// index.js — Production webhook receiver + API for GHL pipeline sync
// Receives real GHL webhook payloads → updates pipeline → posts to Telegram
// Real schemas: OpportunityStageUpdate, OpportunityCreate, ContactCreate, etc.

const express = require('express');
const { createLead, advanceStage, updateLead, findLead, getPipelineStatus } = require('./engine');
const { processGhlCall, processJustCallTranscript, draftLoiEmail } = require('./transcriptor');
const { startScheduler } = require('./scheduler');
const { USERS, addUser, loadLeads, saveLeads, logEvent, findUserByGhlLocation, isPPCLocation, PPC_LOCATION_ID, PPC_PIPELINE_ID } = require('./users');
const { GhlClient } = require('./ghl-client');
const { PIPELINE_STAGES, TEXT_SHORTCUTS, FOLLOWUP_TEMPLATES, KEY_CONTACTS } = require('./config');
const { MONTELLI_STAGE_MAP, normalizeMontelliStageValue } = require('./montelli-stage-map');
const {
  normalizeWebhookPayload,
  extractImportMarkers,
  extractTelegramOutreachMarkers,
  acknowledgeTelegramOutreachTransition,
  validateAgainstTarget,
  buildAuditReceipt,
  createDiagnosticLogger,
  TARGET: ATLAS_TARGET,
  HANDLER_VERSION: ATLAS_HANDLER_VERSION,
  FIELD_MAP: ATLAS_FIELD_MAP,
  fieldMapChecksum,
} = require('./atlas-ghl-webhook-safety');
const { initialize: initDeliveryProcessor, handleSmsStatusUpdated } = require('./modules/delivery-state-processor.cjs');

const app = express();
app.use(express.json());

// Contact-card media route — serves approved vCard for JustCall MMS
app.use(require('./routes/contact-card-media').router);

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

// ── PPC Forwarding (transport-only — no business logic here) ──────────────────────────
// Render receives GHL event → recognizes PPC location → forwards to local PPC runtime
// Local runtime at port 3000 is authoritative for: ownership, DND, idempotency, JustCall send
const PPC_FORWARD_TIMEOUT_MS = 8000;

/**
 * Forward a PPC pipeline event to the local canonical PPC runtime via Cloudflare Tunnel.
 * @param {string} forwardUrl — the public Cloudflare Tunnel URL for the PPC runtime
 * @param {object} payload — original GHL webhook payload
 * @param {string} webhookType — OpportunityCreate | OpportunityStageUpdate
 */
async function forwardToPpcRuntime(forwardUrl, payload, webhookType) {
  const secret = process.env.PPC_FORWARD_WEBHOOK_SECRET || '';
  const body = JSON.stringify({
    source: 'render_ppc_forward',
    forwardOf: webhookType,
    receivedAt: new Date().toISOString(),
    locationId: payload.locationId,
    pipelineId: payload.pipelineId,
    opportunityId: payload.opportunityId || payload.id,
    pipelineStageId: payload.pipelineStageId,
    name: payload.name,
    monetaryValue: payload.monetaryValue,
    assignedTo: payload.assignedTo,
    type: webhookType,
  });

  return new Promise((resolve, reject) => {
    try {
      const url = new URL(forwardUrl);
      const https = require('https');
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-PPC-Webhook-Secret': secret,
          'User-Agent': 'prolific-ghl-webhook/1.0 PPC-forwarder',
        },
        timeout: PPC_FORWARD_TIMEOUT_MS,
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[PPC forward] → ${forwardUrl} OK ${res.statusCode}`);
            resolve({ ok: true, status: res.statusCode, body: d.slice(0, 200) });
          } else {
            reject(new Error(`PPC forward HTTP ${res.statusCode}: ${d.slice(0, 100)}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('PPC forward timeout')); });
      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Webhook: OpportunityStageUpdate (main hook — stages change in GHL) ──
app.post('/webhook/ghl', async (req, res) => {
  const t0 = Date.now();
  try {
    const payload = req.body;
    const webhookType = payload.type;

    const normalizedPayload = normalizeWebhookPayload(req);
    const telegramMarkers = extractTelegramOutreachMarkers(normalizedPayload, null);
    if (telegramMarkers.malformed || telegramMarkers.markedTelegramOutreach || telegramMarkers.source) {
      const ack = acknowledgeTelegramOutreachTransition(normalizedPayload, telegramMarkers);
      res.status(ack.ok ? 200 : 403).json(ack);
      if (ack.ok) {
        const validation = validateAgainstTarget('generic', normalizedPayload, null);
        atlasWebhookDiagnostics.write({ ...buildAuditReceipt({ endpoint: 'generic', payload: normalizedPayload, validation, markers: telegramMarkers }), telegramTransition: ack, tookMs: Date.now() - t0 });
      }
      return;
    }

    // Always acknowledge immediately — GHL expects 200 within seconds
    res.status(200).json({ received: true, type: webhookType });

    switch (webhookType) {
      case 'OpportunityStageUpdate':
      case 'OpportunityStatusUpdate':
      case 'OpportunityCreate': {
        const locationId = payload.locationId;
        const userId = findUserByGhlLocation(locationId);

        // ── Divinity Align PPC forwarding ──────────────────────────────────
        // If not Atlas but is the PPC location AND we have a forward URL, route to local PPC runtime.
        // Render is TRANSPORT ONLY — no PPC business logic lives here.
        if (!userId && isPPCLocation(locationId)) {
          const forwardUrl = process.env.PPC_FORWARD_WEBHOOK_URL;
          if (forwardUrl) {
            forwardToPpcRuntime(forwardUrl, payload, webhookType).catch(err => {
              console.error(`[PPC forward] failed: ${err.message}`);
            });
            console.log(`[PPC forward] routed opp ${payload.id} (${payload.name}) type=${webhookType} pipeline=${payload.pipelineId}`);
          } else {
            console.warn(`[PPC forward] skipped — PPC_FORWARD_WEBHOOK_URL not set. Opp ${payload.id} dropped.`);
          }
          return;
        }
        // ───────────────────────────────────────────────────────────────────

        if (!userId) {
          console.error(`Unknown GHL locationId: ${locationId}`);
          return;
        }

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

  const telegramMarkers = extractTelegramOutreachMarkers(payload, null);
  if (telegramMarkers.malformed || telegramMarkers.markedTelegramOutreach || telegramMarkers.source) {
    const ack = acknowledgeTelegramOutreachTransition(payload, telegramMarkers);
    res.status(ack.ok ? 200 : 403).json(ack);
    if (ack.ok) {
      const validation = validateAgainstTarget(endpoint, payload, null);
      atlasWebhookDiagnostics.write({ ...buildAuditReceipt({ endpoint, payload, validation, markers: telegramMarkers }), telegramTransition: ack });
    }
    return null;
  }

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

// ── JustCall Webhook ──
const GHL_JC_TOKEN = process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || '';
const GHL_JC_LOCATION_ID = process.env.GHL_LOCATION_ID || '61XPzSqRy7UKMwW9DeB8';
const MONTELLI_USER_ID = process.env.GHL_MONTELLI_USER_ID || 'PGfXxlXCRXs3hXN3Gq7R';
const PPC_PIPELINE_ID = 'o4hvfO7adOQlLdtqPNIn';
const JC_DEDUPE_MAX = 5000;

// GHL HTTP helper (native https, no SDK dependency)
function ghlJcRequest(method, path, body) {
  return new Promise((ok, fail) => {
    const https = require('https');
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'services.leadconnectorhq.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${GHL_JC_TOKEN}`,
        Version: '2023-02-21',
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { ok(JSON.parse(d)); } catch { ok({ _raw: d }); }
      });
    });
    req.on('error', fail);
    if (data) req.write(data);
    req.end();
  });
}

// PPC Auto-Assignment: when Montelli calls/texts a lead, assign their PPC opportunity to him
async function autoAssignPpcLead(phoneNumber) {
  if (!phoneNumber) return { action: 'skipped', reason: 'no phone number' };
  const digits = phoneNumber.replace(/\D/g, '');
  const normalized = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+${digits}`;
  try {
    const searchRes = await ghlJcRequest('GET', `/contacts/search?locationId=${GHL_JC_LOCATION_ID}&query=${encodeURIComponent(normalized)}`);
    const contacts = searchRes?.contacts || [];
    if (contacts.length === 0) return { action: 'skipped', reason: 'no contact found for phone', phone: normalized };
    for (const contact of contacts) {
      const contactId = contact.id;
      const oppRes = await ghlJcRequest('GET', `/opportunities/search?location_id=${GHL_JC_LOCATION_ID}&pipeline_id=${PPC_PIPELINE_ID}&contact_id=${contactId}&limit=10`);
      const opportunities = oppRes?.opportunities || [];
      for (const opp of opportunities) {
        if (opp.assignedTo !== MONTELLI_USER_ID) {
          await ghlJcRequest('PUT', `/opportunities/${opp.id}?locationId=${GHL_JC_LOCATION_ID}`, {
            assignedTo: MONTELLI_USER_ID,
            pipelineStageId: opp.pipelineStageId
          });
          console.log(`[Atlas PPC] Assigned ${opp.name} (${opp.id}) to Montelli`);
          await ghlJcRequest('POST', `/contacts/${contactId}/notes`, {
            body: `=== PPC LEAD ASSIGNED ===\n${new Date().toISOString()}\nLead auto-assigned to Montelli after phone contact.\nOpportunity: ${opp.name}\nPhone: ${normalized}`
          });
        }
      }
      if (opportunities.length > 0) return { action: 'assigned', contactId, opportunitiesAssigned: opportunities.length, phone: normalized };
    }
    return { action: 'skipped', reason: 'no PPC opportunities found for contact', phone: normalized };
  } catch (e) {
    console.error(`[Atlas PPC] Auto-assignment error: ${e.message}`);
    return { action: 'error', reason: e.message, phone: normalized };
  }
}

const seenJcEvents = new Set();
function dedupeJc(key) {
  if (seenJcEvents.has(key)) return true;
  seenJcEvents.add(key);
  if (seenJcEvents.size > JC_DEDUPE_MAX) {
    const arr = Array.from(seenJcEvents);
    seenJcEvents.clear();
    arr.slice(-JC_DEDUPE_MAX / 2).forEach(k => seenJcEvents.add(k));
  }
  return false;
}

app.post('/webhook/justcall', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const payload = req.body;
    const type = payload.type || payload.event;
    const eventId = payload.data?.id || payload.data?.call_sid || payload.request_id || Math.random();
    if (dedupeJc(`${type}:${eventId}`)) {
      console.log(`[Atlas JustCall] Duplicate event skipped: ${type}:${eventId}`);
      return;
    }
    console.log(`[Atlas JustCall] ${type}: ${JSON.stringify(payload.data || {}).slice(0, 100)}`);

    if (type === 'call.completed' || type === 'call.ended') {
      const callData = payload.data || {};
      const contactId = callData.contact_id || callData.ghl_contact_id;
      const callerNumber = callData.from_number || callData.to_number || callData.contact_number;
      if (callerNumber) {
        autoAssignPpcLead(callerNumber).then(result => {
          console.log(`[Atlas PPC] Call auto-assignment: ${JSON.stringify(result)}`);
        }).catch(e => console.error(`[Atlas PPC] Call auto-assignment failed: ${e.message}`));
      }
      if (contactId) {
        const noteBody = `=== CALL COMPLETED ===\n${new Date().toISOString()}\nCall ID: ${callData.id}\nFrom: ${callData.from_number || 'unknown'}\nTo: ${callData.to_number || 'unknown'}\nDirection: ${callData.direction || 'unknown'}\nDuration: ${callData.duration || 'unknown'}s\nDisposition: ${callData.disposition || 'unknown'}\nRecording: ${callData.recording_url || 'N/A'}\nVoicemail: ${callData.voicemail_url || 'N/A'}\nNotes: ${callData.notes || 'N/A'}`;
        try {
          await ghlJcRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
          console.log(`[Atlas JustCall] Call logged to contact ${contactId}`);
        } catch (e) {
          console.error(`[Atlas JustCall] Failed to log call: ${e.message}`);
        }
      }
    }

    if (type === 'sms.received' || type === 'text.received') {
      const smsData = payload.data || {};
      const contactId = smsData.contact_id || smsData.ghl_contact_id;
      const senderNumber = smsData.from_number || smsData.contact_number;
      if (senderNumber) {
        autoAssignPpcLead(senderNumber).then(result => {
          console.log(`[Atlas PPC] SMS auto-assignment: ${JSON.stringify(result)}`);
        }).catch(e => console.error(`[Atlas PPC] SMS auto-assignment failed: ${e.message}`));
      }
      if (contactId) {
        const noteBody = `=== SMS RECEIVED ===\n${new Date().toISOString()}\nFrom: ${smsData.from_number || 'unknown'}\nBody: ${(smsData.body || '').slice(0, 200)}`;
        try {
          await ghlJcRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
          console.log(`[Atlas JustCall] SMS logged to contact ${contactId}`);
        } catch (e) {
          console.error(`[Atlas JustCall] Failed to log SMS: ${e.message}`);
        }
      }
    }

    if (type === 'sms.sent' || type === 'text.sent') {
      const smsData = payload.data || {};
      const contactId = smsData.contact_id || smsData.ghl_contact_id;
      const recipientNumber = smsData.to_number || smsData.contact_number;
      if (recipientNumber) {
        autoAssignPpcLead(recipientNumber).then(result => {
          console.log(`[Atlas PPC] Outbound SMS auto-assignment: ${JSON.stringify(result)}`);
        }).catch(e => console.error(`[Atlas PPC] Outbound SMS auto-assignment failed: ${e.message}`));
      }
      if (contactId) {
        const noteBody = `=== SMS SENT ===\n${new Date().toISOString()}\nTo: ${smsData.to_number || 'unknown'}\nBody: ${(smsData.body || '').slice(0, 200)}`;
        try {
          await ghlJcRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
          console.log(`[Atlas JustCall] Outbound SMS logged to contact ${contactId}`);
        } catch (e) {
          console.error(`[Atlas JustCall] Failed to log outbound SMS: ${e.message}`);
        }
      }
    }

    if (type === 'call.ai_report') {
      const aiData = payload.data || {};
      const callId = aiData.id;
      const callScore = aiData.call_score;
      const callSummary = aiData.call_summary;
      const customerSentiment = aiData.customer_sentiment;
      const callTags = (aiData.tags || []).join(', ');
      const callMoments = aiData.call_moments || [];
      const transcription = aiData.call_transcription || [];
      const contactId = aiData.contact_id || aiData.ghl_contact_id;

      if (!contactId) {
        console.log(`[Atlas JustCall] No contactId in AI report`);
        return;
      }

      let transcriptionText = '';
      if (transcription.length > 0) {
        transcriptionText = transcription.map(seg => {
          const speaker = seg.speaker || seg.role || 'Speaker';
          const text = seg.text || seg.message || '';
          const time = seg.start_time || '';
          return `[${time}] ${speaker}: ${text}`;
        }).join('\n');
      }

      let momentsText = '';
      if (callMoments.length > 0) {
        momentsText = callMoments.map(m => {
          const time = m.start_time || '';
          const title = m.title || 'Moment';
          const desc = m.description || '';
          return `• [${time}] ${title}: ${desc}`;
        }).join('\n');
      }

      const noteBody = `=== AI COACHING REPORT ===\n${new Date().toISOString()}\nCall ID: ${callId}\nCall Score: ${callScore || 'N/A'}/100\nCustomer Sentiment: ${customerSentiment || 'N/A'}\nTags: ${callTags || 'none'}\n\n--- SUMMARY ---\n${callSummary || 'No summary'}\n\n${momentsText ? '--- KEY MOMENTS ---\n' + momentsText + '\n\n' : ''}${transcriptionText ? '--- TRANSCRIPT ---\n' + transcriptionText.slice(0, 3000) + (transcriptionText.length > 3000 ? '\n[...truncated]' : '') : ''}`;
      try {
        await ghlJcRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
        console.log(`[Atlas JustCall] Full AI coaching + transcript logged to contact ${contactId}`);
      } catch (e) {
        console.error(`[Atlas JustCall] Failed to log AI report: ${e.message}`);
      }
    }
  } catch (err) {
    console.error('JustCall webhook error:', err.message);
  }
});

// ── Webhook: JustCall sms.status_updated (delivery status updates) ──
app.post('/webhook/justcall', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const payload = req.body || {};
    const type = payload.action || payload.type;
    
    if (type === 'sms.status_updated') {
      console.log(`[Delivery State] sms.status_updated received: ${JSON.stringify(payload.data || {}).slice(0, 150)}`);
      const result = await handleSmsStatusUpdated(payload);
      if (result.success) {
        console.log(`[Delivery State] Processed: ${result.action} for message ${payload.data?.id}`);
      } else {
        console.warn(`[Delivery State] Processing failed: ${result.error}`);
      }
      return;
    }
    
    // Fall through to existing JustCall handler for other event types
  } catch (err) {
    console.error('JustCall sms.status_updated error:', err.message);
  }
});

// Health check
app.get('/', (req, res) => res.json({
  service: 'AI REI Pipeline Engine',
  version: '1.0.0',
  baseUrl: `${req.protocol}://${req.get('host')}`,
  endpoints: {
    webhook: 'POST /webhook/ghl',
    justcallWebhook: 'POST /webhook/justcall',
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
    telegramOutreachMarkers: {
      supported: true,
      source: 'TELEGRAM_ATLAS_OUTREACH',
      acknowledgement: 'ATLAS_TELEGRAM_STAGE_TRANSITION_ACKNOWLEDGED_NO_OUTREACH',
      requiredFields: ['source', 'opportunityId', 'contactId', 'locationId', 'pipelineId', 'atlas_telegram_action_id', 'atlas_telegram_transition_id', 'atlas_telegram_idempotency_key', 'atlas_telegram_from_stage_id', 'atlas_telegram_to_stage_id', 'atlas_telegram_transition_at'],
      sendsDuringAcknowledgement: 0,
      writesDuringAcknowledgement: 0,
      stageMovementsDuringAcknowledgement: 0,
    },
    databaseUrlProvisionedByThisRevision: false,
    atlasPathUsesDatabaseUrl: false,
    atlasPathUsesNeon: false,
    atlasPathUsesDivinity: false,
    writesDuringHealthCheck: 0,
    outreachDuringHealthCheck: 0,
  });
});

// Initialize delivery state processor on startup
const PPC_DB_URL = process.env.PPC_AUTOMATION_DATABASE_URL || process.env.DATABASE_URL;
if (PPC_DB_URL) {
  initDeliveryProcessor(PPC_DB_URL).then(() => {
    console.log('[Startup] Delivery state processor initialized');
  }).catch(err => {
    console.error('[Startup] Delivery processor init failed:', err.message);
  });
} else {
  console.warn('[Startup] PPC_AUTOMATION_DATABASE_URL not set - delivery processor disabled');
}

app.listen(PORT, () => {
  console.log(`AI REI Pipeline Engine v1.0 on port ${PORT}`);
  console.log(`GHL webhook: POST /webhook/ghl`);
  console.log(`JustCall webhook: POST /webhook/justcall (handles sms.status_updated)`);
  console.log(`GHL stages: POST /api/ghl/sync-stages/:userId`);
  console.log(`GHL import: POST /api/ghl/import/:userId`);
});

module.exports = app;

