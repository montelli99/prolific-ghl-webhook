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
// Lead Generation / Pre-Acquisition pipeline (ygQaJ2hi7ouJeA5HR7uu) — stage ID → Atlas stage name
const GHL_STAGE_MAP = {
  '0651d634-1b58-4039-9908-03c4077c88cb': 'Lead Entered',
  '660c657c-8b59-4f56-9ea4-b3cbb62aa313': 'Contact Made',
  'e30583a3-e53e-45ae-a3e3-a5672fdd4d28': 'Offer Ready to be Sent to Seller',
  '9bbe635c-2bee-42e2-b1ad-3f9b6c314acd': 'Offer Sent to Lead',
  'de4357bb-9ef7-479f-9cd8-69009d815b98': 'Offer Received',
  '7e18de44-53b7-421f-8504-001c902afb3a': 'Offer Ready to Gain Feedback',
  '138be6ca-2f31-49e1-b751-78a09edfab0d': 'No Answer After Offer Ready to Gain Feedback',
  'bcc4d024-d7ec-46ab-8e1c-b0a212ca8fbc': 'Seller Declined Offer',
  '4cf61ef7-f125-42cc-8fba-deda6591a156': 'Active Negotiation',
  'f805edc3-5782-4398-a692-d919c967a64c': 'Terms Agreed',
  'b0e24feb-7fa3-4447-8bc5-4cd40ae264d1': 'Contract Out',
  '2dd14d3a-7c82-41ce-9308-0e01a25b093a': 'Under Contract',
  'd35374ef-5b5b-4c29-9525-7be99503f42a': 'Under Contract w/ Another Buyer',
  'a4c6722d-7df7-4354-950d-9610ef75e2ab': 'Inspection Complete',
  '520d191e-4625-4cf1-837b-2bd6ce2473b6': 'Appraisal Complete',
  '24c8699c-7a51-44ef-ab0c-daec3b3f69e7': 'JV Sent',
  'b858ae7b-c706-4da1-9e60-5cb72b5f0ad0': 'JV Signed',
  '125f89a5-39e2-4c41-b099-c4e038d70cb6': 'Wire Instructions Set Up',
  '02c0e45f-47be-4969-a02a-a24257ae9871': 'Closing Date Assigned'
};

app.post('/webhook/ghl', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const payload = req.body;
    const type = payload.type;
    if (!['OpportunityStageUpdate', 'OpportunityStatusUpdate', 'OpportunityCreate'].includes(type)) return;
    const userId = 'montelli';
    const address = payload.name;
    if (!address) return;

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
    await logEvent(userId, 'ghl_webhook', null, { type, address, pipelineStageId: payload.pipelineStageId });
  } catch (err) {
    console.error('GHL webhook error:', err.message);
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