#!/usr/bin/env node
'use strict';

const path = require('path');
const queue = require('../modules/atlas-exception-queue');

function parseArgs(argv) { const args = { _: [] }; for (let i = 0; i < argv.length; i += 1) { const arg = argv[i]; if (!arg.startsWith('--')) args._.push(arg); else args[arg.slice(2)] = argv[++i]; } return args; }
function print(value) { console.log(JSON.stringify(value, null, 2)); }

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'list';
  if (command === 'list') {
    const loaded = queue.loadQueue();
    print({ statusToken: 'ATLAS_EXCEPTIONS_LIST', sourceArtifact: loaded.sourceArtifact, rows: loaded.rows.map(row => ({ rowId: row.rowId, state: row.state, classification: row.classification, reason: row.reason, futureReconsiderationAllowed: row.futureReconsiderationAllowed })), productionWrites: 0 });
    return;
  }
  if (command === 'show') {
    if (!args.row) throw new Error('--row is required');
    const { row } = queue.findRow(args.row);
    print({ statusToken: 'ATLAS_EXCEPTIONS_SHOW', row, productionWrites: 0 });
    return;
  }
  if (command === 'review') {
    if (!args.row || !args.evidence) throw new Error('--row and --evidence are required');
    const artifact = queue.review(args.row, path.resolve(args.evidence));
    const ref = queue.writeChildArtifact(`atlas-exception-review-${args.row.replace(/[^a-z0-9]+/gi, '-')}`, artifact);
    print({ statusToken: 'ATLAS_EXCEPTION_REVIEW_RECORDED', artifact: { relativePath: ref.relativePath, canonicalHash: ref.canonicalHash }, productionWrites: 0 });
    return;
  }
  if (command === 'resolve') {
    if (!args.row || !args.decision || !args.evidence) throw new Error('--row --decision and --evidence are required');
    const artifact = queue.resolve(args.row, args.decision, path.resolve(args.evidence), { contactId: args['contact-id'] });
    const ref = queue.writeChildArtifact(`atlas-exception-resolution-${args.row.replace(/[^a-z0-9]+/gi, '-')}`, artifact);
    print({ statusToken: 'ATLAS_EXCEPTION_RESOLUTION_RECORDED', artifact: { relativePath: ref.relativePath, canonicalHash: ref.canonicalHash }, mayCreateManifest: artifact.mayCreateManifest, productionWrites: 0 });
    return;
  }
  if (command === 'manifest') {
    if (!args['resolution-artifact']) throw new Error('--resolution-artifact is required');
    const artifact = require(path.resolve(args['resolution-artifact']));
    const manifest = queue.manifestFromResolution(artifact);
    const ref = queue.writeChildArtifact(`atlas-exception-resolution-manifest-${artifact.rowId.replace(/[^a-z0-9]+/gi, '-')}`, manifest, path.resolve('lead-tracking/atlas-deals/manifests'));
    print({ statusToken: 'ATLAS_EXCEPTION_MANIFEST_RECOMMENDATION_CREATED', manifest: { relativePath: ref.relativePath, canonicalHash: ref.canonicalHash }, liveExecutionAuthorized: false, productionWrites: 0 });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

try { main(); } catch (error) { console.error(JSON.stringify({ statusToken: 'ATLAS_EXCEPTIONS_FAILED', error: error.message }, null, 2)); process.exit(1); }
