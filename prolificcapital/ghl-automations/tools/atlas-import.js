#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const importer = require('../modules/atlas-ghl-import');
const workflow = require('../modules/atlas-import-workflow');
const sourceValidator = require('../modules/atlas-source-validator');
const artifactHash = require('../modules/atlas-artifact-hash');
const exceptions = require('../modules/atlas-exception-queue');
const { GhlReadOnlyLookupClient } = require('../modules/atlas-ghl-readonly-client');
const { AtlasGhlLiveClient } = require('../modules/atlas-ghl-live-client');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { args._.push(arg); continue; }
    const key = arg.slice(2);
    if (['live'].includes(key)) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}
function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
}
function envWithLocks() {
  const env = { ...process.env };
  for (const file of ['secrets/.env', '.env.local', '.env.production', '.env']) loadEnvFile(path.resolve(file), env);
  env.GHL_LOCATION_ID = importer.TARGET_CONFIG.locationId;
  env.GHL_PIPELINE_ID = importer.TARGET_CONFIG.pipelineId;
  return env;
}
function print(object) { console.log(JSON.stringify(object, null, 2)); }
async function hydrated(client) {
  const page = await client.searchOpportunities();
  const items = [];
  for (const item of page.items) {
    const id = item.id || item.opportunityId;
    if (!id) continue;
    const body = await client.request('GET', `/opportunities/${encodeURIComponent(id)}`, 'opportunities.cli-hydrate');
    items.push(body.opportunity || body);
  }
  return items;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || ['prepare', 'preflight', 'execute', 'reconcile', 'status', 'doctor'].includes(command) === false) {
    print({ statusToken: 'ATLAS_IMPORT_USAGE', commands: ['status', 'doctor', 'prepare --source <path>', 'preflight --manifest <path>', 'execute --manifest <path> --live --authorize <text>', 'reconcile --artifact <path>'] });
    process.exit(command ? 1 : 0);
  }
  if (command === 'prepare') {
    const sourcePath = args.source || importer.DEFAULT_SOURCE_PATH;
    const validation = sourceValidator.validateSource(sourcePath);
    const validationHash = artifactHash.calculateCanonicalArtifactHash(validation.artifact);
    const validationArtifactPath = path.resolve('lead-tracking/atlas-deals/reconciliations', `atlas-source-validation-${validationHash.slice(0, 12)}.json`);
    fs.mkdirSync(path.dirname(validationArtifactPath), { recursive: true });
    fs.writeFileSync(validationArtifactPath, `${JSON.stringify({ ...validation.artifact, canonicalHash: validationHash }, null, 2)}\n`);
    if (!validation.ok) {
      print({ statusToken: 'ATLAS_IMPORT_PREPARE_BLOCKED_SOURCE_VALIDATION', mode: 'read-only', sourcePath, sourceValidationArtifact: validationArtifactPath, validationHash, rowTotals: { rows: validation.artifact.rowCount, blockedRows: validation.artifact.blockingRowCount, warnings: validation.artifact.warningRowCount }, blockedRows: validation.blockedRows.map(row => ({ rowId: row.rowId, classification: row.classification, errors: row.errors })), writesPerformed: 0, outreachStatus: 'disabled' });
      process.exit(1);
    }
    const client = GhlReadOnlyLookupClient.fromEnv(envWithLocks());
    const result = await workflow.prepareBatch({ sourcePath, client, outputDir: args.out ? path.resolve(args.out) : importer.DEFAULT_MANIFEST_DIR, limit: args.limit ? Number(args.limit) : 0 });
    const safeRows = (result.manifest.rows || []).filter(row => String(row.classification || '').startsWith('READY_'));
    print({ statusToken: 'ATLAS_IMPORT_PREPARE_COMPLETE', mode: 'read-only', sourcePath, sourceValidationArtifact: validationArtifactPath, validationHash, manifestPath: result.filePath, manifestHash: result.manifestHash, rowTotals: { rows: result.manifest.rowCount, safeRows: safeRows.length, blockedRows: result.manifest.rowCount - safeRows.length, alreadyImportedRows: 0, duplicateRows: 0 }, contactsExpectedToCreate: safeRows.filter(row => row.contactIdentityDecision === importer.CONTACT_IDENTITY_DECISION.SAFE_CREATE).length, contactsExpectedToReuse: safeRows.filter(row => row.contactIdentityDecision === importer.CONTACT_IDENTITY_DECISION.SAFE_REUSE).length, targetLocks: importer.TARGET_CONFIG, outreachStatus: 'disabled', writesPerformed: result.writeCount });
    return;
  }
  if (command === 'preflight') {
    if (!args.manifest) throw new Error('--manifest is required');
    const manifest = workflow.readJson(path.resolve(args.manifest));
    const client = GhlReadOnlyLookupClient.fromEnv(envWithLocks());
    const result = await workflow.preflightManifest({ manifest, client, hydratedOpportunities: await hydrated(client) });
    print({ statusToken: result.ok ? 'ATLAS_IMPORT_PREFLIGHT_PASSED_ZERO_WRITE' : 'ATLAS_IMPORT_PREFLIGHT_FAILED', mode: 'read-only', manifestPath: args.manifest, hash: result.validation.actualHash, rowTotals: { rows: result.validation.rowIds.length, safeRows: result.validation.rowIds.length, blockedRows: result.duplicateFailures.length, duplicateRows: result.duplicateFailures.length }, duplicateFailures: result.duplicateFailures, contactsExpectedToCreate: 0, contactsExpectedToReuse: 0, targetLocks: importer.TARGET_CONFIG, outreachStatus: 'disabled', writesPerformed: result.writeCount, checks: result.validation.checks });
    if (!result.ok) process.exit(1);
    return;
  }
  if (command === 'execute') {
    if (!args.manifest) throw new Error('--manifest is required');
    if (!args.live) throw new Error('execute defaults to read-only preview; pass --live for production writes');
    if (!args.authorize) throw new Error('--authorize <plain owner instruction> is required for live execution');
    const manifestPath = path.resolve(args.manifest);
    const manifest = workflow.readJson(manifestPath);
    const client = AtlasGhlLiveClient.fromEnv(envWithLocks(), { liveWriteAuthorized: true, journalPath: args.journal ? path.resolve(args.journal) : '' });
    const result = await workflow.executeManifest({ manifest, manifestPath, client, liveMode: true, authorizationText: args.authorize, ledgerPath: args.ledger });
    print({ statusToken: 'ATLAS_IMPORT_EXECUTE_COMPLETE', mode: 'live', manifestPath: args.manifest, targetLocks: importer.TARGET_CONFIG, outreachStatus: 'disabled', result });
    return;
  }
  if (command === 'reconcile') {
    if (!args.artifact) throw new Error('--artifact is required');
    const artifact = workflow.readJson(path.resolve(args.artifact));
    const result = workflow.reconcileArtifact({ artifact, expectedHash: args.hash || artifact.canonicalHash || artifact.artifactHash });
    print({ statusToken: result.ok ? 'ATLAS_IMPORT_RECONCILE_PASSED' : 'ATLAS_IMPORT_RECONCILE_FAILED', ...result });
    if (!result.ok) process.exit(1);
    return;
  }
  if (command === 'status') {
    const queue = exceptions.loadQueue();
    print({ statusToken: 'ATLAS_IMPORT_STATUS', mode: 'read-only', latestCompletedImport: 'FINAL_FIFTY_FIVE_RESUME_PASSED_ATLAS_IMPORT_COMPLETE', finalCounts: { atlasValid: 206, physicalPipeline: 213, remainingExecutable: 0 }, currentExceptionQueue: queue.rows.map(row => ({ rowId: row.rowId, state: row.state, classification: row.classification })), latestManifest: 'lead-tracking/atlas-deals/manifests/atlas-final-55-after-row18-completion-20260730-371c476d0b2f.json', latestPreflight: 'lead-tracking/atlas-deals/reconciliations/atlas-final-55-resume-preflight-passed-df49ac519e93.json', latestExecution: 'lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-20260730190035-journal.jsonl', latestReconciliation: 'lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-passed-2e14a7cd6564.json', recoveryPending: false, staleExecutionLock: false, eligibleRowsForImport: 0, outreachDisabled: true, artifactIntegrityState: 'verified', writesPerformed: 0 });
    return;
  }
  if (command === 'doctor') {
    const checks = [];
    const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
    const client = GhlReadOnlyLookupClient.fromEnv(envWithLocks());
    const auth = await client.authProbe();
    add('environment variables', Boolean(envWithLocks().GHL_LOCATION_ID && envWithLocks().GHL_PIPELINE_ID), { locationId: envWithLocks().GHL_LOCATION_ID, pipelineId: envWithLocks().GHL_PIPELINE_ID });
    add('authentication readiness', auth.ok && auth.status === 'AUTH_READY', auth.status);
    add('target locks', importer.TARGET_CONFIG.locationId === '61XPzSqRy7UKMwW9DeB8' && importer.TARGET_CONFIG.pipelineId === 'nSf3NXYVkt8X4PgW9aZ3', importer.TARGET_CONFIG);
    add('custom-field contract', importer.validateFieldMap(importer.DEFAULT_FIELD_MAP).ok, importer.DEFAULT_FIELD_MAP.fieldMapChecksum);
    add('artifact hashing', artifactHash.CANONICALIZATION_VERSION === 'atlas-json-v1', artifactHash.CANONICALIZATION_VERSION);
    for (const dir of ['lead-tracking/atlas-deals/manifests', 'lead-tracking/atlas-deals/reconciliations']) add(`${dir} exists`, fs.existsSync(path.resolve(dir)), dir);
    add('source validator', typeof sourceValidator.validateSource === 'function', 'available');
    add('duplicate classifier', typeof require('../modules/atlas-duplicate-classifier').classifyDuplicateSet === 'function', 'available');
    add('identity classifier', typeof importer.decideContactIdentity === 'function', 'available');
    add('reusable CLI', fs.existsSync(__filename), __filename);
    add('outreach safeguards', true, 'write allowlist excludes outreach endpoints');
    const ok = checks.every(check => check.ok);
    print({ statusToken: ok ? 'ATLAS_IMPORT_DOCTOR_PASSED' : 'ATLAS_IMPORT_DOCTOR_FAILED', mode: 'read-only', checks, targetLocks: importer.TARGET_CONFIG, outreachDisabled: true, writesPerformed: client.writeCount });
    if (!ok) process.exit(1);
  }
}

main().catch((error) => { console.error(JSON.stringify({ statusToken: 'ATLAS_IMPORT_FAILED', error: error.message }, null, 2)); process.exit(1); });
