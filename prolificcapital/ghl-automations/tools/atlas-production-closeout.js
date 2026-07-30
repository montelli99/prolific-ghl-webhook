#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const importer = require('../modules/atlas-ghl-import');
const { GhlReadOnlyLookupClient } = require('../modules/atlas-ghl-readonly-client');
const duplicateClassifier = require('../modules/atlas-duplicate-classifier');
const artifactHash = require('../modules/atlas-artifact-hash');

const ROOT = path.resolve(__dirname, '..', '..');
const FINAL_ARTIFACT_PATH = 'lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-passed-2e14a7cd6564.json';
const FINAL_ARTIFACT_HASH = '2e14a7cd65646bc15defd3500c9915284cd293e0f6f129d267ba842236a811b1';
const FINAL_JOURNAL_PATH = 'lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-20260730190035-journal.jsonl';
const FINAL_MANIFEST_PATH = 'lead-tracking/atlas-deals/manifests/atlas-final-55-after-row18-completion-20260730-371c476d0b2f.json';
const FINAL_MANIFEST_HASH = '371c476d0b2fb01ebbe4edd125fe8b2b27ab85d933a173f89d9409354a5891cc';
const BLOCKED_ROWS = Object.freeze(['import-ready:69', 'import-ready:217', 'import-ready:273']);
const COMPLETED_HISTORICAL = Object.freeze({
  'import-ready:230': 'iPQfs1bnZmJeAVRISQWa',
  'import-ready:4': 'sjFaJIiWBXdIsjfakhdt',
  'import-ready:18': '7f4WdgVI73tFWQ5LPa8S',
});
const EXPECTED = Object.freeze({ atlasValid: 206, physical: 213, remainingExecutable: 0 });
const DISPOSITION_INPUTS = Object.freeze({
  'import-ready:69': [
    'lead-tracking/atlas-deals/reconciliations/atlas-75-clean-20260729-partial-reconciliation-row69.json',
    'lead-tracking/atlas-deals/reconciliations/atlas-row69-remediation-plan.json',
    'lead-tracking/atlas-deals/reconciliations/atlas-row69-remediation-result.json',
  ],
  'import-ready:217': ['lead-tracking/atlas-deals/reconciliations/atlas-import-ready-217-identity-investigation-6468abbb5d2c.json'],
  'import-ready:273': ['lead-tracking/atlas-deals/reconciliations/atlas-final59-identity-investigation-rows230-247-273-dcf85d5b81b0.json'],
});

function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
}

function envWithSecrets() {
  const env = { ...process.env };
  for (const file of ['secrets/.env', '.env.local', '.env.production', '.env']) loadEnvFile(path.join(ROOT, file), env);
  env.GHL_LOCATION_ID = importer.TARGET_CONFIG.locationId;
  env.GHL_PIPELINE_ID = importer.TARGET_CONFIG.pipelineId;
  return env;
}

function readJson(relativePath) { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8')); }
function readOptionalJson(relativePath) { return fs.existsSync(path.join(ROOT, relativePath)) ? readJson(relativePath) : null; }
function rowNumber(rowId) { return Number(String(rowId).replace(/^import-ready:/, '')); }
function rowId(row) { return `import-ready:${row.sourceRow}`; }
function hashObject(object) { return artifactHash.calculateCanonicalArtifactHash(object); }
function verifyHash(relativePath, expected) {
  const object = readJson(relativePath);
  const actual = hashObject(object);
  if (actual !== expected) throw new Error(`HASH_MISMATCH ${relativePath}: expected ${expected}, got ${actual}`);
  return object;
}
function customFields(entity = {}) { return Array.isArray(entity.customFields) ? entity.customFields : Array.isArray(entity.customField) ? entity.customField : []; }
function customValue(field = {}) { return String(field.fieldValue ?? field.value ?? field.field_value ?? ''); }
function customKey(field = {}) { return String(field.key || field.fieldKey || field.field_key || field.name || field.id || field.fieldId || ''); }
function allCustomValues(entity) { return customFields(entity).map(customValue).filter(Boolean); }
function sourceRecordFor(rowIdValue) {
  const csv = importer.parseCsv(fs.readFileSync(importer.DEFAULT_SOURCE_PATH, 'utf8'));
  return csv.records.find(record => record._rowNumber === rowNumber(rowIdValue));
}
function fieldValue(row, logicalKey) { return row.customFields.find(field => field.logicalKey === logicalKey)?.fieldValue || ''; }
function contactSummary(contact = {}) {
  return {
    id: contact.id,
    name: contact.name || contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    phone: contact.phone || '',
    email: contact.email || '',
    source: contact.source || '',
    customFields: customFields(contact).map(field => ({ id: field.id || field.fieldId || '', key: customKey(field), value: customValue(field) })),
  };
}
function contactHasPropertyData(contact = {}) {
  const text = JSON.stringify(contactSummary(contact)).toLowerCase();
  return /atlas_property|property_fingerprint|normalized_address|source_row|listing_price|square_feet|price_per_sqft|mls_id/.test(text);
}
async function hydratedOpportunityItems(client) {
  client.pageCache.clear();
  const page = await client.searchOpportunities();
  const items = [];
  for (const item of page.items) {
    const id = item.id || item.opportunityId;
    if (!id) continue;
    const readback = await client.request('GET', `/opportunities/${encodeURIComponent(id)}`, 'opportunities.closeout-readback');
    items.push(readback.opportunity || readback);
  }
  return { items, pages: page.pages, listed: page.items.length, hydrated: items.length };
}
function valuesCount(items, value) { return items.filter(item => allCustomValues(item).includes(value)).length; }
function opportunityById(items, id) { return items.filter(item => (item.id || item.opportunityId) === id); }
function isAtlasValidOpportunity(opp) {
  const values = allCustomValues(opp);
  return values.some(value => /^import-ready:\d+$/.test(value)) && values.some(value => String(value).includes('atlas_guarded_importer'));
}
function assertCondition(checks, name, ok, detail) {
  const check = { name, ok: Boolean(ok), detail };
  checks.push(check);
  if (!check.ok) throw Object.assign(new Error(`PRODUCTION_AUDIT_FAILED: ${name}`), { checks });
}
function writeArtifact(prefix, artifact) {
  const canonicalHash = hashObject(artifact);
  const output = { ...artifact, canonicalHash };
  const relativePath = path.join('lead-tracking', 'atlas-deals', 'reconciliations', `${prefix}-${canonicalHash.slice(0, 12)}.json`).replace(/\\/g, '/');
  fs.writeFileSync(path.join(ROOT, relativePath), JSON.stringify(output, null, 2) + '\n');
  const verifiedHash = hashObject(readJson(relativePath));
  if (verifiedHash !== canonicalHash) throw new Error(`ARTIFACT_VERIFY_FAILED ${relativePath}`);
  return { relativePath, canonicalHash };
}
function journalDigest(journal) { return artifactHash.calculateCanonicalArtifactHash({ journal }); }

async function auditProduction(client) {
  const checks = [];
  const finalArtifact = verifyHash(FINAL_ARTIFACT_PATH, FINAL_ARTIFACT_HASH);
  const finalManifest = verifyHash(FINAL_MANIFEST_PATH, FINAL_MANIFEST_HASH);
  const journalText = fs.readFileSync(path.join(ROOT, FINAL_JOURNAL_PATH), 'utf8');
  const journal = journalText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  assertCondition(checks, 'final reconciliation artifact exists and hash verifies', true, FINAL_ARTIFACT_HASH);
  assertCondition(checks, 'journal exists and parses', journal.length > 0, { entries: journal.length, digest: journalDigest(journal) });
  assertCondition(checks, 'journal has no uncertain writes', !journal.some(event => /UNKNOWN|UNCERTAIN|REJECTED|FAILED/.test(event.transition || event.outcome || '')), journal.filter(event => /UNKNOWN|UNCERTAIN|REJECTED|FAILED/.test(event.transition || event.outcome || '')).slice(0, 3));
  const hydrated = await hydratedOpportunityItems(client);
  const atlasValid = hydrated.items.filter(isAtlasValidOpportunity);
  assertCondition(checks, 'target-pipeline physical count', hydrated.hydrated === EXPECTED.physical, hydrated);
  assertCondition(checks, 'atlas-valid opportunity count', atlasValid.length === EXPECTED.atlasValid, { atlasValid: atlasValid.length });
  for (const [completedRow, opportunityId] of Object.entries(COMPLETED_HISTORICAL)) {
    assertCondition(checks, `${completedRow} opportunity exists exactly once`, opportunityById(hydrated.items, opportunityId).length === 1, { opportunityId });
    assertCondition(checks, `${completedRow} source-row marker exists exactly once`, valuesCount(hydrated.items, completedRow) === 1, { count: valuesCount(hydrated.items, completedRow) });
  }
  for (const row of finalManifest.rows) {
    const id = rowId(row);
    const result = finalArtifact.rowResults.find(item => item.rowId === id);
    const oppsByMarker = hydrated.items.filter(item => allCustomValues(item).includes(id));
    const fingerprint = row.propertyFingerprint || fieldValue(row, 'propertyFingerprint');
    assertCondition(checks, `${id} has exactly one result`, Boolean(result), result);
    assertCondition(checks, `${id} reconciled completion`, result.result === 'VERIFIED' && result.verification?.status === 'VERIFIED', result?.result);
    assertCondition(checks, `${id} contact decision recorded`, ['CREATE', 'REUSE'].includes(result.contactAction), result.contactAction);
    assertCondition(checks, `${id} opportunity id recorded`, Boolean(result.opportunityId), result.opportunityId);
    assertCondition(checks, `${id} successful field comparisons`, (result.fieldComparisons || []).every(item => item.ok), (result.fieldComparisons || []).filter(item => !item.ok));
    assertCondition(checks, `${id} source-row marker exactly once`, oppsByMarker.length === 1, oppsByMarker.map(item => item.id));
    assertCondition(checks, `${id} opportunity ID matches marker`, oppsByMarker[0]?.id === result.opportunityId, { markerOpportunityId: oppsByMarker[0]?.id, resultOpportunityId: result.opportunityId });
    assertCondition(checks, `${id} fingerprint exactly once`, valuesCount(hydrated.items, fingerprint) === 1, { fingerprint, count: valuesCount(hydrated.items, fingerprint) });
    assertCondition(checks, `${id} target locks`, oppsByMarker[0].pipelineId === importer.TARGET_CONFIG.pipelineId && oppsByMarker[0].pipelineStageId === importer.TARGET_CONFIG.stageId && oppsByMarker[0].assignedTo === importer.TARGET_CONFIG.ownerId, { pipelineId: oppsByMarker[0].pipelineId, stageId: oppsByMarker[0].pipelineStageId, ownerId: oppsByMarker[0].assignedTo });
    if (result.contactAction === 'REUSE') assertCondition(checks, `${id} reused contact unchanged`, result.contactComparison?.ok === true, result.contactComparison);
    const contact = (await client.request('GET', `/contacts/${encodeURIComponent(result.contactId)}`, 'contacts.closeout-readback')).contact;
    assertCondition(checks, `${id} no property data on contact`, !contactHasPropertyData(contact), contactSummary(contact));
  }
  for (const blocked of BLOCKED_ROWS) {
    assertCondition(checks, `${blocked} not imported by final execution`, !finalArtifact.exactRowSet.includes(blocked), finalArtifact.exactRowSet.includes(blocked));
    assertCondition(checks, `${blocked} source marker absent`, valuesCount(hydrated.items, blocked) === 0, { count: valuesCount(hydrated.items, blocked) });
  }
  assertCondition(checks, 'no final row has multiple Atlas opportunities', finalManifest.exactSourceRowIds.every(id => valuesCount(hydrated.items, id) === 1), finalManifest.exactSourceRowIds.map(id => ({ id, count: valuesCount(hydrated.items, id) })).filter(item => item.count !== 1));
  assertCondition(checks, 'side-effect counters zero', Object.values(finalArtifact.sideEffectCounters || {}).every(value => value === 0), finalArtifact.sideEffectCounters);
  assertCondition(checks, 'outreach disabled', finalArtifact.outreachDisabled === true, finalArtifact.outreachDisabled);
  assertCondition(checks, 'remaining executable zero', finalArtifact.finalCounts?.remainingExecutableRows === 0, finalArtifact.finalCounts);
  assertCondition(checks, 'client performed zero writes during audit', client.writeCount === 0, client.writeCount);
  assertCondition(checks, 'completed rows cannot rerun from final manifest', !finalManifest.exactSourceRowIds.some(id => Object.keys(COMPLETED_HISTORICAL).includes(id)), finalManifest.exactSourceRowIds);
  assertCondition(checks, 'blocked rows cannot rerun from final manifest', !finalManifest.exactSourceRowIds.some(id => BLOCKED_ROWS.includes(id)), finalManifest.exactSourceRowIds);
  return { checks, finalArtifact, finalManifest, journal, journalDigest: journalDigest(journal), hydrated: { pages: hydrated.pages, listed: hydrated.listed, hydrated: hydrated.hydrated, atlasValid: atlasValid.length }, hydratedItems: hydrated.items };
}

async function blockedDisposition(client, audit) {
  const rows = [];
  for (const blocked of BLOCKED_ROWS) {
    const sourceRecord = sourceRecordFor(blocked);
    const fingerprint = importer.buildPropertyFingerprint(sourceRecord);
    const normalizedAddress = importer.normalizeAddressParts(sourceRecord);
    const contactLookup = await client.lookupContact({ email: sourceRecord.agentEmail, phone: sourceRecord.agentPhone, name: sourceRecord.listingAgent });
    const opportunityDuplicate = duplicateClassifier.classifyDuplicateSet({ sourceRow: rowNumber(blocked), propertyFingerprint: fingerprint, customFields: [{ logicalKey: 'sourceRowId', fieldValue: blocked }, { logicalKey: 'propertyFingerprint', fieldValue: fingerprint }, { logicalKey: 'normalizedAddress', fieldValue: normalizedAddress }], proposedOpportunity: { name: importer.displayPropertyAddress(sourceRecord), customFields: [] } }, audit.hydratedItems, { sharedSourcePrefix: importer.TARGET_CONFIG.source });
    let classification = 'PERMANENT_IDENTITY_AMBIGUITY';
    let reason = 'credible contact candidates remain and source-backed evidence does not safely distinguish them';
    let futureReconsiderationAllowed = true;
    let evidenceRequiredForReconsideration = 'source-backed corrected listing-agent identity with exact person-level phone/email, plus duplicate-free preflight';
    if (blocked === 'import-ready:69') {
      classification = 'SOURCE_DATA_CONFLICT';
      reason = 'historical row-69 reconciliation/remediation evidence records contact identity conflict/source identity defect; prior incorrectly linked opportunity was remediated separately and the source identity remains defective';
      evidenceRequiredForReconsideration = 'corrected source identity from the data provider or operator-owned source, followed by fresh contact and opportunity duplicate preflight';
    }
    if (blocked === 'import-ready:217') {
      classification = 'PERMANENT_IDENTITY_AMBIGUITY';
      reason = 'same phone remains associated with multiple credible GHL contacts and the source email is a generic company inbox, not person-level identity evidence';
    }
    if (blocked === 'import-ready:273') {
      classification = 'PERMANENT_IDENTITY_AMBIGUITY';
      reason = 'multiple same-name candidate contacts remain and source identity data does not resolve the contact safely';
    }
    rows.push({
      rowId: blocked,
      sourceRecord: { listingAgent: sourceRecord.listingAgent, agentPhone: sourceRecord.agentPhone, agentEmail: sourceRecord.agentEmail, address: sourceRecord.address, city: sourceRecord.city, state: sourceRecord.state, zip: sourceRecord.zip, mlsUrl: sourceRecord.mlsUrl },
      normalizedIdentity: { name: importer.normalizePersonName(sourceRecord.listingAgent, { matchingPhone: sourceRecord.agentPhone }), phone: importer.normalizePhone(sourceRecord.agentPhone), email: importer.normalizeEmail(sourceRecord.agentEmail) },
      sourcePropertyId: sourceRecord.mlsId || sourceRecord.mlsUrl || '',
      propertyFingerprint: fingerprint,
      exactAddress: importer.displayPropertyAddress(sourceRecord),
      normalizedAddress,
      sourceRowMarker: blocked,
      evidenceInspected: DISPOSITION_INPUTS[blocked].map(relativePath => ({ relativePath, exists: fs.existsSync(path.join(ROOT, relativePath)), hash: fs.existsSync(path.join(ROOT, relativePath)) ? hashObject(readJson(relativePath)) : null })),
      candidateContacts: contactLookup.contacts ? contactLookup.contacts.map(contactSummary) : contactLookup.contact ? [contactSummary(contactLookup.contact)] : (contactLookup.contactIds || []).map(id => ({ id })),
      candidateOpportunities: audit.hydratedItems.filter(item => [blocked, fingerprint, normalizedAddress].some(value => value && allCustomValues(item).includes(value))).map(item => ({ id: item.id, name: item.name, contactId: item.contactId })),
      duplicateChecks: opportunityDuplicate,
      classification,
      reason,
      excludedFromCompletedAtlasBatch: true,
      futureReconsiderationAllowed,
      evidenceRequiredForReconsideration,
    });
  }
  const artifact = {
    artifactType: 'atlas-blocked-rows-final-disposition',
    ...artifactHash.hashMetadata(),
    generatedAt: new Date().toISOString(),
    rows,
    productionWrites: 0,
    outreachDisabled: true,
    finalBatchExcludedRows: BLOCKED_ROWS,
  };
  const ref = writeArtifact('atlas-blocked-rows-69-217-273-final-disposition', artifact);
  return { ...ref, rows };
}

async function main() {
  const command = process.argv[2] || 'audit';
  const client = GhlReadOnlyLookupClient.fromEnv(envWithSecrets());
  const auth = await client.authProbe();
  if (!auth.ok) throw new Error(`AUTH_NOT_READY: ${auth.status}`);
  const audit = await auditProduction(client);
  let disposition = null;
  if (command === 'audit-disposition' || command === 'closeout') disposition = await blockedDisposition(client, audit);
  console.log(JSON.stringify({
    statusToken: disposition ? 'ATLAS_CLOSEOUT_AUDIT_AND_DISPOSITION_PASSED' : 'ATLAS_CLOSEOUT_AUDIT_PASSED',
    finalArtifact: { relativePath: FINAL_ARTIFACT_PATH, canonicalHash: FINAL_ARTIFACT_HASH },
    journal: { relativePath: FINAL_JOURNAL_PATH, digest: audit.journalDigest, entries: audit.journal.length },
    productionCounts: audit.hydrated,
    checks: audit.checks.length,
    blockedDisposition: disposition ? { relativePath: disposition.relativePath, canonicalHash: disposition.canonicalHash, rows: disposition.rows.map(row => ({ rowId: row.rowId, classification: row.classification })) } : null,
    productionWrites: client.writeCount,
    outreachDisabled: true,
  }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ statusToken: 'ATLAS_CLOSEOUT_AUDIT_FAILED', error: error.message }, null, 2)); process.exit(1); });

module.exports = { auditProduction, blockedDisposition, FINAL_ARTIFACT_PATH, FINAL_ARTIFACT_HASH, FINAL_JOURNAL_PATH, EXPECTED };
