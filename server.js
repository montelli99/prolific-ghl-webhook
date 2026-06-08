// server.js — Production Express API with Neon Postgres + JWT Auth
// Start: DATABASE_URL=postgres://... JWT_SECRET=your-secret node server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const {
  initDb, getUser, getUserByEmail, getUserByTelegramId, listUsers,
  createUserWithPassword, verifyPassword,
  saveConnection, getConnections, getConnection,
  createLead, getLead, getLeads, advanceLeadStage, updateLead, getPipelineStatus,
  saveStageMapping, getStageMappings, logEvent
} = require('./db');

const app = express();
app.use(express.json());

// ── API routes BEFORE static (static serves public/ files) ──
app.get('/api/scripts', (req, res) => {
  res.sendFile(path.join(__dirname, 'ghl-scripts-reference.json'));
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'airei-dev-secret-change-in-production';
const JWT_TTL = process.env.JWT_TTL || '7d';

// ── Init DB on startup ──
if (process.env.DATABASE_URL) {
  initDb(process.env.DATABASE_URL);
  console.log('Neon Postgres connected');
}

// ── Auth middleware ──
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.userId !== 'montelli') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ── Dashboard (auth-gated) ──
app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ── Auth endpoints ──
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, name required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const userId = email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    const user = await createUserWithPassword({ id: userId, name, email, password });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_TTL });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan } });
  } catch (err) {
    if (err.message && err.message.includes('unique')) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await verifyPassword(user.id, password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_TTL });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, status: user.status }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pipeline status ──
app.get('/api/pipeline/:userId', async (req, res) => {
  try {
    if (process.env.DATABASE_URL) {
      const status = await getPipelineStatus(req.params.userId);
      return res.json(status);
    }
    const { getPipelineStatus: fileStatus } = require('./engine');
    res.json(fileStatus(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create lead ──
app.post('/api/leads', requireAuth, async (req, res) => {
  try {
    const leadData = { ...req.body, source: req.body.source || 'api' };
    const lead = process.env.DATABASE_URL
      ? await createLead(req.userId, leadData)
      : require('./engine').createLead(req.userId, leadData).lead;
    await logEvent(req.userId, 'lead_created', lead.id);
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Advance stage ──
app.post('/api/leads/:address/advance', requireAuth, async (req, res) => {
  try {
    const { stage, note } = req.body;
    const lead = process.env.DATABASE_URL
      ? await advanceLeadStage(req.userId, req.params.address, stage, note)
      : require('./engine').advanceStage(req.userId, req.params.address, stage, note).lead;
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update lead ──
app.patch('/api/leads/:address', requireAuth, async (req, res) => {
  try {
    const lead = process.env.DATABASE_URL
      ? await updateLead(req.userId, req.params.address, req.body)
      : require('./engine').updateLead(req.userId, req.params.address, req.body).lead;
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Connections ──
app.get('/api/connections/:userId', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.json([]);
    if (req.params.userId !== req.userId && req.userId !== 'montelli') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const conns = await getConnections(req.params.userId);
    res.json(conns.map(c => ({ ...c, api_key: c.api_key ? '••••••••' : null })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connections/:userId', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.json({ ok: true, note: 'Neon not configured' });
    if (req.params.userId !== req.userId) {
      return res.status(403).json({ error: 'Cannot update another user\'s connections' });
    }
    const { provider, apiKey, locationId, accountId, sheetId, sheetRange } = req.body;
    const conn = await saveConnection(req.params.userId, provider, {
      apiKey, locationId, accountId, sheetId, sheetRange
    });
    await logEvent(req.params.userId, 'connection_saved', null, { provider });
    res.json({ ok: true, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin routes ──
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = process.env.DATABASE_URL ? await listUsers() : [{ id: 'montelli', name: 'Montelli Scott', status: 'active', plan: 'pro' }];
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await createUser(req.body);
    await logEvent('montelli', 'user_created', null, { newUserId: req.body.id });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/users/:userId/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await updateUserStatus(req.params.userId, req.body.status);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GHL mappings ──
app.get('/api/ghl/mappings/:userId', async (req, res) => {
  try {
    const mappings = process.env.DATABASE_URL ? await getStageMappings(req.params.userId) : [];
    res.json(mappings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GHL Webhook ──
// Montelli Atlas-Managed pipeline (nSf3NXYVkt8X4PgW9aZ3) — stage ID → Stage name
const GHL_TOKEN = process.env.GHL_API_TOKEN || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '61XPzSqRy7UKMwW9DeB8';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'nSf3NXYVkt8X4PgW9aZ3';
const MONTELLI_USER = process.env.GHL_MONTELLI_USER_ID || 'PGfXxlXCRXs3hXN3Gq7R';

const GHL_STAGE_MAP = {
  '7067148a-2ee8-4e5b-93c8-31e0253fea68': 'Lead Entered',
  '934c4c52-4b22-457a-8d10-55ab6600fdee': 'Contact Made',
  '3da698e7-aba8-4d4a-b14b-7742f7b44ac7': 'Offer Ready',
  'eef16a9b-8ca9-43b7-9cad-fb9c352b560d': 'Offer Sent',
  'd5375376-26dc-4dc3-9b06-f55178f8a23b': 'Offer Received',
  '83f2c0df-a9c5-44fe-b42f-46ed60274e66': 'Gain Feedback',
  'b82940e0-e55c-4359-98e6-35cb22e065ab': 'No Answer',
  '8dc3463c-8a45-41a1-a305-2013527b1bd8': 'Seller Declined',
  'a7a5c7ac-3933-4c68-bfce-b81eaacf622e': 'Active Negotiation',
  'e6480e04-1b0f-4f79-af96-7cf5fb634ac5': 'Terms Agreed',
  '1e97ae23-78a6-4698-919f-ba0d6a0e08c6': 'Awaiting Title',
  'f0b739d5-f270-410c-b9e9-bce2e26a53ff': 'Contract Out',
  '645611af-ae9a-4dfc-aba9-8bfff08dc79a': 'Under Contract',
  'b68f7087-559d-470b-9ddf-d1452f4b027e': 'UC Another Buyer',
  '129094e2-ea70-49c1-a670-b599ee25ba3f': 'Sent to Buyers',
  'b7ab06be-9a28-40a2-9dc9-6697fc09a836': 'Inspection Complete',
  '49142ba4-2360-49ca-9a86-6223dc847440': 'Appraisal Complete',
  '36993fe3-cfc3-4651-99d6-3146627869a3': 'JV Sent',
  '6eb610d7-31f2-4380-ab03-fd0c2f771e8b': 'JV Signed',
  '6f97e402-288e-417a-b561-65a8287e5653': 'Wire Setup',
  'e446607c-2d2c-4664-b0cd-96f9de0584e1': 'Closing Date'
};

// GHL HTTP helper
async function ghlRequest(method, path, body) {
  return new Promise((ok, fail) => {
    const https = require('https');
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'services.leadconnectorhq.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${GHL_TOKEN}`,
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

async function autoPopulateOpp(opp) {
  const stageId = opp.pipelineStageId;
  const stageName = GHL_STAGE_MAP[stageId] || 'Unknown';
  const contactId = opp.contactId;

  if (!contactId) {
    console.log(`[Atlas] ${opp.name}: no contactId, skipping`);
    return { skipped: true };
  }

  const noteBody = `=== ${stageName} ===\n${new Date().toISOString()}\nAuto-populated by Atlas webhook server.\nOpportunity: ${opp.name}\nPipeline: ${GHL_PIPELINE_ID}\nStage ID: ${stageId}`;

  try {
    await ghlRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
    console.log(`[Atlas] ${opp.name} → ${stageName}: note written`);
    return { success: true, stage: stageName };
  } catch (e) {
    console.error(`[Atlas] ${opp.name}: error writing note: ${e.message}`);
    return { error: e.message };
  }
}

// In-memory dedupe
const seenGhlEvents = new Set();
const DEDUPE_MAX = 5000;
function dedupeGhl(key) {
  if (seenGhlEvents.has(key)) return true;
  seenGhlEvents.add(key);
  if (seenGhlEvents.size > DEDUPE_MAX) {
    const arr = Array.from(seenGhlEvents);
    seenGhlEvents.clear();
    arr.slice(-DEDUPE_MAX / 2).forEach(k => seenGhlEvents.add(k));
  }
  return false;
}

app.post('/webhook/ghl', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const payload = req.body;
    const type = payload.type;
    if (!['OpportunityStageUpdate', 'OpportunityStatusUpdate', 'OpportunityCreate'].includes(type)) return;
    if (!payload.pipelineId || payload.pipelineId !== GHL_PIPELINE_ID) {
      console.log(`[Atlas] Ignoring opp ${payload.id} - wrong pipeline: ${payload.pipelineId}`);
      return;
    }
    if (payload.assignedTo && payload.assignedTo !== MONTELLI_USER) {
      console.log(`[Atlas] Ignoring opp ${payload.id} - wrong user: ${payload.assignedTo}`);
      return;
    }
    const eventId = payload.id + ':' + (payload.pipelineStageId || 'none') + ':' + Date.now().toString().slice(0, -4);
    if (dedupeGhl(eventId)) {
      console.log(`[Atlas] Duplicate event skipped: ${eventId}`);
      return;
    }
    const address = payload.name;
    if (!address) return;
    console.log(`[Atlas] ${type}: ${address} → ${GHL_STAGE_MAP[payload.pipelineStageId] || 'unknown'}`);

    // Auto-populate via GHL API
    const result = await autoPopulateOpp({
      id: payload.id,
      name: address,
      pipelineStageId: payload.pipelineStageId,
      contactId: payload.contactId,
    });
    console.log(`[Atlas] ${address}: ${JSON.stringify(result)}`);

    // Legacy lead tracking (for dashboard)
    const userId = 'montelli';
    if (process.env.DATABASE_URL) {
      const existing = await getLead(userId, address);
      const mappedStage = GHL_STAGE_MAP[payload.pipelineStageId] || null;
      if (!existing && type === 'OpportunityCreate') {
        const newLead = await createLead(userId, {
          address, price: payload.monetaryValue || null, source: 'ghl_webhook',
          ghlOpportunityId: payload.id, notes: `GHL ID: ${payload.id}`
        });
        if (mappedStage) await advanceLeadStage(userId, address, mappedStage);
      } else if (existing && mappedStage && existing.stage !== mappedStage) {
        await advanceLeadStage(userId, address, mappedStage, `GHL stage change: ${type}`);
      }
    } else {
      const eng = require('./engine');
      const existing = eng.findLead(userId, address);
      if (!existing && type === 'OpportunityCreate') {
        eng.createLead(userId, { address, price: payload.monetaryValue || null, source: 'ghl_webhook', notes: `GHL ID: ${payload.id}` });
      }
    }
    await logEvent(userId, 'ghl_webhook', null, { type, address, pipelineStageId: payload.pipelineStageId, autoPopulate: result });
  } catch (err) {
    console.error('GHL webhook error:', err.message);
  }
});

// ── JustCall Webhook ──
const seenJcEvents = new Set();
function dedupeJc(key) {
  if (seenJcEvents.has(key)) return true;
  seenJcEvents.add(key);
  if (seenJcEvents.size > DEDUPE_MAX) {
    const arr = Array.from(seenJcEvents);
    seenJcEvents.clear();
    arr.slice(-DEDUPE_MAX / 2).forEach(k => seenJcEvents.add(k));
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
      // Log to GHL contact timeline with FULL details
      const callData = payload.data || {};
      const contactId = callData.contact_id || callData.ghl_contact_id;
      if (contactId) {
        const noteBody = `=== CALL COMPLETED ===\n${new Date().toISOString()}\nCall ID: ${callData.id}\nFrom: ${callData.from_number || 'unknown'}\nTo: ${callData.to_number || 'unknown'}\nDirection: ${callData.direction || 'unknown'}\nDuration: ${callData.duration || 'unknown'}s\nDisposition: ${callData.disposition || 'unknown'}\nRecording: ${callData.recording_url || 'N/A'}\nVoicemail: ${callData.voicemail_url || 'N/A'}\nNotes: ${callData.notes || 'N/A'}`;
        try {
          await ghlRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
          console.log(`[Atlas JustCall] Call logged to contact ${contactId}`);
        } catch (e) {
          console.error(`[Atlas JustCall] Failed to log call: ${e.message}`);
        }
      }
    }

    if (type === 'sms.received' || type === 'text.received') {
      const smsData = payload.data || {};
      const contactId = smsData.contact_id || smsData.ghl_contact_id;
      if (contactId) {
        const noteBody = `=== SMS RECEIVED ===\n${new Date().toISOString()}\nFrom: ${smsData.from_number || 'unknown'}\nBody: ${(smsData.body || '').slice(0, 200)}`;
        try {
          await ghlRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
          console.log(`[Atlas JustCall] SMS logged to contact ${contactId}`);
        } catch (e) {
          console.error(`[Atlas JustCall] Failed to log SMS: ${e.message}`);
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
        await ghlRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
        console.log(`[Atlas JustCall] Full AI coaching + transcript logged to contact ${contactId}`);
      } catch (e) {
        console.error(`[Atlas JustCall] Failed to log AI report: ${e.message}`);
      }
    }
  } catch (err) {
    console.error('JustCall webhook error:', err.message);
  }
});

// ── Scripts reference ──
app.get('/api/scripts', (req, res) => {
  res.sendFile(path.join(__dirname, 'ghl-scripts-reference.json'));
});

// ────────────────────────────────────────────────────────────────────
// ── NEW ENDPOINTS (added 2026-06-07 per GHL_WORKFLOWS_SPEC.md) ──
// ── GHL workflows call these for heavy compute / external APIs ──
// ────────────────────────────────────────────────────────────────────

// Pipeline + user guard shared by all 5 new endpoints
function ghlWorkflowGuard(req, res) {
  const body = req.body || {};
  if (body.pipelineId && body.pipelineId !== GHL_PIPELINE_ID) {
    res.status(403).json({ status: 'REJECTED', reason: 'wrong pipeline' });
    return false;
  }
  if (body.assignedTo && body.assignedTo !== MONTELLI_USER) {
    res.status(403).json({ status: 'REJECTED', reason: 'wrong user' });
    return false;
  }
  if (!body.opportunityId) {
    res.status(400).json({ status: 'ERROR', reason: 'opportunityId required' });
    return false;
  }
  return true;
}

// D.0: /webhook/ghl/stage-transition — generic stage handoff logger
app.post('/webhook/ghl/stage-transition', async (req, res) => {
  if (!ghlWorkflowGuard(req, res)) return;
  res.status(200).json({ status: 'OK' });
  try {
    const { opportunityId, contactId, fromStage, toStage, address, propertyAddress, note } = req.body;
    const leadLabel = propertyAddress || address || opportunityId || 'unknown';
    const transitionNote = `=== STAGE TRANSITION ===\n${new Date().toISOString()}\nOpportunity: ${opportunityId || 'unknown'}\nAddress: ${leadLabel}\nFrom: ${fromStage || 'unknown'}\nTo: ${toStage || 'unknown'}${note ? `\nNote: ${note}` : ''}`;

    if (contactId) {
      await ghlRequest('POST', `/contacts/${contactId}/notes`, { body: transitionNote });
    }

    await logEvent('montelli', 'stage_transition', null, {
      opportunityId: opportunityId || null,
      contactId: contactId || null,
      fromStage: fromStage || null,
      toStage: toStage || null,
      address: leadLabel,
    });
  } catch (err) {
    console.error('[Atlas stage-transition] error:', err.message);
  }
});

// D.1: /webhook/ghl/lead-entered — pre-screen + queue (Stage 1 trigger)
app.post('/webhook/ghl/lead-entered', async (req, res) => {
  if (!ghlWorkflowGuard(req, res)) return;
  res.status(200).json({ status: 'OK' });
  try {
    const { address, askingPrice, monthlyRent, sqft, beds, baths } = req.body;
    console.log(`[Atlas lead-entered] pre-screen for ${address}`);
    // Quick pre-screen: 1-line summary of comp inputs (no web fetch in v1 — uses caller-supplied data)
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
    console.log(`[Atlas lead-entered] pre-screen result: ${JSON.stringify(preScreen)}`);
    // Note write to opportunity
    if (req.body.contactId) {
      await ghlRequest('POST', `/contacts/${req.body.contactId}/notes`, {
        body: `=== Stage 1: Lead Entered (Atlas pre-screen) ===\n${new Date().toISOString()}\nAddress: ${address}\nBuy Box Match: ${preScreen.buyBoxMatch}\nRecommended Action: ${preScreen.recommendedAction}\nAsking: $${askingPrice || 'N/A'}\nRent est: $${monthlyRent || 'N/A'}`,
      }).catch(e => console.log('[Atlas lead-entered] note write failed:', e.message));
    }
    await logEvent('montelli', 'lead_entered_prescreen', null, preScreen);
  } catch (err) {
    console.error('[Atlas lead-entered] error:', err.message);
  }
});

// D.2: /webhook/ghl/offer-ready — comps + 5-strategy calc (Stage 3, 9, 17 trigger)
app.post('/webhook/ghl/offer-ready', async (req, res) => {
  if (!ghlWorkflowGuard(req, res)) return;
  res.status(200).json({ status: 'OK' });
  try {
    const { opportunityId, address, askingPrice, monthlyRent, sqft, isRental, beds, baths, appraisalValue } = req.body;
    const aru = appraisalValue || askingPrice || 0;
    console.log(`[Atlas offer-ready] ${opportunityId} ${address} ARU=$${aru}`);
    // Strategy recommendations
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
    // 5-strategy offer summary
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
    console.log(`[Atlas offer-ready] recommended: ${recommendedStrategy}, cash flow: $${cashFlow}/mo, DSCR: ${dscr}`);
    if (req.body.contactId) {
      await ghlRequest('POST', `/contacts/${req.body.contactId}/notes`, {
        body: `=== Offer Calc (Atlas webhook) ===\n${new Date().toISOString()}\nARU: $${aru.toLocaleString()}\nLender Value (70%): $${lenderValue.toLocaleString()}\nMonthly P&I: $${monthlyPayment.toLocaleString()}\nCash Flow: $${cashFlow.toLocaleString()}/mo\nDSCR: ${dscr} (threshold 1.25)\n1% Rule: ${onePctPass ? 'PASS' : 'FAIL'}\nRecommended Strategy: ${recommendedStrategy}`,
      }).catch(e => console.log('[Atlas offer-ready] note write failed:', e.message));
    }
    await logEvent('montelli', 'offer_ready_calc', null, result);
  } catch (err) {
    console.error('[Atlas offer-ready] error:', err.message);
  }
});

// D.3: /webhook/ghl/contract-draft — generate PSA draft URL (Stage 10 trigger)
app.post('/webhook/ghl/contract-draft', async (req, res) => {
  if (!ghlWorkflowGuard(req, res)) return;
  res.status(200).json({ status: 'OK' });
  try {
    const { opportunityId, contractType, address, purchasePrice, emdAmount, coeDate, inspectionDays, titleCompany } = req.body;
    console.log(`[Atlas contract-draft] ${opportunityId} ${contractType} for ${address}`);
    // v1: returns a draft URL placeholder (full Google Doc assembly requires Drive API + service account)
    // In production: POST to Google Drive API to clone template, unlock, return URL
    const draftUrl = `https://docs.google.com/document/d/DRAFT_${opportunityId}_${Date.now()}/edit`;
    const result = {
      opportunityId,
      contractType: contractType || 'Cash',
      draftUrl,
      template: (() => {
        if (contractType === 'SubTo') return 'PSA Creative _ Sub To + Subject to Addendum';
        if (contractType === 'Stack') return 'Stack PSA';
        if (contractType === 'Commercial') return 'Real Estate Commercial PSA';
        if (contractType === 'JV') return '4-party JV (or 3-party)';
        return 'Cash Offer Template';
      })(),
      fields: {
        address,
        purchasePrice: purchasePrice || 0,
        emdAmount: emdAmount || 100,
        coeDate: coeDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        inspectionDays: inspectionDays || 14,
        titleCompany: titleCompany || 'CLOSED Title',
      },
      generatedAt: new Date().toISOString(),
      notes: 'Draft URL is a placeholder. Production needs Google Drive API integration to clone Kay\'s Drive templates and unlock for sharing.',
    };
    console.log(`[Atlas contract-draft] generated draft URL: ${draftUrl}`);
    await logEvent('montelli', 'contract_draft_generated', null, result);
  } catch (err) {
    console.error('[Atlas contract-draft] error:', err.message);
  }
});

// D.4: /webhook/ghl/contract-sign — RabbitSign envelope (Stage 12, 18 trigger)
app.post('/webhook/ghl/contract-sign', async (req, res) => {
  if (!ghlWorkflowGuard(req, res)) return;
  res.status(200).json({ status: 'OK' });
  try {
    const { opportunityId, contractType, draftUrl, signers, hasSubToAddendum, hasJVDoc } = req.body;
    console.log(`[Atlas contract-sign] ${opportunityId} signers=${(signers || []).length}`);
    // v1: returns envelope metadata (full RabbitSign API integration needs API key + endpoint)
    const envelope = {
      opportunityId,
      envelopeId: `envelope_${opportunityId}_${Date.now()}`,
      contractType: contractType || 'Cash',
      documents: [
        { name: 'PSA', source: draftUrl || 'pending' },
        ...(hasSubToAddendum ? [{ name: 'Subject to Addendum', source: 'auto-attached' }] : []),
        ...(hasJVDoc ? [{ name: 'JV Agreement', source: 'auto-attached' }] : []),
      ],
      signers: signers || [],
      status: 'created',
      signingUrl: `https://app.rabbitsign.com/sign/${opportunityId}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      notes: 'Envelope metadata is a placeholder. Production needs RabbitSign API integration with API key + signer routing.',
    };
    console.log(`[Atlas contract-sign] envelope created: ${envelope.envelopeId}`);
    await logEvent('montelli', 'contract_sign_envelope_created', null, envelope);
  } catch (err) {
    console.error('[Atlas contract-sign] error:', err.message);
  }
});

// D.5: /webhook/ghl/generate-loi — clone LOI template URL (Stage 3 sub-action)
app.post('/webhook/ghl/generate-loi', async (req, res) => {
  if (!ghlWorkflowGuard(req, res)) return;
  res.status(200).json({ status: 'OK' });
  try {
    const { opportunityId, strategy, address, purchasePrice, downPayment, emdAmount, coeDate, monthlyPayment } = req.body;
    console.log(`[Atlas generate-loi] ${opportunityId} strategy=${strategy}`);
    const loiUrl = `https://docs.google.com/document/d/LOI_${opportunityId}_${Date.now()}/edit`;
    const result = {
      opportunityId,
      strategy: strategy || 'Cash',
      loiUrl,
      fields: {
        address,
        purchasePrice: purchasePrice || 0,
        downPayment: downPayment || 0,
        emdAmount: emdAmount || 100,
        coeDate: coeDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        monthlyPayment: monthlyPayment || 0,
      },
      generatedAt: new Date().toISOString(),
      notes: 'LOI URL is a placeholder. Production needs Google Drive API integration to clone Kay\'s Drive LOI template, unlock for sharing, and return the public URL.',
    };
    console.log(`[Atlas generate-loi] generated LOI URL: ${loiUrl}`);
    await logEvent('montelli', 'loi_generated', null, result);
  } catch (err) {
    console.error('[Atlas generate-loi] error:', err.message);
  }
});

// ── 404 catcher ──
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`╔═══════════════════════════════════╗`);
  console.log(`║  AI REI Pipeline v3 (Auth + Neon)  ║`);
  console.log(`║  http://localhost:${PORT}            ║`);
  console.log(`╚═══════════════════════════════════╝`);
  if (!process.env.JWT_SECRET) {
    console.log('⚠️  WARNING: Using default JWT_SECRET. Set JWT_SECRET env var in production.');
  }
});

module.exports = app;
