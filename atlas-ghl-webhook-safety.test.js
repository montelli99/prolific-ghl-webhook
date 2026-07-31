const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const safety = require('./atlas-ghl-webhook-safety');

const root = __dirname;
const helperSource = fs.readFileSync(path.join(root, 'atlas-ghl-webhook-safety.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function leadEnteredPayload(extra = {}) {
  return {
    body: {
      type: 'OpportunityStageUpdate',
      opportunityId: 'opp_123',
      locationId: safety.TARGET.locationId,
      pipelineId: safety.TARGET.pipelineId,
      pipelineStageId: safety.TARGET.leadEnteredStageId,
      assignedTo: safety.TARGET.ownerId,
      source: safety.ATLAS_SOURCE,
      atlas_import_batch_id: 'batch-1',
      atlas_source_row_id: 'row-1',
      atlas_property_fingerprint: 'fp-1',
      ...extra,
    },
  };
}

function markedClassification(req = leadEnteredPayload(), opportunity = null) {
  const payload = safety.normalizeWebhookPayload(req);
  const markers = safety.extractImportMarkers(payload, opportunity);
  const validation = safety.validateAgainstTarget('lead-entered', payload, opportunity);
  return { payload, markers, validation };
}

function telegramPayload(extra = {}) {
  return safety.normalizeWebhookPayload(leadEnteredPayload({
    source: safety.TELEGRAM_OUTREACH_SOURCE,
    atlas_import_batch_id: '',
    atlas_source_row_id: '',
    atlas_property_fingerprint: '',
    opportunityId: 'realOpp123456789',
    contactId: 'realContact123456',
    pipelineStageId: safety.TARGET.contactMadeStageId || '934c4c52-4b22-457a-8d10-55ab6600fdee',
    atlas_telegram_session_id: 'session_123',
    atlas_telegram_plan_hash: 'abc123def456',
    atlas_telegram_action_id: 'action_123',
    atlas_telegram_transition_id: 'transition_123',
    atlas_telegram_idempotency_key: 'tgoutreach_123',
    atlas_telegram_from_stage_id: safety.TARGET.leadEnteredStageId,
    atlas_telegram_to_stage_id: '934c4c52-4b22-457a-8d10-55ab6600fdee',
    atlas_telegram_transition_at: '2026-07-31T16:00:00.000Z',
    ...extra,
  }));
}

test('Atlas helper has no Neon import or DATABASE_URL dependency', () => {
  assert.doesNotMatch(helperSource, /@neondatabase|\bNeon\b|\bneon\b|DATABASE_URL|postgres|CREATE TABLE|\bsql\b/i);
});

test('Atlas webhook path does not select database-backed processing', () => {
  const atlasImportPath = indexSource.slice(indexSource.indexOf("const {\n  normalizeWebhookPayload"), indexSource.indexOf('// ── Background: enrich lead'));
  assert.doesNotMatch(atlasImportPath, /DATABASE_URL|@neondatabase|\bNeon\b|\bneon\b|claim\(|complete\(|fail\(|idempotency/i);
});

test('marked lead-entered event validates exact target and marker', () => {
  const { markers, validation } = markedClassification();
  assert.equal(validation.ok, true);
  assert.equal(markers.markedImport, true);
  assert.equal(markers.malformed, false);
});

test('wrong location is rejected', () => {
  const { validation } = markedClassification(leadEnteredPayload({ locationId: 'wrong-location' }));
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(','), /wrong location/);
});

test('wrong pipeline is rejected', () => {
  const { validation } = markedClassification(leadEnteredPayload({ pipelineId: 'wrong-pipeline' }));
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(','), /wrong pipeline/);
});

test('wrong lead-entered stage is rejected', () => {
  const { validation } = markedClassification(leadEnteredPayload({ pipelineStageId: 'wrong-stage' }));
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(','), /wrong lead-entered stage/);
});

test('missing Atlas marker does not enter safe import branch', () => {
  const { markers } = markedClassification(leadEnteredPayload({
    source: 'manual',
    atlas_import_batch_id: '',
    atlas_source_row_id: '',
    atlas_property_fingerprint: '',
  }));
  assert.equal(markers.markedImport, false);
});

test('live GHL opportunity marker overrides incomplete payload', () => {
  const payload = safety.normalizeWebhookPayload(leadEnteredPayload({
    source: '',
    atlas_import_batch_id: '',
    atlas_source_row_id: '',
    atlas_property_fingerprint: '',
  }));
  const markers = safety.extractImportMarkers(payload, {
    source: safety.ATLAS_SOURCE,
    customFields: [{ key: 'atlas_property_fingerprint', field_value: 'fp-live' }],
  });
  assert.equal(markers.markedImport, true);
  assert.equal(markers.propertyFingerprint, 'fp-live');
});

test('live GHL ID field marker shape is detected', () => {
  const payload = safety.normalizeWebhookPayload(leadEnteredPayload({
    source: '',
    atlas_import_batch_id: '',
    atlas_source_row_id: '',
    atlas_property_fingerprint: '',
  }));
  const markers = safety.extractImportMarkers(payload, {
    customFields: [
      { id: 'k198PybZpHpw7xvJyShQ', fieldValue: safety.ATLAS_SOURCE },
      { id: '7Qk4VP3Uvi7W3NViBHxM', fieldValue: 'atlas-20260729' },
      { id: 'bNUaLqPpKB2IY7nMx1Gh', fieldValue: 'import-ready:2' },
      { id: 'FP9PrUN1rudLi4IEw1mo', fieldValue: 'propwire:525624' },
    ],
  });
  assert.equal(markers.markedImport, true);
  assert.equal(markers.sourceRowId, 'import-ready:2');
});

test('conflicting live and payload markers fail closed', () => {
  const payload = safety.normalizeWebhookPayload(leadEnteredPayload({ atlas_source_row_id: 'import-ready:2' }));
  const markers = safety.extractImportMarkers(payload, {
    customFields: [{ id: 'bNUaLqPpKB2IY7nMx1Gh', fieldValue: 'import-ready:3' }],
  });
  assert.equal(markers.markedImport, false);
  assert.equal(markers.malformed, true);
  assert.equal(markers.conflict, true);
});

test('malformed marker is rejected', () => {
  const { markers } = markedClassification(leadEnteredPayload({ atlas_source_row_id: '../bad' }));
  assert.equal(markers.markedImport, false);
  assert.equal(markers.malformed, true);
});

test('payload secrets are redacted', () => {
  assert.deepEqual(safety.redact({ authorization: 'Bearer abc', nested: { apiKey: 'secret' } }), {
    authorization: '[redacted]',
    nested: { apiKey: '[redacted]' },
  });
});

test('diagnostic file helper is disabled by default and not required in production', () => {
  const logger = safety.createDiagnosticLogger({});
  assert.equal(logger.enabled(), false);
  assert.equal(logger.write({ ok: true }), false);
});

test('marked lead-entered branch returns before note, contact, opportunity, stage, SMS, email, and legacy mutations', () => {
  const route = indexSource.slice(indexSource.indexOf("app.post('/webhook/ghl/lead-entered'"), indexSource.indexOf("app.post('/webhook/ghl/offer-ready'"));
  assert.match(route, /if \(atlas\.safeImportAcked\) return;/);
  const markedBranchPrefix = route.slice(0, route.indexOf('if (atlas.safeImportAcked) return;') + 'if (atlas.safeImportAcked) return;'.length);
  assert.doesNotMatch(markedBranchPrefix, /contacts\/|opportunities\/|advanceStage|createLead|updateLead|sms|email|logEvent\(/i);
});

test('marked generic branch bypasses legacy dashboard mutation and external mutation calls', () => {
  const route = indexSource.slice(indexSource.indexOf("app.post('/webhook/ghl'"), indexSource.indexOf('// ── GHL workflow-only hooks'));
  const markedBranch = route.slice(route.indexOf('if (importMarkers.markedImport)'), route.indexOf('const stageMap = loadStageMap'));
  assert.match(markedBranch, /return;/);
  assert.doesNotMatch(markedBranch, /createLead|advanceStage|updateLead|fetchGhlContactAndEnrich|contacts\/|opportunities\/|sms|email|logEvent\(/i);
});

test('repeated marked receipt classification is harmless and deterministic', () => {
  const first = markedClassification();
  const second = markedClassification();
  assert.deepEqual(first.markers, second.markers);
  assert.deepEqual(first.validation, second.validation);
});

test('both marked routes classify the same logical lead-entered event as safe without storage', () => {
  const { payload, markers, validation } = markedClassification();
  const audit = safety.buildAuditReceipt({ endpoint: 'lead-entered', payload, validation, markers });
  const genericAudit = safety.buildAuditReceipt({ endpoint: 'generic', payload, validation, markers });
  assert.equal(audit.atlas.markedImport, true);
  assert.equal(genericAudit.atlas.markedImport, true);
  assert.equal(audit.receiptKey, genericAudit.receiptKey);
});

test('ordinary non-Atlas lead-entered behavior still contains existing note path after safe return', () => {
  const route = indexSource.slice(indexSource.indexOf("app.post('/webhook/ghl/lead-entered'"), indexSource.indexOf("app.post('/webhook/ghl/offer-ready'"));
  const ordinaryPath = route.slice(route.indexOf('if (atlas.safeImportAcked) return;'));
  assert.match(ordinaryPath, /contacts\/\$\{contactId\}\/notes/);
});

test('offer-ready is not permanently suppressed for Atlas-origin opportunities', () => {
  const route = indexSource.slice(indexSource.indexOf("app.post('/webhook/ghl/offer-ready'"), indexSource.indexOf('// ── Background: enrich lead'));
  assert.doesNotMatch(route, /safeImportAcked/);
  assert.match(route, /contacts\/\$\{contactId\}\/notes/);
});

test('legacy contact importer is retired instead of writing property-specific contact values', () => {
  const importer = fs.readFileSync(path.join(root, 'import-ghl-leads.js'), 'utf8');
  assert.match(importer, /RETIRED_HARD_STOP/);
  assert.doesNotMatch(importer, /property_address|arv|equity|mls_listing_price|https\.request/);
});

test('Telegram Atlas outreach marker is detected separately from import marker', () => {
  const payload = telegramPayload();
  const importMarkers = safety.extractImportMarkers(payload, null);
  const outreachMarkers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.equal(importMarkers.markedImport, false);
  assert.equal(outreachMarkers.markedTelegramOutreach, true);
});

test('Telegram Atlas outreach marker requires full idempotency context', () => {
  const payload = telegramPayload({ atlas_telegram_idempotency_key: '' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.equal(markers.markedTelegramOutreach, false);
  assert.equal(markers.malformed, false);
});

test('Telegram Atlas outreach marker fails closed on conflicting live and payload values', () => {
  const payload = telegramPayload();
  const markers = safety.extractTelegramOutreachMarkers(payload, {
    customFields: [{ key: 'atlas_telegram_action_id', fieldValue: 'action_456' }],
  });
  assert.equal(markers.markedTelegramOutreach, false);
  assert.equal(markers.malformed, true);
  assert.equal(markers.conflict, true);
});

test('Telegram Atlas outreach marker is included in redacted audit receipt', () => {
  const payload = telegramPayload();
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  const validation = safety.validateAgainstTarget('lead-entered', payload, null);
  const receipt = safety.buildAuditReceipt({ endpoint: 'lead-entered', payload, validation, markers });
  assert.equal(receipt.atlas.markedTelegramOutreach, true);
  assert.equal(receipt.atlas.telegramActionId, 'action_123');
});

test('Telegram marker fields have correct primitive types', () => {
  const markers = safety.extractTelegramOutreachMarkers(telegramPayload(), null);
  assert.equal(typeof markers.markedTelegramOutreach, 'boolean');
  assert.equal(typeof markers.malformed, 'boolean');
  assert.equal(typeof markers.conflict, 'boolean');
  assert.equal(typeof markers.actionId, 'string');
  assert.equal(typeof markers.transitionId, 'string');
});

test('missing Telegram action ID fails closed', () => {
  const payload = telegramPayload({ atlas_telegram_action_id: '' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /action ID required/);
});

test('missing Telegram transition ID fails closed', () => {
  const payload = telegramPayload({ atlas_telegram_transition_id: '' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /transition ID required/);
});

test('missing Telegram origin fails closed', () => {
  const payload = telegramPayload({ source: '' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /wrong origin/);
});

test('wrong Telegram origin fails closed', () => {
  const payload = telegramPayload({ source: 'TELEGRAM_DIVINITY_OUTREACH' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.equal(safety.acknowledgeTelegramOutreachTransition(payload, markers).status, 'REJECTED');
});

test('wrong Telegram location fails closed', () => {
  const payload = telegramPayload({ locationId: 'wrong-location' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /wrong location/);
});

test('wrong Telegram pipeline fails closed', () => {
  const payload = telegramPayload({ pipelineId: 'wrong-pipeline' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /wrong pipeline/);
});

test('wrong Telegram from stage fails closed', () => {
  const payload = telegramPayload({ atlas_telegram_from_stage_id: 'wrong-from-stage' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /wrong from stage/);
});

test('wrong Telegram to stage fails closed', () => {
  const payload = telegramPayload({ atlas_telegram_to_stage_id: 'wrong-to-stage' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /wrong to stage/);
});

test('duplicate identical Telegram delivery is idempotent', () => {
  const payload = telegramPayload({ atlas_telegram_idempotency_key: 'tgoutreach_duplicate_same' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  const receipts = new Map();
  assert.equal(safety.acknowledgeTelegramOutreachTransition(payload, markers, { receipts }).duplicate, false);
  assert.equal(safety.acknowledgeTelegramOutreachTransition(payload, markers, { receipts }).duplicate, true);
});

test('duplicate conflicting Telegram delivery fails closed', () => {
  const first = telegramPayload({ atlas_telegram_idempotency_key: 'tgoutreach_duplicate_conflict' });
  const second = telegramPayload({ atlas_telegram_idempotency_key: 'tgoutreach_duplicate_conflict', contactId: 'realContactChanged' });
  const receipts = new Map();
  safety.acknowledgeTelegramOutreachTransition(first, safety.extractTelegramOutreachMarkers(first, null), { receipts });
  assert.match(safety.acknowledgeTelegramOutreachTransition(second, safety.extractTelegramOutreachMarkers(second, null), { receipts }).reason, /duplicate conflicting/);
});

test('Telegram marker mixed with import marker fails closed as import malformed', () => {
  const payload = telegramPayload({ atlas_import_batch_id: 'batch-1', atlas_source_row_id: 'row-1' });
  assert.equal(safety.extractImportMarkers(payload, null).malformed, true);
});

test('malformed Telegram timestamp fails closed', () => {
  const payload = telegramPayload({ atlas_telegram_transition_at: 'not-a-date' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /malformed timestamp/);
});

test('synthetic Telegram opportunity ID fails closed', () => {
  const payload = telegramPayload({ opportunityId: 'opp-a1' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /synthetic opportunity ID/);
});

test('synthetic Telegram contact ID fails closed', () => {
  const payload = telegramPayload({ contactId: 'contact-a1' });
  const markers = safety.extractTelegramOutreachMarkers(payload, null);
  assert.match(safety.acknowledgeTelegramOutreachTransition(payload, markers).reason, /synthetic contact ID/);
});

test('Telegram acknowledgment performs no outreach, writes, or stage movement', () => {
  const payload = telegramPayload({ atlas_telegram_idempotency_key: 'tgoutreach_zero_effects' });
  const ack = safety.acknowledgeTelegramOutreachTransition(payload, safety.extractTelegramOutreachMarkers(payload, null), { receipts: new Map() });
  assert.equal(ack.status, safety.TELEGRAM_STAGE_TRANSITION_ACK);
  assert.equal(ack.sends, 0);
  assert.equal(ack.writes, 0);
  assert.equal(ack.stageMovements, 0);
});

test('generic webhook Telegram marker branch returns before provider and mutation paths', () => {
  const route = indexSource.slice(indexSource.indexOf("app.post('/webhook/ghl'"), indexSource.indexOf('// ── GHL workflow-only hooks'));
  const markerBranch = route.slice(route.indexOf('const telegramMarkers'), route.indexOf('// Always acknowledge immediately'));
  assert.match(markerBranch, /acknowledgeTelegramOutreachTransition/);
  assert.doesNotMatch(markerBranch, /JustCall|sendSMS|contacts\/|opportunities\/|advanceStage|createLead|updateLead|draftLoiEmail|offer_ready/i);
});

test('Telegram marker branch contains no Divinity processing', () => {
  const route = indexSource.slice(indexSource.indexOf("app.post('/webhook/ghl'"), indexSource.indexOf('// Always acknowledge immediately'));
  assert.doesNotMatch(route, /DIVINITY|divinitycrm|Divinity/);
});
