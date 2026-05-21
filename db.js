// db.js — Neon Postgres database layer
// Replaces users.js file-based storage with production Postgres

const { neon } = require('@neondatabase/serverless');

let sql = null;

function initDb(connectionString) {
  sql = neon(connectionString || process.env.DATABASE_URL);
  return sql;
}

function getSql() {
  if (!sql) throw new Error('Database not initialized — call initDb(connectionString) first');
  return sql;
}

// ── Users ──
async function createUser({ id, name, telegramId, role = 'mentee', plan = 'free' }) {
  const db = getSql();
  const [user] = await db`
    INSERT INTO users (id, name, telegram_id, role, status, plan)
    VALUES (${id}, ${name}, ${telegramId || null}, ${role}, 'active', ${plan})
    ON CONFLICT (id) DO UPDATE SET name = ${name}, telegram_id = ${telegramId || null}
    RETURNING *
  `;
  return user;
}

async function getUser(userId) {
  const db = getSql();
  const [user] = await db`SELECT * FROM users WHERE id = ${userId}`;
  return user || null;
}

async function getUserByTelegramId(telegramId) {
  const db = getSql();
  const [user] = await db`SELECT * FROM users WHERE telegram_id = ${telegramId}`;
  return user || null;
}

async function listUsers() {
  const db = getSql();
  return db`SELECT * FROM users ORDER BY created_at DESC`;
}

async function updateUserStatus(userId, status) {
  const db = getSql();
  const [user] = await db`
    UPDATE users SET status = ${status}, updated_at = NOW()
    WHERE id = ${userId} RETURNING *
  `;
  return user;
}

// ── Connections ──
async function saveConnection(userId, provider, data) {
  const db = getSql();
  const [conn] = await db`
    INSERT INTO user_connections (user_id, provider, api_key, location_id, account_id, sheet_id, sheet_range)
    VALUES (${userId}, ${provider}, ${data.apiKey || null}, ${data.locationId || null},
            ${data.accountId || null}, ${data.sheetId || null}, ${data.sheetRange || 'Sheet1'})
    ON CONFLICT (user_id, provider)
    DO UPDATE SET api_key = COALESCE(${data.apiKey || null}, user_connections.api_key),
                  location_id = COALESCE(${data.locationId || null}, user_connections.location_id),
                  account_id = COALESCE(${data.accountId || null}, user_connections.account_id),
                  sheet_id = COALESCE(${data.sheetId || null}, user_connections.sheet_id),
                  sheet_range = COALESCE(${data.sheetRange || null}, user_connections.sheet_range),
                  is_active = true, updated_at = NOW()
    RETURNING *
  `;
  return conn;
}

async function getConnections(userId) {
  const db = getSql();
  return db`SELECT * FROM user_connections WHERE user_id = ${userId} AND is_active = true`;
}

async function getConnection(userId, provider) {
  const db = getSql();
  const [conn] = await db`SELECT * FROM user_connections WHERE user_id = ${userId} AND provider = ${provider}`;
  return conn || null;
}

// ── Leads ──
function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function snakeToCamel(obj) {
  if (!obj) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

async function createLead(userId, leadData) {
  const db = getSql();
  const id = `LEAD_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const [lead] = await db`
    INSERT INTO leads (
      id, user_id, address, stage, price, property_type, population,
      agent_name, agent_phone, agent_email, contact_type,
      roof_age, hvac_age, occupied, rent_amount, lease_type, utilities_on, feedback,
      notes, source, ghl_opportunity_id
    ) VALUES (
      ${id}, ${userId}, ${leadData.address}, 'NEW_LEAD',
      ${leadData.price || null}, ${leadData.propertyType || null}, ${leadData.population || null},
      ${leadData.agentName || null}, ${leadData.agentPhone || null}, ${leadData.agentEmail || null},
      ${leadData.contactType || 'agent'},
      ${leadData.roofAge || null}, ${leadData.hvacAge || null},
      ${leadData.occupied !== undefined ? leadData.occupied : null},
      ${leadData.rentAmount || null}, ${leadData.leaseType || null},
      ${leadData.utilitiesOn !== undefined ? leadData.utilitiesOn : null},
      ${leadData.feedback || null},
      ${leadData.notes || ''}, ${leadData.source || 'manual'}, ${leadData.ghlOpportunityId || null}
    ) RETURNING *
  `;

  // Add history entry
  await db`
    INSERT INTO lead_history (lead_id, stage, note)
    VALUES (${id}, 'NEW_LEAD', ${'Lead created'})
  `;

  return snakeToCamel(lead);
}

async function getLead(userId, address) {
  const db = getSql();
  const [lead] = await db`
    SELECT * FROM leads WHERE user_id = ${userId} AND LOWER(address) = LOWER(${address})
  `;
  return snakeToCamel(lead);
}

async function getLeads(userId) {
  const db = getSql();
  const leads = await db`SELECT * FROM leads WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return leads.map(snakeToCamel);
}

async function advanceLeadStage(userId, address, newStage, note = '') {
  const db = getSql();
  const lead = await getLead(userId, address);
  if (!lead) throw new Error(`Lead "${address}" not found`);

  const oldStage = lead.stage;
  const now = new Date().toISOString();

  await db`
    UPDATE leads SET
      stage = ${newStage},
      stage_entered_at = ${now},
      updated_at = ${now}
      ${newStage === 'LOI_REQUESTED' ? db` ,loi_requested_at = ${now}` : db``}
      ${newStage === 'OFFER_SENT' ? db` ,offer_sent_at = ${now}, followup_48hr_due = ${new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()}` : db``}
      ${newStage === 'UNDER_CONTRACT' ? db` ,under_contract_at = ${now}` : db``}
      ${newStage === 'CLOSED' ? db` ,closed_at = ${now}` : db``}
      ${newStage === 'DEAD' ? db` ,declined_at = ${now}` : db``}
    WHERE id = ${lead.id}
  `;

  await db`
    INSERT INTO lead_history (lead_id, stage, from_stage, note)
    VALUES (${lead.id}, ${newStage}, ${oldStage}, ${note || `Advanced from ${oldStage} to ${newStage}`})
  `;

  // Log event
  await db`
    INSERT INTO pipeline_events (user_id, event_type, lead_id, payload)
    VALUES (${userId}, 'stage_change', ${lead.id}, ${JSON.stringify({ from: oldStage, to: newStage, note })})
  `;

  return snakeToCamel({ ...lead, stage: newStage, stageEnteredAt: now });
}

async function updateLead(userId, address, updates) {
  const db = getSql();
  const lead = await getLead(userId, address);
  if (!lead) throw new Error(`Lead "${address}" not found`);

  const cols = [];
  const vals = [];
  vals.push(lead.id);

  // Map camelCase keys to snake_case columns
  const keyMap = {
    agentName: 'agent_name', agentPhone: 'agent_phone', agentEmail: 'agent_email',
    propertyType: 'property_type', rentAmount: 'rent_amount', leaseType: 'lease_type',
    utilitiesOn: 'utilities_on', roofAge: 'roof_age', hvacAge: 'hvac_age',
    followup48hrDue: 'followup_48hr_due', offerSentAt: 'offer_sent_at',
    onePercentRule: 'one_percent_rule', domDays: 'dom_days',
    ghlPipelineStageId: 'ghl_pipeline_stage_id',
    price: 'price', population: 'population', notes: 'notes', feedback: 'feedback',
    occupied: 'occupied', offerAmount: 'offer_amount'
  };

  let idx = 2;
  for (const [camel, value] of Object.entries(updates)) {
    const col = keyMap[camel] || camelToSnake(camel);
    cols.push(`${col} = $${idx}`);
    vals.push(value);
    idx++;
  }

  if (cols.length > 0) {
    vals.push(null); // placeholder for updated_at
    await db.query(
      `UPDATE leads SET ${cols.join(', ')}, updated_at = NOW() WHERE id = $1`,
      vals
    );
  }

  return getLead(userId, address);
}

async function getPipelineStatus(userId) {
  const db = getSql();
  const leads = await getLeads(userId);

  const byStage = {};
  const allStages = ['NEW_LEAD','QUALIFIED','LOI_REQUESTED','LOI_APPROVED','OFFER_SENT','NEGOTIATING','UNDER_CONTRACT','CLOSED','ARCHIVED','DEAD'];
  allStages.forEach(s => { byStage[s] = []; });

  leads.forEach(l => {
    if (byStage[l.stage]) byStage[l.stage].push(l);
    else byStage[l.stage] = [l];
  });

  const now = Date.now();
  const followupsDue = leads.filter(l => {
    if (!l.followup48hrDue) return false;
    const due = new Date(l.followup48hrDue).getTime();
    return due >= now - 4 * 60 * 60 * 1000 && due <= now + 4 * 60 * 60 * 1000;
  });

  const stalled = leads.filter(l => {
    if (['CLOSED', 'ARCHIVED', 'DEAD'].includes(l.stage)) return false;
    const last = new Date(l.updatedAt || l.createdAt).getTime();
    return now - last > 72 * 60 * 60 * 1000;
  });

  return {
    total: leads.length,
    activeCount: leads.filter(l => !['CLOSED', 'ARCHIVED', 'DEAD'].includes(l.stage)).length,
    byStage,
    followupsDue,
    stalledDeals: stalled
  };
}

async function getLeadHistory(leadId) {
  const db = getSql();
  return db`SELECT * FROM lead_history WHERE lead_id = ${leadId} ORDER BY created_at ASC`;
}

// ── Stage Mappings ──
async function saveStageMapping(userId, pipelineStageId, pipelineName, mappedStage) {
  const db = getSql();
  await db`
    INSERT INTO stage_mappings (user_id, pipeline_stage_id, pipeline_name, mapped_stage)
    VALUES (${userId}, ${pipelineStageId}, ${pipelineName}, ${mappedStage})
    ON CONFLICT (user_id, pipeline_stage_id)
    DO UPDATE SET mapped_stage = ${mappedStage}, pipeline_name = COALESCE(${pipelineName}, stage_mappings.pipeline_name)
  `;
}

async function getStageMapping(userId, pipelineStageId) {
  const db = getSql();
  const [row] = await db`
    SELECT mapped_stage FROM stage_mappings
    WHERE user_id = ${userId} AND pipeline_stage_id = ${pipelineStageId}
  `;
  return row ? row.mapped_stage : null;
}

async function getStageMappings(userId) {
  const db = getSql();
  return db`SELECT * FROM stage_mappings WHERE user_id = ${userId}`;
}

// ── Events ──
async function logEvent(userId, eventType, leadId = null, payload = {}) {
  const db = getSql();
  await db`
    INSERT INTO pipeline_events (user_id, event_type, lead_id, payload)
    VALUES (${userId}, ${eventType}, ${leadId}, ${JSON.stringify(payload)})
  `;
}

async function getRecentEvents(userId, limit = 50) {
  const db = getSql();
  return db`
    SELECT * FROM pipeline_events WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
}

async function verifyPassword(userId, password) {
  const db = getSql();
  const [user] = await db`SELECT password_hash FROM users WHERE id = ${userId}`;
  if (!user || !user.password_hash) return false;
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(password, user.password_hash);
}

async function createUserWithPassword({ id, name, email, password, telegramId, role = 'mentee', plan = 'free' }) {
  const db = getSql();
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 10);
  const [user] = await db`
    INSERT INTO users (id, name, email, password_hash, telegram_id, role, status, plan)
    VALUES (${id}, ${name}, ${email || null}, ${hash}, ${telegramId || null}, ${role}, 'active', ${plan})
    ON CONFLICT (id) DO UPDATE SET name = ${name}, email = ${email || null}, telegram_id = ${telegramId || null}
    RETURNING id, name, email, role, status, plan, created_at
  `;
  return user;
}

async function getUserByEmail(email) {
  const db = getSql();
  const [user] = await db`SELECT * FROM users WHERE email = ${email}`;
  return user || null;
}

module.exports = {
  initDb, getSql,
  createUser, getUser, getUserByTelegramId, listUsers, updateUserStatus,
  createUserWithPassword, getUserByEmail, verifyPassword,
  saveConnection, getConnections, getConnection,
  createLead, getLead, getLeads, advanceLeadStage, updateLead, getPipelineStatus,
  getLeadHistory,
  saveStageMapping, getStageMapping, getStageMappings,
  logEvent, getRecentEvents
};
