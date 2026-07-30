'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const artifactHash = require('./atlas-artifact-hash');
const liveClient = require('./atlas-ghl-live-client');
const DEFAULT_FIELD_MAP = require('../config/atlas-opportunity-field-map.json');

const TARGET_CONFIG = Object.freeze({
  locationId: '61XPzSqRy7UKMwW9DeB8',
  pipelineId: 'nSf3NXYVkt8X4PgW9aZ3',
  stageName: 'LEAD_ENTERED',
  stageId: '7067148a-2ee8-4e5b-93c8-31e0253fea68',
  ownerId: 'PGfXxlXCRXs3hXN3Gq7R',
  source: 'atlas_guarded_importer',
  proposedTags: [],
});

const CONTACT_ALLOWED_FIELDS = Object.freeze([
  'locationId', 'firstName', 'lastName', 'name', 'phone', 'email', 'companyName', 'source',
]);

const OPPORTUNITY_FIELD_KEYS = Object.freeze({
  propertyAddress: 'atlas_property_address',
  normalizedAddress: 'atlas_normalized_address',
  street: 'atlas_property_street',
  city: 'atlas_property_city',
  state: 'atlas_property_state',
  zip: 'atlas_property_zip',
  propertyFingerprint: 'atlas_property_fingerprint',
  sourceRowId: 'atlas_source_row_id',
  importBatchId: 'atlas_import_batch_id',
  atlasSource: 'atlas_source',
  listingPrice: 'listing_price',
  squareFeet: 'square_feet',
  pricePerSqft: 'price_per_sqft',
  propertyType: 'property_type',
  ownership: 'ownership',
  mlsStatus: 'mls_status',
  leadTypes: 'lead_types',
  listingUrl: 'listing_url',
  mlsId: 'mls_id',
  brokerage: 'brokerage',
});

const FIELD_VALUE_TYPES = Object.freeze({
  TEXT: 'text',
  LARGE_TEXT: 'text',
  MONETORY: 'number',
  NUMERICAL: 'number',
  FLOAT: 'number',
});

const EXPECTED_HEADERS = Object.freeze([
  'county', 'state', 'address', 'city', 'zip', 'listPrice', 'sqft', 'pricePerSqft',
  'propertyType', 'ownership', 'status', 'leadTypes', 'listingAgent', 'agentEmail',
  'agentPhone', 'brokerName', 'mlsUrl', 'ghlStatus',
]);

const DEFAULT_SOURCE_PATH = path.resolve(__dirname, '..', '..', 'lead-tracking', 'atlas-deals', 'import-ready.csv');
const DEFAULT_LEDGER_PATH = path.resolve(__dirname, '..', '..', 'lead-tracking', 'atlas-deals', 'ghl-import-ledger.jsonl');
const DEFAULT_MANIFEST_DIR = path.resolve(__dirname, '..', '..', 'lead-tracking', 'atlas-deals', 'manifests');

const CANONICAL_SYSTEM = Object.freeze({
  system: 'atlas-guarded-importer',
  schemaVersion: 1,
  dedupeAuthority: 'property-and-opportunity',
  canonicalCli: 'ghl-automations/tools/atlas-ghl-import.js',
  legacySystemsAccepted: false,
});

const WORKFLOW_SAFETY = Object.freeze({
  SAFE_NO_SMS: 'LEAD_ENTERED_SAFE_NO_SMS',
  SAFE_WITH_IMPORT_SUPPRESSION: 'LEAD_ENTERED_SAFE_WITH_IMPORT_SUPPRESSION',
  TRIGGERS_SMS: 'LEAD_ENTERED_TRIGGERS_SMS',
  UNVERIFIED: 'LEAD_ENTERED_UNVERIFIED',
});

const LIFECYCLE_STATUS = Object.freeze({
  LOCAL_PREPARED: 'LOCAL_PREPARED',
  LIVE_LOOKUP_PENDING: 'LIVE_LOOKUP_PENDING',
  PROPERTY_DUPLICATE: 'PROPERTY_DUPLICATE',
  PROPERTY_POSSIBLE_MATCH: 'PROPERTY_POSSIBLE_MATCH',
  OPPORTUNITY_DUPLICATE: 'OPPORTUNITY_DUPLICATE',
  OPPORTUNITY_POSSIBLE_MATCH: 'OPPORTUNITY_POSSIBLE_MATCH',
  AGENT_REUSE: 'AGENT_REUSE',
  AGENT_NEW: 'AGENT_NEW',
  AGENT_REVIEW: 'AGENT_REVIEW',
  LOOKUP_ERROR: 'LOOKUP_ERROR',
  WORKFLOW_SAFETY_UNVERIFIED: 'WORKFLOW_SAFETY_UNVERIFIED',
  READY_FOR_DRY_RUN: 'READY_FOR_DRY_RUN',
  APPROVED_FOR_IMPORT: 'APPROVED_FOR_IMPORT',
  IMPORTED_VERIFIED: 'IMPORTED_VERIFIED',
});

const CLASSIFICATION = Object.freeze({
  READY_CREATE_CONTACT_AND_OPPORTUNITY: 'READY_CREATE_CONTACT_AND_OPPORTUNITY',
  READY_REUSE_CONTACT_CREATE_OPPORTUNITY: 'READY_REUSE_CONTACT_CREATE_OPPORTUNITY',
  EXISTING_OPPORTUNITY: 'EXISTING_OPPORTUNITY',
  POSSIBLE_CONTACT_MATCH: 'POSSIBLE_CONTACT_MATCH',
  POSSIBLE_OPPORTUNITY_MATCH: 'POSSIBLE_OPPORTUNITY_MATCH',
  INTERNAL_DUPLICATE: 'INTERNAL_DUPLICATE',
  PREVIOUSLY_IMPORTED: 'PREVIOUSLY_IMPORTED',
  UNCERTAIN_PRIOR_IMPORT: 'UNCERTAIN_PRIOR_IMPORT',
  MISSING_REQUIRED_PROPERTY_DATA: 'MISSING_REQUIRED_PROPERTY_DATA',
  MISSING_CONTACT_METHOD: 'MISSING_CONTACT_METHOD',
  MISSING_AGENT_PHONE: 'MISSING_AGENT_PHONE',
  PROPERTY_CONTACT_FOUND_EXACT: 'PROPERTY_CONTACT_FOUND_EXACT',
  PROPERTY_CONTACT_FOUND_POSSIBLE: 'PROPERTY_CONTACT_FOUND_POSSIBLE',
  PROPERTY_CONTACT_FOUND_MULTIPLE: 'PROPERTY_CONTACT_FOUND_MULTIPLE',
  WORKFLOW_SAFETY_UNVERIFIED: 'WORKFLOW_SAFETY_UNVERIFIED',
  LOOKUP_ERROR: 'LOOKUP_ERROR',
  INVALID_RECORD: 'INVALID_RECORD',
  UNMAPPED_FIELD: 'UNMAPPED_FIELD',
});

const CONTACT_IDENTITY_DECISION = Object.freeze({
  SAFE_REUSE: 'SAFE_REUSE',
  SAFE_CREATE: 'SAFE_CREATE',
  BLOCK_SHARED_PHONE: 'BLOCK_SHARED_PHONE',
  BLOCK_GENERIC_EMAIL: 'BLOCK_GENERIC_EMAIL',
  BLOCK_NAME_CONFLICT: 'BLOCK_NAME_CONFLICT',
  BLOCK_IDENTIFIER_CONFLICT: 'BLOCK_IDENTIFIER_CONFLICT',
  BLOCK_AMBIGUOUS_IDENTITY: 'BLOCK_AMBIGUOUS_IDENTITY',
});

const EMAIL_AUTHORITY = Object.freeze({
  PERSON_SPECIFIC_EMAIL: 'PERSON_SPECIFIC_EMAIL',
  GENERIC_COMPANY_EMAIL: 'GENERIC_COMPANY_EMAIL',
  SHARED_BROKERAGE_EMAIL: 'SHARED_BROKERAGE_EMAIL',
  ROLE_BASED_EMAIL: 'ROLE_BASED_EMAIL',
  UNKNOWN_EMAIL_AUTHORITY: 'UNKNOWN_EMAIL_AUTHORITY',
  EMAIL_ABSENT: 'EMAIL_ABSENT',
});

const GENERIC_EMAIL_LOCAL_PARTS = new Set(['info', 'contact', 'admin', 'office', 'broker', 'txbroker', 'sales', 'support', 'team', 'hello', 'leads', 'listings']);
const BROKERAGE_EMAIL_LOCAL_PARTS = new Set(['broker', 'brokerage', 'txbroker', 'listings']);
const ROLE_EMAIL_LOCAL_PARTS = new Set(['admin', 'support', 'sales', 'leads']);
const COMPANY_EMAIL_LOCAL_PARTS = new Set(['info', 'contact', 'office', 'team', 'hello']);

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fieldMapChecksum(fieldMap) {
  return sha256(JSON.stringify({
    locationId: fieldMap.locationId,
    version: fieldMap.version,
    verifiedAt: fieldMap.verifiedAt,
    fields: fieldMap.fields,
  }));
}

function validateFieldMap(fieldMap = DEFAULT_FIELD_MAP, config = TARGET_CONFIG) {
  if (!fieldMap || typeof fieldMap !== 'object') return { ok: false, reason: 'field map missing' };
  if (fieldMap.locationId !== config.locationId) return { ok: false, reason: 'wrong location' };
  if (!fieldMap.verifiedAt) return { ok: false, reason: 'unverified map' };
  if (!fieldMap.fieldMapChecksum || fieldMap.fieldMapChecksum !== fieldMapChecksum(fieldMap)) return { ok: false, reason: 'checksum mismatch' };
  const fields = fieldMap.fields || {};
  const missing = Object.keys(OPPORTUNITY_FIELD_KEYS).filter(key => !fields[key]);
  if (missing.length) return { ok: false, reason: `missing logical field ${missing[0]}` };
  const ids = new Set();
  for (const [logicalKey, field] of Object.entries(fields)) {
    if (!OPPORTUNITY_FIELD_KEYS[logicalKey]) return { ok: false, reason: `unknown logical field ${logicalKey}` };
    if (!field.id) return { ok: false, reason: `missing field ID ${logicalKey}` };
    if (ids.has(field.id)) return { ok: false, reason: `duplicate field ID ${field.id}` };
    ids.add(field.id);
    if (field.model !== 'opportunity') return { ok: false, reason: `non-opportunity field ${logicalKey}` };
    if (!FIELD_VALUE_TYPES[field.dataType]) return { ok: false, reason: `unsupported data type ${logicalKey}` };
  }
  return { ok: true };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value);
      if (row.some(cell => String(cell).trim())) rows.push(row);
      row = [];
      value = '';
      continue;
    }
    value += char;
  }
  row.push(value);
  if (row.some(cell => String(cell).trim())) rows.push(row);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map(cell => cell.trim());
  const records = rows.slice(1).map((cells, index) => {
    const record = { _rowNumber: index + 2 };
    headers.forEach((header, columnIndex) => {
      record[header] = cells[columnIndex] == null ? '' : String(cells[columnIndex]).trim();
    });
    return record;
  });
  return { headers, records };
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function stripMatchingTrailingPhone(value, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return value;
  const match = String(value || '').match(/(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\s*$/);
  if (!match || !phoneMatches(normalizedPhone, match[0])) return value;
  return String(value || '').slice(0, match.index).trim();
}

function normalizePersonName(value, options = {}) {
  const name = options.matchingPhone ? stripMatchingTrailingPhone(value, options.matchingPhone) : value;
  return normalizeText(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneMatches(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  if (!a || !b) return false;
  return a === b || `1${a}` === b || a === `1${b}`;
}

function isGenericEmail(value) {
  return [EMAIL_AUTHORITY.GENERIC_COMPANY_EMAIL, EMAIL_AUTHORITY.SHARED_BROKERAGE_EMAIL, EMAIL_AUTHORITY.ROLE_BASED_EMAIL].includes(classifyEmailAuthority(value).classification);
}

function classifyEmailAuthority(value) {
  const email = normalizeEmail(value);
  if (!email) return { classification: EMAIL_AUTHORITY.EMAIL_ABSENT, reason: 'email absent', localPart: '', domain: '' };
  const match = email.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!match) return { classification: EMAIL_AUTHORITY.UNKNOWN_EMAIL_AUTHORITY, reason: 'email format is not authoritative', localPart: email.split('@')[0] || '', domain: email.split('@')[1] || '' };
  const localPart = match[1];
  const domain = match[2];
  if (BROKERAGE_EMAIL_LOCAL_PARTS.has(localPart)) return { classification: EMAIL_AUTHORITY.SHARED_BROKERAGE_EMAIL, reason: 'brokerage local part', localPart, domain };
  if (ROLE_EMAIL_LOCAL_PARTS.has(localPart)) return { classification: EMAIL_AUTHORITY.ROLE_BASED_EMAIL, reason: 'role-based local part', localPart, domain };
  if (COMPANY_EMAIL_LOCAL_PARTS.has(localPart)) return { classification: EMAIL_AUTHORITY.GENERIC_COMPANY_EMAIL, reason: 'company inbox local part', localPart, domain };
  if (GENERIC_EMAIL_LOCAL_PARTS.has(localPart)) return { classification: EMAIL_AUTHORITY.GENERIC_COMPANY_EMAIL, reason: 'generic local part', localPart, domain };
  return { classification: EMAIL_AUTHORITY.PERSON_SPECIFIC_EMAIL, reason: 'non-role local part', localPart, domain };
}

function canonicalContactIdentityDecision(record, lookup = {}) {
  const contact = lookup.contact || {};
  const expectedPhone = normalizePhone(record.agentPhone);
  const expectedEmail = normalizeEmail(record.agentEmail);
  const actualPhone = normalizePhone(contact.phone || lookup.phone || '');
  const actualEmail = normalizeEmail(contact.email || lookup.email || '');
  const sourceEmailAuthority = classifyEmailAuthority(expectedEmail);
  const existingEmailAuthority = classifyEmailAuthority(actualEmail);
  const sourceIdentity = {
    name: normalizePersonName(record.listingAgent),
    phone: expectedPhone,
    email: expectedEmail,
  };
  const existingIdentity = {
    name: normalizePersonName(contact.name || contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' '), { matchingPhone: actualPhone }),
    phone: actualPhone,
    email: actualEmail,
  };
  const nameMatch = Boolean(sourceIdentity.name && existingIdentity.name && sourceIdentity.name === existingIdentity.name);
  const phoneMatch = Boolean(expectedPhone && actualPhone && phoneMatches(expectedPhone, actualPhone));
  const emailMatch = Boolean(expectedEmail && actualEmail && expectedEmail === actualEmail);
  const existingEmailAbsent = !actualEmail;
  const existingPhoneAbsent = !actualPhone;
  const phoneConflict = Boolean(expectedPhone && actualPhone && !phoneMatch);
  const emailConflict = Boolean(expectedEmail && actualEmail && !emailMatch && sourceEmailAuthority.classification === EMAIL_AUTHORITY.PERSON_SPECIFIC_EMAIL && existingEmailAuthority.classification === EMAIL_AUTHORITY.PERSON_SPECIFIC_EMAIL);
  const genericEmail = isGenericEmail(expectedEmail);
  const sharedPhone = Boolean(lookup.phoneOwnerCount && lookup.phoneOwnerCount > 1) || /shared phone/i.test(String(lookup.reason || ''));
  const strongIdentifierMatched = phoneMatch || emailMatch || lookup.matchedFields?.includes('phone') || lookup.matchedFields?.includes('email') || /phone|email/i.test(String(lookup.reason || ''));
  const nameConflict = Boolean(strongIdentifierMatched && sourceIdentity.name && existingIdentity.name && !nameMatch);
  const base = {
    decision: CONTACT_IDENTITY_DECISION.BLOCK_AMBIGUOUS_IDENTITY,
    reason: lookup.reason || lookup.status || 'contact identity is ambiguous',
    reasonCodes: [],
    contactId: lookup.contactId || contact.id || null,
    sourceIdentity,
    existingIdentity,
    nameMatch,
    phoneMatch,
    emailMatch,
    existingEmailAbsent,
    existingPhoneAbsent,
    phoneConflict,
    emailConflict,
    sharedPhone,
    genericEmail,
    sourceEmailAuthority,
    existingEmailAuthority,
    nameConflict,
  };
  if (lookup.status === 'CONTACT_NOT_FOUND') return { ...base, decision: CONTACT_IDENTITY_DECISION.SAFE_CREATE, reason: 'no reusable contact found', reasonCodes: ['NO_REUSABLE_CONTACT'] };
  if (lookup.status !== 'CONTACT_FOUND_EXACT') {
    if (sharedPhone) return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_SHARED_PHONE, reasonCodes: ['SHARED_PHONE'] };
    if (/generic email/i.test(String(lookup.reason || ''))) return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_GENERIC_EMAIL, reasonCodes: ['GENERIC_EMAIL_ONLY'] };
    if (/name conflicts/i.test(String(lookup.reason || ''))) return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_NAME_CONFLICT, reasonCodes: ['NAME_CONFLICT'] };
    return { ...base, reasonCodes: ['AMBIGUOUS_IDENTITY'] };
  }
  const hasContactDetails = Boolean(existingIdentity.name || actualPhone || actualEmail || lookup.reason || lookup.matchedFields);
  if (!hasContactDetails) {
    if (expectedEmail && genericEmail && !expectedPhone) return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_GENERIC_EMAIL, reason: 'generic email cannot independently authorize reuse', reasonCodes: ['GENERIC_EMAIL_ONLY'] };
    return { ...base, decision: CONTACT_IDENTITY_DECISION.SAFE_REUSE, reason: 'lookup returned exact reusable contact', reasonCodes: ['LOOKUP_EXACT'] };
  }
  if (nameConflict) return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_NAME_CONFLICT, reason: 'strong identifier matched but person name conflicts', reasonCodes: ['NAME_CONFLICT'] };
  if (sharedPhone && phoneMatch) return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_SHARED_PHONE, reason: 'phone is associated with multiple named agents', reasonCodes: ['SHARED_PHONE'] };
  if (phoneConflict || emailConflict) return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_IDENTIFIER_CONFLICT, reason: 'reliable identifiers disagree', reasonCodes: [phoneConflict ? 'PHONE_CONFLICT' : '', emailConflict ? 'EMAIL_CONFLICT' : ''].filter(Boolean) };
  if (emailMatch && genericEmail && !phoneMatch) return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_GENERIC_EMAIL, reason: 'generic email cannot independently authorize reuse', reasonCodes: ['GENERIC_EMAIL_ONLY'] };
  if (nameMatch && phoneMatch && existingEmailAbsent) return { ...base, decision: CONTACT_IDENTITY_DECISION.SAFE_REUSE, reason: 'name and direct phone match; existing email absent', reasonCodes: ['SAFE_REUSE_NAME_PHONE_EMAIL_ABSENT'] };
  if (nameMatch && phoneMatch) return { ...base, decision: CONTACT_IDENTITY_DECISION.SAFE_REUSE, reason: lookup.reason || 'name and direct phone match', reasonCodes: ['SAFE_REUSE_NAME_PHONE'] };
  if (phoneMatch || emailMatch) return { ...base, decision: CONTACT_IDENTITY_DECISION.SAFE_REUSE, reason: lookup.reason || 'verified reusable contact identity', reasonCodes: [phoneMatch ? 'SAFE_REUSE_PHONE' : 'SAFE_REUSE_EMAIL'] };
  return { ...base, decision: CONTACT_IDENTITY_DECISION.BLOCK_AMBIGUOUS_IDENTITY, reason: 'name-only or weak contact match cannot authorize reuse', reasonCodes: ['WEAK_MATCH_ONLY'] };
}

function decideContactIdentity(record, lookup = {}) {
  return canonicalContactIdentityDecision(record, lookup);
}

function validateReusedContactReadback(record, contact, approvedIdentity) {
  const readback = canonicalContactIdentityDecision(record, { status: 'CONTACT_FOUND_EXACT', contactId: approvedIdentity.contactId, contact });
  const contactId = contact.id || contact.contactId;
  const contactUnchanged = !approvedIdentity.contactId || contactId === approvedIdentity.contactId;
  const approvedPhoneStillMatches = !approvedIdentity.phoneMatch || readback.phoneMatch;
  const approvedEmailStillMatches = !approvedIdentity.emailMatch || readback.emailMatch;
  const noIdentifierConflict = !readback.phoneConflict && !readback.emailConflict && !readback.nameConflict;
  const propertyFieldJson = JSON.stringify(contact.customFields || contact.customField || {});
  const contactIdentityOnly = !Object.values(DEFAULT_FIELD_MAP.fields).some(field => propertyFieldJson.includes(field.id));
  const ok = contactUnchanged && approvedPhoneStillMatches && approvedEmailStillMatches && noIdentifierConflict && contactIdentityOnly && [CONTACT_IDENTITY_DECISION.SAFE_REUSE, CONTACT_IDENTITY_DECISION.SAFE_CREATE].includes(readback.decision);
  return { status: ok ? 'VERIFIED' : 'PARTIALLY_VERIFIED', contactId, approvedIdentity, readbackIdentity: readback, checks: { contactUnchanged, approvedPhoneStillMatches, approvedEmailStillMatches, noIdentifierConflict, contactIdentityOnly } };
}

function normalizeAddressParts(record) {
  return [record.address, record.city, record.state, record.zip]
    .map(part => normalizeText(part).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('|');
}

function displayPropertyAddress(record) {
  return [normalizeText(record.address), `${normalizeText(record.city)} ${normalizeText(record.state)} ${normalizeText(record.zip)}`.trim()]
    .filter(Boolean)
    .join(', ');
}

function extractPropWireId(url) {
  const match = String(url || '').match(/\/realestate\/[^/]+\/(\d+)\//i);
  return match ? match[1] : '';
}

function buildPropertyFingerprint(record) {
  const propWireId = extractPropWireId(record.mlsUrl);
  if (propWireId) return `propwire:${propWireId}`;
  const address = normalizeAddressParts(record);
  return address ? `address:${address}` : '';
}

function splitName(fullName) {
  const name = normalizeText(fullName);
  if (!name) return { firstName: 'Atlas', lastName: 'PropWire Agent', name: 'Atlas PropWire Agent' };
  const parts = name.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '', name };
  return { firstName: parts[0], lastName: parts.slice(1).join(' '), name };
}

function toNumberOrUndefined(value) {
  const num = Number(String(value || '').replace(/[$,]/g, ''));
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function buildContactPayload(record, config = TARGET_CONFIG) {
  const name = splitName(record.listingAgent);
  const phone = normalizePhone(record.agentPhone);
  const email = normalizeEmail(record.agentEmail);
  const payload = {
    locationId: config.locationId,
    firstName: name.firstName,
    lastName: name.lastName,
    name: name.name,
    phone: phone || undefined,
    email: email || undefined,
    companyName: normalizeText(record.brokerName) || undefined,
    source: config.source,
  };
  assertContactPayloadSafe(payload);
  return payload;
}

function assertContactPayloadSafe(payload) {
  for (const key of Object.keys(payload)) {
    if (!CONTACT_ALLOWED_FIELDS.includes(key)) throw new Error(`FORBIDDEN_PROPERTY_WRITE contact field ${key}`);
  }
  if (payload.customFields || payload.custom_fields || payload.tags || payload.address1 || payload.postalCode || payload.city || payload.state) {
    throw new Error('FORBIDDEN_PROPERTY_WRITE contact payload contains property-scoped keys');
  }
}

function serializeFieldValue(value, dataType) {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  if (FIELD_VALUE_TYPES[dataType] === 'number') {
    const num = Number(normalized.replace(/[$,]/g, ''));
    if (!Number.isFinite(num)) throw new Error(`invalid numeric opportunity field value for ${dataType}`);
    return num;
  }
  return normalized;
}

function fieldValueEntries(record, fingerprint, config = TARGET_CONFIG) {
  return {
    propertyAddress: displayPropertyAddress(record),
    normalizedAddress: normalizeAddressParts(record),
    street: record.address,
    city: record.city,
    state: record.state,
    zip: record.zip,
    propertyFingerprint: fingerprint,
    sourceRowId: `import-ready:${record._rowNumber}`,
    importBatchId: buildImportBatchId(),
    atlasSource: config.source,
    listingPrice: record.listPrice,
    squareFeet: record.sqft,
    pricePerSqft: record.pricePerSqft,
    propertyType: record.propertyType,
    ownership: record.ownership,
    mlsStatus: record.status,
    leadTypes: record.leadTypes,
    listingUrl: record.mlsUrl,
    mlsId: extractPropWireId(record.mlsUrl),
    brokerage: record.brokerName,
  };
}

function buildOpportunityCustomFields(record, fingerprint, config = TARGET_CONFIG, fieldMap = DEFAULT_FIELD_MAP) {
  const mapCheck = validateFieldMap(fieldMap, config);
  if (!mapCheck.ok) throw new Error(`OPPORTUNITY_FIELD_MAP_INVALID: ${mapCheck.reason}`);
  const fields = Object.entries(fieldValueEntries(record, fingerprint, config)).map(([logicalKey, rawValue]) => {
    const field = fieldMap.fields[logicalKey];
    const fieldValue = serializeFieldValue(rawValue, field.dataType);
    if (fieldValue === undefined) return null;
    return { logicalKey, key: OPPORTUNITY_FIELD_KEYS[logicalKey], id: field.id, name: field.name, dataType: field.dataType, fieldValue, field_value: fieldValue };
  }).filter(Boolean);
  for (const required of [OPPORTUNITY_FIELD_KEYS.propertyAddress, OPPORTUNITY_FIELD_KEYS.normalizedAddress, OPPORTUNITY_FIELD_KEYS.propertyFingerprint, OPPORTUNITY_FIELD_KEYS.sourceRowId, OPPORTUNITY_FIELD_KEYS.importBatchId, OPPORTUNITY_FIELD_KEYS.atlasSource]) {
    if (!fields.some(field => field.key === required && normalizeText(field.fieldValue))) throw new Error(`missing opportunity field ${required}`);
  }
  return fields;
}

function toApiCustomFields(fields, fieldMap = DEFAULT_FIELD_MAP) {
  const allowedIds = new Set(Object.values(fieldMap.fields || {}).map(field => field.id));
  return fields.map((field) => {
    if (!allowedIds.has(field.id)) throw new Error(`OPPORTUNITY_FIELD_ID_NOT_VERIFIED: ${field.id || '(missing)'}`);
    return { id: field.id, fieldValue: field.fieldValue };
  });
}

function buildImportBatchId(date = new Date()) {
  return `atlas-${date.toISOString().slice(0, 10).replace(/-/g, '')}`;
}

function buildOpportunityPayload(record, contactId, config = TARGET_CONFIG, fieldMap = DEFAULT_FIELD_MAP) {
  const fingerprint = buildPropertyFingerprint(record);
  const propertyName = displayPropertyAddress(record);
  const customFields = buildOpportunityCustomFields(record, fingerprint, config, fieldMap);
  return {
    locationId: config.locationId,
    pipelineId: config.pipelineId,
    pipelineStageId: config.stageId,
    assignedTo: config.ownerId,
    status: 'open',
    contactId,
    name: propertyName,
    monetaryValue: toNumberOrUndefined(record.listPrice),
    source: config.source,
    customFields: toApiCustomFields(customFields, fieldMap),
  };
}

async function verifyContact(client, expected) {
  if (!client || typeof client.getContact !== 'function' || !expected.contactId) {
    return { status: 'UNCERTAIN', reason: 'contact verifier unavailable' };
  }
  try {
    const contact = await client.getContact(expected.contactId);
    const actual = contact.contact || contact;
    const expectedPhone = normalizePhone(expected.phone);
    const actualPhone = normalizePhone(actual.phone);
    const expectedEmail = normalizeEmail(expected.email);
    const actualEmail = normalizeEmail(actual.email);
    const phoneOk = !expectedPhone || phoneMatches(expectedPhone, actualPhone);
    const emailOk = !expectedEmail || expectedEmail === actualEmail;
    const sourceOk = !expected.source || actual.source === expected.source || actual.source == null;
    const tags = Array.isArray(actual.tags) ? actual.tags : [];
    const tagsOk = !expected.tags || expected.tags.every(tag => tags.includes(tag));
    const contactFields = (Array.isArray(actual.customFields) ? actual.customFields : []).map(field => [field.id, field.key, field.name, field.value, field.fieldValue, field.field_value].filter(Boolean).join(' ')).join(' ');
    const noPropertyDataOk = !/atlas_|property fingerprint|source row|import batch|atlas property/i.test(contactFields);
    if (phoneOk && emailOk && sourceOk && tagsOk && noPropertyDataOk) return { status: 'VERIFIED', contactId: expected.contactId };
    return { status: 'PARTIALLY_VERIFIED', contactId: expected.contactId, checks: { phoneOk, emailOk, sourceOk, tagsOk, noPropertyDataOk } };
  } catch (error) {
    return { status: 'FAILED', reason: error.message };
  }
}

async function verifyOpportunity(client, expected) {
  if (!client || typeof client.getOpportunity !== 'function' || !expected.opportunityId) {
    return { status: 'UNCERTAIN', reason: 'opportunity verifier unavailable' };
  }
  try {
    const opportunity = await client.getOpportunity(expected.opportunityId);
    const actual = opportunity.opportunity || opportunity;
    const checks = {
      contactOk: actual.contactId === expected.contactId || actual.contact?.id === expected.contactId,
      locationOk: actual.locationId === expected.locationId || actual.locationId == null,
      pipelineOk: actual.pipelineId === expected.pipelineId,
      stageOk: actual.pipelineStageId === expected.stageId,
      ownerOk: actual.assignedTo === expected.ownerId,
      statusOk: !expected.status || actual.status === expected.status,
      nameOk: !expected.name || actual.name === expected.name,
    };
    if (Array.isArray(expected.customFields) && (client.isAtlasLiveWriteClient || Array.isArray(actual.customFields) || Array.isArray(actual.customField))) {
      const comparisons = liveClient.expectedFieldComparisons(expected.customFields.filter(field => normalizeText(field.fieldValue ?? field.field_value ?? field.value)), actual.customFields || actual.customField || []);
      checks.customFieldsOk = comparisons.every(item => item.ok);
      const expectedIds = new Set(expected.customFields.map(field => field.id));
      const importerFieldIds = new Set(Object.values(DEFAULT_FIELD_MAP.fields || {}).map(field => field.id));
      const unexpectedFields = (actual.customFields || actual.customField || []).filter((field) => {
        const fieldId = field.id || field.fieldId;
        const value = field.fieldValue ?? field.value ?? field.field_value;
        return importerFieldIds.has(fieldId) && !expectedIds.has(fieldId) && normalizeText(value);
      });
      checks.noUnexpectedImporterFieldsOk = unexpectedFields.length === 0;
      checks.customFieldComparisons = comparisons;
      checks.unexpectedImporterFields = unexpectedFields.map(field => field.id || field.fieldId || field.key || field.name);
    }
    if (Object.values(checks).every(Boolean)) return { status: 'VERIFIED', opportunityId: expected.opportunityId, checks };
    return { status: 'PARTIALLY_VERIFIED', opportunityId: expected.opportunityId, checks };
  } catch (error) {
    return { status: 'FAILED', reason: error.message };
  }
}

function buildRowNotes(record, fingerprint) {
  return [
    '=== ATLAS DEALS PROPWIRE IMPORT ===',
    `Property: ${normalizeText(record.address)}, ${normalizeText(record.city)} ${normalizeText(record.state)} ${normalizeText(record.zip)}`,
    `Fingerprint: ${fingerprint}`,
    `Lead Types: ${normalizeText(record.leadTypes) || '(missing)'}`,
    `Listing Status: ${normalizeText(record.status) || '(missing)'}`,
    `List Price: ${normalizeText(record.listPrice) || '(missing)'}`,
    `Property Type: ${normalizeText(record.propertyType) || '(missing)'}`,
    `Listing Agent: ${normalizeText(record.listingAgent) || '(missing)'}`,
    `Agent Phone: ${normalizeText(record.agentPhone) || '(missing)'}`,
    `Agent Email: ${normalizeText(record.agentEmail) || '(missing)'}`,
    `Brokerage: ${normalizeText(record.brokerName) || '(missing)'}`,
    `Source URL: ${normalizeText(record.mlsUrl) || '(missing)'}`,
  ].join('\n');
}

function validateHeaders(headers) {
  const missing = EXPECTED_HEADERS.filter(header => !headers.includes(header));
  const extra = headers.filter(header => !EXPECTED_HEADERS.includes(header));
  return { ok: missing.length === 0, missing, extra };
}

function readLedger(ledgerPath = DEFAULT_LEDGER_PATH) {
  if (!fs.existsSync(ledgerPath)) return [];
  return fs.readFileSync(ledgerPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return { eventType: 'LEDGER_PARSE_ERROR', raw: line.slice(0, 100) }; }
    });
}

function ledgerStatus(events, fingerprint) {
  const matches = events.filter(event => event.propertyFingerprint === fingerprint);
  if (matches.some(event => event.eventType === 'ROW_VERIFIED' || event.result === 'VERIFIED')) return 'verified';
  if (matches.some(event => /CREATED|FAILED|UNCERTAIN|PARTIAL/.test(String(event.eventType || event.result || '')))) return 'uncertain';
  return 'none';
}

function safeLedgerEvent(event) {
  const copy = { ...event };
  delete copy.authorization;
  delete copy.headers;
  delete copy.cookie;
  delete copy.cookies;
  delete copy.token;
  delete copy.apiKey;
  return copy;
}

function normalizeLegacySourceStatus(value) {
  const status = normalizeText(value).toLowerCase();
  if (status === 'new') return LIFECYCLE_STATUS.LOCAL_PREPARED;
  if (status === 'duplicate') return LIFECYCLE_STATUS.PROPERTY_POSSIBLE_MATCH;
  if (status === 'error') return LIFECYCLE_STATUS.LOOKUP_ERROR;
  return status ? status.toUpperCase() : LIFECYCLE_STATUS.LOCAL_PREPARED;
}

function isWorkflowSafeForPreview(status) {
  return status === WORKFLOW_SAFETY.SAFE_NO_SMS || status === WORKFLOW_SAFETY.SAFE_WITH_IMPORT_SUPPRESSION;
}

function deriveLifecycleStatus(row) {
  if (row.classification === CLASSIFICATION.READY_CREATE_CONTACT_AND_OPPORTUNITY) return LIFECYCLE_STATUS.READY_FOR_DRY_RUN;
  if (row.classification === CLASSIFICATION.READY_REUSE_CONTACT_CREATE_OPPORTUNITY) return LIFECYCLE_STATUS.AGENT_REUSE;
  if (row.classification === CLASSIFICATION.EXISTING_OPPORTUNITY) return LIFECYCLE_STATUS.OPPORTUNITY_DUPLICATE;
  if (row.classification === CLASSIFICATION.POSSIBLE_OPPORTUNITY_MATCH) return LIFECYCLE_STATUS.OPPORTUNITY_POSSIBLE_MATCH;
  if (row.classification === CLASSIFICATION.PROPERTY_CONTACT_FOUND_EXACT) return LIFECYCLE_STATUS.PROPERTY_DUPLICATE;
  if (row.classification === CLASSIFICATION.PROPERTY_CONTACT_FOUND_POSSIBLE || row.classification === CLASSIFICATION.PROPERTY_CONTACT_FOUND_MULTIPLE) return LIFECYCLE_STATUS.PROPERTY_POSSIBLE_MATCH;
  if (row.classification === CLASSIFICATION.POSSIBLE_CONTACT_MATCH) return LIFECYCLE_STATUS.AGENT_REVIEW;
  if (row.classification === CLASSIFICATION.LOOKUP_ERROR) return LIFECYCLE_STATUS.LOOKUP_ERROR;
  if (row.classification === CLASSIFICATION.WORKFLOW_SAFETY_UNVERIFIED) return LIFECYCLE_STATUS.WORKFLOW_SAFETY_UNVERIFIED;
  return LIFECYCLE_STATUS.LOCAL_PREPARED;
}

function appendLedgerEvent(ledgerPath, event) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(safeLedgerEvent({ timestamp: new Date().toISOString(), ...event })) + '\n');
}

async function lookupContact(record, client) {
  if (!client) return { status: 'CONTACT_LOOKUP_ERROR', reason: 'GHL lookup client unavailable' };
  if (typeof client.lookupContact !== 'function') return { status: 'CONTACT_LOOKUP_ERROR', reason: 'lookupContact not implemented' };
  try {
    const result = await client.lookupContact({
      email: normalizeEmail(record.agentEmail),
      phone: normalizePhone(record.agentPhone),
      name: normalizeText(record.listingAgent),
    });
    return result || { status: 'CONTACT_LOOKUP_ERROR', reason: 'empty lookup result' };
  } catch (error) {
    return { status: 'CONTACT_LOOKUP_ERROR', reason: error.message };
  }
}

async function lookupPropertyContact(record, client) {
  if (!client) return { status: 'PROPERTY_CONTACT_LOOKUP_ERROR', reason: 'GHL lookup client unavailable' };
  if (typeof client.lookupPropertyContact !== 'function') return { status: 'PROPERTY_CONTACT_LOOKUP_ERROR', reason: 'lookupPropertyContact not implemented' };
  try {
    const result = await client.lookupPropertyContact({
      propertyAddress: normalizeText(record.address),
      city: normalizeText(record.city),
      state: normalizeText(record.state),
      zip: normalizeText(record.zip),
      normalizedAddress: normalizeAddressParts(record),
    });
    return result || { status: 'PROPERTY_CONTACT_LOOKUP_ERROR', reason: 'empty lookup result' };
  } catch (error) {
    return { status: 'PROPERTY_CONTACT_LOOKUP_ERROR', reason: error.message };
  }
}

async function lookupOpportunity(record, fingerprint, client, config = TARGET_CONFIG) {
  if (!client) return { status: 'OPPORTUNITY_LOOKUP_ERROR', reason: 'GHL lookup client unavailable' };
  if (typeof client.lookupOpportunity !== 'function') return { status: 'OPPORTUNITY_LOOKUP_ERROR', reason: 'lookupOpportunity not implemented' };
  try {
    const result = await client.lookupOpportunity({
      fingerprint,
      propertyAddress: normalizeText(record.address),
      city: normalizeText(record.city),
      state: normalizeText(record.state),
      zip: normalizeText(record.zip),
      mlsUrl: normalizeText(record.mlsUrl),
      locationId: config.locationId,
      pipelineId: config.pipelineId,
    });
    return result || { status: 'OPPORTUNITY_LOOKUP_ERROR', reason: 'empty lookup result' };
  } catch (error) {
    return { status: 'OPPORTUNITY_LOOKUP_ERROR', reason: error.message };
  }
}

function classifyRecord(record, ctx) {
  const warnings = [];
  if (!normalizeText(record.agentPhone)) warnings.push(CLASSIFICATION.MISSING_AGENT_PHONE);
  if (ctx.headerError) return { classification: CLASSIFICATION.INVALID_RECORD, warnings, blockers: ['CSV schema is unsupported'] };
  if (!record.address || !record.city || !record.state || !record.zip || !ctx.fingerprint) {
    return { classification: CLASSIFICATION.MISSING_REQUIRED_PROPERTY_DATA, warnings, blockers: ['Missing required property identity fields'] };
  }
  if (!normalizeEmail(record.agentEmail) && !normalizePhone(record.agentPhone)) {
    return { classification: CLASSIFICATION.MISSING_CONTACT_METHOD, warnings, blockers: ['Missing agent phone and email'] };
  }
  if (ctx.internalDuplicate) return { classification: CLASSIFICATION.INTERNAL_DUPLICATE, warnings, blockers: ['Duplicate property fingerprint in source file'] };
  if (ctx.ledger === 'verified') return { classification: CLASSIFICATION.PREVIOUSLY_IMPORTED, warnings, blockers: ['Ledger already has verified import'] };
  if (ctx.ledger === 'uncertain') return { classification: CLASSIFICATION.UNCERTAIN_PRIOR_IMPORT, warnings, blockers: ['Ledger has uncertain prior import attempt'] };
  if (ctx.propertyContact.status === 'PROPERTY_CONTACT_LOOKUP_ERROR' || ctx.propertyContact.status === 'PROPERTY_LOOKUP_INCOMPLETE' || ctx.contact.status === 'CONTACT_LOOKUP_ERROR' || ctx.contact.status === 'AGENT_LOOKUP_INCOMPLETE' || ctx.opportunity.status === 'OPPORTUNITY_LOOKUP_ERROR' || ctx.opportunity.status === 'OPPORTUNITY_LOOKUP_INCOMPLETE') {
    return { classification: CLASSIFICATION.LOOKUP_ERROR, warnings, blockers: [ctx.propertyContact.reason, ctx.contact.reason, ctx.opportunity.reason].filter(Boolean) };
  }
  if (ctx.propertyContact.status === 'PROPERTY_CONTACT_FOUND_EXACT') return { classification: CLASSIFICATION.PROPERTY_CONTACT_FOUND_EXACT, warnings, blockers: ['Property address already appears on an existing GHL contact'] };
  if (ctx.propertyContact.status === 'PROPERTY_CONTACT_MULTIPLE_EXACT' || ctx.propertyContact.status === 'PROPERTY_CONTACT_FOUND_MULTIPLE') return { classification: CLASSIFICATION.PROPERTY_CONTACT_FOUND_MULTIPLE, warnings, blockers: ['Multiple existing GHL contacts match the property address and require review'] };
  if (ctx.propertyContact.status === 'PROPERTY_CONTACT_FOUND_POSSIBLE') return { classification: CLASSIFICATION.PROPERTY_CONTACT_FOUND_POSSIBLE, warnings, blockers: ['Possible existing GHL contact for property address requires review'] };
  if (ctx.contact.status === 'CONTACT_FOUND_POSSIBLE') return { classification: CLASSIFICATION.POSSIBLE_CONTACT_MATCH, warnings, blockers: ['Possible contact match requires review'] };
  if (ctx.contactIdentity && ![CONTACT_IDENTITY_DECISION.SAFE_REUSE, CONTACT_IDENTITY_DECISION.SAFE_CREATE].includes(ctx.contactIdentity.decision)) {
    return { classification: CLASSIFICATION.POSSIBLE_CONTACT_MATCH, warnings, blockers: [ctx.contactIdentity.reason || ctx.contactIdentity.decision] };
  }
  if (ctx.opportunity.status === 'OPPORTUNITY_FOUND_POSSIBLE' || ctx.opportunity.status === 'OPPORTUNITY_MULTIPLE_EXACT') return { classification: CLASSIFICATION.POSSIBLE_OPPORTUNITY_MATCH, warnings, blockers: ['Possible opportunity match requires review'] };
  if (ctx.opportunity.status === 'OPPORTUNITY_FOUND_EXACT') return { classification: CLASSIFICATION.EXISTING_OPPORTUNITY, warnings, blockers: ['Opportunity already exists'] };
  if (!isWorkflowSafeForPreview(ctx.workflowSafetyStatus)) return { classification: CLASSIFICATION.WORKFLOW_SAFETY_UNVERIFIED, warnings, blockers: ['LEAD_ENTERED workflow and outreach safety is not proven'] };
  if (ctx.contact.status === 'CONTACT_FOUND_EXACT') return { classification: CLASSIFICATION.READY_REUSE_CONTACT_CREATE_OPPORTUNITY, warnings, blockers: [] };
  return { classification: CLASSIFICATION.READY_CREATE_CONTACT_AND_OPPORTUNITY, warnings, blockers: [] };
}

async function buildPreflightManifest(options = {}) {
  const sourcePath = options.sourcePath || DEFAULT_SOURCE_PATH;
  const ledgerPath = options.ledgerPath || DEFAULT_LEDGER_PATH;
  const config = options.config || TARGET_CONFIG;
  const limit = Number(options.limit || 0);
  const runId = options.runId || `atlas-ghl-${Date.now()}`;
  const workflowSafetyStatus = options.workflowSafetyStatus || WORKFLOW_SAFETY.UNVERIFIED;
  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  const sourceChecksum = sha256(sourceText);
  const parsed = parseCsv(sourceText);
  const headerCheck = validateHeaders(parsed.headers);
  const authProbe = options.client && typeof options.client.authProbe === 'function' && options.skipAuthProbe !== true
    ? await options.client.authProbe()
    : { ok: true, status: 'AUTH_NOT_CONFIGURED_FOR_CLIENT' };
  if (!authProbe.ok) {
    const manifestCore = {
      system: CANONICAL_SYSTEM.system,
      schemaVersion: CANONICAL_SYSTEM.schemaVersion,
      ...artifactHash.hashMetadata(),
      dedupeAuthority: CANONICAL_SYSTEM.dedupeAuthority,
      runId,
      mode: 'preflight',
      generatedAt: new Date().toISOString(),
      sourcePath,
      sourceChecksum,
      targetLocationId: config.locationId,
      targetPipelineId: config.pipelineId,
      workflowSafetyStatus,
      expectedHeaders: EXPECTED_HEADERS,
      actualHeaders: parsed.headers,
      headerCheck,
      targetConfig: config,
      authProbe,
      rowCount: parsed.records.length,
      counts: { [CLASSIFICATION.LOOKUP_ERROR]: parsed.records.length },
      rows: [],
      divinityEndpointReferenced: false,
      legacyUploaderInvoked: false,
      writeCount: 0,
      globalAuthFailure: authProbe.status,
    };
    return { ...manifestCore, manifestChecksum: artifactHash.calculateCanonicalArtifactHash(manifestCore) };
  }
  const ledger = readLedger(ledgerPath);
  const seen = new Set();
  const sourceRowIds = Array.isArray(options.sourceRowIds) ? new Set(options.sourceRowIds.map(id => Number(String(id).replace(/^import-ready:/, '')))) : null;
  const allRecords = sourceRowIds ? parsed.records.filter(record => sourceRowIds.has(record._rowNumber)) : parsed.records;
  const records = limit > 0 ? allRecords.slice(0, limit) : allRecords;
  const rows = [];

  for (const record of records) {
    const fingerprint = buildPropertyFingerprint(record);
    const internalDuplicate = Boolean(fingerprint && seen.has(fingerprint));
    if (fingerprint) seen.add(fingerprint);
    const [propertyContact, contact, opportunity] = await Promise.all([
      lookupPropertyContact(record, options.client),
      lookupContact(record, options.client),
      lookupOpportunity(record, fingerprint, options.client, config),
    ]);
    const contactIdentity = decideContactIdentity(record, contact);
    const decision = classifyRecord(record, {
      headerError: !headerCheck.ok,
      fingerprint,
      internalDuplicate,
      ledger: ledgerStatus(ledger, fingerprint),
      propertyContact,
      contact,
      contactIdentity,
      opportunity,
      workflowSafetyStatus,
    });
    let contactPayload;
    let customFields;
    let proposedOpportunity;
    let payloadError = '';
    try {
      contactPayload = buildContactPayload(record, config);
      customFields = buildOpportunityCustomFields(record, fingerprint, config);
      proposedOpportunity = buildOpportunityPayload(record, contactPayload.id || '<resolved-contact-id>', config);
    } catch (error) {
      payloadError = error.message;
      contactPayload = contactPayload || buildContactPayload(record, config);
      customFields = [];
      proposedOpportunity = null;
    }
    const classification = payloadError ? CLASSIFICATION.INVALID_RECORD : decision.classification;
    rows.push({
      sourceRow: record._rowNumber,
      propertyFingerprint: fingerprint,
      propertyAddress: normalizeText(record.address),
      listingAgent: normalizeText(record.listingAgent),
      phoneAvailable: Boolean(normalizePhone(record.agentPhone)),
      emailAvailable: Boolean(normalizeEmail(record.agentEmail)),
      sourceLifecycleStatus: normalizeLegacySourceStatus(record.ghlStatus),
      sourceRecord: {
        listingAgent: record.listingAgent,
        agentPhone: record.agentPhone,
        agentEmail: record.agentEmail,
      },
      propertyContactDecision: propertyContact.status,
      propertyContactId: propertyContact.contactId || propertyContact.contact?.id || null,
      contactDecision: contact.status,
      contactIdentityDecision: contactIdentity.decision,
      contactIdentityReason: contactIdentity.reason,
      contactIdentityDetails: contactIdentity,
      contactId: contact.contactId || contact.contact?.id || null,
      opportunityDecision: opportunity.status,
      opportunityId: opportunity.opportunityId || opportunity.opportunity?.id || null,
      classification,
      lifecycleStatus: deriveLifecycleStatus({ classification }),
      workflowSafetyStatus,
      warnings: decision.warnings,
      blockers: payloadError ? [payloadError] : decision.blockers,
      target: {
        locationId: config.locationId,
        pipelineId: config.pipelineId,
        stageName: config.stageName,
        stageId: config.stageId,
        ownerId: config.ownerId,
      },
      tags: [...config.proposedTags],
      customFields,
      source: config.source,
      proposedContact: contactPayload,
      proposedOpportunity,
      proposedNote: buildRowNotes(record, fingerprint),
    });
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.classification] = (acc[row.classification] || 0) + 1;
    return acc;
  }, {});
  const manifestCore = {
    system: CANONICAL_SYSTEM.system,
    schemaVersion: CANONICAL_SYSTEM.schemaVersion,
    ...artifactHash.hashMetadata(),
    dedupeAuthority: CANONICAL_SYSTEM.dedupeAuthority,
    runId,
    mode: 'preflight',
    generatedAt: new Date().toISOString(),
    sourcePath,
    sourceChecksum,
    targetLocationId: config.locationId,
    targetPipelineId: config.pipelineId,
    workflowSafetyStatus,
    expectedHeaders: EXPECTED_HEADERS,
    actualHeaders: parsed.headers,
    headerCheck,
    targetConfig: config,
    authProbe,
    rowCount: rows.length,
    counts,
    rows,
    divinityEndpointReferenced: false,
    legacyUploaderInvoked: false,
    writeCount: 0,
  };
  const manifestChecksum = artifactHash.calculateCanonicalArtifactHash(manifestCore);
  return { ...manifestCore, manifestChecksum };
}

function readyRows(manifest) {
  return manifest.rows.filter(row => row.classification.startsWith('READY_'));
}

function writeReadyManifest(manifest, manifestDir = DEFAULT_MANIFEST_DIR) {
  const ready = readyRows(manifest);
  const output = {
    metadata: {
      canonicalSystem: CANONICAL_SYSTEM.system,
      sourceFileHash: manifest.sourceChecksum,
      fieldMapHash: DEFAULT_FIELD_MAP.fieldMapChecksum,
      manifestHash: manifest.manifestChecksum,
      generatedAt: new Date().toISOString(),
      importerVersion: 'atlas-ghl-import-v2-property-scope',
      webhookSafetyVersion: 'atlas-webhook-ghl-only-v2',
      locationId: manifest.targetConfig.locationId,
      pipelineId: manifest.targetConfig.pipelineId,
      stageId: manifest.targetConfig.stageId,
      ownerId: manifest.targetConfig.ownerId,
      batchId: buildImportBatchId(),
      totalSourceRows: manifest.rowCount,
      readyRows: ready.length,
      blockedRows: manifest.rowCount - ready.length,
      opportunityFieldMappingVersion: 'opportunity-scope-v2',
      contactFieldMappingVersion: 'contact-scope-v2',
    },
    ready: ready.map(row => ({
      sourceRowId: `import-ready:${row.sourceRow}`,
      propertyDisplayAddress: row.proposedOpportunity.name,
      normalizedPropertyAddress: row.customFields.find(field => field.key === OPPORTUNITY_FIELD_KEYS.normalizedAddress)?.field_value || '',
      propertyFingerprint: row.propertyFingerprint,
      contactDecision: row.contactDecision,
      matchedContactId: row.contactId,
      approvedMissingReusableContactFields: [],
      opportunityDecision: row.opportunityDecision,
      approvedOpportunityFieldMap: row.customFields,
      liveLookupProof: {
        propertyContactDecision: row.propertyContactDecision,
        contactDecision: row.contactDecision,
        opportunityDecision: row.opportunityDecision,
      },
      paginationProof: { complete: true },
      duplicateClassification: row.classification,
      markerValues: {
        atlas_import_batch_id: row.customFields.find(field => field.key === OPPORTUNITY_FIELD_KEYS.importBatchId)?.field_value || '',
        atlas_source_row_id: row.customFields.find(field => field.key === OPPORTUNITY_FIELD_KEYS.sourceRowId)?.field_value || '',
        atlas_property_fingerprint: row.customFields.find(field => field.key === OPPORTUNITY_FIELD_KEYS.propertyFingerprint)?.field_value || '',
        source: row.source,
      },
      sourceHash: manifest.sourceChecksum,
    })),
    blocked: manifest.rows.filter(row => !row.classification.startsWith('READY_')).map(row => ({
      sourceRowId: `import-ready:${row.sourceRow}`,
      classification: row.classification,
      blockers: row.blockers,
    })),
  };
  fs.mkdirSync(manifestDir, { recursive: true });
  const filePath = path.join(manifestDir, `${output.metadata.batchId}-${manifest.manifestChecksum.slice(0, 12)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
  return { filePath, manifest: output };
}

function validateApproval(approval, manifest, config = TARGET_CONFIG) {
  if (!approval) return { ok: false, reason: 'approval missing' };
  if (approval.runId !== manifest.runId) return { ok: false, reason: 'runId mismatch' };
  if (approval.sourceChecksum !== manifest.sourceChecksum) return { ok: false, reason: 'source checksum mismatch' };
  if (approval.manifestChecksum !== manifest.manifestChecksum) return { ok: false, reason: 'manifest checksum mismatch' };
  if (approval.locationId !== config.locationId) return { ok: false, reason: 'location mismatch' };
  if (approval.pipelineId !== config.pipelineId) return { ok: false, reason: 'pipeline mismatch' };
  if (approval.stageId !== config.stageId) return { ok: false, reason: 'stage mismatch' };
  if (approval.ownerId !== config.ownerId) return { ok: false, reason: 'owner mismatch' };
  if (!['LIVE_GHL_IMPORT', liveClient.EXECUTION_MODES.LIVE_CANARY, liveClient.EXECUTION_MODES.LIVE_MANIFEST].includes(approval.executionMode)) return { ok: false, reason: 'execution mode mismatch' };
  const expiresAt = new Date(approval.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, reason: 'approval expired' };
  if (Number(approval.approvedRowCount) !== manifest.rows.filter(row => row.classification.startsWith('READY_')).length) return { ok: false, reason: 'approved row count mismatch' };
  return { ok: true };
}

function validateGuardedManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, reason: 'manifest missing or invalid' };
  if (manifest.system !== CANONICAL_SYSTEM.system) return { ok: false, reason: manifest.system ? 'unknown manifest system' : 'manifest system missing' };
  if (manifest.schemaVersion !== CANONICAL_SYSTEM.schemaVersion) return { ok: false, reason: 'unsupported schema version' };
  if (manifest.legacySystem === 'legacy-ghl-dedup' || manifest.system === 'legacy-ghl-dedup') return { ok: false, reason: 'legacy dedupe output is not accepted' };
  if (!manifest.sourceChecksum) return { ok: false, reason: 'source checksum missing' };
  if (options.sourceChecksum && manifest.sourceChecksum !== options.sourceChecksum) return { ok: false, reason: 'source checksum mismatch' };
  if (!isWorkflowSafeForPreview(manifest.workflowSafetyStatus)) return { ok: false, reason: 'workflow safety unverified' };
  if (!Array.isArray(manifest.rows)) return { ok: false, reason: 'manifest rows missing' };
  const incomplete = manifest.rows.find(row => !row.propertyContactDecision || !row.contactDecision || !row.opportunityDecision);
  if (incomplete) return { ok: false, reason: 'live lookup proof missing' };
  if (manifest.writeCount !== 0) return { ok: false, reason: 'preview manifest must have writeCount 0' };
  return { ok: true };
}

async function executeApprovedImport({ manifest, approval, client, ledgerPath = DEFAULT_LEDGER_PATH, enableMockWrites = false, strictStopOnFirstFailure = false } = {}) {
  if (!enableMockWrites || !client || client.mockWriteClient !== true) {
    const liveAuth = liveClient.validateLiveWriteAuthorization({
      mode: approval?.executionMode,
      manifestPath: approval?.manifestPath,
      manifest,
      approval,
      canaryArtifact: approval?.canaryArtifact,
      successfulCanaryArtifact: approval?.successfulCanaryArtifact,
    });
    if (!client?.isAtlasLiveWriteClient || !client.liveWriteAuthorized || !liveAuth.ok) {
      throw new Error(`LIVE_GHL_IMPORT_DISABLED: ${liveAuth.checks.filter(check => !check.ok).map(check => check.name).join('; ') || 'live client not authorized'}`);
    }
  }
  const manifestCheck = validateGuardedManifest(manifest);
  if (!manifestCheck.ok) throw new Error(`MANIFEST_INVALID: ${manifestCheck.reason}`);
  const approvalCheck = validateApproval(approval, manifest);
  if (!approvalCheck.ok) throw new Error(`APPROVAL_INVALID: ${approvalCheck.reason}`);
  const results = [];
  for (const row of manifest.rows) {
    if (!row.classification.startsWith('READY_')) continue;
    if (![CONTACT_IDENTITY_DECISION.SAFE_REUSE, CONTACT_IDENTITY_DECISION.SAFE_CREATE].includes(row.contactIdentityDecision)) {
      appendLedgerEvent(ledgerPath, { eventType: 'ROW_BLOCKED_CONTACT_IDENTITY', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, sourceRow: row.sourceRow, propertyFingerprint: row.propertyFingerprint, result: 'BLOCKED', safeErrorSummary: row.contactIdentityReason || row.contactIdentityDecision });
      results.push({ sourceRow: row.sourceRow, result: 'ROW_BLOCKED', reason: 'contact identity conflict' });
      break;
    }
    let contactId = row.contactId;
    if (!contactId) {
      let contact;
      try {
        contact = await client.createContact(row.proposedContact);
      } catch (error) {
        appendLedgerEvent(ledgerPath, { eventType: 'CONTACT_CREATION_FAILED', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, sourceRow: row.sourceRow, propertyFingerprint: row.propertyFingerprint, result: 'FAILED', safeErrorSummary: error.message });
        results.push({ sourceRow: row.sourceRow, result: 'ROW_FAILED', reason: 'contact creation failed' });
        if (strictStopOnFirstFailure) throw error;
        continue;
      }
      contactId = contact.contact?.id || contact.id;
      appendLedgerEvent(ledgerPath, { eventType: 'CONTACT_CREATED', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, sourceRow: row.sourceRow, propertyFingerprint: row.propertyFingerprint, contactId, result: 'CREATED' });
    } else {
      appendLedgerEvent(ledgerPath, { eventType: 'CONTACT_REUSED', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, sourceRow: row.sourceRow, propertyFingerprint: row.propertyFingerprint, contactId, result: 'REUSED' });
    }

    let contactVerification;
    if (row.contactIdentityDecision === CONTACT_IDENTITY_DECISION.SAFE_REUSE) {
      if (typeof client.getContact !== 'function') {
        contactVerification = { status: 'UNCERTAIN', reason: 'contact verifier unavailable' };
      } else {
        const contactReadback = await client.getContact(contactId);
        contactVerification = validateReusedContactReadback(row.sourceRecord, contactReadback.contact || contactReadback, { ...row.contactIdentityDetails, contactId });
      }
    } else {
      contactVerification = await verifyContact(client, { contactId, ...row.proposedContact });
    }
    if (contactVerification.status === 'FAILED' || contactVerification.status === 'UNCERTAIN') {
      appendLedgerEvent(ledgerPath, { eventType: 'ROW_UNCERTAIN', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, sourceRow: row.sourceRow, propertyFingerprint: row.propertyFingerprint, contactId, verificationStatus: contactVerification.status, result: 'UNCERTAIN', safeErrorSummary: contactVerification.reason });
      results.push({ sourceRow: row.sourceRow, result: 'ROW_UNCERTAIN', contactId });
      if (strictStopOnFirstFailure) throw new Error(`CONTACT_RECONCILIATION_${contactVerification.status}: ${row.sourceRow}`);
      continue;
    }

    const opportunityPayload = { ...row.proposedOpportunity, contactId };
    let opportunity;
    try {
      opportunity = await client.createOpportunity(opportunityPayload);
    } catch (error) {
      appendLedgerEvent(ledgerPath, { eventType: 'OPPORTUNITY_CREATION_FAILED', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, sourceRow: row.sourceRow, propertyFingerprint: row.propertyFingerprint, contactId, pipelineId: TARGET_CONFIG.pipelineId, stageId: TARGET_CONFIG.stageId, ownerId: TARGET_CONFIG.ownerId, result: 'FAILED', safeErrorSummary: error.message });
      results.push({ sourceRow: row.sourceRow, result: 'ROW_FAILED', reason: 'opportunity creation failed', contactId });
      if (strictStopOnFirstFailure) throw error;
      continue;
    }
    const opportunityId = opportunity.opportunity?.id || opportunity.id;
    appendLedgerEvent(ledgerPath, { eventType: 'OPPORTUNITY_CREATED', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, sourceRow: row.sourceRow, propertyFingerprint: row.propertyFingerprint, contactId, opportunityId, pipelineId: TARGET_CONFIG.pipelineId, stageId: TARGET_CONFIG.stageId, ownerId: TARGET_CONFIG.ownerId, result: 'CREATED' });
    const opportunityVerification = await verifyOpportunity(client, { opportunityId, contactId, ...opportunityPayload, stageId: TARGET_CONFIG.stageId, ownerId: TARGET_CONFIG.ownerId });
    appendLedgerEvent(ledgerPath, { eventType: opportunityVerification.status === 'VERIFIED' ? 'ROW_VERIFIED' : 'ROW_PARTIALLY_VERIFIED', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, sourceRow: row.sourceRow, propertyFingerprint: row.propertyFingerprint, contactId, opportunityId, pipelineId: TARGET_CONFIG.pipelineId, stageId: TARGET_CONFIG.stageId, ownerId: TARGET_CONFIG.ownerId, result: opportunityVerification.status, verificationStatus: opportunityVerification.status });
    results.push({ sourceRow: row.sourceRow, result: opportunityVerification.status, contactId, opportunityId });
    if (strictStopOnFirstFailure && opportunityVerification.status !== 'VERIFIED') throw new Error(`OPPORTUNITY_RECONCILIATION_${opportunityVerification.status}: ${row.sourceRow}`);
  }
  appendLedgerEvent(ledgerPath, { eventType: results.every(row => row.result === 'VERIFIED') ? 'IMPORT_COMPLETED' : 'IMPORT_PARTIAL', runId: manifest.runId, sourceChecksum: manifest.sourceChecksum, manifestChecksum: manifest.manifestChecksum, pipelineId: TARGET_CONFIG.pipelineId, stageId: TARGET_CONFIG.stageId, ownerId: TARGET_CONFIG.ownerId, result: results.every(row => row.result === 'VERIFIED') ? 'VERIFIED' : 'PARTIAL' });
  return { runId: manifest.runId, results };
}

function formatManifestSummary(manifest) {
  const ready = (manifest.counts[CLASSIFICATION.READY_CREATE_CONTACT_AND_OPPORTUNITY] || 0)
    + (manifest.counts[CLASSIFICATION.READY_REUSE_CONTACT_CREATE_OPPORTUNITY] || 0);
  const blocked = manifest.rowCount - ready;
  return [
    '*ATLAS GUARDED PREFLIGHT*',
    '',
    `System: ${manifest.system}`,
    `Schema version: ${manifest.schemaVersion}`,
    'Source status: LOCAL_PREPARED',
    `Mode: ${manifest.mode}`,
    `Rows checked: ${manifest.rowCount}`,
    `Ready rows: ${ready}`,
    `Blocked/existing rows: ${blocked}`,
    `Workflow safety: ${manifest.workflowSafetyStatus}`,
    manifest.globalAuthFailure ? `Auth gate: ${manifest.globalAuthFailure}` : `Auth gate: ${manifest.authProbe?.status || 'not run'}`,
    manifest.authProbe?.missingCustomFieldKeys?.length ? `Missing custom fields: ${manifest.authProbe.missingCustomFieldKeys.length}` : null,
    `Writes: ${manifest.writeCount}`,
    'Legacy dedupe: DISABLED',
    'Upload: NOT AUTHORIZED',
    `Target pipeline: ${manifest.targetConfig.pipelineId}`,
    `Target stage: ${manifest.targetConfig.stageName} (${manifest.targetConfig.stageId})`,
    `Target owner: ${manifest.targetConfig.ownerId}`,
    `Manifest checksum: ${manifest.manifestChecksum}`,
    '',
    'No GHL writes occurred. No Divinity CRM calls occurred.',
  ].filter(line => line !== null).join('\n');
}

function formatControlledBatch(manifest, count = 10) {
  const manifestCheck = validateGuardedManifest(manifest);
  if (!manifestCheck.ok) return ['*Controlled Atlas GHL Batch Preview*', '', 'Rows proposed: 0', `Blocked: ${manifestCheck.reason}`, 'This preview does not upload anything.'].join('\n');
  const readyRows = manifest.rows
    .filter(row => row.classification.startsWith('READY_'))
    .slice(0, count);
  const lines = ['*Controlled Atlas GHL Batch Preview*', '', `Rows proposed: ${readyRows.length}`, `Manifest checksum: ${manifest.manifestChecksum}`, ''];
  for (const row of readyRows) {
    lines.push(`Row ${row.sourceRow}: ${row.propertyAddress}`);
    lines.push(`Agent: ${row.listingAgent || '(missing)'}`);
    lines.push(`Contact: ${row.contactDecision}`);
    lines.push(`Opportunity: ${row.opportunityDecision}`);
    lines.push(`Target: ${row.target.pipelineId} / ${row.target.stageName}`);
    lines.push('');
  }
  lines.push('No execution approval is active. This preview does not upload anything.');
  return lines.join('\n');
}

async function handleConversationalIntent(intent, options = {}) {
  const normalized = String(intent || '').trim().toUpperCase();
  if (['IMPORT_TO_GHL', 'UPLOAD_FIRST_BATCH', 'RETRY_FAILED_ROWS'].includes(normalized)) {
    return { executed: false, reply: 'Atlas GHL import write intents are recognized but disabled. Run IMPORT_PREFLIGHT and request explicit owner approval first.' };
  }
  const manifest = await buildPreflightManifest({ ...options, limit: options.limit || (normalized === 'PREPARE_CONTROLLED_BATCH' ? 10 : options.limit) });
  if (normalized === 'PREPARE_CONTROLLED_BATCH') return { executed: false, manifest, reply: formatControlledBatch(manifest, 10) };
  if (normalized === 'SHOW_IMPORT_BLOCKERS') {
    const blockers = manifest.rows.filter(row => row.blockers.length > 0).slice(0, 20);
    return { executed: false, manifest, reply: blockers.map(row => `Row ${row.sourceRow}: ${row.classification} - ${row.blockers.join('; ')}`).join('\n') || 'No blockers in checked rows.' };
  }
  if (normalized === 'SHOW_MISSING_AGENT_DATA') {
    const rows = manifest.rows.filter(row => row.warnings.includes(CLASSIFICATION.MISSING_AGENT_PHONE) || !row.emailAvailable).slice(0, 20);
    return { executed: false, manifest, reply: rows.map(row => `Row ${row.sourceRow}: ${row.propertyAddress} phone=${row.phoneAvailable} email=${row.emailAvailable}`).join('\n') || 'No missing agent data in checked rows.' };
  }
  return { executed: false, manifest, reply: formatManifestSummary(manifest) };
}

module.exports = {
  CANONICAL_SYSTEM,
  WORKFLOW_SAFETY,
  LIFECYCLE_STATUS,
  TARGET_CONFIG,
  EXPECTED_HEADERS,
  DEFAULT_SOURCE_PATH,
  DEFAULT_LEDGER_PATH,
  DEFAULT_MANIFEST_DIR,
  CLASSIFICATION,
  CONTACT_IDENTITY_DECISION,
  EMAIL_AUTHORITY,
  CONTACT_ALLOWED_FIELDS,
  OPPORTUNITY_FIELD_KEYS,
  DEFAULT_FIELD_MAP,
  validateFieldMap,
  fieldMapChecksum,
  parseCsv,
  sha256,
  normalizeEmail,
  normalizePersonName,
  normalizePhone,
  phoneMatches,
  isGenericEmail,
  classifyEmailAuthority,
  canonicalContactIdentityDecision,
  decideContactIdentity,
  validateReusedContactReadback,
  normalizeAddressParts,
  buildPropertyFingerprint,
  displayPropertyAddress,
  lookupPropertyContact,
  buildContactPayload,
  assertContactPayloadSafe,
  buildOpportunityCustomFields,
  toApiCustomFields,
  buildImportBatchId,
  buildOpportunityPayload,
  buildRowNotes,
  buildPreflightManifest,
  validateApproval,
  executeApprovedImport,
  verifyContact,
  verifyOpportunity,
  appendLedgerEvent,
  readLedger,
  normalizeLegacySourceStatus,
  validateGuardedManifest,
  artifactHash,
  readyRows,
  writeReadyManifest,
  handleConversationalIntent,
  formatManifestSummary,
  formatControlledBatch,
};
