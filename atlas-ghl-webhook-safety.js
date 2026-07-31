'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FIELD_MAP = require('./atlas-opportunity-field-map.json');

const TARGET = Object.freeze({
  locationId: '61XPzSqRy7UKMwW9DeB8',
  pipelineId: 'nSf3NXYVkt8X4PgW9aZ3',
  leadEnteredStageId: '7067148a-2ee8-4e5b-93c8-31e0253fea68',
  contactMadeStageId: '934c4c52-4b22-457a-8d10-55ab6600fdee',
  offerReadyStageId: '3da698e7-aba8-4d4a-b14b-7742f7b44ac7',
  ownerId: 'PGfXxlXCRXs3hXN3Gq7R',
});

const HANDLER_VERSION = 'atlas-webhook-ghl-only-v2';
const ATLAS_SOURCE = 'atlas_guarded_importer';
const TELEGRAM_OUTREACH_SOURCE = 'TELEGRAM_ATLAS_OUTREACH';
const TELEGRAM_STAGE_TRANSITION_ACK = 'ATLAS_TELEGRAM_STAGE_TRANSITION_ACKNOWLEDGED_NO_OUTREACH';
const SAFE_MARKER = /^[A-Za-z0-9_.:-]{1,160}$/;
const SAFE_GHL_ID = /^[A-Za-z0-9_-]{8,80}$/;
const SYNTHETIC_ID = /^(opp|contact|sim|synthetic|test|fake|dry)[_-]|synthetic|fixture|example/i;
const _telegramReceipts = new Map();

function fieldMapChecksum(fieldMap = FIELD_MAP) {
  return crypto.createHash('sha256').update(JSON.stringify({
    locationId: fieldMap.locationId,
    version: fieldMap.version,
    verifiedAt: fieldMap.verifiedAt,
    fields: fieldMap.fields,
  })).digest('hex');
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeWebhookPayload(req) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const query = req && req.query && typeof req.query === 'object' ? req.query : {};
  const payload = { ...query, ...body };
  const opportunityId = text(payload.opportunityId || payload.id || payload.opportunity_id);
  const stageId = text(payload.pipelineStageId || payload.stageId || payload.stage_id);
  return {
    ...payload,
    opportunityId,
    id: text(payload.id || opportunityId),
    locationId: text(payload.locationId || payload.location_id),
    pipelineId: text(payload.pipelineId || payload.pipeline_id),
    pipelineStageId: stageId,
    assignedTo: text(payload.assignedTo || payload.assigned_to),
    type: text(payload.type || payload.event || 'OpportunityStageUpdate'),
  };
}

function readCustomValues(entity, names) {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  const fields = entity && (entity.customFields || entity.customField || entity.customFieldsValues || entity.customFieldValues);
  const values = [];
  if (Array.isArray(fields)) {
    for (const field of fields) {
      const key = text(field.key || field.name || field.fieldKey || field.id).toLowerCase();
      if (wanted.has(key)) values.push(text(field.value ?? field.fieldValue ?? field.field_value));
    }
  }
  for (const name of names) {
    if (entity && entity[name] != null) values.push(text(entity[name]));
  }
  return values.filter(Boolean);
}

function singleMarkerValue(payloadValue, opportunity, names) {
  const values = [text(payloadValue), ...readCustomValues(opportunity, names)].filter(Boolean);
  const unique = [...new Set(values)];
  return { value: unique[0] || '', conflict: unique.length > 1 };
}

function validMarker(value) {
  return Boolean(value && SAFE_MARKER.test(value));
}

function validGhlId(value) {
  const textValue = text(value);
  return SAFE_GHL_ID.test(textValue) && !SYNTHETIC_ID.test(textValue);
}

function validIsoTimestamp(value) {
  const timestamp = text(value);
  return Boolean(timestamp && !Number.isNaN(Date.parse(timestamp)) && /^\d{4}-\d{2}-\d{2}T/.test(timestamp));
}

function extractImportMarkers(payload, opportunity) {
  const sourceMarker = singleMarkerValue(payload.source || opportunity?.source, opportunity, ['source', 'atlas_source', 'opportunity.atlas_source', FIELD_MAP.fields.atlasSource.id]);
  const batchMarker = singleMarkerValue(payload.atlas_import_batch_id || payload.batchId, opportunity, ['atlas_import_batch_id', 'atlasImportBatchId', 'opportunity.atlas_import_batch_id', FIELD_MAP.fields.importBatchId.id]);
  const rowMarker = singleMarkerValue(payload.atlas_source_row_id || payload.sourceRowId, opportunity, ['atlas_source_row_id', 'atlasSourceRowId', 'opportunity.atlas_source_row_id', FIELD_MAP.fields.sourceRowId.id]);
  const fingerprintMarker = singleMarkerValue(payload.atlas_property_fingerprint || payload.propertyFingerprint, opportunity, ['atlas_property_fingerprint', 'atlasPropertyFingerprint', 'opportunity.atlas_property_fingerprint', FIELD_MAP.fields.propertyFingerprint.id]);
  const source = sourceMarker.value;
  const batchId = batchMarker.value;
  const sourceRowId = rowMarker.value;
  const propertyFingerprint = fingerprintMarker.value;
  const sourceMatches = source === ATLAS_SOURCE;
  const markerValues = [batchId, sourceRowId, propertyFingerprint].filter(Boolean);
  const conflict = sourceMarker.conflict || batchMarker.conflict || rowMarker.conflict || fingerprintMarker.conflict;
  const malformed = conflict || markerValues.some(value => !validMarker(value)) || Boolean(source && /atlas/i.test(source) && !sourceMatches);
  const markedImport = !malformed && (sourceMatches || markerValues.length > 0);
  return { markedImport, malformed, conflict, source, batchId, sourceRowId, propertyFingerprint };
}

function extractTelegramOutreachMarkers(payload, opportunity) {
  const sourceMarker = singleMarkerValue(payload.source || opportunity?.source, opportunity, ['source', 'atlas_outreach_source', 'opportunity.atlas_outreach_source']);
  const sessionMarker = singleMarkerValue(payload.atlas_telegram_session_id || payload.telegramSessionId, opportunity, ['atlas_telegram_session_id', 'telegramSessionId', 'opportunity.atlas_telegram_session_id']);
  const planMarker = singleMarkerValue(payload.atlas_telegram_plan_hash || payload.telegramPlanHash, opportunity, ['atlas_telegram_plan_hash', 'telegramPlanHash', 'opportunity.atlas_telegram_plan_hash']);
  const actionMarker = singleMarkerValue(payload.atlas_telegram_action_id || payload.telegramActionId, opportunity, ['atlas_telegram_action_id', 'telegramActionId', 'opportunity.atlas_telegram_action_id']);
  const transitionMarker = singleMarkerValue(payload.atlas_telegram_transition_id || payload.telegramTransitionId, opportunity, ['atlas_telegram_transition_id', 'telegramTransitionId', 'opportunity.atlas_telegram_transition_id']);
  const idempotencyMarker = singleMarkerValue(payload.atlas_telegram_idempotency_key || payload.telegramIdempotencyKey, opportunity, ['atlas_telegram_idempotency_key', 'telegramIdempotencyKey', 'opportunity.atlas_telegram_idempotency_key']);
  const fromStageMarker = singleMarkerValue(payload.atlas_telegram_from_stage_id || payload.fromStageId, opportunity, ['atlas_telegram_from_stage_id', 'fromStageId', 'opportunity.atlas_telegram_from_stage_id']);
  const toStageMarker = singleMarkerValue(payload.atlas_telegram_to_stage_id || payload.toStageId, opportunity, ['atlas_telegram_to_stage_id', 'toStageId', 'opportunity.atlas_telegram_to_stage_id']);
  const timestampMarker = singleMarkerValue(payload.atlas_telegram_transition_at || payload.telegramTransitionAt, opportunity, ['atlas_telegram_transition_at', 'telegramTransitionAt', 'opportunity.atlas_telegram_transition_at']);
  const source = sourceMarker.value;
  const sessionId = sessionMarker.value;
  const planHash = planMarker.value;
  const actionId = actionMarker.value;
  const transitionId = transitionMarker.value;
  const idempotencyKey = idempotencyMarker.value;
  const fromStageId = fromStageMarker.value;
  const toStageId = toStageMarker.value;
  const transitionAt = timestampMarker.value;
  const markerValues = [sessionId, planHash, actionId, transitionId, idempotencyKey, fromStageId, toStageId, transitionAt].filter(Boolean);
  const conflict = sourceMarker.conflict || sessionMarker.conflict || planMarker.conflict || actionMarker.conflict || transitionMarker.conflict || idempotencyMarker.conflict || fromStageMarker.conflict || toStageMarker.conflict || timestampMarker.conflict;
  const malformed = conflict || markerValues.some(value => !validMarker(value)) || Boolean(source && /telegram|outreach|atlas/i.test(source) && source !== TELEGRAM_OUTREACH_SOURCE);
  const markedTelegramOutreach = Boolean(!malformed && source === TELEGRAM_OUTREACH_SOURCE && sessionId && planHash && actionId && transitionId && idempotencyKey && fromStageId && toStageId && transitionAt);
  return { markedTelegramOutreach, malformed, conflict, source, sessionId, planHash, actionId, transitionId, idempotencyKey, fromStageId, toStageId, transitionAt };
}

function validateTelegramOutreachTransition(payload, markers) {
  const errors = [];
  if (markers.source !== TELEGRAM_OUTREACH_SOURCE) errors.push('wrong origin');
  if (!markers.actionId) errors.push('action ID required');
  if (!markers.transitionId) errors.push('transition ID required');
  if (!markers.idempotencyKey) errors.push('idempotency key required');
  if (!validIsoTimestamp(markers.transitionAt)) errors.push('malformed timestamp');
  if (!validGhlId(payload.opportunityId)) errors.push('synthetic opportunity ID');
  if (!validGhlId(payload.contactId)) errors.push('synthetic contact ID');
  if (payload.locationId !== TARGET.locationId) errors.push('wrong location');
  if (payload.pipelineId !== TARGET.pipelineId) errors.push('wrong pipeline');
  if (markers.fromStageId !== TARGET.leadEnteredStageId) errors.push('wrong from stage');
  if (markers.toStageId !== TARGET.contactMadeStageId) errors.push('wrong to stage');
  if (payload.pipelineStageId && payload.pipelineStageId !== markers.toStageId) errors.push('wrong transition stage');
  return { ok: errors.length === 0, errors };
}

function acknowledgeTelegramOutreachTransition(payload, markers, options = {}) {
  const validation = validateTelegramOutreachTransition(payload, markers);
  if (!markers.markedTelegramOutreach || markers.malformed || !validation.ok) {
    return { status: 'REJECTED', ok: false, reason: markers.malformed ? 'malformed Telegram outreach marker' : validation.errors.join(', ') };
  }
  const contentHash = crypto.createHash('sha256').update(JSON.stringify({ opportunityId: payload.opportunityId, contactId: payload.contactId, locationId: payload.locationId, pipelineId: payload.pipelineId, actionId: markers.actionId, transitionId: markers.transitionId, fromStageId: markers.fromStageId, toStageId: markers.toStageId, transitionAt: markers.transitionAt })).digest('hex');
  const receipts = options.receipts || _telegramReceipts;
  const existing = receipts.get(markers.idempotencyKey);
  if (existing && existing !== contentHash) return { status: 'REJECTED', ok: false, reason: 'duplicate conflicting delivery' };
  receipts.set(markers.idempotencyKey, contentHash);
  return { status: TELEGRAM_STAGE_TRANSITION_ACK, ok: true, duplicate: Boolean(existing), idempotencyKey: markers.idempotencyKey, actionId: markers.actionId, transitionId: markers.transitionId, sends: 0, writes: 0, stageMovements: 0 };
}

function validateAgainstTarget(endpoint, payload, opportunity) {
  const errors = [];
  const effectiveLocationId = text(payload.locationId || opportunity?.locationId);
  const effectivePipelineId = text(payload.pipelineId || opportunity?.pipelineId);
  const effectiveStageId = text(payload.pipelineStageId || opportunity?.pipelineStageId);
  const effectiveOwnerId = text(payload.assignedTo || opportunity?.assignedTo || opportunity?.ownerId);

  if (!payload.opportunityId) errors.push('opportunityId required');
  if (!effectiveLocationId || effectiveLocationId !== TARGET.locationId) errors.push('wrong location');
  if (!effectivePipelineId || effectivePipelineId !== TARGET.pipelineId) errors.push('wrong pipeline');
  if (effectiveOwnerId && effectiveOwnerId !== TARGET.ownerId) errors.push('wrong owner');
  if (endpoint === 'lead-entered' && (!effectiveStageId || effectiveStageId !== TARGET.leadEnteredStageId)) errors.push('wrong lead-entered stage');
  if (endpoint === 'offer-ready' && effectiveStageId && effectiveStageId !== TARGET.offerReadyStageId) errors.push('wrong offer-ready stage');

  return {
    ok: errors.length === 0,
    errors,
    locationId: effectiveLocationId,
    pipelineId: effectivePipelineId,
    stageId: effectiveStageId,
    ownerId: effectiveOwnerId,
  };
}

function buildReceiptKey({ locationId, opportunityId, eventType, stageId, endpoint }) {
  return ['ghl', locationId || TARGET.locationId, opportunityId, eventType || endpoint || 'event', stageId || 'none'].join(':');
}

function redact(value) {
  return JSON.parse(JSON.stringify(value || {}, (key, val) => {
    if (/token|secret|authorization|password|cookie|api[_-]?key/i.test(key)) return '[redacted]';
    if (typeof val === 'string' && /^Bearer\s+/i.test(val)) return 'Bearer [redacted]';
    return val;
  }));
}

class FileDiagnosticLogger {
  constructor(filePath) {
    this.filePath = filePath || null;
  }

  enabled() {
    return Boolean(this.filePath);
  }

  write(record) {
    if (!this.enabled()) return false;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, JSON.stringify(redact(record)) + '\n');
      return true;
    } catch (error) {
      console.log(`[Atlas webhook] diagnostic log unavailable: ${error.message}`);
      return false;
    }
  }
}

function createDiagnosticLogger(env = process.env) {
  return new FileDiagnosticLogger(env.ATLAS_WEBHOOK_DIAGNOSTIC_FILE || null);
}

function buildAuditReceipt({ endpoint, payload, validation, markers }) {
  return redact({
    handlerVersion: HANDLER_VERSION,
    endpoint,
    receiptKey: buildReceiptKey({
      locationId: validation.locationId,
      opportunityId: payload.opportunityId,
      eventType: payload.type,
      stageId: validation.stageId || payload.pipelineStageId,
      endpoint,
    }),
    opportunityId: payload.opportunityId,
    locationId: validation.locationId,
    pipelineId: validation.pipelineId,
    stageId: validation.stageId,
    ownerId: validation.ownerId,
    atlas: {
      markedImport: markers.markedImport,
      markedTelegramOutreach: markers.markedTelegramOutreach || false,
      batchId: markers.batchId || null,
      sourceRowId: markers.sourceRowId || null,
      propertyFingerprint: markers.propertyFingerprint || null,
      telegramSessionId: markers.sessionId || null,
      telegramActionId: markers.actionId || null,
      telegramTransitionId: markers.transitionId || null,
      telegramIdempotencyKey: markers.idempotencyKey || null,
      source: markers.source || null,
    },
  });
}

module.exports = {
  TARGET,
  HANDLER_VERSION,
  ATLAS_SOURCE,
  TELEGRAM_OUTREACH_SOURCE,
  TELEGRAM_STAGE_TRANSITION_ACK,
  FIELD_MAP,
  fieldMapChecksum,
  normalizeWebhookPayload,
  extractImportMarkers,
  extractTelegramOutreachMarkers,
  validateTelegramOutreachTransition,
  acknowledgeTelegramOutreachTransition,
  validGhlId,
  validIsoTimestamp,
  validateAgainstTarget,
  buildReceiptKey,
  buildAuditReceipt,
  redact,
  FileDiagnosticLogger,
  createDiagnosticLogger,
};
