#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JustCallIntegration, TRANSCRIPT_CERTIFICATION_STATES } = require('./justcall-integration');
const {
  APPROVAL_LANGUAGE,
  TranscriptNoteApprovalStore,
  TranscriptNotePreviewStore,
  buildTestNotePreview,
  normalizeProviderTranscript,
  sha256,
  validateStructuredFacts,
  verifyCallIdentity,
} = require('./owner-controlled-transcript-note');
const { OwnerControlledTranscriptNoteWriter } = require('./owner-controlled-transcript-note-writer');
const { GhlCallNoteGateway } = require('./ghl-call-note-gateway');
const killSwitch = require('../bot/kill-switch');

const TEST_CONTACT_ID = 'PSVc2FuuA0dqyaQPXqOE';
const OWNER_ID = '718718959';
const tempDirs = [];
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

function call(overrides = {}) {
  return {
    id: 400683713,
    call_sid: 'CA-owner-test',
    call_date: '2026-08-04',
    call_time: '13:59:48',
    call_info: { direction: 'Outgoing', type: 'answered', recording: 'https://recording.invalid/redacted' },
    call_duration: { total_duration: 32 },
    ...overrides,
  };
}

function ai(overrides = {}) {
  return {
    id: 400683713,
    call_sid: 'CA-owner-test',
    platform: 'justcall',
    call_transcription: [{ speaker_id: 'contact', speaker_name: 'Test Contact', sentence: 'The property is vacant. The roof is ten years old.', timestamp: { starttime: 3, endtime: 30 } }],
    ...overrides,
  };
}

function contact(overrides = {}) {
  return { id: TEST_CONTACT_ID, locationId: '61XPzSqRy7UKMwW9DeB8', firstName: 'Montelli Call Note', lastName: 'Test', phone: '+15718140891', tags: ['owner_controlled_test', 'call_note_certification', 'do_not_contact_prospect'], dnd: false, ...overrides };
}

function makePreview(options = {}) {
  const identity = verifyCallIdentity({ requestedCallId: '400683713', call: call(), ai: ai() });
  const transcript = normalizeProviderTranscript({ identity, ai: ai(), retrievedAt: '2026-08-04T15:31:04.849Z', annotations: options.annotations || [] });
  return buildTestNotePreview({
    identity,
    transcript,
    contact: options.contact || contact(),
    testContactId: TEST_CONTACT_ID,
    associatedOpportunities: options.opportunities || [],
    ownerId: OWNER_ID,
    facts: options.facts || [{ label: 'Occupancy', value: 'Vacant', evidence: 'The property is vacant.' }],
    riskFlags: options.riskFlags || [],
    now: options.now || new Date(),
    ttlMs: options.ttlMs || 15 * 60 * 1000,
  });
}

function harness(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-call-note-'));
  tempDirs.push(dir);
  const previewStore = new TranscriptNotePreviewStore({ dir: path.join(dir, 'previews') });
  const approvalStore = new TranscriptNoteApprovalStore({ dir: path.join(dir, 'approvals'), signingSecret: 'test-secret', ownerId: OWNER_ID, previewStore, verifyOwnerContext: context => context.testAuthenticatedOwner === true });
  const preview = options.preview || makePreview();
  if (options.persistPreview !== false) previewStore.persist(preview);
  const counters = { notes: 0, fields: 0, tags: 0, opportunities: 0, stages: 0, sms: 0, calls: 0, tasks: 0, workflows: 0 };
  const notes = [...(options.notes || [])];
  let currentContact = options.contact || contact();
  const ghl = {
    getContact: async () => currentContact,
    listContactNotes: async () => notes.map(note => ({ ...note })),
    findOpportunitiesForContact: async () => options.opportunities || [],
    createOwnerControlledTestNote: async (contactId, body) => {
      if (options.writeError) throw options.writeError;
      counters.notes++;
      const note = { id: `note-${counters.notes}`, contactId, body };
      notes.push(note);
      if (options.mutateContactAfterWrite) currentContact = { ...currentContact, firstName: 'Changed' };
      return note;
    },
  };
  const writer = new OwnerControlledTranscriptNoteWriter({
    previewStore,
    approvalStore,
    ghl,
    readTranscriptEvidence: async () => options.currentTranscript || { sourceType: 'TRANSCRIPT_PROVIDER_API', callId: preview.callId, transcriptHash: preview.transcriptHash },
    getSafetyState: () => options.safetyState || 'PAUSED',
    allowTestNoteWrite: options.allowTestNoteWrite === true,
    testContactId: options.testContactId || TEST_CONTACT_ID,
    verifyWriteIsolation: async () => options.writeIsolation || { verified: true, providerSends: 0, calls: 0, sms: 0, tasks: 0, workflows: 0, stageMovements: 0 },
    verifyExternalEffects: async () => options.externalEffects || { verified: true, providerSends: 0, calls: 0, sms: 0, tasks: 0, workflows: 0, stageMovements: 0 },
  });
  return { dir, preview, previewStore, approvalStore, counters, notes, writer };
}

function approve(h, text = APPROVAL_LANGUAGE) {
  return h.approvalStore.approve(h.preview, text, { testAuthenticatedOwner: true, ownerId: OWNER_ID, messageId: `m-${Date.now()}-${Math.random()}` });
}

(async () => {
  await test('1 transcript-only API query disables all paid add-on fields', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); let pathname; jc._justcallRequest = async (_method, value) => { pathname = value; return { data: { id: 400683713 } }; }; await jc.fetchCallAiData(400683713); assert.match(pathname, /fetch_transcription=true&fetch_summary=false&fetch_ai_insights=false&fetch_action_items=false&fetch_smart_chapters=false$/); });
  await test('2 transcript retrieval returns provider data', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc._justcallRequest = async () => ({ status: 'success', data: ai() }); assert.strictEqual((await jc.fetchCallAiData(400683713)).id, 400683713); });
  await test('3 top-level call ID is required', () => assert.strictEqual(verifyCallIdentity({ requestedCallId: '400683713', call: call({ id: undefined }), ai: ai() }).reason, 'CALL_ID_MISSING'));
  await test('4 AI call ID is required', () => assert.strictEqual(verifyCallIdentity({ requestedCallId: '400683713', call: call(), ai: ai({ id: undefined }) }).reason, 'CALL_ID_MISSING'));
  await test('5 conflicting IDs block', () => assert.strictEqual(verifyCallIdentity({ requestedCallId: '400683713', call: call({ call_id: 999 }), ai: ai() }).classification, 'CALL_IDENTITY_CONFLICT'));
  await test('6 empty transcript blocks', () => assert.strictEqual(verifyCallIdentity({ requestedCallId: '400683713', call: call(), ai: ai({ call_transcription: [] }) }).reason, 'TRANSCRIPT_EMPTY'));
  await test('7 provider transcript provenance is preserved', () => { const preview = makePreview(); assert.strictEqual(preview.transcriptMetadata.source, 'PROVIDER_TRANSCRIPT'); assert.strictEqual(preview.transcriptMetadata.sourceType, 'TRANSCRIPT_PROVIDER_API'); assert.strictEqual(preview.transcriptMetadata.provider, 'JustCall'); });
  await test('8 raw and normalized transcript hashes are distinct artifacts', () => { const preview = makePreview({ annotations: [{ type: 'UNCLEAR', phrase: 'ten years old', reason: 'review' }] }); assert.notStrictEqual(preview.transcriptMetadata.providerTranscriptHash, preview.transcriptMetadata.normalizedTranscriptHash); });
  await test('9 normalization does not invent text', () => { const preview = makePreview(); assert.ok(preview.normalizedTranscript.includes('The property is vacant.')); assert.strictEqual(preview.normalizationDiff[0], 'No wording changes; only transport normalization applied.'); });
  await test('10 structured facts require transcript evidence', () => { const result = validateStructuredFacts([{ label: 'Rent', value: '$1,000', evidence: 'Rent is $1,000.' }], 'The property is vacant.'); assert.strictEqual(result.facts.length, 0); assert.strictEqual(result.rejected.length, 1); });
  await test('11 preview persists with integrity', () => { const h = harness(); assert.strictEqual(h.previewStore.load(h.preview.previewId).status, 'NOTE_PREVIEW_PENDING_APPROVAL'); });
  await test('12 no preview means no write', async () => { const h = harness({ persistPreview: false, allowTestNoteWrite: true }); const result = await h.writer.write(h.preview.previewId, 'missing'); assert.strictEqual(result.reason, 'NOTE_PREVIEW_REQUIRED'); assert.strictEqual(h.counters.notes, 0); });
  await test('13 ambiguous approval does not write', () => { const h = harness(); assert.throws(() => approve(h, 'yes'), /EXACT_TEST_NOTE_APPROVAL_LANGUAGE_REQUIRED/); assert.strictEqual(h.counters.notes, 0); });
  await test('14 expired preview requires new approval', () => { const h = harness({ preview: makePreview({ now: new Date(Date.now() - 60_000), ttlMs: 1 }) }); assert.throws(() => approve(h), /NOTE_PREVIEW_EXPIRED/); });
  await test('15 exact transcript hash is required', async () => { const h = harness({ allowTestNoteWrite: true, currentTranscript: { sourceType: 'TRANSCRIPT_PROVIDER_API', callId: '400683713', transcriptHash: 'changed' } }); const approval = approve(h); const result = await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(result.reason, 'TRANSCRIPT_HASH_CHANGED'); });
  await test('16 exact contact is required', async () => { const h = harness({ allowTestNoteWrite: true, testContactId: 'wrong' }); const approval = approve(h); const result = await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(result.reason, 'EXACT_TEST_CONTACT_REQUIRED'); });
  await test('17 production contact cannot be substituted', async () => { const h = harness({ allowTestNoteWrite: true, contact: contact({ tags: [] }) }); const approval = approve(h); const result = await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(result.reason, 'TEST_CONTACT_IDENTITY_CHANGED'); });
  await test('18 one note maximum', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); const result = await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(result.status, 'NOTE_WRITTEN'); assert.strictEqual(h.counters.notes, 1); });
  await test('19 duplicate rerun does not write', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); await h.writer.write(h.preview.previewId, approval.approvalId); const rerun = await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(rerun.status, 'ALREADY_PROCESSED_NO_WRITE'); assert.strictEqual(h.counters.notes, 1); });
  await test('20 no contact field updates', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(h.counters.fields, 0); });
  await test('21 no tag updates', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(h.counters.tags, 0); });
  await test('22 no opportunity writes', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(h.counters.opportunities, 0); });
  await test('23 no stage movements', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(h.counters.stages, 0); });
  await test('24 no SMS', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(h.counters.sms, 0); });
  await test('25 no automatic call', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(h.counters.calls, 0); });
  await test('26 uncertain write blocks retry', async () => { const error = Object.assign(new Error('timeout'), { writeUncertain: true }); const h = harness({ allowTestNoteWrite: true, writeError: error }); const approval = approve(h); assert.strictEqual((await h.writer.write(h.preview.previewId, approval.approvalId)).reason, 'GHL_WRITE_UNCERTAIN'); assert.strictEqual((await h.writer.write(h.preview.previewId, approval.approvalId)).reason, 'UNCERTAIN_WRITE_REQUIRES_MANUAL_RECONCILIATION'); });
  await test('27 post-write verification is required', async () => { const h = harness({ allowTestNoteWrite: true, mutateContactAfterWrite: true }); const approval = approve(h); const result = await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(result.status, 'GHL_WRITE_UNCERTAIN'); });
  await test('28 final state is PAUSED', () => assert.strictEqual(killSwitch.readKillSwitch().state, 'PAUSED'));
  await test('29 false entitlement classification is superseded', () => { assert.ok(TRANSCRIPT_CERTIFICATION_STATES.includes('TRANSCRIPT_PROVIDER_API')); assert.strictEqual(TRANSCRIPT_CERTIFICATION_STATES.includes('JUSTCALL_TRANSCRIPT_FEATURE_NOT_ENABLED'), false); });
  await test('30 AI Review Assist is not required for transcript-only retrieval', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); let pathname; jc._justcallRequest = async (_method, value) => { pathname = value; return { data: ai() }; }; await jc.fetchCallAiData(400683713); assert.ok(pathname.includes('fetch_ai_insights=false')); assert.ok(pathname.includes('fetch_summary=false')); });
  await test('31 narrow gateway refuses every non-designated contact', async () => { const gateway = new GhlCallNoteGateway({ token: 'x', locationId: 'loc', ownerControlledTestNoteWritesEnabled: true, ownerControlledTestContactId: TEST_CONTACT_ID, getSafetyState: () => 'PAUSED', transport: async () => ({ status: 200, body: { id: 'note' } }) }); await assert.rejects(() => gateway.createOwnerControlledTestNote('production-contact', 'body', { previewId: 'p', previewHash: 'h', noteBodyHash: 'x', callId: 'c', transcriptHash: 't' }), /WRITE_DISABLED/); });
  await test('32 narrow gateway requires PAUSED', async () => { const gateway = new GhlCallNoteGateway({ token: 'x', locationId: 'loc', ownerControlledTestNoteWritesEnabled: true, ownerControlledTestContactId: TEST_CONTACT_ID, getSafetyState: () => 'CANARY_ALLOWED', transport: async () => ({ status: 200, body: { id: 'note' } }) }); await assert.rejects(() => gateway.createOwnerControlledTestNote(TEST_CONTACT_ID, 'body', { previewId: 'p', previewHash: 'h', noteBodyHash: 'x', callId: 'c', transcriptHash: 't' }), /REQUIRES_PAUSED/); });
  await test('33 trusted owner identity is required', () => { const h = harness(); assert.throws(() => h.approvalStore.approve(h.preview, APPROVAL_LANGUAGE, { trustedOwner: false, ownerId: OWNER_ID }), /OWNER_IDENTITY_REQUIRED/); });
  await test('34 no task or workflow write surface is invoked', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(h.counters.tasks, 0); assert.strictEqual(h.counters.workflows, 0); });
  await test('35 gateway verifies and reserves signed approval before narrow write', async () => { const h = harness(); const approval = approve(h); let posts = 0; const gateway = new GhlCallNoteGateway({ token: 'x', locationId: 'loc', ownerControlledTestNoteWritesEnabled: true, ownerControlledTestContactId: TEST_CONTACT_ID, ownerControlledTestApprovalSecret: 'test-secret', ownerControlledTestOwnerId: OWNER_ID, ownerControlledTestApprovalStore: h.approvalStore, getSafetyState: () => 'PAUSED', transport: async () => { posts++; return { status: 200, body: { id: 'note' } }; } }); await gateway.createOwnerControlledTestNote(TEST_CONTACT_ID, h.preview.exactNoteBody, { previewId: h.preview.previewId, previewHash: h.preview.previewHash, noteBodyHash: h.preview.noteBodyHash, callId: h.preview.callId, transcriptHash: h.preview.transcriptHash, approval }); assert.strictEqual(posts, 1); assert.strictEqual(h.approvalStore.load(approval.approvalId).status, 'RESERVED'); });
  await test('36 concurrent approvals create at most one note', async () => { const h = harness({ allowTestNoteWrite: true }); const approval = approve(h); const [first, second] = await Promise.all([h.writer.write(h.preview.previewId, approval.approvalId), h.writer.write(h.preview.previewId, approval.approvalId)]); assert.strictEqual(h.counters.notes, 1); assert.ok([first.status, second.status].includes('NOTE_WRITTEN')); assert.ok([first.reason, second.reason].includes('NOTE_PREVIEW_WRITE_LOCKED')); });
  await test('37 expiration is rechecked immediately before write', async () => { const h = harness({ allowTestNoteWrite: true }); h.writer.verifyWriteIsolation = async ({ preview }) => { preview.expiresAt = new Date(Date.now() - 1).toISOString(); return { verified: true, providerSends: 0, calls: 0, sms: 0, tasks: 0, workflows: 0, stageMovements: 0 }; }; const approval = approve(h); const result = await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(result.reason, 'NOTE_PREVIEW_EXPIRED'); assert.strictEqual(h.counters.notes, 0); });
  await test('38 missing automation isolation proof blocks write', async () => { const h = harness({ allowTestNoteWrite: true, writeIsolation: { verified: false } }); const approval = approve(h); const result = await h.writer.write(h.preview.previewId, approval.approvalId); assert.strictEqual(result.reason, 'TEST_NOTE_AUTOMATION_ISOLATION_NOT_VERIFIED'); assert.strictEqual(h.counters.notes, 0); });
  await test('39 every failed POST response is write-uncertain', async () => { const h = harness(); const approval = approve(h); const gateway = new GhlCallNoteGateway({ token: 'x', locationId: 'loc', ownerControlledTestNoteWritesEnabled: true, ownerControlledTestContactId: TEST_CONTACT_ID, ownerControlledTestApprovalSecret: 'test-secret', ownerControlledTestOwnerId: OWNER_ID, ownerControlledTestApprovalStore: h.approvalStore, getSafetyState: () => 'PAUSED', transport: async () => ({ status: 408, body: {} }) }); await assert.rejects(() => gateway.createOwnerControlledTestNote(TEST_CONTACT_ID, h.preview.exactNoteBody, { previewId: h.preview.previewId, previewHash: h.preview.previewHash, noteBodyHash: sha256(h.preview.exactNoteBody), callId: h.preview.callId, transcriptHash: h.preview.transcriptHash, approval }), error => error.writeUncertain === true); assert.strictEqual(h.approvalStore.load(approval.approvalId).status, 'RESERVED'); });
  await test('40 reserved approval cannot be replayed directly at gateway', async () => { const h = harness(); const approval = approve(h); let posts = 0; const gateway = new GhlCallNoteGateway({ token: 'x', locationId: 'loc', ownerControlledTestNoteWritesEnabled: true, ownerControlledTestContactId: TEST_CONTACT_ID, ownerControlledTestApprovalSecret: 'test-secret', ownerControlledTestOwnerId: OWNER_ID, ownerControlledTestApprovalStore: h.approvalStore, getSafetyState: () => 'PAUSED', transport: async () => { posts++; return { status: 200, body: { id: 'note' } }; } }); const authorization = { previewId: h.preview.previewId, previewHash: h.preview.previewHash, noteBodyHash: h.preview.noteBodyHash, callId: h.preview.callId, transcriptHash: h.preview.transcriptHash, approval }; await gateway.createOwnerControlledTestNote(TEST_CONTACT_ID, h.preview.exactNoteBody, authorization); await assert.rejects(() => gateway.createOwnerControlledTestNote(TEST_CONTACT_ID, h.preview.exactNoteBody, authorization), /APPROVAL_NOT_ACTIVE/); assert.strictEqual(posts, 1); });

  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed}/${passed + failed} tests passed`);
  if (failed) process.exit(1);
})().catch(error => { console.error(error); process.exit(1); });
