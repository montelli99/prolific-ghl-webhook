'use strict';

const fs = require('fs');
const path = require('path');
const artifactHash = require('./atlas-artifact-hash');
const importer = require('./atlas-ghl-import');

const ROOT = path.resolve(__dirname, '..', '..');
const DISPOSITION_PATH = 'lead-tracking/atlas-deals/reconciliations/atlas-blocked-rows-69-217-273-final-disposition-eac14b494825.json';
const DISPOSITION_HASH = 'eac14b494825e050ccaffe8a8ad10bf41a685a9e7c0761002b861472ef7bb384';
const STATES = Object.freeze({
  OPEN_SOURCE_DATA_CONFLICT: 'OPEN_SOURCE_DATA_CONFLICT',
  OPEN_IDENTITY_AMBIGUITY: 'OPEN_IDENTITY_AMBIGUITY',
  WAITING_FOR_SOURCE_EVIDENCE: 'WAITING_FOR_SOURCE_EVIDENCE',
  WAITING_FOR_OWNER_DECISION: 'WAITING_FOR_OWNER_DECISION',
  RESOLVED_SAFE_CREATE: 'RESOLVED_SAFE_CREATE',
  RESOLVED_SAFE_REUSE: 'RESOLVED_SAFE_REUSE',
  RESOLVED_TRUE_DUPLICATE: 'RESOLVED_TRUE_DUPLICATE',
  PERMANENTLY_EXCLUDED: 'PERMANENTLY_EXCLUDED',
});

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function canonicalHash(value) { return artifactHash.calculateCanonicalArtifactHash(value); }
function verifyArtifact(relativePath = DISPOSITION_PATH, expectedHash = DISPOSITION_HASH) {
  const absolutePath = path.resolve(ROOT, relativePath);
  const artifact = readJson(absolutePath);
  const actualHash = canonicalHash(artifact);
  if (actualHash !== expectedHash) throw new Error(`EXCEPTION_ARTIFACT_HASH_MISMATCH: ${actualHash}`);
  return artifact;
}
function stateFor(row) { return row.classification === 'SOURCE_DATA_CONFLICT' ? STATES.OPEN_SOURCE_DATA_CONFLICT : STATES.OPEN_IDENTITY_AMBIGUITY; }
function loadQueue(options = {}) {
  const artifact = verifyArtifact(options.dispositionPath || DISPOSITION_PATH, options.dispositionHash || DISPOSITION_HASH);
  return {
    sourceArtifact: { path: options.dispositionPath || DISPOSITION_PATH, hash: options.dispositionHash || DISPOSITION_HASH },
    rows: artifact.rows.map(row => ({ ...row, state: row.state || stateFor(row), productionWrites: 0, outreachDisabled: true })),
  };
}
function findRow(rowId, options = {}) {
  const queue = loadQueue(options);
  const row = queue.rows.find(item => item.rowId === rowId);
  if (!row) throw new Error(`EXCEPTION_ROW_NOT_FOUND: ${rowId}`);
  return { queue, row };
}
function evidenceHash(evidencePath) {
  const absolute = path.resolve(evidencePath);
  if (!fs.existsSync(absolute)) throw new Error(`EVIDENCE_NOT_FOUND: ${evidencePath}`);
  const text = fs.readFileSync(absolute, 'utf8');
  return { path: path.relative(ROOT, absolute).replace(/\\/g, '/'), hash: importer.sha256(text) };
}
function review(rowId, evidencePath, options = {}) {
  const { queue, row } = findRow(rowId, options);
  const evidence = evidenceHash(evidencePath);
  const hasSourceBackedResolution = /SAFE_CREATE|SAFE_REUSE|TRUE_DUPLICATE/i.test(fs.readFileSync(path.resolve(evidencePath), 'utf8'));
  return {
    artifactType: 'atlas-exception-review',
    ...artifactHash.hashMetadata(),
    generatedAt: new Date().toISOString(),
    parentDisposition: queue.sourceArtifact,
    rowId,
    priorClassification: row.classification,
    priorState: row.state,
    evidence,
    reviewState: hasSourceBackedResolution ? STATES.WAITING_FOR_OWNER_DECISION : STATES.WAITING_FOR_SOURCE_EVIDENCE,
    exactReason: hasSourceBackedResolution ? 'Evidence may support a future owner decision; no import is authorized by review.' : 'Evidence does not deterministically resolve the blocked row.',
    productionWrites: 0,
    outreachDisabled: true,
  };
}
function resolve(rowId, decision, evidencePath, options = {}) {
  const { queue, row } = findRow(rowId, options);
  const allowed = new Set(['SAFE_CREATE', 'SAFE_REUSE', 'TRUE_DUPLICATE', 'PERMANENTLY_EXCLUDED']);
  if (!allowed.has(decision)) throw new Error(`UNSUPPORTED_EXCEPTION_DECISION: ${decision}`);
  const evidence = evidenceHash(evidencePath);
  const contactId = options.contactId || '';
  if (decision === 'SAFE_REUSE' && !contactId) throw new Error('SAFE_REUSE_REQUIRES_CONTACT_ID');
  const resolvedState = decision === 'SAFE_CREATE' ? STATES.RESOLVED_SAFE_CREATE : decision === 'SAFE_REUSE' ? STATES.RESOLVED_SAFE_REUSE : decision === 'TRUE_DUPLICATE' ? STATES.RESOLVED_TRUE_DUPLICATE : STATES.PERMANENTLY_EXCLUDED;
  return {
    artifactType: 'atlas-exception-resolution',
    ...artifactHash.hashMetadata(),
    generatedAt: new Date().toISOString(),
    parentDisposition: queue.sourceArtifact,
    rowId,
    priorClassification: row.classification,
    priorState: row.state,
    evidence,
    ownerDecision: decision,
    identityResult: decision === 'SAFE_REUSE' ? 'PROPOSED_SAFE_REUSE' : decision === 'SAFE_CREATE' ? 'PROPOSED_SAFE_CREATE' : 'NOT_IMPORTABLE',
    duplicateResult: decision === 'TRUE_DUPLICATE' ? 'TRUE_PROPERTY_DUPLICATE' : 'REQUIRES_FUTURE_PREFLIGHT',
    proposedContactId: contactId,
    targetLocks: importer.TARGET_CONFIG,
    resolvedState,
    mayCreateManifest: [STATES.RESOLVED_SAFE_CREATE, STATES.RESOLVED_SAFE_REUSE].includes(resolvedState),
    importAuthorized: false,
    productionWrites: 0,
    outreachDisabled: true,
  };
}
function writeChildArtifact(prefix, artifact, outputDir = path.join(ROOT, 'lead-tracking/atlas-deals/reconciliations')) {
  const hash = canonicalHash(artifact);
  const output = { ...artifact, canonicalHash: hash };
  const filePath = path.join(outputDir, `${prefix}-${hash.slice(0, 12)}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(output, null, 2)}\n`);
  return { relativePath: path.relative(ROOT, filePath).replace(/\\/g, '/'), canonicalHash: hash, artifact: output };
}
function manifestFromResolution(resolutionArtifact) {
  if (!resolutionArtifact.mayCreateManifest) throw new Error('RESOLUTION_NOT_SAFE_FOR_MANIFEST');
  return {
    artifactType: 'atlas-exception-resolution-manifest-recommendation',
    ...artifactHash.hashMetadata(),
    generatedAt: new Date().toISOString(),
    parentResolutionArtifactHash: resolutionArtifact.canonicalHash || canonicalHash(resolutionArtifact),
    rowId: resolutionArtifact.rowId,
    requiredFutureManifestMembership: [resolutionArtifact.rowId],
    decision: resolutionArtifact.ownerDecision,
    proposedContactId: resolutionArtifact.proposedContactId || null,
    targetLocks: importer.TARGET_CONFIG,
    liveExecutionAuthorized: false,
    productionWrites: 0,
    outreachDisabled: true,
  };
}

module.exports = { STATES, DISPOSITION_PATH, DISPOSITION_HASH, loadQueue, findRow, review, resolve, writeChildArtifact, manifestFromResolution, canonicalHash };
