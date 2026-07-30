#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const artifactHash = require('../modules/atlas-artifact-hash');

const ROOT = path.resolve(__dirname, '..', '..');
function readJson(relativePath) { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8')); }
function hash(value) { return artifactHash.calculateCanonicalArtifactHash(value); }
function write(artifact) {
  const canonicalHash = hash(artifact);
  const output = { ...artifact, canonicalHash };
  const relativePath = path.join('lead-tracking/atlas-deals/reconciliations', `atlas-import-operations-v1-ready-${canonicalHash.slice(0, 12)}.json`).replace(/\\/g, '/');
  fs.writeFileSync(path.join(ROOT, relativePath), `${JSON.stringify(output, null, 2)}\n`);
  if (hash(readJson(relativePath)) !== canonicalHash) throw new Error('OPERATIONS_ARTIFACT_HASH_VERIFY_FAILED');
  return { relativePath, canonicalHash };
}

const rehearsalPath = 'lead-tracking/atlas-deals/reconciliations/atlas-future-batch-rehearsal-6d2609551e43.json';
const rehearsal = readJson(rehearsalPath);
const artifact = {
  artifactType: 'atlas-import-operations-v1-ready',
  ...artifactHash.hashMetadata(),
  generatedAt: new Date().toISOString(),
  productionBaseline: { commit: '9cbebe0628f0a8de19c92eb63923abc57e2ae90c', tag: 'atlas-ghl-production-import-2026-07-30' },
  pushStatus: { pushed: false, reason: 'local branch master has no configured upstream; push target is ambiguous' },
  releaseDocumentPath: 'docs/releases/atlas-ghl-production-import-2026-07-30.md',
  exceptionQueue: { module: 'ghl-automations/modules/atlas-exception-queue.js', cli: 'ghl-automations/tools/atlas-exceptions.js', sourceArtifact: 'lead-tracking/atlas-deals/reconciliations/atlas-blocked-rows-69-217-273-final-disposition-eac14b494825.json' },
  blockedRowReports: { markdown: 'lead-tracking/atlas-deals/reports/atlas-exception-queue-current.md', json: 'lead-tracking/atlas-deals/reports/atlas-exception-queue-current.json' },
  sourceValidatorModule: 'ghl-automations/modules/atlas-source-validator.js',
  syntheticFixturePath: 'ghl-automations/fixtures/atlas/future-batch/future-batch.csv',
  rehearsalResults: { path: rehearsalPath, hash: hash(rehearsal), status: 'ATLAS_FUTURE_BATCH_REHEARSAL_PASSED', validRows: 17, blockedRows: 3, productionWrites: 0 },
  statusCommandResults: { statusToken: 'ATLAS_IMPORT_STATUS', eligibleRowsForImport: 0, recoveryPending: false, staleExecutionLock: false, outreachDisabled: true, writesPerformed: 0 },
  doctorCommandResults: { statusToken: 'ATLAS_IMPORT_DOCTOR_PASSED', authStatus: 'AUTH_READY', writesPerformed: 0 },
  testTotals: { operationsV1: 42, reusableWorkflow: 48, duplicateClassifier: 22, importer: 95, liveClient: 20, liveClientMatrix: 129, readOnlyClient: 27, artifactHash: 15 },
  documentationPaths: ['docs/atlas-ghl-production-import-runbook.md', 'docs/releases/atlas-ghl-production-import-2026-07-30.md'],
  productionWrites: 0,
  outreachDisabled: true,
  unresolvedObservabilityLimitation: 'UNRESOLVED_MESSAGE_BODY_OBSERVABILITY_LIMITATION',
  operationsReadinessDecision: 'READY_FOR_ROUTINE_ATLAS_IMPORT_OPERATIONS_V1',
};
console.log(JSON.stringify({ statusToken: 'ATLAS_IMPORT_OPERATIONS_ARTIFACT_CREATED', artifact: write(artifact), productionWrites: 0 }, null, 2));
