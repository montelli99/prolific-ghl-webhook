'use strict';

const fs = require('fs');
const path = require('path');
const importer = require('./atlas-ghl-import');
const artifactHash = require('./atlas-artifact-hash');

const CLASSIFICATION = Object.freeze({
  SOURCE_VALID: 'SOURCE_VALID',
  SOURCE_VALID_WITH_WARNINGS: 'SOURCE_VALID_WITH_WARNINGS',
  SOURCE_BLOCKED_SCHEMA: 'SOURCE_BLOCKED_SCHEMA',
  SOURCE_BLOCKED_IDENTITY: 'SOURCE_BLOCKED_IDENTITY',
  SOURCE_BLOCKED_DUPLICATE: 'SOURCE_BLOCKED_DUPLICATE',
  SOURCE_BLOCKED_CONFLICT: 'SOURCE_BLOCKED_CONFLICT',
  SOURCE_ALREADY_IMPORTED: 'SOURCE_ALREADY_IMPORTED',
  SOURCE_PREVIOUSLY_EXCLUDED: 'SOURCE_PREVIOUSLY_EXCLUDED',
});
const VALID_STATES = new Set(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC']);
const DEFAULT_COMPLETED = new Set(['import-ready:230', 'import-ready:4', 'import-ready:18', 'import-ready:24', 'import-ready:38', 'import-ready:44', 'import-ready:52', 'import-ready:57', 'import-ready:61', 'import-ready:63', 'import-ready:65', 'import-ready:71', 'import-ready:197', 'import-ready:198', 'import-ready:203', 'import-ready:205', 'import-ready:207', 'import-ready:208', 'import-ready:209', 'import-ready:212', 'import-ready:215', 'import-ready:218', 'import-ready:219', 'import-ready:220', 'import-ready:221', 'import-ready:222', 'import-ready:224', 'import-ready:225', 'import-ready:226', 'import-ready:227', 'import-ready:228', 'import-ready:229', 'import-ready:232', 'import-ready:233', 'import-ready:234', 'import-ready:235', 'import-ready:237', 'import-ready:238', 'import-ready:240', 'import-ready:242', 'import-ready:243', 'import-ready:246', 'import-ready:247', 'import-ready:252', 'import-ready:254', 'import-ready:257', 'import-ready:258', 'import-ready:259', 'import-ready:261', 'import-ready:262', 'import-ready:263', 'import-ready:265', 'import-ready:266', 'import-ready:267', 'import-ready:268', 'import-ready:270', 'import-ready:271', 'import-ready:272']);
const DEFAULT_BLOCKED = new Set(['import-ready:69', 'import-ready:217', 'import-ready:273']);

function normalizeRowId(record) { return `import-ready:${record._rowNumber}`; }
function normalizeEmail(value) { return importer.normalizeEmail(value); }
function normalizePhone(value) { return importer.normalizePhone(value); }
function normalizeName(value, phone) { return importer.normalizePersonName(value, { matchingPhone: phone }); }
function isValidEmail(value) { if (!value) return true; return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value); }
function isValidPhone(value) { if (!value) return true; const digits = normalizePhone(value); return digits.length === 10 || (digits.length === 11 && digits.startsWith('1')); }
function isValidZip(value) { return /^\d{5}(?:-\d{4})?$/.test(String(value || '').trim()); }
function isCsvPath(sourcePath) { return /\.csv$/i.test(sourcePath); }
function snapshotRecord(record) {
  const normalizedPhone = normalizePhone(record.agentPhone);
  return {
    rowId: normalizeRowId(record),
    sourcePropertyId: String(record.mlsId || '').trim() || String(record.mlsUrl || '').match(/\/([0-9]+)\/mls-listing/)?.[1] || '',
    propertyFingerprint: importer.buildPropertyFingerprint(record),
    normalizedAddress: importer.normalizeAddressParts(record),
    rawAddress: importer.displayPropertyAddress(record),
    identity: { name: normalizeName(record.listingAgent, normalizedPhone), phone: normalizedPhone, email: normalizeEmail(record.agentEmail) },
    source: { ...record },
  };
}
function classifyRow(record, ctx) {
  const rowId = normalizeRowId(record);
  const errors = [];
  const warnings = [];
  const propertyId = String(record.mlsId || '').trim() || String(record.mlsUrl || '').match(/\/([0-9]+)\/mls-listing/)?.[1] || '';
  if (ctx.completedRows.has(rowId)) return { classification: CLASSIFICATION.SOURCE_ALREADY_IMPORTED, errors: ['source row already appears in completed artifacts'], warnings };
  if (ctx.blockedRows.has(rowId)) return { classification: CLASSIFICATION.SOURCE_PREVIOUSLY_EXCLUDED, errors: ['source row is in blocked-row disposition'], warnings };
  if (!record.address || !record.city || !record.state || !record.zip) errors.push('missing property address components');
  if (record.state && !VALID_STATES.has(String(record.state).toUpperCase())) errors.push('invalid state abbreviation');
  if (record.zip && !isValidZip(record.zip)) errors.push('malformed ZIP code');
  if (!record.listingAgent) errors.push('missing owner identity');
  if (!record.agentEmail && !record.agentPhone) errors.push('missing email and phone identity evidence');
  if (!isValidEmail(normalizeEmail(record.agentEmail))) errors.push('malformed email');
  if (!isValidPhone(record.agentPhone)) errors.push('malformed phone number');
  if (ctx.rowIds.has(rowId)) errors.push('duplicate source-row ID');
  if (propertyId && ctx.propertyIds.has(propertyId)) errors.push('duplicate source property ID');
  const fingerprint = importer.buildPropertyFingerprint(record);
  if (fingerprint && ctx.fingerprints.has(fingerprint)) errors.push('duplicate normalized property');
  if (errors.some(error => /duplicate/.test(error))) return { classification: CLASSIFICATION.SOURCE_BLOCKED_DUPLICATE, errors, warnings };
  if (errors.some(error => /identity|email|phone/.test(error))) return { classification: CLASSIFICATION.SOURCE_BLOCKED_IDENTITY, errors, warnings };
  if (errors.length) return { classification: CLASSIFICATION.SOURCE_BLOCKED_SCHEMA, errors, warnings };
  if (!record.ownership || !record.listPrice) warnings.push('blank optional property field preserved');
  return { classification: warnings.length ? CLASSIFICATION.SOURCE_VALID_WITH_WARNINGS : CLASSIFICATION.SOURCE_VALID, errors, warnings };
}
function validateSource(sourcePath, options = {}) {
  const absolutePath = path.resolve(sourcePath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  const sourceChecksum = importer.sha256(text);
  const parsed = importer.parseCsv(text.replace(/^\uFEFF/, ''));
  const headers = parsed.headers;
  const errors = [];
  if (!isCsvPath(sourcePath)) errors.push('unsupported file type');
  if (text.includes('\u0000')) errors.push('unsupported encoding');
  const emptyHeaders = headers.filter(header => !header);
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  const missingHeaders = importer.EXPECTED_HEADERS.filter(header => !headers.includes(header));
  if (emptyHeaders.length) errors.push('empty header');
  if (duplicateHeaders.length) errors.push(`duplicate headers: ${[...new Set(duplicateHeaders)].join(', ')}`);
  if (missingHeaders.length) errors.push(`missing required columns: ${missingHeaders.join(', ')}`);
  const completedRows = options.completedRows || DEFAULT_COMPLETED;
  const blockedRows = options.blockedRows || DEFAULT_BLOCKED;
  const ctx = { rowIds: new Set(), propertyIds: new Set(), fingerprints: new Set(), completedRows, blockedRows };
  const rows = [];
  if (errors.length === 0) {
    for (const record of parsed.records) {
      const result = classifyRow(record, ctx);
      const snap = snapshotRecord(record);
      rows.push({ ...snap, classification: result.classification, errors: result.errors, warnings: result.warnings, normalizedPhone: snap.identity.phone });
      ctx.rowIds.add(snap.rowId);
      if (snap.sourcePropertyId) ctx.propertyIds.add(snap.sourcePropertyId);
      if (snap.propertyFingerprint) ctx.fingerprints.add(snap.propertyFingerprint);
    }
  }
  const blockingRows = rows.filter(row => ![CLASSIFICATION.SOURCE_VALID, CLASSIFICATION.SOURCE_VALID_WITH_WARNINGS].includes(row.classification));
  const classification = errors.length ? CLASSIFICATION.SOURCE_BLOCKED_SCHEMA : blockingRows.length ? 'SOURCE_HAS_BLOCKING_ROWS' : rows.some(row => row.warnings.length) ? CLASSIFICATION.SOURCE_VALID_WITH_WARNINGS : CLASSIFICATION.SOURCE_VALID;
  const snapshot = { sourcePath: path.relative(process.cwd(), absolutePath).replace(/\\/g, '/'), sourceChecksum, rows: rows.map(row => ({ rowId: row.rowId, sourcePropertyId: row.sourcePropertyId, propertyFingerprint: row.propertyFingerprint, normalizedAddress: row.normalizedAddress, identity: row.identity })) };
  const artifact = { artifactType: 'atlas-source-validation', ...artifactHash.hashMetadata(), generatedAt: new Date().toISOString(), sourcePath: snapshot.sourcePath, sourceChecksum, classification, schemaErrors: errors, rowCount: rows.length, blockingRowCount: blockingRows.length, warningRowCount: rows.filter(row => row.warnings.length).length, normalizedSnapshotHash: artifactHash.calculateCanonicalArtifactHash(snapshot), rows, productionWrites: 0, outreachDisabled: true };
  return { ok: errors.length === 0 && blockingRows.length === 0, classification, artifact, snapshot, blockedRows: blockingRows };
}

module.exports = { CLASSIFICATION, validateSource, snapshotRecord, isValidEmail, isValidPhone, isValidZip, DEFAULT_COMPLETED, DEFAULT_BLOCKED };
