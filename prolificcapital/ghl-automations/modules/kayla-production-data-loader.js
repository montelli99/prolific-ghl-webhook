'use strict';

const fs = require('fs');
const path = require('path');
const { LEAD_ENTERED_STAGE_ID } = require('./kayla-course-spec');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch === ',') { row.push(cell); cell = ''; continue; }
    if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() || [];
  return rows.map(values => Object.fromEntries(header.map((key, index) => [key, values[index] || ''])));
}

function defaultHydrationPath() {
  return path.resolve(__dirname, '..', '..', 'lead-tracking', 'atlas-deals', 'audits', 'atlas-pipeline-full-safe-hydration-696e71987f97.json');
}

function defaultImportReadyPath() {
  return path.resolve(__dirname, '..', '..', 'lead-tracking', 'atlas-deals', 'import-ready.csv');
}

function loadAtlasDryRunOpportunities(options = {}) {
  const csvPath = options.importReadyPath || defaultImportReadyPath();
  const rows = fs.existsSync(csvPath) ? parseCsv(fs.readFileSync(csvPath, 'utf8')) : [];
  const byAddress = new Map(rows.map((row, index) => [String(row.address || '').toLowerCase(), { ...row, sourceRowId: `import-ready:${index + 2}` }]));
  const items = [];
  const seenAddresses = new Set();
  const hydrationPath = options.hydrationPath || defaultHydrationPath();
  if (fs.existsSync(hydrationPath)) {
    const hydration = JSON.parse(fs.readFileSync(hydrationPath, 'utf8'));
    for (const group of hydration.multiPropertyContacts || []) {
      for (const opp of group.opportunities || []) {
        const row = byAddress.get(String(opp.propertyAddress || '').split(',')[0].toLowerCase()) || {};
        seenAddresses.add(String(opp.propertyAddress || '').split(',')[0].toLowerCase());
        items.push({
          opportunityId: opp.opportunityId,
          contactId: group.contactId,
          propertyAddress: opp.propertyAddress,
          contactName: row.listingAgent || row.brokerName || 'Unknown Atlas Contact',
          contactRole: row.listingAgent ? 'agent' : 'unknown',
          stageId: opp.stageId || LEAD_ENTERED_STAGE_ID,
          stageName: 'Lead Entered',
          sourceRowId: opp.sourceRowId || row.sourceRowId,
          raw: row,
        });
      }
    }
  }
  for (const [index, row] of rows.entries()) {
    if (seenAddresses.has(String(row.address || '').toLowerCase())) continue;
    const address = [row.address, row.city, row.state, row.zip].filter(Boolean).join(', ');
    items.push({
      opportunityId: `dryrun-${index + 2}`,
      contactId: `dryrun-contact-${index + 2}`,
      propertyAddress: address,
      contactName: row.listingAgent || row.brokerName || 'Unknown Atlas Contact',
      contactRole: row.listingAgent ? 'agent' : 'unknown',
      stageId: LEAD_ENTERED_STAGE_ID,
      stageName: 'Lead Entered',
      phone: row.agentPhone,
      sourceRowId: `import-ready:${index + 2}`,
      raw: row,
    });
  }
  return items;
}

module.exports = { parseCsv, loadAtlasDryRunOpportunities };
