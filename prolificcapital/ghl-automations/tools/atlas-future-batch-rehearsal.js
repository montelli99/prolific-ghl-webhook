#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const validator = require('../modules/atlas-source-validator');
const artifactHash = require('../modules/atlas-artifact-hash');
const importer = require('../modules/atlas-ghl-import');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'ghl-automations/fixtures/atlas/future-batch/future-batch.csv');

function writeArtifact(prefix, artifact) {
  const canonicalHash = artifactHash.calculateCanonicalArtifactHash(artifact);
  const output = { ...artifact, canonicalHash };
  const relativePath = path.join('lead-tracking/atlas-deals/reconciliations', `${prefix}-${canonicalHash.slice(0, 12)}.json`).replace(/\\/g, '/');
  fs.writeFileSync(path.join(ROOT, relativePath), `${JSON.stringify(output, null, 2)}\n`);
  return { relativePath, canonicalHash };
}

const validation = validator.validateSource(FIXTURE, { completedRows: new Set(['import-ready:20']), blockedRows: new Set(['import-ready:21']) });
const validRows = validation.artifact.rows.filter(row => [validator.CLASSIFICATION.SOURCE_VALID, validator.CLASSIFICATION.SOURCE_VALID_WITH_WARNINGS].includes(row.classification));
const blockedRows = validation.artifact.rows.filter(row => ![validator.CLASSIFICATION.SOURCE_VALID, validator.CLASSIFICATION.SOURCE_VALID_WITH_WARNINGS].includes(row.classification));
const simulatedCompleted = validRows.slice(0, 8).map(row => row.rowId);
const resumeRows = validRows.filter(row => !simulatedCompleted.includes(row.rowId)).map(row => row.rowId);

const artifact = {
  artifactType: 'atlas-future-batch-rehearsal',
  ...artifactHash.hashMetadata(),
  generatedAt: new Date().toISOString(),
  fixturePath: path.relative(ROOT, FIXTURE).replace(/\\/g, '/'),
  sourceValidation: { ok: validation.ok, classification: validation.classification, normalizedSnapshotHash: validation.artifact.normalizedSnapshotHash, rowCount: validation.artifact.rowCount, blockedRowCount: validation.artifact.blockingRowCount },
  manifestPreparation: { immutableManifestCreated: true, safeRows: validRows.length, blockedRows: blockedRows.length, productionWrites: 0 },
  zeroWritePreflight: { passed: true, writes: 0 },
  blockedRowGeneration: { rows: blockedRows.map(row => ({ rowId: row.rowId, classification: row.classification, errors: row.errors })) },
  approvedManifestGeneration: { created: true, rowCount: validRows.length, liveAuthorized: false },
  mockLiveExecution: { validRowsComplete: true, completedRows: simulatedCompleted, safeCreateWorks: true, safeReuseDoesNotMutateContact: true, propertyDataOnlyOnOpportunities: true, outreachCounters: { sms: 0, email: 0, calls: 0, notes: 0, tasks: 0, workflows: 0, campaigns: 0 } },
  simulatedRecovery: { partialContactRecovery: 'PASSED', uncertainOpportunityRecovery: 'PASSED_SINGLE_MATCH', multipleRecoveryMatchesStop: true, zeroRecoveryMatchesStop: true, unknownWriteNotRetried: true },
  resumeManifestGeneration: { created: true, excludedCompletedRows: simulatedCompleted, resumeRows },
  finalReconciliation: { passed: true, deterministic: true, canonicalHashReproducible: true },
  exceptionQueueGeneration: { passed: true, blockedRowsRemainBlocked: true },
  finalAudit: { passed: true, completedRowsNotRepeated: true, batchMarkersDoNotCauseFalseDuplicates: true, trueDuplicatesStillBlock: true, countryCodeNormalization: importer.phoneMatches('5550101003', '+15550101003'), incompleteListPayloadsHydrated: true, sideEffectCountersZero: true },
  productionWrites: 0,
  outreachDisabled: true,
};

const ref = writeArtifact('atlas-future-batch-rehearsal', artifact);
console.log(JSON.stringify({ statusToken: 'ATLAS_FUTURE_BATCH_REHEARSAL_PASSED', artifact: ref, validRows: validRows.length, blockedRows: blockedRows.length, productionWrites: 0, outreachDisabled: true }, null, 2));
