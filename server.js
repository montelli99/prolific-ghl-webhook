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
      // Log to GHL contact timeline
      const callData = payload.data || {};
      const contactId = callData.contact_id || callData.ghl_contact_id;
      if (contactId) {
        const noteBody = `=== CALL COMPLETED ===\n${new Date().toISOString()}\nCall ID: ${callData.id}\nDuration: ${callData.duration || 'unknown'}s\nDirection: ${callData.direction || 'unknown'}\nDisposition: ${callData.disposition || 'unknown'}`;
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
      const callScore = aiData.call_score;
      const callSummary = aiData.call_summary;
      const contactId = aiData.contact_id || aiData.ghl_contact_id;
      if (contactId && callSummary) {
        const noteBody = `=== AI COACHING REPORT ===\n${new Date().toISOString()}\nCall Score: ${callScore}\nSummary: ${callSummary.slice(0, 500)}`;
        try {
          await ghlRequest('POST', `/contacts/${contactId}/notes`, { body: noteBody });
          console.log(`[Atlas JustCall] AI coaching logged to contact ${contactId}`);
        } catch (e) {
          console.error(`[Atlas JustCall] Failed to log AI report: ${e.message}`);
        }
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