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

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;
const DEFAULT_GHL_API_KEY = process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || '';

// ── GHL PipelineStageId → Our Stage mapping (configurable per pipeline) ──
// Each GHL pipeline has stage UUIDs. Map them to our internal stages.
const DEFAULT_STAGE_MAP = {}; // populated from GHL API on first connect

// Load per-user stage mappings
function loadStageMap(userId) {
  const path = require('path');
  const fs = require('fs');
  const file = path.join(__dirname, 'data', userId, 'pipeline-stage-map.json');
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }
  return {};
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

// Best-effort name matching: "New Lead" → NEW_LEAD, "Offer Sent" → OFFER_SENT, etc.
function autoMapStageName(name) {
  const n = name.toLowerCase().trim();
  if (n.includes('new lead') || n.includes('new')) return 'NEW_LEAD';
  if (n.includes('qualified')) return 'QUALIFIED';
  if (n.includes('loi request')) return 'LOI_REQUESTED';
  if (n.includes('loi approve') || n.includes('approved')) return 'LOI_APPROVED';
  if (n.includes('offer sent')) return 'OFFER_SENT';
  if (n.includes('active negotiation') || n.includes('negotiating') || n.includes('feedback')) return 'NEGOTIATING';
  if (n.includes('under contract') || n.includes('contract')) return 'UNDER_CONTRACT';
  if (n.includes('closed') || n.includes('won')) return 'CLOSED';
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

        const stageMap = loadStageMap(userId.id);
        const pipelineStageId = payload.pipelineStageId;
        const address = payload.name; // GHL Opportunity Name = property address

        if (!address) return;

        const existingLead = findLead(userId.id, address);
        const ghlStage = stageMap[pipelineStageId];

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
            advanceStage(userId.id, address, ghlStage, `GHL stage: ${payload.pipelineStageId}`);
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

app.listen(PORT, () => {
  console.log(`AI REI Pipeline Engine v1.0 on port ${PORT}`);
  console.log(`GHL webhook: POST /webhook/ghl`);
  console.log(`GHL stages: POST /api/ghl/sync-stages/:userId`);
  console.log(`GHL import: POST /api/ghl/import/:userId`);
});

module.exports = app;
