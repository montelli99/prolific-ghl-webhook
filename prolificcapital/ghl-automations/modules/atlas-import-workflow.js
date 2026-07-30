'use strict';

const fs = require('fs');
const path = require('path');
const importer = require('./atlas-ghl-import');
const live = require('./atlas-ghl-live-client');
const duplicateClassifier = require('./atlas-duplicate-classifier');
const artifactHash = require('./atlas-artifact-hash');

const DEFAULT_BLOCKED_ROWS = Object.freeze(['import-ready:69', 'import-ready:217', 'import-ready:273']);

function sourceRowId(row) { return `import-ready:${row.sourceRow}`; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function writeJson(filePath, object) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(object, null, 2)}\n`); }
function manifestHash(manifest) { return artifactHash.calculateCanonicalArtifactHash(manifest); }
function isReadyRow(row) {
  return String(row.classification || '').startsWith('READY_')
    && [importer.CONTACT_IDENTITY_DECISION.SAFE_CREATE, importer.CONTACT_IDENTITY_DECISION.SAFE_REUSE].includes(row.contactIdentityDecision);
}
function normalizeId(id) { return String(id || '').replace(/^import-ready:/, ''); }

function validateImmutableManifest(manifest, options = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const liveMode = options.live === true;
  const rows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const rowIds = Array.isArray(manifest?.exactSourceRowIds) ? manifest.exactSourceRowIds : rows.map(sourceRowId);
  const blockedRows = new Set(options.blockedRows || DEFAULT_BLOCKED_ROWS);
  const completedRows = new Set(options.completedRows || []);
  const expectedHash = options.expectedHash || manifest?.manifestChecksum || manifest?.canonicalHash || '';
  let actualHash = '';
  try { actualHash = manifestHash(manifest); } catch (error) { actualHash = `ERROR:${error.message}`; }
  add('manifest object exists', Boolean(manifest && typeof manifest === 'object' && !Array.isArray(manifest)), manifest?.artifactType || manifest?.system || 'missing');
  add('canonical manifest hash passes', Boolean(expectedHash && actualHash === expectedHash), { expectedHash, actualHash });
  add('row array exists', rows.length > 0 || !liveMode, { rows: rows.length, liveMode });
  add('no duplicate row ids', new Set(rowIds).size === rowIds.length, rowIds);
  add('no blocked rows in live manifest', !rowIds.some(id => blockedRows.has(id)), rowIds.filter(id => blockedRows.has(id)));
  add('no completed rows in live manifest', !rowIds.some(id => completedRows.has(id)), rowIds.filter(id => completedRows.has(id)));
  add('all rows are ready for live mode', !liveMode || rows.every(isReadyRow), rows.filter(row => !isReadyRow(row)).map(sourceRowId));
  const target = manifest?.targetConfig || manifest?.target || {};
  add('target location locked', !target.locationId || target.locationId === importer.TARGET_CONFIG.locationId, target.locationId);
  add('target pipeline locked', !target.pipelineId || target.pipelineId === importer.TARGET_CONFIG.pipelineId, target.pipelineId);
  add('target stage locked', !target.stageId || target.stageId === importer.TARGET_CONFIG.stageId, target.stageId);
  add('target owner locked', !target.ownerId || target.ownerId === importer.TARGET_CONFIG.ownerId, target.ownerId);
  add('outreach disabled', manifest?.outreachEnabled === false || manifest?.metadata?.outreachEnabled === false || manifest?.mode === 'preflight' || !liveMode, manifest?.outreachEnabled ?? manifest?.metadata?.outreachEnabled ?? 'not-declared');
  add('import only', manifest?.importOnly === true || manifest?.metadata?.importOnly === true || manifest?.mode === 'preflight' || !liveMode, manifest?.importOnly ?? manifest?.metadata?.importOnly ?? 'not-declared');
  return { ok: checks.every(check => check.ok), checks, actualHash, expectedHash, rowIds };
}

async function prepareBatch({ sourcePath, client, outputDir = importer.DEFAULT_MANIFEST_DIR, limit, sourceRowIds, workflowSafetyStatus = importer.WORKFLOW_SAFETY.SAFE_NO_SMS } = {}) {
  const manifest = await importer.buildPreflightManifest({ sourcePath, client, limit, sourceRowIds, workflowSafetyStatus });
  const basename = `atlas-preflight-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${manifest.manifestChecksum.slice(0, 12)}.json`;
  const filePath = path.join(outputDir, basename);
  writeJson(filePath, manifest);
  return { manifest, filePath, manifestHash: manifest.manifestChecksum, writeCount: client?.writeCount || 0 };
}

async function preflightManifest({ manifest, client, blockedRows, completedRows, hydratedOpportunities = [] } = {}) {
  const validation = validateImmutableManifest(manifest, { blockedRows, completedRows, expectedHash: manifest.manifestChecksum || manifest.canonicalHash });
  const duplicateChecks = {};
  for (const row of manifest.rows || []) duplicateChecks[sourceRowId(row)] = duplicateClassifier.classifyDuplicateSet(row, hydratedOpportunities, { sharedSourcePrefix: importer.TARGET_CONFIG.source });
  const duplicateFailures = Object.entries(duplicateChecks).filter(([, result]) => result.blocking).map(([id, result]) => ({ id, classification: result.classification }));
  const writeCount = client?.writeCount || 0;
  return { ok: validation.ok && duplicateFailures.length === 0 && writeCount === 0, validation, duplicateChecks, duplicateFailures, writeCount };
}

function buildOwnerAuthorization({ manifest, manifestPath, authorizationText, rowCount, expiresAt } = {}) {
  if (!authorizationText || !String(authorizationText).trim()) return { ok: false, reason: 'owner authorization text missing' };
  return {
    ok: true,
    runId: manifest.runId,
    sourceChecksum: manifest.sourceChecksum,
    manifestChecksum: manifest.manifestChecksum,
    manifestPath,
    locationId: importer.TARGET_CONFIG.locationId,
    pipelineId: importer.TARGET_CONFIG.pipelineId,
    stageId: importer.TARGET_CONFIG.stageId,
    ownerId: importer.TARGET_CONFIG.ownerId,
    executionMode: live.EXECUTION_MODES.LIVE_MANIFEST,
    approvedRowCount: rowCount ?? (manifest.rows || []).filter(row => String(row.classification || '').startsWith('READY_')).length,
    approvedMaximum: rowCount ?? (manifest.rows || []).length,
    productionAuthorized: true,
    explicitCliAuthorization: true,
    ownerAuthorizationText: String(authorizationText).trim(),
    expiresAt: expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

async function executeManifest({ manifest, manifestPath, client, liveMode = false, authorizationText, blockedRows, completedRows, ledgerPath } = {}) {
  if (!liveMode) return { executed: false, status: 'READ_ONLY_EXECUTION_PREVIEW', writeCount: client?.writeCount || 0 };
  const validation = validateImmutableManifest(manifest, { live: true, blockedRows, completedRows, expectedHash: manifest.manifestChecksum || manifest.canonicalHash });
  if (!validation.ok) throw new Error(`MANIFEST_INVALID: ${validation.checks.filter(check => !check.ok).map(check => check.name).join('; ')}`);
  if (!client?.isAtlasLiveWriteClient || client.liveWriteAuthorized !== true) throw new Error('LIVE_CLIENT_NOT_AUTHORIZED');
  const approval = buildOwnerAuthorization({ manifest, manifestPath, authorizationText });
  if (!approval.ok) throw new Error(`APPROVAL_INVALID: ${approval.reason}`);
  return importer.executeApprovedImport({ manifest, approval, client, ledgerPath, strictStopOnFirstFailure: true });
}

function reconcileArtifact({ artifact, expectedHash } = {}) {
  const actualHash = artifactHash.calculateCanonicalArtifactHash(artifact);
  const checks = [
    { name: 'artifact hash matches', ok: !expectedHash || actualHash === expectedHash, detail: { expectedHash, actualHash } },
    { name: 'terminal status present', ok: Boolean(artifact.status || artifact.statusToken), detail: artifact.status || artifact.statusToken || 'missing' },
    { name: 'side effects zero', ok: !artifact.sideEffectCounters || Object.values(artifact.sideEffectCounters).every(value => value === 0), detail: artifact.sideEffectCounters || null },
  ];
  return { ok: checks.every(check => check.ok), checks, actualHash };
}

module.exports = {
  DEFAULT_BLOCKED_ROWS,
  sourceRowId,
  readJson,
  writeJson,
  manifestHash,
  validateImmutableManifest,
  prepareBatch,
  preflightManifest,
  buildOwnerAuthorization,
  executeManifest,
  reconcileArtifact,
  normalizeId,
};
