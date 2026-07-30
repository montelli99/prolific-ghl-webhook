#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const queue = require('../modules/atlas-exception-queue');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_DIR = path.join(ROOT, 'lead-tracking/atlas-deals/reports');
const jsonPath = path.join(REPORT_DIR, 'atlas-exception-queue-current.json');
const mdPath = path.join(REPORT_DIR, 'atlas-exception-queue-current.md');

const loaded = queue.loadQueue();
const report = {
  artifactType: 'atlas-exception-queue-current',
  generatedAt: new Date().toISOString(),
  sourceArtifact: loaded.sourceArtifact,
  rows: loaded.rows.map(row => ({
    rowId: row.rowId,
    currentState: row.state,
    classification: row.classification,
    sourceName: row.sourceRecord?.listingAgent || '',
    phone: row.sourceRecord?.agentPhone || '',
    email: row.sourceRecord?.agentEmail || '',
    sourcePropertyId: row.sourcePropertyId || '',
    rawAddress: row.exactAddress || row.sourceRecord?.address || '',
    normalizedAddress: row.normalizedAddress || '',
    candidateContactIds: (row.candidateContacts || []).map(contact => contact.id).filter(Boolean),
    candidateContactEvidence: row.candidateContacts || [],
    candidateOpportunityIds: (row.candidateOpportunities || []).map(opp => opp.id).filter(Boolean),
    candidateOpportunities: row.candidateOpportunities || [],
    conflictingData: row.classification === 'SOURCE_DATA_CONFLICT' ? row.reason : row.candidateContacts?.length > 1 ? 'multiple credible contact candidates; no deterministic source-backed selector' : '',
    missingEvidence: row.evidenceRequiredForReconsideration || '',
    safeResolutionRequirements: row.evidenceRequiredForReconsideration || '',
    mayEverBeReconsidered: row.futureReconsiderationAllowed === true,
    currentRecommendedDisposition: row.classification === 'SOURCE_DATA_CONFLICT' ? 'keep excluded until corrected source identity is supplied' : 'keep excluded until source-backed identity evidence selects exactly one contact',
  })),
  productionWrites: 0,
  outreachDisabled: true,
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const lines = ['# Atlas Exception Queue Current', '', `Generated: ${report.generatedAt}`, '', `Source artifact: \`${loaded.sourceArtifact.path}\``, `Source hash: \`${loaded.sourceArtifact.hash}\``, '', '| Row | State | Classification | Source Name | Phone | Email | Candidate Contacts | Candidate Opportunities | Recommendation |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
for (const row of report.rows) lines.push(`| \`${row.rowId}\` | \`${row.currentState}\` | \`${row.classification}\` | ${row.sourceName || ''} | ${row.phone || ''} | ${row.email || ''} | ${row.candidateContactIds.join(', ') || 'none'} | ${row.candidateOpportunityIds.join(', ') || 'none'} | ${row.currentRecommendedDisposition} |`);
lines.push('', '## Details', '');
for (const row of report.rows) {
  lines.push(`### ${row.rowId}`, '');
  lines.push(`- Raw address: ${row.rawAddress}`);
  lines.push(`- Normalized address: ${row.normalizedAddress}`);
  lines.push(`- Source property ID: ${row.sourcePropertyId || '(missing)'}`);
  lines.push(`- Conflicting data: ${row.conflictingData || '(none recorded)'}`);
  lines.push(`- Missing evidence: ${row.missingEvidence}`);
  lines.push(`- Safe resolution requirements: ${row.safeResolutionRequirements}`);
  lines.push(`- May be reconsidered: ${row.mayEverBeReconsidered ? 'yes' : 'no'}`);
  lines.push('');
}
fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ statusToken: 'ATLAS_EXCEPTION_REPORTS_CREATED', jsonPath: path.relative(ROOT, jsonPath).replace(/\\/g, '/'), markdownPath: path.relative(ROOT, mdPath).replace(/\\/g, '/'), rows: report.rows.length, productionWrites: 0 }, null, 2));
