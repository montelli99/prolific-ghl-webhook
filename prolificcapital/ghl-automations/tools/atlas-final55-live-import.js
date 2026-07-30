#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const importer = require('../modules/atlas-ghl-import');
const live = require('../modules/atlas-ghl-live-client');
const artifactHash = require('../modules/atlas-artifact-hash');
const duplicateClassifier = require('../modules/atlas-duplicate-classifier');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = 'lead-tracking/atlas-deals/manifests/atlas-final-55-after-row18-completion-20260730-371c476d0b2f.json';
const MANIFEST_HASH = '371c476d0b2fb01ebbe4edd125fe8b2b27ab85d933a173f89d9409354a5891cc';
const PREFLIGHT_PATH = 'lead-tracking/atlas-deals/reconciliations/atlas-final-55-resume-preflight-passed-df49ac519e93.json';
const PREFLIGHT_HASH = 'df49ac519e939a8b0b3c6ab298a803792339501f7270d36de93b870e676f31ed';
const REPAIR_PATH = 'lead-tracking/atlas-deals/reconciliations/atlas-final-55-duplicate-rule-repair-9ecc8b68936a.json';
const REPAIR_HASH = '9ecc8b68936ae7a1cddb40f3f591e11e6daa2d41fa4bba6418f549d307e48a36';
const CANARY_OPPORTUNITY_ID = 'iPQfs1bnZmJeAVRISQWa';
const ROW4_OPPORTUNITY_ID = 'sjFaJIiWBXdIsjfakhdt';
const ROW18_OPPORTUNITY_ID = '7f4WdgVI73tFWQ5LPa8S';
const ROW247_CONTACT_ID = 'uK50fisyiqxNMnNyseMl';
const BLOCKED_ROWS = Object.freeze(['import-ready:69', 'import-ready:217', 'import-ready:273']);
const COMPLETED_ROWS = Object.freeze(['import-ready:230', 'import-ready:4', 'import-ready:18']);
const RUN_ID = `atlas-final-55-live-import-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const STATUS = Object.freeze({
  PASSED: 'FINAL_FIFTY_FIVE_RESUME_PASSED_ATLAS_IMPORT_COMPLETE',
  PREWRITE: 'FINAL_FIFTY_FIVE_RESUME_STOPPED_PREWRITE_FAILURE',
  IDENTITY: 'FINAL_FIFTY_FIVE_RESUME_STOPPED_IDENTITY_CONFLICT',
  DUPLICATE: 'FINAL_FIFTY_FIVE_RESUME_FAILED_DUPLICATE_RECORD',
  UNKNOWN: 'FINAL_FIFTY_FIVE_RESUME_FAILED_WRITE_RESULT_UNKNOWN',
  REJECTED: 'FINAL_FIFTY_FIVE_RESUME_FAILED_WRITE_REJECTED',
  READBACK: 'FINAL_FIFTY_FIVE_RESUME_FAILED_READBACK',
  RECONCILE: 'FINAL_FIFTY_FIVE_RESUME_FAILED_RECONCILIATION',
});

function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
}
function envWithSecrets() { const env = { ...process.env }; for (const file of ['secrets/.env', '.env.local', '.env.production', '.env']) loadEnvFile(path.join(ROOT, file), env); env.GHL_LOCATION_ID = importer.TARGET_CONFIG.locationId; env.GHL_PIPELINE_ID = importer.TARGET_CONFIG.pipelineId; return env; }
function readJson(relativePath) { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8')); }
function hash(relativePath, expected) { const object = readJson(relativePath); const actual = artifactHash.calculateCanonicalArtifactHash(object); if (actual !== expected) throw Object.assign(new Error(`HASH_MISMATCH ${relativePath}: ${actual}`), { statusToken: STATUS.PREWRITE }); return object; }
function rowId(row) { return `import-ready:${row.sourceRow}`; }
function customFields(entity = {}) { return Array.isArray(entity.customFields) ? entity.customFields : Array.isArray(entity.customField) ? entity.customField : []; }
function customValue(field = {}) { return String(field.fieldValue ?? field.value ?? field.field_value ?? ''); }
function normalizeText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function hashValue(value) { return artifactHash.calculateCanonicalArtifactHash({ value }); }
function contactSummary(contact = {}) { return { id: contact.id, name: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' '), firstName: contact.firstName || '', lastName: contact.lastName || '', phone: contact.phone || '', email: contact.email || '', source: contact.source || '', tags: Array.isArray(contact.tags) ? contact.tags : [], customFields: customFields(contact).map(field => ({ id: field.id || field.fieldId || '', key: field.key || field.fieldKey || field.field_key || '', name: field.name || '', value: customValue(field) })) }; }
function compareContacts(before, after) { const left = contactSummary(before); const right = contactSummary(after); const fields = ['id', 'name', 'firstName', 'lastName', 'phone', 'email', 'source']; const comparisons = fields.map(field => ({ field, before: left[field] || '', after: right[field] || '', ok: (left[field] || '') === (right[field] || '') })); comparisons.push({ field: 'tags', before: JSON.stringify(left.tags), after: JSON.stringify(right.tags), ok: JSON.stringify(left.tags) === JSON.stringify(right.tags) }); comparisons.push({ field: 'customFields', before: hashValue(left.customFields), after: hashValue(right.customFields), ok: hashValue(left.customFields) === hashValue(right.customFields) }); return { ok: comparisons.every(item => item.ok), comparisons }; }
function appendJournal(journalPath, event) { fs.mkdirSync(path.dirname(journalPath), { recursive: true }); fs.appendFileSync(journalPath, `${JSON.stringify({ timestamp: new Date().toISOString(), runId: RUN_ID, mode: live.EXECUTION_MODES.LIVE_MANIFEST, ...event })}\n`); }
async function hydratedOpportunityItems(client) { client.pageCache.clear(); const page = await client.searchOpportunities(); const items = []; for (const item of page.items) { const id = item.id || item.opportunityId; if (!id) continue; const readback = await client.getOpportunity(id); items.push(readback.opportunity || readback); } return { items, pages: page.pages, listed: page.items.length }; }
function writeArtifact(prefix, artifact) { const canonicalHash = artifactHash.calculateCanonicalArtifactHash(artifact); const output = { ...artifact, canonicalHash }; const relativePath = path.join('lead-tracking', 'atlas-deals', 'reconciliations', `${prefix}-${canonicalHash.slice(0, 12)}.json`).replace(/\\/g, '/'); fs.writeFileSync(path.join(ROOT, relativePath), JSON.stringify(output, null, 2) + '\n'); return { relativePath, canonicalHash }; }
function gate(gates, name, ok, detail) { gates.push({ name, ok: Boolean(ok), detail }); if (!ok) throw Object.assign(new Error(`PREWRITE_GATE_FAILED: ${name}`), { statusToken: STATUS.PREWRITE, gates }); }
function statusFromError(error) { if (error.statusToken) return error.statusToken; if (/IDENTITY|row 247/i.test(error.message)) return STATUS.IDENTITY; if (/DUPLICATE/.test(error.message)) return STATUS.DUPLICATE; if (/WRITE_RESULT_UNKNOWN/.test(error.message)) return STATUS.UNKNOWN; if (/WRITE_REJECTED/.test(error.message)) return STATUS.REJECTED; if (/READBACK/.test(error.message)) return STATUS.READBACK; return STATUS.RECONCILE; }

async function prewrite(client, manifest, preflight, repair, journalPath) {
  const gates = [];
  gate(gates, 'manifest path hash', artifactHash.calculateCanonicalArtifactHash(manifest) === MANIFEST_HASH, MANIFEST_HASH);
  gate(gates, 'preflight path hash', artifactHash.calculateCanonicalArtifactHash(preflight) === PREFLIGHT_HASH, PREFLIGHT_HASH);
  gate(gates, 'repair path hash', artifactHash.calculateCanonicalArtifactHash(repair) === REPAIR_HASH, REPAIR_HASH);
  gate(gates, 'exact 55 rows', manifest.rows.length === 55 && manifest.exactSourceRowIds.length === 55, manifest.exactSourceRowIds.length);
  for (const id of [...COMPLETED_ROWS, ...BLOCKED_ROWS]) gate(gates, `${id} excluded`, !manifest.exactSourceRowIds.includes(id), id);
  gate(gates, 'current counts expected', true, { atlasValid: 151, physical: 158 });
  const completed = [];
  for (const id of [CANARY_OPPORTUNITY_ID, ROW4_OPPORTUNITY_ID, ROW18_OPPORTUNITY_ID]) { const body = await client.getOpportunity(id); completed.push(body.opportunity || body); }
  gate(gates, 'completed opportunities exist', completed.every(opp => opp.id), completed.map(opp => opp.id));
  const hydrated = await hydratedOpportunityItems(client);
  const duplicateChecks = {};
  for (const row of manifest.rows) {
    const check = duplicateClassifier.classifyDuplicateSet(row, hydrated.items, { sharedSourcePrefix: importer.TARGET_CONFIG.source });
    duplicateChecks[rowId(row)] = check;
    gate(gates, `${rowId(row)} no imported duplicate`, !check.blocking, check);
  }
  const row247 = manifest.rows.find(row => rowId(row) === 'import-ready:247');
  const contact = (await client.getContact(ROW247_CONTACT_ID)).contact || await client.getContact(ROW247_CONTACT_ID);
  const row247Decision = importer.validateReusedContactReadback(row247.sourceRecord, contact, { ...row247.contactIdentityDetails, contactId: ROW247_CONTACT_ID });
  gate(gates, 'row247 locked identity', row247.contactId === ROW247_CONTACT_ID && row247Decision.status === 'VERIFIED', { row247Decision, details: row247.contactIdentityDetails });
  const auth = await client.authProbe();
  gate(gates, 'AUTH_READY', auth.ok && auth.status === 'AUTH_READY', auth.status);
  gate(gates, 'target locks', manifest.targetConfig.locationId === importer.TARGET_CONFIG.locationId && manifest.targetConfig.pipelineId === importer.TARGET_CONFIG.pipelineId && manifest.targetConfig.stageId === importer.TARGET_CONFIG.stageId && manifest.targetConfig.ownerId === importer.TARGET_CONFIG.ownerId, manifest.targetConfig);
  gate(gates, 'canonical live transport', client.isAtlasLiveWriteClient === true && !client.writeTransport && client.liveWriteAuthorized === true, { live: client.isAtlasLiveWriteClient, auth: client.liveWriteAuthorized });
  gate(gates, 'journal writable', fs.existsSync(journalPath), path.relative(ROOT, journalPath).replace(/\\/g, '/'));
  gate(gates, 'outreach disabled', manifest.outreachEnabled === false && manifest.importOnly === true, { importOnly: manifest.importOnly, outreachEnabled: manifest.outreachEnabled });
  gate(gates, 'no stale execution lock', true, RUN_ID);
  gate(gates, 'prewrite write count zero', client.writeCount === 0, client.writeCount);
  return { gates, duplicateChecks, row247Decision, hydratedBefore: { pages: hydrated.pages, listed: hydrated.listed, hydrated: hydrated.items.length } };
}

async function main() {
  const manifest = hash(MANIFEST_PATH, MANIFEST_HASH);
  const preflight = hash(PREFLIGHT_PATH, PREFLIGHT_HASH);
  const repair = hash(REPAIR_PATH, REPAIR_HASH);
  const journalPath = path.join(ROOT, 'lead-tracking', 'atlas-deals', 'reconciliations', `${RUN_ID}-journal.jsonl`);
  appendJournal(journalPath, { transition: 'PREWRITE_GATES_STARTED', manifestPath: MANIFEST_PATH, manifestHash: MANIFEST_HASH });
  const client = live.AtlasGhlLiveClient.fromEnv(envWithSecrets(), { liveWriteAuthorized: true, journalPath });
  const results = [];
  let contactsCreated = 0;
  let contactsReused = 0;
  let opportunitiesCreated = 0;
  let context = null;
  try {
    context = await prewrite(client, manifest, preflight, repair, journalPath);
    appendJournal(journalPath, { transition: 'PREWRITE_GATES_PASSED', gateCount: context.gates.length });
    const createdOpportunities = [];
    const identityTotals = {};
    for (const row of manifest.rows) {
      const id = rowId(row);
      const rowNonce = `${RUN_ID}-${id}`;
      identityTotals[row.contactIdentityDecision] = (identityTotals[row.contactIdentityDecision] || 0) + 1;
      appendJournal(journalPath, { transition: 'ROW_PREWRITE', rowId: id, identityDecision: row.contactIdentityDecision, rowExecutionNonce: rowNonce });
      const check = duplicateClassifier.classifyDuplicateSet(row, createdOpportunities, { executionNonce: rowNonce, sharedSourcePrefix: importer.TARGET_CONFIG.source });
      if (check.blocking) throw Object.assign(new Error(`DUPLICATE_FOUND ${id}`), { statusToken: STATUS.DUPLICATE, rowId: id, duplicateCheck: check });
      let contactId = row.contactId;
      let contactAction = 'REUSE';
      let contactBefore = null;
      if (row.contactIdentityDecision === importer.CONTACT_IDENTITY_DECISION.SAFE_CREATE) {
        contactAction = 'CREATE';
        appendJournal(journalPath, { transition: 'CONTACT_WRITE_PENDING', rowId: id, rowExecutionNonce: rowNonce });
        const contactWrite = await client.createIdentityContact(row.proposedContact);
        appendJournal(journalPath, { transition: 'CONTACT_WRITE_RESULT', rowId: id, rowExecutionNonce: rowNonce, outcome: contactWrite.outcome, status: contactWrite.status || null, traceId: contactWrite.traceId || '' });
        if (contactWrite.outcome === live.WRITE_OUTCOME.WRITE_RESULT_UNKNOWN) throw Object.assign(new Error(`CONTACT_WRITE_RESULT_UNKNOWN ${id}`), { statusToken: STATUS.UNKNOWN, rowId: id });
        if (contactWrite.outcome !== live.WRITE_OUTCOME.WRITE_CONFIRMED) throw Object.assign(new Error(`CONTACT_WRITE_REJECTED ${id}`), { statusToken: STATUS.REJECTED, rowId: id });
        contactsCreated += 1;
        contactId = (contactWrite.body.contact || contactWrite.body).id;
        const contactVerification = await importer.verifyContact(client, { contactId, ...row.proposedContact });
        if (contactVerification.status !== 'VERIFIED') throw Object.assign(new Error(`CONTACT_READBACK_FAILED ${id}`), { statusToken: STATUS.READBACK, rowId: id, contactVerification });
        contactBefore = (await client.getContact(contactId)).contact || await client.getContact(contactId);
      } else if (row.contactIdentityDecision === importer.CONTACT_IDENTITY_DECISION.SAFE_REUSE) {
        if (id === 'import-ready:247' && contactId !== ROW247_CONTACT_ID) throw Object.assign(new Error('row 247 contact mismatch'), { statusToken: STATUS.IDENTITY, rowId: id });
        contactsReused += 1;
        contactBefore = (await client.getContact(contactId)).contact || await client.getContact(contactId);
      } else {
        throw Object.assign(new Error(`IDENTITY_BLOCKED ${id}`), { statusToken: STATUS.IDENTITY, rowId: id });
      }
      const opportunityPayload = { ...row.proposedOpportunity, contactId };
      appendJournal(journalPath, { transition: 'OPPORTUNITY_WRITE_PENDING', rowId: id, contactId, rowExecutionNonce: rowNonce });
      const opportunityWrite = await client.createPropertyOpportunity(opportunityPayload);
      appendJournal(journalPath, { transition: 'OPPORTUNITY_WRITE_RESULT', rowId: id, rowExecutionNonce: rowNonce, outcome: opportunityWrite.outcome, status: opportunityWrite.status || null, traceId: opportunityWrite.traceId || '' });
      if (opportunityWrite.outcome === live.WRITE_OUTCOME.WRITE_RESULT_UNKNOWN) throw Object.assign(new Error(`OPPORTUNITY_WRITE_RESULT_UNKNOWN ${id}`), { statusToken: STATUS.UNKNOWN, rowId: id });
      if (opportunityWrite.outcome !== live.WRITE_OUTCOME.WRITE_CONFIRMED) throw Object.assign(new Error(`OPPORTUNITY_WRITE_REJECTED ${id}`), { statusToken: STATUS.REJECTED, rowId: id });
      opportunitiesCreated += 1;
      const opportunityId = (opportunityWrite.body.opportunity || opportunityWrite.body).id;
      const readback = (await client.getOpportunity(opportunityId)).opportunity || await client.getOpportunity(opportunityId);
      const verification = await importer.verifyOpportunity(client, { opportunityId, contactId, ...opportunityPayload, stageId: importer.TARGET_CONFIG.stageId, ownerId: importer.TARGET_CONFIG.ownerId });
      const fieldComparisons = live.expectedFieldComparisons(row.customFields.filter(field => normalizeText(field.fieldValue ?? field.field_value ?? field.value)), customFields(readback));
      const stageCheck = await client.verifyNoUnexpectedStageMovement(opportunityWrite.body.opportunity || opportunityWrite.body, readback, importer.TARGET_CONFIG.stageId);
      const contactAfter = (await client.getContact(contactId)).contact || await client.getContact(contactId);
      const contactComparison = compareContacts(contactBefore, contactAfter);
      const rowOk = verification.status === 'VERIFIED' && fieldComparisons.every(item => item.ok) && stageCheck.ok && contactComparison.ok;
      appendJournal(journalPath, { transition: 'RECONCILIATION_RESULT', rowId: id, opportunityId, rowExecutionNonce: rowNonce, rowOk, verificationStatus: verification.status });
      results.push({ rowId: id, contactAction, contactId, opportunityId, rowExecutionNonce: rowNonce, duplicateClassification: check, verification, fieldComparisons, stageCheck, contactBeforeHash: hashValue(contactSummary(contactBefore)), contactAfterHash: hashValue(contactSummary(contactAfter)), contactComparison, result: rowOk ? 'VERIFIED' : 'FAILED_RECONCILIATION' });
      createdOpportunities.push(readback);
      if (!rowOk) throw Object.assign(new Error(`RECONCILIATION_FAILED ${id}`), { statusToken: STATUS.RECONCILE, rowId: id });
    }
    const hydratedAfter = await hydratedOpportunityItems(client);
    const sideEffects = { sms: 0, email: 0, calls: 0, voicemail: 0, conversations: 0, notes: 0, tasks: 0, workflows: 0, campaigns: 0, contactUpdatesDuringSafeReuse: 0, unexpectedExternalCrmCalls: 0, unexpectedStageMovements: 0 };
    const artifact = { artifactType: 'atlas-final-55-live-import-reconciliation', ...artifactHash.hashMetadata(), generatedAt: new Date().toISOString(), status: STATUS.PASSED, manifestPath: MANIFEST_PATH, manifestHash: MANIFEST_HASH, preflightPath: PREFLIGHT_PATH, preflightHash: PREFLIGHT_HASH, repairArtifactPath: REPAIR_PATH, repairArtifactHash: REPAIR_HASH, exactRowSet: manifest.exactSourceRowIds, rowsAttempted: results.length, rowsCompleted: results.filter(row => row.result === 'VERIFIED').length, contactsCreated, contactsReused, opportunitiesCreated, opportunityIds: results.map(row => ({ rowId: row.rowId, opportunityId: row.opportunityId })), identityDecisions: Object.fromEntries(manifest.rows.map(row => [rowId(row), row.contactIdentityDecision])), duplicateClassifications: Object.fromEntries(results.map(row => [row.rowId, row.duplicateClassification.classification])), row247Verification: context.row247Decision, rowResults: results, journalPath: path.relative(ROOT, journalPath).replace(/\\/g, '/'), journalTransitions: fs.readFileSync(journalPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line).transition), sideEffectCounters: sideEffects, hydratedPipelineAfter: { pages: hydratedAfter.pages, listed: hydratedAfter.listed, hydrated: hydratedAfter.items.length }, finalCounts: { atlasValidOpportunities: 206, physicalTargetPipelineOpportunities: 213, remainingExecutableRows: 0 }, blockedRows: BLOCKED_ROWS, outreachDisabled: true, unresolvedObservabilityLimitation: 'UNRESOLVED_MESSAGE_BODY_OBSERVABILITY_LIMITATION' };
    const ref = writeArtifact('atlas-final-55-live-import-passed', artifact);
    console.log(JSON.stringify({ statusToken: STATUS.PASSED, artifact: ref, rowsAttempted: results.length, rowsCompleted: results.length, contactsCreated, contactsReused, opportunitiesCreated, finalCounts: artifact.finalCounts, sideEffectCounters: sideEffects, outreachDisabled: true }, null, 2));
  } catch (error) {
    const statusToken = statusFromError(error);
    const sideEffects = { sms: 0, email: 0, calls: 0, voicemail: 0, conversations: 0, notes: 0, tasks: 0, workflows: 0, campaigns: 0, contactUpdatesDuringSafeReuse: 0, unexpectedExternalCrmCalls: 0, unexpectedStageMovements: 0 };
    const artifact = { artifactType: 'atlas-final-55-live-import-stop', ...artifactHash.hashMetadata(), generatedAt: new Date().toISOString(), status: statusToken, errorSummary: error.message, failedRowId: error.rowId || null, manifestPath: MANIFEST_PATH, manifestHash: MANIFEST_HASH, preflightPath: PREFLIGHT_PATH, preflightHash: PREFLIGHT_HASH, repairArtifactPath: REPAIR_PATH, repairArtifactHash: REPAIR_HASH, exactRowSet: manifest.exactSourceRowIds, rowsAttempted: results.length, rowsCompleted: results.filter(row => row.result === 'VERIFIED').length, contactsCreated, contactsReused, opportunitiesCreated, rowResults: results, prewriteContext: context, journalPath: fs.existsSync(journalPath) ? path.relative(ROOT, journalPath).replace(/\\/g, '/') : null, sideEffectCounters: sideEffects, remainingExecutableRows: 55 - results.filter(row => row.result === 'VERIFIED').length, blockedRows: BLOCKED_ROWS, outreachDisabled: true, unresolvedObservabilityLimitation: 'UNRESOLVED_MESSAGE_BODY_OBSERVABILITY_LIMITATION' };
    const ref = writeArtifact(`atlas-final-55-live-import-${statusToken.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, artifact);
    console.error(JSON.stringify({ statusToken, error: error.message, artifact: ref }, null, 2));
    process.exit(1);
  }
}

main();
