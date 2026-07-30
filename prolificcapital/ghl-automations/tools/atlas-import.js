#!/usr/bin/env node
'use strict';

const path = require('path');
const importer = require('../modules/atlas-ghl-import');
const workflow = require('../modules/atlas-import-workflow');
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
function envWithLocks() { return { ...process.env, GHL_LOCATION_ID: importer.TARGET_CONFIG.locationId, GHL_PIPELINE_ID: importer.TARGET_CONFIG.pipelineId }; }
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
  if (!command || ['prepare', 'preflight', 'execute', 'reconcile'].includes(command) === false) {
    print({ statusToken: 'ATLAS_IMPORT_USAGE', commands: ['prepare --source <path>', 'preflight --manifest <path>', 'execute --manifest <path> --live --authorize <text>', 'reconcile --artifact <path>'] });
    process.exit(command ? 1 : 0);
  }
  if (command === 'prepare') {
    const sourcePath = args.source || importer.DEFAULT_SOURCE_PATH;
    const client = GhlReadOnlyLookupClient.fromEnv(envWithLocks());
    const result = await workflow.prepareBatch({ sourcePath, client, outputDir: args.out ? path.resolve(args.out) : importer.DEFAULT_MANIFEST_DIR, limit: args.limit ? Number(args.limit) : 0 });
    print({ statusToken: 'ATLAS_IMPORT_PREPARE_COMPLETE', manifestPath: result.filePath, manifestHash: result.manifestHash, rows: result.manifest.rowCount, writeCount: result.writeCount });
    return;
  }
  if (command === 'preflight') {
    if (!args.manifest) throw new Error('--manifest is required');
    const manifest = workflow.readJson(path.resolve(args.manifest));
    const client = GhlReadOnlyLookupClient.fromEnv(envWithLocks());
    const result = await workflow.preflightManifest({ manifest, client, hydratedOpportunities: await hydrated(client) });
    print({ statusToken: result.ok ? 'ATLAS_IMPORT_PREFLIGHT_PASSED_ZERO_WRITE' : 'ATLAS_IMPORT_PREFLIGHT_FAILED', manifestHash: result.validation.actualHash, duplicateFailures: result.duplicateFailures, checks: result.validation.checks, writeCount: result.writeCount });
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
    print({ statusToken: 'ATLAS_IMPORT_EXECUTE_COMPLETE', result });
    return;
  }
  if (command === 'reconcile') {
    if (!args.artifact) throw new Error('--artifact is required');
    const artifact = workflow.readJson(path.resolve(args.artifact));
    const result = workflow.reconcileArtifact({ artifact, expectedHash: args.hash || artifact.canonicalHash || artifact.artifactHash });
    print({ statusToken: result.ok ? 'ATLAS_IMPORT_RECONCILE_PASSED' : 'ATLAS_IMPORT_RECONCILE_FAILED', ...result });
    if (!result.ok) process.exit(1);
  }
}

main().catch((error) => { console.error(JSON.stringify({ statusToken: 'ATLAS_IMPORT_FAILED', error: error.message }, null, 2)); process.exit(1); });
