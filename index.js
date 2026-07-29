// index.js — Production webhook receiver + API for GHL pipeline sync
// Receives real GHL webhook payloads → updates pipeline → posts to Telegram
// Real schemas: OpportunityStageUpdate, OpportunityCreate, ContactCreate, etc.

const express = require('express');
const { createLead, advanceStage, updateLead, findLead, getPipelineStatus } = require('./engine');
const { processGhlCall, processJustCallTranscript, draftLoiEmail } = require('./transcriptor');
const { startScheduler } = require('./scheduler');
const { USERS, addUser, loadLeads, saveLeads, logEvent, findUserByGhlLocation } = require('./users');
const { GhlClient } = require('./ghl-client');
const { PIPELINE_STAGES, TEXT_SHORTCUTS, FOLLOWUP_TEMPLATES, KEY_CONTACTS } = require('./config');
const { MONTELLI_STAGE_MAP, normalizeMontelliStageValue } = require('./montelli-stage-map');
const {
  normalizeWebhookPayload,
  extractImportMarkers,
  validateAgainstTarget,
  buildAuditReceipt,
  createDiagnosticLogger,
  TARGET: ATLAS_TARGET,
  HANDLER_VERSION: ATLAS_HANDLER_VERSION,
  FIELD_MAP: ATLAS_FIELD_MAP,
  fieldMapChecksum,
} = require('./atlas-ghl-webhook-safety');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;
const DEFAULT_GHL_API_KEY = process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || '';
const DEPLOY_REVISION = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'local';

// ── GHL PipelineStageId → Our Stage mapping (configurable per pipeline) ──
// Each GHL pipeline has stage UUIDs. Map them to our internal stages.
const DEFAULT_STAGE_MAP = {}; // populated from GHL API on first connect

// Load per-user stage mappings
function loadStageMap(userId) {
  const path = require('path');
  const fs = require('fs');
  const file = path.join(__dirname, 'data', userId, 'pipeline-stage-map.json');
  if (fs.existsSync(file)) {
    try { return { ...MONTELLI_STAGE_MAP, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { ...MONTELLI_STAGE_MAP }; }
  }
  return { ...MONTELLI_STAGE_MAP };
}

function getGhlCredentials(user) {
  return {
    apiKey: user?.ghlApiKey || DEFAULT_GHL_API_KEY,
    locationId: user?.ghlLocationId || process.env.GHL_LOCATION_ID || null,
  };
}

function saveStageMap(userId, map) {
  const path = require('path');
  const fs = require('fs');
  const dir = path.join(__dirname, 'data', userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pipeline-stage-map.json'), JSON.stringify(map, null, 2));
}

// Fetch pipeline stages from GHL and auto-map by name
async function syncPipelineStages(userId) {
  const user = USERS[userId];
  const creds = getGhlCredentials(user);
  if (!user || !creds.apiKey || !creds.locationId) throw new Error('No GHL API credentials configured');

  const client = new GhlClient(creds.apiKey, creds.locationId);
  const pipelines = await client.getPipelines();
  const stageMap = {};

  if (pipelines && pipelines.pipelines) {
    for (const pipeline of pipelines.pipelines) {
      if (pipeline.stages) {
        for (const stage of pipeline.stages) {
          const name = (stage.name || '').toLowerCase();
          const mapped = autoMapStageName(name);
          if (mapped) {
            stageMap[stage.id] = mapped;
          }
        }
      }
    }
  }

  saveStageMap(userId, stageMap);
  logEvent(userId, { type: 'stages_synced', count: Object.keys(stageMap).length, map: stageMap });
  return stageMap;
}

// Stage name → internal stage mapping (Montelli Atlas pipeline, 21 stages)
function autoMapStageName(name) {
  const n = name.toLowerCase().trim();
  // Montelli Atlas-Managed pipeline stages (exact matches first)
  if (n.includes('lead entered')) return 'LEAD_ENTERED';
  if (n.includes('contact made')) return 'CONTACT_MADE';
  if (n.includes('offer ready to be sent') || n.includes('offer ready')) return 'OFFER_READY';
  if (n.includes('offer sent')) return 'OFFER_SENT';
  if (n.includes('offer received')) return 'OFFER_RECEIVED';
  if (n.includes('gain feedback') || n.includes('offer ready to gain')) return 'GAIN_FEEDBACK';
  if (n.includes('no answer')) return 'NO_ANSWER';
  if (n.includes('seller declined')) return 'SELLER_DECLINED';
  if (n.includes('active negotiation')) return 'ACTIVE_NEGOTIATION';
  if (n.includes('terms agreed')) return 'TERMS_AGREED';
  if (n.includes('awaiting') && n.includes('title')) return 'AWAITING_TITLE';
  if (n.includes('contract out')) return 'CONTRACT_OUT';
  if (n.includes('under contract') && n.includes('another buyer')) return 'UC_ANOTHER_BUYER';
  if (n.includes('under contract')) return 'UNDER_CONTRACT';
  if (n.includes('sent to buyers')) return 'SENT_TO_BUYERS';
  if (n.includes('inspection complete')) return 'INSPECTION_COMPLETE';
  if (n.includes('appraisal complete')) return 'APPRAISAL_COMPLETE';
  if (n.includes('jv sent')) return 'JV_SENT';
  if (n.includes('jv signed')) return 'JV_SIGNED';
  if (n.includes('wire')) return 'WIRE_SETUP';
  if (n.includes('closing date')) return 'CLOSING_DATE';
  // Generic fallbacks for other pipelines
  if (n.includes('new lead') || n.includes('new')) return 'NEW_LEAD';
  if (n.includes('qualified')) return 'QUALIFIED';
  if (n.includes('closed') || n.includes('won') || n.includes('sold')) return 'CLOSED';
  if (n.includes('lost') || n.includes('dead') || n.includes('declined') || n.includes('archived')) return 'DEAD';
  return null;
}

// ── Webhook: OpportunityStageUpdate (main hook — stages change in GHL) ──
app.post('/webhook/ghl', async (req, res) => {
  const t0 = Date.now();
  try {
    const payload = req.body;
    const webhookType = payload.type;

    // Always acknowledge immediately — GHL expects 200 within seconds
    res.status(200).json({ received: true, type: webhookType });

    switch (webhookType) {
      case 'OpportunityStageUpdate':
      case 'OpportunityStatusUpdate':
      case 'OpportunityCreate': {
        const locationId = payload.locationId;
        const userId = findUserByGhlLocation(locationId);

        if (!userId) {
          console.error(`Unknown GHL locationId: ${locationId}`);
          return;
        }

        const normalizedPayload = normalizeWebhookPayload(req);
        const payloadMarkers = extractImportMarkers(normalizedPayload, null);
        const opportunity = payloadMarkers.markedImport ? null : await fetchAtlasOpportunity(normalizedPayload.opportunityId);
        const importMarkers = extractImportMarkers(normalizedPayload, opportunity);
        if (importMarkers.malformed) {
          console.warn(`[Atlas import] rejected generic webhook for ${normalizedPayload.opportunityId}: malformed Atlas marker`);
          return;
        }
        if (importMarkers.markedImport) {
          const validation = validateAgainstTarget('lead-entered', normalizedPayload, opportunity);
          if (!validation.ok) {
            console.warn(`[Atlas import] rejected generic webhook for ${normalizedPayload.opportunityId}: ${validation.errors.join(', ')}`);
            return;
          }
          const audit = buildAuditReceipt({ endpoint: 'generic', payload: normalizedPayload, validation, markers: importMarkers });
          console.log(`[Atlas import] generic safe receipt: ${JSON.stringify(audit)}`);
          atlasWebhookDiagnostics.write({ ...audit, tookMs: Date.now() - t0 });
          return;
        }

        const stageMap = loadStageMap(userId.id);
        const stageNormalization = normalizeMontelliStageValue(payload.pipelineStageId);
        const pipelineStageId = stageNormalization.stageId;
        const address = payload.name; // GHL Opportunity Name = property address

        if (!address) return;

        const existingLead = findLead(userId.id, address);
        const ghlStage = stageMap[pipelineStageId];
        if (stageNormalization.normalized) {
          console.log(`Normalized GHL stage name "${payload.pipelineStageId}" to ${pipelineStageId}`);
        } else if (payload.pipelineStageId && !ghlStage) {
          console.warn(`Unmapped GHL pipelineStageId value: ${payload.pipelineStageId}`);
        }

        if (webhookType === 'OpportunityCreate' && !existingLead) {
          // Auto-create lead from GHL
          const leadData = {
            address: address,
            price: payload.monetaryValue || null,
            contactType: 'agent',
            source: 'ghl_webhook',
            notes: `GHL ID: ${payload.id}`
          };

          createLead(userId.id, leadData);

          // If we can map the stage, advance
          if (ghlStage) {
            advanceStage(userId.id, address, ghlStage, `GHL stage: ${pipelineStageId}`);
          }
        } else if (existingLead && ghlStage && existingLead.stage !== ghlStage) {
          advanceStage(userId.id, address, ghlStage, `GHL webhook: ${webhookType}`);
        }

        // Fetch contact details (async, best-effort)
        fetchGhlContactAndEnrich(userId, payload);

        logEvent(userId.id, {
          type: 'ghl_webhook',
          webhookType,
          address,
          pipelineStageId,
          originalPipelineStageId: payload.pipelineStageId,
          stageNormalization: stageNormalization.reason,
          mappedStage: ghlStage,
          tookMs: Date.now() - t0
        });
        break;
      }

      case 'InboundMessage':
      case 'OutboundMessage': {
        // Future: SMS message tracking
        logEvent('montelli', {
          type: 'message_webhook',
          webhookType,
          contactId: payload.contactId,
          message: (payload.body || payload.message || '').substring(0, 100)
        });
        break;
      }

      case 'AppointmentCreate':
      case 'TaskCreate':
      case 'TaskComplete': {
        // Future: calendar/task sync
        logEvent('montelli', {
          type: 'task_webhook',
          webhookType,
          payload: JSON.stringify(payload).substring(0, 200)
        });
        break;
      }

      default:
        // Log unknown webhooks for future use
        logEvent('montelli', { type: 'unknown_webhook', webhookType });
    }
  } catch (err) {
    console.error(`GHL webhook error (${Date.now() - t0}ms):`, err.message);
    // Response already sent above, just logging
  }
});

// ── GHL workflow-only hooks (Montelli Atlas pipeline) ──
const GHL_TOKEN = process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || '';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'nSf3NXYVkt8X4PgW9aZ3';
const MONTELLI_USER = process.env.GHL_MONTELLI_USER_ID || 'PGfXxlXCRXs3hXN3Gq7R';
const FORBIDDEN_PIPELINE_ID = 'ygQaJ2hi7ouJeA5HR7uu';
const atlasWebhookDiagnostics = createDiagnosticLogger();

function ghlWorkflowGuard(req, res) {
  const body = req.body || {};
  const query = req.query || {};
  const payload = { ...query, ...body };
  req.ghlWorkflowPayload = payload;
  if (payload.pipelineId === FORBIDDEN_PIPELINE_ID) {
    res.status(403).json({ status: 'REJECTED', reason: 'forbidden pipeline' });
    return false;
  }
  if (payload.pipelineId && payload.pipelineId !== GHL_PIPELINE_ID) {
    res.status(403).json({ status: 'REJECTED', reason: 'wrong pipeline' });
    return false;
  }
  if (payload.assignedTo && payload.assignedTo !== MONTELLI_USER) {
    res.status(403).json({ status: 'REJECTED', reason: 'wrong user' });
    return false;
  }
  if (!payload.opportunityId) {
    res.status(400).json({ status: 'ERROR', reason: 'opportunityId required' });
    return false;
  }
  return true;
}

async function fetchAtlasOpportunity(opportunityId) {
  if (!GHL_TOKEN || !opportunityId) return null;
  try {
    const response = await ghlRequest('GET', `/opportunities/${opportunityId}`);
    return response.opportunity || response;
  } catch (e) {
    console.log(`[Atlas webhook] opportunity fetch failed for ${opportunityId}: ${e.message}`);
    return null;
  }
}

async function prepareAtlasWebhook(endpoint, req, res) {
  const payload = normalizeWebhookPayload(req);
  req.ghlWorkflowPayload = payload;

  if (payload.pipelineId === FORBIDDEN_PIPELINE_ID) {
    res.status(403).json({ status: 'REJECTED', reason: 'forbidden pipeline' });
    return null;
  }

  const opportunity = await fetchAtlasOpportunity(payload.opportunityId);
  const validation = validateAgainstTarget(endpoint, payload, opportunity);
  if (!validation.ok) {
    res.status(payload.opportunityId ? 403 : 400).json({ status: 'REJECTED', reason: validation.errors.join(', ') });
    return null;
  }

  const markers = extractImportMarkers(payload, opportunity);
  if (markers.malformed) {
    res.status(403).json({ status: 'REJECTED', reason: 'malformed Atlas marker' });
    return null;
  }

  if (endpoint === 'lead-entered' && markers.markedImport) {
    const audit = buildAuditReceipt({ endpoint, payload, validation, markers });
    console.log(`[Atlas ${endpoint}] safe import receipt: ${JSON.stringify(audit)}`);
    atlasWebhookDiagnostics.write(audit);
    res.status(200).json({ status: 'OK', markedImport: true });
    return { payload, opportunity, validation, markers, safeImportAcked: true };
  }

  res.status(200).json({ status: 'OK', markedImport: markers.markedImport });
  return { payload, opportunity, validation, markers, safeImportAcked: false };
}

async function ghlRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'services.leadconnectorhq.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${GHL_TOKEN}`,
        Version: '2023-02-21',
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', chunk => { d += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ _raw: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

app.post('/webhook/ghl/lead-entered', async (req, res) => {
  const atlas = await prepareAtlasWebhook('lead-entered', req, res);
  if (!atlas) return;
  if (atlas.safeImportAcked) return;
  try {
    const { payload, markers } = atlas;
    const { address, askingPrice, monthlyRent, sqft, beds, baths, contactId } = payload;
    const preScreen = {
      address,
      buyBoxMatch: askingPrice >= 150000 && askingPrice <= 550000 && sqft > 0,
      askingPrice: askingPrice || null,
      estimatedRent: monthlyRent || null,
      beds: beds || null,
      baths: baths || null,
      sqft: sqft || null,
      recommendedAction: (askingPrice && askingPrice >= 150000 && askingPrice <= 550000)
        ? 'queue_for_int_call'
        : 'auto_decline',
      screenedAt: new Date().toISOString(),
    };
    console.log(`[Atlas lead-entered] pre-screen for ${address}`);
    console.log(`[Atlas lead-entered] pre-screen result: ${JSON.stringify(preScreen)}`);
    if (contactId && GHL_TOKEN) {
      await ghlRequest('POST', `/contacts/${contactId}/notes`, {
        body: `=== Stage 1: Lead Entered (Atlas pre-screen) ===\n${new Date().toISOString()}\nAddress: ${address}\nBuy Box Match: ${preScreen.buyBoxMatch}\nRecommended Action: ${preScreen.recommendedAction}\nAsking: $${askingPrice || 'N/A'}\nRent est: $${monthlyRent || 'N/A'}`,
      }).catch(e => console.log('[Atlas lead-entered] note write failed:', e.message));
    }
    await logEvent('montelli', {
      type: 'lead_entered_prescreen',
      pipelineId: payload.pipelineId || GHL_PIPELINE_ID,
      opportunityId: payload.opportunityId,
      contactId: contactId || null,
      markedImport: markers.markedImport,
      importBatchId: markers.batchId || null,
      sourceRowId: markers.sourceRowId || null,
      preScreen,
    });
  } catch (err) {
    console.error('[Atlas lead-entered] error:', err.message);
  }
});

app.post('/webhook/ghl/offer-ready', async (req, res) => {
  const atlas = await prepareAtlasWebhook('offer-ready', req, res);
  if (!atlas) return;
  try {
    const { payload, markers } = atlas;
    const { opportunityId, address, askingPrice, monthlyRent, sqft, isRental, appraisalValue, contactId } = payload;
    const aru = appraisalValue || askingPrice || 0;
    const lenderValue = Math.round(aru * 0.7);
    const interestRate = 0.07;
    const monthlyPayment = Math.round((lenderValue * interestRate) / 12);
    const dscr = monthlyPayment > 0 ? Number((monthlyRent / monthlyPayment).toFixed(2)) : 0;
    const onePctPass = askingPrice > 0 ? (monthlyRent / askingPrice) >= 0.01 : false;
    const cashFlow = monthlyRent - monthlyPayment;
    const recommendedStrategy = (() => {
      if (isRental && monthlyRent > 0 && onePctPass) return 'Stack50';
      if (monthlyRent > 0 && dscr >= 1.25) return 'SubTo';
      if (monthlyRent > 0) return 'DSCR';
      return 'Cash';
    })();
    const offerSummary = {
      cash: { offer: Math.round(aru * 0.7 - (sqft || 1500) * 30 - 20000), structure: '0.70×ARV − repairs − fee' },
      f50: { offer: Math.round(aru * 0.65), structure: '50% down + 50% carryback' },
      f10: { offer: Math.round(aru * 0.65), structure: '10% down + 90% in 24mo' },
      subTo: { offer: Math.round(aru * 0.9), structure: 'Take over existing loan' },
      midTerm: { offer: aru, monthlyRent: Math.round(aru * 0.012), structure: '1.2% rule FF' },
    };
    const result = {
      opportunityId,
      aru,
      lenderValue,
      interestRate,
      monthlyPayment,
      dscr,
      onePctPass,
      cashFlow,
      recommendedStrategy,
      offers: offerSummary,
      computedAt: new Date().toISOString(),
    };
    console.log(`[Atlas offer-ready] ${opportunityId} ${address} ARU=$${aru}`);
    console.log(`[Atlas offer-ready] recommended: ${recommendedStrategy}, cash flow: $${cashFlow}/mo, DSCR: ${dscr}`);
    if (contactId && GHL_TOKEN) {
      await ghlRequest('POST', `/contacts/${contactId}/notes`, {
        body: `=== Offer Calc (Atlas webhook) ===\n${new Date().toISOString()}\nARU: $${aru.toLocaleString()}\nLender Value (70%): $${lenderValue.toLocaleString()}\nMonthly P&I: $${monthlyPayment.toLocaleString()}\nCash Flow: $${cashFlow.toLocaleString()}/mo\nDSCR: ${dscr} (threshold 1.25)\n1% Rule: ${onePctPass ? 'PASS' : 'FAIL'}\nRecommended Strategy: ${recommendedStrategy}`,
      }).catch(e => console.log('[Atlas offer-ready] note write failed:', e.message));
    }
    await logEvent('montelli', {
      type: 'offer_ready_calc',
      pipelineId: payload.pipelineId || GHL_PIPELINE_ID,
      opportunityId,
      contactId: contactId || null,
      markedImport: markers.markedImport,
      importBatchId: markers.batchId || null,
      sourceRowId: markers.sourceRowId || null,
      result,
    });
  } catch (err) {
    console.error('[Atlas offer-ready] error:', err.message);
  }
});

// ── Background: enrich lead with GHL contact data ──
async function fetchGhlContactAndEnrich(user, opportunityPayload) {
  try {
    const creds = getGhlCredentials(user);
    if (!creds.apiKey || !creds.locationId || !opportunityPayload.contactId) return;

    const client = new GhlClient(creds.apiKey, creds.locationId);
    const contact = await client.getContact(opportunityPayload.contactId);

    if (contact && contact.contact) {
      const c = contact.contact;
      const address = opportunityPayload.name || opportunityPayload.name;
      if (!address) return;

      const updates = {};
      if (c.contactName && !c.contactName.includes('Unknown')) updates.agentName = c.contactName;
      if (c.email) updates.agentEmail = c.email;
      if (c.phone) updates.agentPhone = c.phone;

      if (Object.keys(updates).length > 0) {
        updateLead(user.id, address, updates);
      }
    }
  } catch (err) {
    // Silent fail — contact enrichment is best-effort
    console.error(`Contact enrich failed: ${err.message}`);
  }
}

// ── API: Get GHL pipeline stage map ──
app.get('/api/ghl/pipelines/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = USERS[userId];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const creds = getGhlCredentials(user);
    if (!creds.apiKey || !creds.locationId) return res.status(400).json({ error: 'No GHL API credentials configured for user' });

    const client = new GhlClient(creds.apiKey, creds.locationId);
    const pipelines = await client.getPipelines();
    const stageMap = loadStageMap(userId);

    // Return pipelines with human-readable stage mapping
    const result = {
      locationId: creds.locationId,
      pipelines: pipelines.pipelines?.map(p => ({
        id: p.id,
        name: p.name,
        stages: p.stages?.map(s => ({
          id: s.id,
          name: s.name,
          mappedTo: stageMap[s.id] || null
        }))
      })),
      mappedCount: Object.keys(stageMap).length
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Sync stages from GHL ──
app.post('/api/ghl/sync-stages/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const stageMap = await syncPipelineStages(userId);
    res.json({ stages: Object.keys(stageMap).length, map: stageMap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Get GHL opportunities ──
app.get('/api/ghl/opportunities/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = USERS[userId];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const creds = getGhlCredentials(user);
    if (!creds.apiKey || !creds.locationId) return res.status(400).json({ error: 'No GHL API credentials configured' });

    const client = new GhlClient(creds.apiKey, creds.locationId);
    const ops = await client.searchOpportunities();

    const stageMap = loadStageMap(userId);
    const mapped = (ops.opportunities || ops.data || []).map(op => ({
      id: op.id,
      name: op.name,
      monetaryValue: op.monetaryValue,
      status: op.status,
      pipelineStageId: op.pipelineStageId,
      mappedStage: stageMap[op.pipelineStageId] || null,
      contactId: op.contactId,
      dateAdded: op.dateAdded
    }));

    res.json({ opportunities: mapped, count: mapped.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Import GHL opportunities into our pipeline ──
app.post('/api/ghl/import/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = USERS[userId];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const creds = getGhlCredentials(user);
    if (!creds.apiKey || !creds.locationId) return res.status(400).json({ error: 'No GHL API credentials configured' });

    const client = new GhlClient(creds.apiKey, creds.locationId);
    const ops = await client.searchOpportunities();
    const stageMap = loadStageMap(userId);

    const imported = [];
    const skipped = [];

    for (const op of (ops.opportunities || ops.data || [])) {
      const address = op.name;
      if (!address) { skipped.push({ id: op.id, reason: 'no_name' }); continue; }

      const existing = findLead(userId, address);
      if (existing) {
        skipped.push({ id: op.id, address, reason: 'already_exists' });
        continue;
      }

      const leadData = {
        address,
        price: op.monetaryValue || null,
        source: 'ghl_import',
        notes: `GHL ID: ${op.id}`
      };

      createLead(userId, leadData);

      const mappedStage = stageMap[op.pipelineStageId];
      if (mappedStage) {
        advanceStage(userId, address, mappedStage, `Imported from GHL at stage ${op.pipelineStageId}`);
      }

      imported.push({ id: op.id, address, stage: mappedStage || 'NEW_LEAD' });
    }

    logEvent(userId, { type: 'ghl_import', imported: imported.length, skipped: skipped.length });
    res.json({ imported, skipped, total: imported.length + skipped.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function bootstrapStageMaps() {
  try {
    for (const userId of Object.keys(USERS)) {
      const creds = getGhlCredentials(USERS[userId]);
      if (!creds.apiKey || !creds.locationId) continue;
      const existing = loadStageMap(userId);
      if (!existing || Object.keys(existing).length === 0) {
        await syncPipelineStages(userId);
      }
    }
  } catch (err) {
    console.error(`Stage map bootstrap failed: ${err.message}`);
  }
}

setImmediate(() => {
  bootstrapStageMaps();
});

// ── Pipeline API (same as before, now production-backed) ──
app.post('/api/pipeline', (req, res) => {
  try {
    const { action, userId, ...data } = req.body;
    const uid = userId || 'montelli';

    switch (action) {
      case 'create_lead':
        return res.json(createLead(uid, data));

      case 'advance_stage':
        return res.json(advanceStage(uid, data.address, data.stage, data.note));

      case 'update_lead':
        return res.json(updateLead(uid, data.address, data.updates));

      case 'status':
        return res.json(getPipelineStatus(uid));

      case 'draft_loi': {
        const lead = findLead(uid, data.address);
        if (!lead) return res.json({ error: 'Lead not found' });
        return res.json(draftLoiEmail(lead, {}));
      }

      case 'search':
        return res.json({ lead: findLead(uid, data.address) });

      case 'add_user':
        return res.json(addUser(data.userId, data.config));

      case 'followup_templates':
        return res.json({ templates: FOLLOWUP_TEMPLATES, shortcuts: TEXT_SHORTCUTS });

      default:
        return res.json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => res.json({
  service: 'AI REI Pipeline Engine',
  version: '1.0.0',
  baseUrl: `${req.protocol}://${req.get('host')}`,
  endpoints: {
    webhook: 'POST /webhook/ghl',
    api: 'POST /api/pipeline',
    ghlPipelines: 'GET /api/ghl/pipelines/:userId',
    ghlSync: 'POST /api/ghl/sync-stages/:userId',
    ghlOpportunities: 'GET /api/ghl/opportunities/:userId',
    ghlImport: 'POST /api/ghl/import/:userId'
  }
}));

app.get('/health/atlas', (req, res) => {
  const token = String(process.env.GHL_READ_TOKEN || process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.LEADCONNECTOR_TOKEN || process.env.GHL_API_TOKEN || process.env.GHL_TOKEN || process.env.GHL_ACCESS_TOKEN || process.env.GHL_API_KEY || '').trim().replace(/^Bearer\s+/i, '');
  const computedFieldMapHash = fieldMapChecksum(ATLAS_FIELD_MAP);
  res.json({
    ok: true,
    revision: DEPLOY_REVISION,
    handlerVersion: ATLAS_HANDLER_VERSION,
    atlasTarget: ATLAS_TARGET,
    fieldMapHash: ATLAS_FIELD_MAP.fieldMapChecksum,
    fieldMapHashValid: computedFieldMapHash === ATLAS_FIELD_MAP.fieldMapChecksum,
    credentialProbe: {
      present: Boolean(token),
      malformed: Boolean(token && (/REPLACE|YOUR_|_KEY$/i.test(token) || /^Bearer\s+/i.test(token))),
      display: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : '',
    },
    safeBypass: {
      leadEntered: true,
      generic: true,
      offerReadySuppression: false,
    },
    databaseUrlProvisionedByThisRevision: false,
    atlasPathUsesDatabaseUrl: false,
    atlasPathUsesNeon: false,
    atlasPathUsesDivinity: false,
    writesDuringHealthCheck: 0,
    outreachDuringHealthCheck: 0,
  });
});

app.listen(PORT, () => {
  console.log(`AI REI Pipeline Engine v1.0 on port ${PORT}`);
  console.log(`GHL webhook: POST /webhook/ghl`);
  console.log(`GHL stages: POST /api/ghl/sync-stages/:userId`);
  console.log(`GHL import: POST /api/ghl/import/:userId`);
});

module.exports = app;
