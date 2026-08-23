// users.js — multi-user pipeline isolation
// Each user has their own active leads and settings

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Location Identity Constants ──────────────────────────────────────────────────
// Atlas (Montelli) location
const ATLAS_LOCATION_ID = process.env.GHL_LOCATION_ID || '61XPzSqRy7UKMwW9DeB8';
// Divinity Align PPC location — forwarded to local PPC runtime
const PPC_LOCATION_ID = 'GDq92uruRngbi9mLGGrV';
const PPC_PIPELINE_ID = 'ril84XHGQleRgE0W0FKU';

// Default users — add Kayla's mentees here
const USERS = {
  montelli: {
    id: 'montelli',
    name: 'Montelli Scott',
    ghlLocationId: ATLAS_LOCATION_ID,
    justcallAccountId: null,
    active: true
  }
};

function ensureUserDir(userId) {
  const dir = path.join(DATA_DIR, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLeadsPath(userId) {
  return path.join(ensureUserDir(userId), 'active-leads.json');
}

function getPipelineLog(userId) {
  return path.join(ensureUserDir(userId), 'pipeline.log');
}

function getSettingsPath(userId) {
  return path.join(ensureUserDir(userId), 'settings.json');
}

// Load user's active leads
function loadLeads(userId) {
  const p = getLeadsPath(userId);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

// Save user's active leads
function saveLeads(userId, leads) {
  fs.writeFileSync(getLeadsPath(userId), JSON.stringify(leads, null, 2));
}

// Log pipeline event
function logEvent(userId, event) {
  const entry = `[${new Date().toISOString()}] ${JSON.stringify(event)}\n`;
  fs.appendFileSync(getPipelineLog(userId), entry);
}

// Add user (for Kayla scaling)
function addUser(userId, config) {
  USERS[userId] = { id: userId, ...config, active: true };
  ensureUserDir(userId);
  if (!fs.existsSync(getLeadsPath(userId))) {
    saveLeads(userId, []);
  }
  return USERS[userId];
}

// Get user by GHL location ID (Atlas only — PPC is routed separately)
function findUserByGhlLocation(locationId) {
  return Object.values(USERS).find(u => u.ghlLocationId === locationId);
}

// Check if a locationId is the Divinity Align PPC location
function isPPCLocation(locationId) {
  return locationId === PPC_LOCATION_ID;
}

// Get user by JustCall account
function findUserByJustcall(accountId) {
  return Object.values(USERS).find(u => u.justcallAccountId === accountId);
}

module.exports = {
  USERS, loadLeads, saveLeads, logEvent,
  addUser, findUserByGhlLocation, isPPCLocation,
  findUserByJustcall, PPC_LOCATION_ID, PPC_PIPELINE_ID,
  getLeadsPath, getPipelineLog, ensureUserDir
};
