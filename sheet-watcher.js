// sheet-watcher.js — Google Sheets lead intake watcher
// Polls a Google Sheet, detects new rows, auto-creates pipeline leads
// Uses service account for auth (already in workspace)
// Docs: https://developers.google.com/sheets/api/reference/rest/v4

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const KEYFILE = path.resolve(__dirname, '..', 'prolific-agent-key.json');

// Expected column layout (configurable — Kayla's sheet format)
const COLUMN_MAP = {
  A: 'address',      // Property Address (Opportunity Name in GHL)
  B: 'price',        // Purchase Price
  C: 'propertyType', // Turnkey / Reno / Livable
  D: 'agentName',    // Agent or Seller Name
  E: 'agentPhone',   // Phone Number
  F: 'agentEmail',   // Email
  G: 'population',   // City Population
  H: 'notes'         // Additional Notes
};

let auth = null;
let lastProcessedRow = 0;

// Track processed rows in a file so we don't duplicate on restart
function getTrackerPath(sheetId, sheetName) {
  return path.resolve(__dirname, 'data', `sheet-tracker-${sheetId}-${sheetName}.json`);
}

function loadTracker(sheetId, sheetName) {
  const p = getTrackerPath(sheetId, sheetName);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
  }
  return { lastRow: 0, processedRows: [] };
}

function saveTracker(sheetId, sheetName, tracker) {
  const dir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getTrackerPath(sheetId, sheetName), JSON.stringify(tracker, null, 2));
}

async function getAuth() {
  if (auth) return auth;
  auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE,
    scopes: SCOPES,
  });
  return auth;
}

/**
 * Poll a Google Sheet for new lead rows since last check.
 * @param {string} sheetId - Google Sheet ID (from URL)
 * @param {string} range - Sheet name, e.g. "Sheet1" or "Leads"
 * @returns {Array} Array of new lead objects { address, price, propertyType, agentName, agentPhone, ... }
 */
async function pollSheet(sheetId, range = 'A:Z') {
  const client = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // Read all data
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: range,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) {
    console.log(`Sheet watcher: ${rows.length} rows, no data rows`);
    return [];
  }

  // Row 1 is headers, data starts at row 2
  const tracker = loadTracker(sheetId, range);
  const newLeads = [];

  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1; // 1-indexed for Google Sheets API

    // Skip already-processed rows
    if (tracker.processedRows.includes(rowNum)) continue;
    if (rowNum <= tracker.lastRow && tracker.processedRows.length > 0) continue;

    const row = rows[i];
    if (!row || row.length === 0) continue;

    // Map columns using COLUMN_MAP
    const lead = {
      source: 'google_sheet',
      sourceRow: rowNum,
    };

    Object.entries(COLUMN_MAP).forEach(([col, field]) => {
      const colIndex = col.charCodeAt(0) - 65; // A=0, B=1, etc.
      const value = row[colIndex];
      if (value !== undefined && value !== null && value.toString().trim() !== '') {
        // Convert numeric strings to numbers for price/population
        if ((field === 'price' || field === 'population') && !isNaN(value)) {
          lead[field] = Number(value);
        } else {
          lead[field] = value.toString().trim();
        }
      }
    });

    // Skip rows without an address (required field)
    if (!lead.address || lead.address.length < 5) {
      console.log(`Sheet watcher: skipping row ${rowNum} — no valid address`);
      continue;
    }

    // Map propertyType text to engine-compatible values
    if (lead.propertyType) {
      const t = lead.propertyType.toLowerCase();
      if (t.includes('turnkey') || t.includes('rental') || t.includes('move in'))
        lead.propertyType = 'turnkey';
      else if (t.includes('reno') || t.includes('renovation') || t.includes('fix') || t.includes('rehab'))
        lead.propertyType = 'reno';
      else if (t.includes('livable') || t.includes('decent'))
        lead.propertyType = 'livable';
    }

    newLeads.push(lead);
  }

  // Update tracker
  if (newLeads.length > 0) {
    const maxRow = Math.max(...newLeads.map(l => l.sourceRow));
    tracker.lastRow = maxRow;
    newLeads.forEach(l => tracker.processedRows.push(l.sourceRow));
    saveTracker(sheetId, range, tracker);
  }

  console.log(`Sheet watcher: ${rows.length - 1} total rows, ${newLeads.length} new leads found`);
  return newLeads;
}

/**
 * Poll and auto-ingest new leads into pipeline.
 * @param {string} userId - Pipeline user ID
 * @param {string} sheetId - Google Sheet ID
 * @param {string} range - Sheet name/range
 * @returns {Object} { imported: number, leads: Array }
 */
async function pollAndIngest(userId, sheetId, range) {
  const { createLead } = require('./engine');
  const newLeads = await pollSheet(sheetId, range);

  const imported = [];
  const skipped = [];

  for (const lead of newLeads) {
    const existing = require('./engine').findLead(userId, lead.address);
    if (existing) {
      skipped.push(lead);
      continue;
    }

    const result = createLead(userId, lead);
    imported.push({ address: lead.address, id: result.lead.id, row: lead.sourceRow });
  }

  return { imported, skipped, total: newLeads.length };
}

module.exports = { pollSheet, pollAndIngest };
