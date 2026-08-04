#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JustCallGhlCallNoteProcessor } = require('./justcall-ghl-call-note-processor');
const { CallNoteJournal } = require('./call-note-journal');
const { matchCallToGhl } = require('./call-contact-opportunity-matcher');
const { normalizeCallRecord, normalizeTranscript, validateExtractedFacts, maskPhone, buildTranscriptEvidence, hashRecordingBytes, buildCallNote } = require('./call-note-schema');
const { JustCallIntegration, TRANSCRIPT_CERTIFICATION_STATES } = require('./justcall-integration');
const { CallNoteOperatorService, parseCallNoteCommand } = require('./call-note-operator-service');
const { GhlCallNoteGateway, classifyOpportunity } = require('./ghl-call-note-gateway');
const { CallNoteApprovalStore } = require('./call-note-approval-store');
const killSwitch = require('../bot/kill-switch');

let passed = 0;
let failed = 0;
const tempDirs = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function makeCall(overrides = {}) {
  return {
    id: 'jc-100',
    direction: 'outgoing',
    justcall_number: '+15715550100',
    contact_number: '+13175550101',
    status: 'completed',
    completed_at: '2026-08-04T15:00:00.000Z',
    duration: 180,
    locationId: 'loc-1',
    meaningfulConversation: true,
    intendedPersonReached: true,
    participantRole: 'agent',
    attemptNumber: 1,
    ...overrides,
  };
}

function transcript(callId = 'jc-100', text = 'The roof is five years old.') {
  return { callId, transcript_status: 'available', call_transcription: [{ speaker: 'contact', text }] };
}

function contact(overrides = {}) {
  return { id: 'contact-1', locationId: 'loc-1', phone: '+13175550101', name: 'Alex Agent', role: 'agent', tags: [], ...overrides };
}

function opportunity(overrides = {}) {
  return { id: 'opp-1', contactId: 'contact-1', pipelineId: 'pipe-1', name: '123 Main St', propertyAddress: '123 Main St', recordClass: 'PRODUCTION', stageName: 'Lead Entered', ...overrides };
}

function completeFacts() {
  return {
    roofAge: { field: 'roofAge', value: 'five years old', evidence: 'roof is five years old' },
    hvacAge: { field: 'hvacAge', value: 'three years old', evidence: 'hvac is three years old' },
    occupancy: { field: 'occupancy', value: 'vacant', evidence: 'property is vacant' },
    utilities: { field: 'utilities', value: 'on', evidence: 'utilities are on' },
    listingFeedback: { field: 'listingFeedback', value: 'needs paint', evidence: 'feedback was that it needs paint' },
  };
}

function completeTranscript() {
  return 'The roof is five years old. The HVAC is three years old. The property is vacant. The utilities are on. The feedback was that it needs paint.';
}

function harness(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-note-cert-'));
  tempDirs.push(dir);
  const notes = options.notes || [];
  const counters = { creates: 0, providerSends: 0, calls: 0, sms: 0, stages: 0 };
  const callRecord = options.callRecord || makeCall();
  const aiData = options.aiData || transcript(callRecord.id || callRecord.call_id, options.transcriptText || 'The roof is five years old.');
  const justcall = {
    fetchCallDetails: async () => callRecord,
    fetchCallAiData: async () => aiData,
    listCalls: async () => ({ data: options.calls || [callRecord] }),
  };
  const ghl = {
    findContactsByPhone: async () => options.contacts || [contact()],
    findOpportunitiesByContacts: async () => options.opportunities || [opportunity()],
    findContactNotes: async (_contactId, marker) => notes.filter(note => String(note.body).includes(marker)),
    createContactNote: async (contactId, body) => {
      counters.creates++;
      if (options.beforeCreate) await options.beforeCreate();
      if (options.writeError) throw options.writeError;
      const note = { id: `note-${counters.creates}`, contactId, body };
      notes.push(note);
      return note;
    },
  };
  const processor = new JustCallGhlCallNoteProcessor({
    justcall,
    ghl,
    journal: new CallNoteJournal({ dir }),
    locationId: 'loc-1',
    pipelineId: 'pipe-1',
    allowNoteWrites: options.allowNoteWrites === true,
    autoLogStructuredNotes: options.autoLogStructuredNotes === true,
    getSafetyState: () => options.safetyState || 'CANARY_ALLOWED',
    approvalStore: new CallNoteApprovalStore({ dir: path.join(dir, 'approvals'), ownerUserId: 'owner', chatId: 'chat', topicId: 'topic', signingSecret: 'test-only-approval-secret' }),
  });
  return { dir, notes, counters, justcall, ghl, processor, approvalStore: processor.approvalStore, callRecord, aiData };
}

async function inspect(h, options = {}) {
  const result = await h.processor.inspectCall(String(h.callRecord.id || h.callRecord.call_id), { callRecord: h.callRecord, aiData: h.aiData, ...options });
  result._approvalStore = h.approvalStore;
  return result;
}

function approval(prepared) {
  const record = prepared._approvalStore.createApproval(prepared, { authenticatedOwner: true, ownerUserId: 'owner', chatId: 'chat', topicId: 'topic', messageId: `message-${Date.now()}-${Math.random()}` });
  return { approvalId: record.approvalId };
}

(async () => {
  await test('1 completed call detected', async () => assert.strictEqual((await inspect(harness())).call.callId, 'jc-100'));
  await test('2 correct JustCall call ID retained', async () => assert.strictEqual((await inspect(harness())).note.marker, 'justcall_call_id:jc-100'));
  await test('3 exact contact match works', () => assert.strictEqual(matchCallToGhl({ call: normalizeCallRecord(makeCall()), contacts: [contact()], opportunities: [opportunity()], locationId: 'loc-1', pipelineId: 'pipe-1' }).contactId, 'contact-1'));
  await test('4 exact opportunity match works', () => assert.strictEqual(matchCallToGhl({ call: normalizeCallRecord(makeCall()), contacts: [contact()], opportunities: [opportunity()], locationId: 'loc-1', pipelineId: 'pipe-1' }).opportunityId, 'opp-1'));
  await test('5 multiple contacts block', async () => assert.strictEqual((await inspect(harness({ contacts: [contact(), contact({ id: 'contact-2' })] }))).reason, 'MULTIPLE_CONTACTS'));
  await test('6 multiple opportunities require review', async () => assert.strictEqual((await inspect(harness({ opportunities: [opportunity(), opportunity({ id: 'opp-2' })] }))).reason, 'MATCHED_CONTACT_MULTIPLE_OPPORTUNITIES'));
  await test('7 non-production opportunity excluded', async () => assert.strictEqual((await inspect(harness({ opportunities: [opportunity({ name: 'QA Test', recordClass: 'LEGACY_TEST' })] }))).reason, 'TEST_OR_NON_PRODUCTION'));
  await test('8 transcript pending does not fabricate notes', async () => { const r = await inspect(harness({ aiData: { callId: 'jc-100', transcript_status: 'pending' } })); assert.strictEqual(r.status, 'TRANSCRIPT_PENDING'); assert.strictEqual(r.note, undefined); });
  await test('9 transcript unavailable does not fabricate notes', async () => { const r = await inspect(harness({ aiData: { callId: 'jc-100', transcript_status: 'unavailable' } })); assert.strictEqual(r.status, 'TRANSCRIPT_UNAVAILABLE'); assert.strictEqual(r.note, undefined); });
  await test('10 no-answer is not contact made', async () => { const h = harness({ callRecord: makeCall({ status: 'no_answer', meaningfulConversation: false, intendedPersonReached: false }), aiData: { callId: 'jc-100', transcript_status: 'pending' } }); const r = await inspect(h); assert.strictEqual(r.conversation.meaningful, false); assert.strictEqual(r.nextAction.actionType, 'CALL_ATTEMPT_2'); });
  await test('11 voicemail is not meaningful contact', async () => { const r = await inspect(harness({ callRecord: makeCall({ disposition: 'voicemail', meaningfulConversation: false, intendedPersonReached: false }), aiData: { callId: 'jc-100', transcript_status: 'pending' } })); assert.strictEqual(r.conversation.outcome, 'VOICEMAIL'); assert.strictEqual(r.conversation.meaningful, false); });
  await test('12 automated attendant is not meaningful contact', async () => { const r = await inspect(harness({ callRecord: makeCall({ meaningfulConversation: false, intendedPersonReached: false }), transcriptText: 'Automated attendant: press 1 for sales.' })); assert.strictEqual(r.conversation.outcome, 'AUTOMATED_ATTENDANT'); });
  await test('13 wrong person is not meaningful contact', async () => { const r = await inspect(harness({ callRecord: makeCall({ meaningfulConversation: false, intendedPersonReached: false }), transcriptText: 'You have the wrong person.' })); assert.strictEqual(r.conversation.outcome, 'WRONG_PARTY'); });
  await test('14 inbound SMS is not an answered call', async () => { const h = harness({ callRecord: makeCall({ type: 'sms.incoming', direction: 'incoming', status: 'delivered', completed_at: null, meaningfulConversation: false }) }); const r = await inspect(h); assert.strictEqual(r.reason, 'CALL_NOT_COMPLETED'); });
  await test('15 transcript maps to correct call', () => assert.strictEqual(normalizeTranscript('jc-100', transcript('jc-999')).reason, 'TRANSCRIPT_CALL_ID_MISMATCH'));
  await test('16 structured note contains required sections', async () => { const body = (await inspect(harness())).note.body; for (const heading of ['CALL SUMMARY', 'CONTACT OUTCOME', 'PROPERTY FACTS COLLECTED', 'MISSING REQUIRED INFORMATION', 'COMMITMENTS AND FOLLOW-UPS', 'COURSE-GUIDED NEXT ACTION', 'TRANSCRIPT/RECORDING PROVENANCE']) assert.ok(body.includes(heading), heading); });
  await test('17 missing facts remain missing', async () => assert.ok((await inspect(harness())).extraction.missing.includes('hvacAge')));
  await test('18 no invented roof HVAC or rent values', () => { const r = validateExtractedFacts({ roofAge: { field: 'roofAge', value: '5', evidence: 'not in transcript' }, hvacAge: '3', monthlyRent: { field: 'monthlyRent', value: 1000, evidence: 'also absent' } }, 'No property facts discussed.', ['roofAge', 'hvacAge']); assert.deepStrictEqual(r.facts, {}); assert.deepStrictEqual(r.missing, ['roofAge', 'hvacAge']); });
  await test('19 call ID marker is written', async () => assert.ok((await inspect(harness())).note.body.includes('justcall_call_id:jc-100')));
  await test('20 duplicate webhook creates no second note', async () => { const h = harness({ allowNoteWrites: true }); const p = await inspect(h); const a = approval(p); await h.processor.writeApprovedNote(p, a); const r = await h.processor.writeApprovedNote(p, a); assert.strictEqual(r.status, 'DUPLICATE_ALREADY_PROCESSED'); assert.strictEqual(h.counters.creates, 1); });
  await test('21 polling reconciliation creates no duplicate', async () => { const h = harness({ allowNoteWrites: true }); const p = await inspect(h); await h.processor.writeApprovedNote(p, approval(p)); const r = await h.processor.reconcileRecentCalls({ aiData: h.aiData, contacts: [contact()], opportunities: [opportunity()] }); assert.strictEqual(r.results[0].status, 'DUPLICATE_ALREADY_PROCESSED'); assert.strictEqual(h.counters.creates, 1); });
  await test('22 restart creates no duplicate', async () => { const h = harness({ allowNoteWrites: true }); const p = await inspect(h); await h.processor.writeApprovedNote(p, approval(p)); const restarted = new JustCallGhlCallNoteProcessor({ justcall: h.justcall, ghl: h.ghl, journal: new CallNoteJournal({ dir: h.dir }), locationId: 'loc-1', pipelineId: 'pipe-1', allowNoteWrites: true }); const r = await restarted.inspectCall('jc-100', { callRecord: h.callRecord, aiData: h.aiData, contacts: [contact()], opportunities: [opportunity()] }); assert.strictEqual(r.status, 'DUPLICATE_ALREADY_PROCESSED'); });
  await test('23 uncertain write is not blindly retried', async () => { const error = Object.assign(new Error('timeout'), { writeUncertain: true }); const h = harness({ allowNoteWrites: true, writeError: error }); const p = await inspect(h); const a = approval(p); assert.strictEqual((await h.processor.writeApprovedNote(p, a)).status, 'PARTIAL_WRITE_UNCERTAIN'); assert.strictEqual((await h.processor.writeApprovedNote(p, a)).status, 'PARTIAL_WRITE_UNCERTAIN'); assert.strictEqual(h.counters.creates, 1); });
  await test('24 native activity and structured note are distinguished', async () => { const r = await inspect(harness()); assert.strictEqual(r.nativeActivityRole, 'NATIVE_ACTIVITY'); assert.strictEqual(r.structuredNoteRole, 'STRUCTURED_KAYLA_NOTE'); });
  await test('25 action engine receives verified outcome', async () => assert.strictEqual((await inspect(harness())).operationalOutcome, 'ANSWERED_INCOMPLETE_QUALIFICATION'));
  await test('26 attempt one produces SECOND_CALL_DUE', async () => { const r = await inspect(harness({ callRecord: makeCall({ status: 'no_answer', meaningfulConversation: false, intendedPersonReached: false, attemptNumber: 1 }), aiData: { callId: 'jc-100', transcript_status: 'pending' } })); assert.strictEqual(r.nextAction.actionType, 'CALL_ATTEMPT_2'); });
  await test('27 attempt two produces VOICE_MEMO_AND_NOA_DUE', async () => { const r = await inspect(harness({ callRecord: makeCall({ status: 'no_answer', meaningfulConversation: false, intendedPersonReached: false, attemptNumber: 2 }), aiData: { callId: 'jc-100', transcript_status: 'pending' } })); assert.strictEqual(r.nextAction.actionType, 'RECORD_VOICE_MEMO'); assert.strictEqual(r.nextAction.afterCompletion.includes('NOA'), true); });
  await test('28 answered incomplete produces INFORMATION_MISSING', async () => assert.strictEqual((await inspect(harness())).nextAction.actionType, 'COLLECT_MISSING_CALL_INFORMATION'));
  await test('29 answered complete produces CONTACT_MADE_ACTIONS_PENDING', async () => { const h = harness({ transcriptText: completeTranscript() }); const r = await inspect(h, { extractedFacts: completeFacts() }); assert.strictEqual(r.nextAction.actionType, 'WRITE_GHL_NOTES'); });
  await test('30 note write does not automatically move stage', async () => { const h = harness({ allowNoteWrites: true }); const p = await inspect(h); const r = await h.processor.writeApprovedNote(p, approval(p)); assert.strictEqual(r.productionEffects.stageMovements, 0); assert.strictEqual(h.counters.stages, 0); });
  await test('31 stage move requires separate approval', async () => assert.ok((await inspect(harness())).nextAction.remainsBlocked.includes('STAGE_MOVEMENT')));
  await test('32 correct GHL contact receives the note', async () => { const h = harness({ allowNoteWrites: true }); const p = await inspect(h); await h.processor.writeApprovedNote(p, approval(p)); assert.strictEqual(h.notes[0].contactId, 'contact-1'); });
  await test('33 wrong contact receives zero writes', async () => { const h = harness({ allowNoteWrites: true, contacts: [] }); const p = await inspect(h); const r = await h.processor.writeApprovedNote(p, {}); assert.strictEqual(r.reason, 'VERIFIED_PREPARED_NOTE_REQUIRED'); assert.strictEqual(h.counters.creates, 0); });
  await test('34 raw transcript is not dumped unless policy allows it', async () => { const secretPhrase = 'unique raw transcript phrase'; const r = await inspect(harness({ transcriptText: secretPhrase })); assert.strictEqual(r.note.body.includes(secretPhrase), false); assert.ok(r.note.body.includes('Raw transcript omitted by policy')); });
  await test('35 general logs mask phone numbers', async () => { const r = await inspect(harness()); assert.ok(r.note.body.includes(maskPhone('+13175550101'))); assert.strictEqual(r.note.body.includes('+13175550101'), false); });
  await test('36 no provider sends', async () => assert.strictEqual((await inspect(harness())).productionEffects.providerSends, 0));
  await test('37 no outbound calls', async () => assert.strictEqual((await inspect(harness())).productionEffects.callsPlaced, 0));
  await test('38 no SMS', async () => assert.strictEqual((await inspect(harness())).productionEffects.smsSent, 0));
  await test('39 no contact card', async () => assert.strictEqual((await inspect(harness())).productionEffects.contactCards, 0));
  await test('40 no CCC', async () => assert.strictEqual((await inspect(harness())).productionEffects.ccc, 0));
  await test('41 no group handoff', async () => assert.strictEqual((await inspect(harness())).productionEffects.handoffs, 0));
  await test('42 no offer generation', async () => assert.strictEqual((await inspect(harness())).productionEffects.offers, 0));
  await test('43 no stage movement during certification', async () => assert.strictEqual((await inspect(harness())).productionEffects.stageMovements, 0));
  await test('44 final PAUSED', () => assert.strictEqual(killSwitch.readKillSwitch().state, 'PAUSED'));
  await test('45 stale signed webhook is rejected', () => { const jc = new JustCallIntegration({ apiSecret: 'secret', webhookUrl: 'https://example.test/hook', now: () => new Date('2026-08-04T12:00:00Z') }); const timestamp = '2026-08-04T11:00:00Z'; const value = `secret|${encodeURIComponent('https://example.test/hook')}|call.completed|${timestamp}`; const signature = crypto.createHmac('sha256', 'secret').update(value).digest('hex'); assert.strictEqual(jc.verifyWebhookSignature({ 'x-justcall-signature': signature, 'x-justcall-request-timestamp': timestamp, 'x-justcall-signature-version': 'v1' }, { type: 'call.completed' }), false); });
  await test('46 every natural call-note command parses', () => { for (const text of ['Show me the notes from my last call.', 'Did my last JustCall call sync to GHL?', 'Which calls are waiting for transcripts?', 'Which completed calls need note review?', 'Prepare the GHL notes from this call.', 'Write these approved notes to GHL.', 'What information did I miss?', 'What does Kayla say I should do next?', 'Did this call qualify for Contact Made?', 'Show the proposed stage move.', "Reconcile today's JustCall calls with GHL.", 'Which calls failed to log?', 'Show duplicate or uncertain call records.']) assert.ok(parseCallNoteCommand(text), text); });
  await test('47 actual JustCall nested call shape normalizes', () => { const call = normalizeCallRecord({ id: 7, contact_number: '+13175550101', justcall_number: '+15715550100', call_date: '2026-08-04', call_time: '12:00:00', call_info: { direction: 'Outgoing', type: 'answered', disposition: 'Lead', recording: 'https://recording.invalid' }, call_duration: { conversation_time: 42 } }); assert.strictEqual(call.direction, 'OUTBOUND'); assert.strictEqual(call.status, 'ANSWERED'); assert.strictEqual(call.durationSeconds, 42); assert.strictEqual(call.recordingStatus, 'AVAILABLE'); });
  await test('48 actual JustCall AI segment shape normalizes', () => { const result = normalizeTranscript('7', { id: 7, call_transcription: [{ speaker_id: 1, sentence: 'Verified sentence', timestamp: { starttime: 3 } }] }); assert.strictEqual(result.status, 'TRANSCRIPT_AVAILABLE'); assert.strictEqual(result.segments[0].text, 'Verified sentence'); assert.strictEqual(result.segments[0].start, 3); });
  await test('49 exact note approval is required', async () => { const h = harness({ allowNoteWrites: true }); const prepared = await inspect(h); const result = await h.processor.writeApprovedNote(prepared, { approvalId: 'not-a-real-approval' }); assert.strictEqual(result.reason, 'EXACT_NOTE_APPROVAL_REQUIRED'); assert.strictEqual(h.counters.creates, 0); });
  await test('50 GHL gateway refuses writes by default', async () => { const gateway = new GhlCallNoteGateway({ token: 'test', locationId: 'loc-1', pipelineId: 'pipe-1', transport: async () => ({ status: 200, body: {} }) }); await assert.rejects(() => gateway.createContactNote('contact-1', 'note'), /WRITES_DISABLED/); });
  await test('51 journal integrity tampering fails closed', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-note-journal-integrity-')); tempDirs.push(dir); const journal = new CallNoteJournal({ dir }); const key = 'justcall_call_note:loc:c:o:call'; journal.transition(key, 'FAILED_MANUAL_REVIEW', { callId: 'call' }); const file = journal.recordPath(key); const record = JSON.parse(fs.readFileSync(file, 'utf8')); fs.writeFileSync(file, JSON.stringify({ ...record, state: 'NOTE_WRITTEN' })); assert.strictEqual(journal.load(key).reason, 'JOURNAL_INTEGRITY_FAILED'); });
  await test('52 official JustCall events are allowlisted', () => { const jc = new JustCallIntegration(); assert.ok(jc.whitelistedEvents.has('call.completed')); assert.ok(jc.whitelistedEvents.has('call.updated')); assert.ok(jc.whitelistedEvents.has('jc.call_ai_generated')); });
  await test('53 PAUSED blocks the processor write boundary', async () => { const h = harness({ allowNoteWrites: true, safetyState: 'PAUSED' }); const prepared = await inspect(h); const result = await h.processor.writeApprovedNote(prepared, approval(prepared)); assert.strictEqual(result.reason, 'KILL_SWITCH_BLOCKS_GHL_NOTE_WRITE'); assert.strictEqual(h.counters.creates, 0); });
  await test('54 approved note artifact cannot be mutated', async () => { const h = harness({ allowNoteWrites: true }); const prepared = await inspect(h); const exactApproval = approval(prepared); prepared.note.body += '\nMUTATED'; const result = await h.processor.writeApprovedNote(prepared, exactApproval); assert.strictEqual(result.reason, 'EXACT_NOTE_APPROVAL_REQUIRED'); assert.strictEqual(h.counters.creates, 0); });
  await test('55 concurrent workers create exactly one note', async () => { const h = harness({ allowNoteWrites: true }); const prepared = await inspect(h); const a = approval(prepared); const results = await Promise.all([h.processor.writeApprovedNote(prepared, a), h.processor.writeApprovedNote(prepared, a)]); assert.strictEqual(h.counters.creates, 1); assert.ok(results.some(result => result.status === 'NOTE_WRITTEN')); assert.ok(results.some(result => ['PROCESSING', 'DUPLICATE_ALREADY_PROCESSED'].includes(result.status))); });
  await test('56 interrupted processing becomes uncertain without retry', async () => { const h = harness({ allowNoteWrites: true }); const prepared = await inspect(h); h.processor.journal.transition(prepared.key, 'PROCESSING', { callId: prepared.call.callId }); const result = await h.processor.writeApprovedNote(prepared, approval(prepared)); assert.strictEqual(result.status, 'PARTIAL_WRITE_UNCERTAIN'); assert.strictEqual(h.counters.creates, 0); });
  await test('57 answered call mentioning failed HVAC stays answered', async () => { const h = harness({ transcriptText: 'The HVAC failed last winter.' }); const result = await inspect(h); assert.strictEqual(result.conversation.outcome, 'ANSWERED_MEANINGFUL'); });
  await test('58 arbitrary value cannot borrow unrelated transcript evidence', () => { const result = validateExtractedFacts({ roofAge: { field: 'roofAge', value: 'five years', evidence: 'the roof is old' } }, 'The roof is old.', ['roofAge']); assert.deepStrictEqual(result.facts, {}); assert.deepStrictEqual(result.missing, ['roofAge']); });
  await test('59 legacy AI handler performs zero GHL writes', async () => { let writes = 0; const jc = new JustCallIntegration({ addNote: async () => { writes++; }, findOpportunityByCallId: async () => ({ opportunityId: 'opp-1' }), whitelistedEvents: ['jc.call_ai_generated'] }); const result = await jc.handleCallAiReport({ type: 'jc.call_ai_generated', data: { id: 'safe-legacy', justcall_ai: { call_transcription: [{ sentence: 'secret' }] } } }); assert.strictEqual(writes, 0); assert.ok(result.action.includes('no GHL write')); assert.strictEqual(result.preparedNote.includes('secret'), false); });
  await test('60 runtime fails closed without read credentials', () => { const runtime = require('./call-note-runtime').createCallNoteRuntime({}); assert.strictEqual(runtime.processor, null); assert.strictEqual(runtime.readiness.justcallReadConfigured, false); assert.strictEqual(runtime.readiness.ghlReadConfigured, false); });
  await test('61 stale process lock is recovered safely', async () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-note-stale-lock-')); tempDirs.push(dir); const journal = new CallNoteJournal({ dir, lockStaleMs: 1 }); const key = 'justcall_call_note:loc:c:o:stale'; fs.mkdirSync(dir, { recursive: true }); const lock = `${journal.recordPath(key)}.lock`; fs.writeFileSync(lock, JSON.stringify({ pid: 99999999, createdAt: '2000-01-01T00:00:00Z' })); const old = new Date('2000-01-01T00:00:00Z'); fs.utimesSync(lock, old, old); let ran = false; await journal.withLock(key, async () => { ran = true; }); assert.strictEqual(ran, true); assert.strictEqual(fs.existsSync(lock), false); });
  await test('62 cross-field evidence cannot fabricate a roof age', () => { const result = validateExtractedFacts({ roofAge: { field: 'roofAge', value: 'five years old', evidence: 'The HVAC is five years old; the roof age is unknown' } }, 'The HVAC is five years old; the roof age is unknown.', ['roofAge']); assert.deepStrictEqual(result.facts, {}); });
  await test('63 all authoritative Atlas markers are required for production', () => { const ids = require('./ghl-authoritative-pipeline-hydrator').ATLAS_FIELD_IDS; const field = id => ({ id, fieldValue: 'present' }); assert.strictEqual(classifyOpportunity({ name: '123 Main', customFields: [field(ids.sourceRowId)] }), 'UNKNOWN'); assert.strictEqual(classifyOpportunity({ name: '123 Main', customFields: [field(ids.sourceRowId), field(ids.importBatchId), field(ids.atlasSource), field(ids.propertyFingerprint)] }), 'PRODUCTION'); });
  await test('64 reconciliation cannot overwrite an in-flight PROCESSING state', async () => { let release; const gate = new Promise(resolve => { release = resolve; }); const h = harness({ allowNoteWrites: true, beforeCreate: async () => gate }); const prepared = await inspect(h); const writePromise = h.processor.writeApprovedNote(prepared, approval(prepared)); await new Promise(resolve => setTimeout(resolve, 10)); const reconcilePromise = h.processor.reconcileRecentCalls({ aiData: h.aiData, contacts: [contact()], opportunities: [opportunity()] }); release(); const [write] = await Promise.all([writePromise, reconcilePromise]); assert.strictEqual(write.status, 'NOTE_WRITTEN'); assert.strictEqual(h.processor.journal.load(prepared.key).state, 'NOTE_WRITTEN'); });
  await test('65 evidence binding requires value and field in one clause', () => { const result = validateExtractedFacts({ roofAge: { field: 'roofAge', value: 'five years old', evidence: 'The roof leaks. The HVAC is five years old.' } }, 'The roof leaks. The HVAC is five years old.', ['roofAge']); assert.deepStrictEqual(result.facts, {}); });
  await test('66 empty Atlas fields do not classify as production', () => { const ids = require('./ghl-authoritative-pipeline-hydrator').ATLAS_FIELD_IDS; const empty = id => ({ id, fieldValue: '' }); assert.strictEqual(classifyOpportunity({ name: '123 Main', customFields: [empty(ids.sourceRowId), empty(ids.importBatchId), empty(ids.atlasSource), empty(ids.propertyFingerprint)] }), 'UNKNOWN'); });
  await test('67 approval requires authenticated owner context and HMAC secret', async () => { const h = harness({ allowNoteWrites: true }); const prepared = await inspect(h); assert.throws(() => h.approvalStore.createApproval(prepared, { ownerUserId: 'owner', chatId: 'chat', topicId: 'topic' }), /CONTEXT_DENIED/); const unsigned = new CallNoteApprovalStore({ dir: path.join(h.dir, 'unsigned'), ownerUserId: 'owner', chatId: 'chat', topicId: 'topic' }); assert.throws(() => unsigned.createApproval(prepared, { authenticatedOwner: true, ownerUserId: 'owner', chatId: 'chat', topicId: 'topic' }), /SIGNING_SECRET_REQUIRED/); });
  await test('68 post-write body mismatch remains uncertain', async () => { const h = harness({ allowNoteWrites: true }); h.ghl.createContactNote = async (contactId, body) => { h.counters.creates++; h.notes.push({ id: 'truncated', contactId, body: `${body.split('\n')[0]}\njustcall_call_id:jc-100` }); return { id: 'truncated' }; }; const prepared = await inspect(h); const result = await h.processor.writeApprovedNote(prepared, approval(prepared)); assert.strictEqual(result.status, 'PARTIAL_WRITE_UNCERTAIN'); assert.strictEqual(h.processor.journal.load(prepared.key).state, 'PARTIAL_WRITE_UNCERTAIN'); });
  await test('69 conjunction boundary prevents cross-field fabrication', () => { const result = validateExtractedFacts({ roofAge: { field: 'roofAge', value: 'five years old', evidence: 'The roof leaks and the HVAC is five years old' } }, 'The roof leaks and the HVAC is five years old', ['roofAge']); assert.deepStrictEqual(result.facts, {}); });
  await test('70 explicit write command requires validated owner and signed approval', async () => { const h = harness({ allowNoteWrites: true }); const prepared = await inspect(h); const preparedWrite = { key: prepared.key, call: { callId: prepared.call.callId, attemptNumber: 1 }, match: { status: prepared.match.status, contactId: prepared.match.contactId, opportunityId: prepared.match.opportunityId, propertyAddress: prepared.match.propertyAddress, currentStage: prepared.match.currentStage, contactName: prepared.match.contactName, contactRole: prepared.match.contactRole, opportunity: {} }, note: prepared.note, approvalScope: prepared.approvalScope, conversation: { meaningful: prepared.conversation.meaningful }, extraction: { missing: prepared.extraction.missing } }; h.processor.journal.transition(prepared.key, 'FAILED_MANUAL_REVIEW', { callId: prepared.call.callId, preparedWrite, notePreview: prepared.note.body }); const service = new CallNoteOperatorService({ journal: h.processor.journal, processor: h.processor, approvalStore: h.approvalStore }); const denied = await service.handle('Write these approved notes to GHL.', { telegramUserId: 'owner', chatId: 'chat', sourceTopicId: 'topic' }); assert.match(denied.reply, /authenticated owner context is missing/); const written = await service.handle('Write these approved notes to GHL.', { ownerContextVerified: true, telegramUserId: 'owner', chatId: 'chat', sourceTopicId: 'topic', messageId: 'message-70' }); assert.strictEqual(written.result.status, 'NOTE_WRITTEN'); assert.strictEqual(h.counters.creates, 1); });
  await test('71 exact call ID is matched during transcript polling', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713, call_info: { recording: 'available' } }); jc.fetchCallAiData = async () => ({ id: 400683713, call_transcription: [{ sentence: 'test' }] }); const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0] }); assert.strictEqual(result.callId, '400683713'); assert.strictEqual(result.state, 'PROVIDER_TRANSCRIPT_AVAILABLE'); });
  await test('72 wrong call ID is rejected', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 999 }); const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0] }); assert.strictEqual(result.reason, 'CALL_ID_MISMATCH'); });
  await test('73 recording availability does not imply transcript availability', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713, call_info: { recording: 'available' } }); jc.fetchCallAiData = async () => { throw Object.assign(new Error('not found'), { status: 404 }); }; const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0], sleep: async () => {} }); assert.strictEqual(result.recordingAvailable, true); assert.strictEqual(result.state, 'PROVIDER_TRANSCRIPT_NOT_GENERATED'); });
  await test('74 generic AUTH_FAILED is reported accurately', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713 }); jc.fetchCallAiData = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); }; const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0] }); assert.strictEqual(result.state, 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE'); assert.strictEqual(result.reason, 'RESOURCE_ACCESS_OR_VALIDATION_DENIED'); });
  await test('75 missing transcript produces no note', async () => { const result = await inspect(harness({ aiData: { callId: 'jc-100', transcript_status: 'pending' } })); assert.strictEqual(result.note, undefined); assert.strictEqual(result.productionEffects.ghlWrites, 0); });
  await test('76 delayed transcript polling is bounded', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713 }); let reads = 0; jc.fetchCallAiData = async () => { reads++; throw Object.assign(new Error('not found'), { status: 404 }); }; const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0, 1, 1], sleep: async () => {} }); assert.strictEqual(reads, 3); assert.strictEqual(result.checked.length, 3); assert.strictEqual(result.reason, 'BOUNDED_POLLING_EXHAUSTED'); });
  await test('77 provider and system transcripts are distinct', () => { const provider = buildTranscriptEvidence({ source: 'PROVIDER', callId: 400683713, text: 'provider text' }); const recordingEvidence = hashRecordingBytes(400683713, Buffer.from('audio')); const system = buildTranscriptEvidence({ source: 'SYSTEM', callId: 400683713, text: 'system text', recordingEvidence }); assert.strictEqual(provider.state, 'PROVIDER_TRANSCRIPT_AVAILABLE'); assert.strictEqual(system.state, 'SYSTEM_TRANSCRIPT_AVAILABLE'); assert.notStrictEqual(provider.evidenceHash, system.evidenceHash); });
  await test('78 owner summary is not labeled transcript', () => { const evidence = buildTranscriptEvidence({ source: 'OWNER', callId: 400683713, text: 'owner summary' }); assert.strictEqual(evidence.state, 'OWNER_SUMMARY_AVAILABLE'); assert.strictEqual(evidence.source, 'OWNER'); });
  await test('79 no transcript means no automatic GHL write', async () => { const h = harness({ allowNoteWrites: true, aiData: { callId: 'jc-100', transcript_status: 'pending' } }); const result = await inspect(h); assert.strictEqual(result.note, undefined); assert.strictEqual(h.counters.creates, 0); });
  await test('80 fallback evidence remains preview-only until explicit approval', () => { const recordingEvidence = hashRecordingBytes(400683713, Buffer.from('audio')); const evidence = buildTranscriptEvidence({ source: 'SYSTEM', callId: 400683713, text: 'authorized recording transcription', recordingEvidence }); assert.strictEqual(evidence.state, 'SYSTEM_TRANSCRIPT_AVAILABLE'); assert.notStrictEqual(evidence.state, 'NOTE_WRITTEN'); });
  await test('81 recording hash is tied to call ID', () => { const first = hashRecordingBytes(400683713, Buffer.from('audio')); const second = hashRecordingBytes(400683714, Buffer.from('audio')); assert.strictEqual(first.recordingSha256, second.recordingSha256); assert.notStrictEqual(first.bindingHash, second.bindingHash); });
  await test('82 duplicate note remains blocked', async () => { const h = harness({ allowNoteWrites: true }); const prepared = await inspect(h); const a = approval(prepared); await h.processor.writeApprovedNote(prepared, a); const duplicate = await h.processor.writeApprovedNote(prepared, a); assert.strictEqual(duplicate.status, 'DUPLICATE_ALREADY_PROCESSED'); assert.strictEqual(h.counters.creates, 1); });
  await test('83 follow-up certification moves no stage', async () => assert.strictEqual((await inspect(harness())).productionEffects.stageMovements, 0));
  await test('84 follow-up certification sends no SMS', async () => assert.strictEqual((await inspect(harness())).productionEffects.smsSent, 0));
  await test('85 follow-up certification places no automatic call', async () => assert.strictEqual((await inspect(harness())).productionEffects.callsPlaced, 0));
  await test('86 follow-up certification ends PAUSED', () => { assert.deepStrictEqual(TRANSCRIPT_CERTIFICATION_STATES, ['CALL_FOUND', 'RECORDING_FOUND', 'TRANSCRIPT_VISIBLE_IN_UI', 'TRANSCRIPT_PROVIDER_API', 'TRANSCRIPT_BROWSER_READ', 'TRANSCRIPT_SYSTEM_GENERATED']); assert.strictEqual(killSwitch.readKillSwitch().state, 'PAUSED'); });
  await test('87 documented transcript-only Calls AI endpoint is used', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); const paths = []; jc._justcallRequest = async (_method, pathname) => { paths.push(pathname); return { data: { id: 400683713 } }; }; await jc.fetchCallDetails(400683713); await jc.fetchCallAiData(400683713); assert.deepStrictEqual(paths, ['/v2.1/calls/400683713', '/v2.1/calls_ai/400683713?fetch_transcription=true&fetch_summary=false&fetch_ai_insights=false&fetch_action_items=false&fetch_smart_chapters=false']); });
  await test('88 unexpected transcript-only entitlement block does not claim transcript absence', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713, call_info: { recording: 'available' } }); jc.fetchCallAiData = async () => { throw Object.assign(new Error('Access requires the AI Review Assist add-on'), { status: 403 }); }; const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0, 1], sleep: async () => {} }); assert.strictEqual(result.state, 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE'); assert.strictEqual(result.reason, 'CALLS_AI_TRANSCRIPT_ACCESS_DENIED'); assert.strictEqual(result.endpointClass, 'CALLS_AI_API'); assert.deepStrictEqual(result.certifications, ['CALL_FOUND', 'RECORDING_FOUND']); assert.strictEqual(result.checked.length, 1); });
  await test('89 mismatched AI response call ID is rejected', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713 }); jc.fetchCallAiData = async () => ({ id: 999, call_transcription: [{ sentence: 'wrong call' }] }); const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0] }); assert.strictEqual(result.reason, 'AI_CALL_ID_MISMATCH'); });
  await test('90 system transcript requires exact recording-to-call binding', () => { const wrong = hashRecordingBytes(999, Buffer.from('audio')); assert.throws(() => buildTranscriptEvidence({ source: 'SYSTEM', callId: 400683713, text: 'system text', recordingEvidence: wrong }), /RECORDING_BINDING_REQUIRED/); });
  await test('91 unapproved fallback evidence cannot label a final note', async () => { const result = await inspect(harness()); const recordingEvidence = hashRecordingBytes(result.call.callId, Buffer.from('audio')); const systemEvidence = buildTranscriptEvidence({ source: 'SYSTEM', callId: result.call.callId, text: result.transcript.text, recordingEvidence }); assert.throws(() => buildCallNote({ call: result.call, match: result.match, transcript: result.transcript, transcriptEvidence: systemEvidence, conversation: result.conversation, extraction: result.extraction, nextAction: result.nextAction, summary: 'System-generated test summary.' }), /FALLBACK_TRANSCRIPT_NOT_AUTHORIZED/); });
  await test('92 ID-less AI transcript is rejected', () => { const result = normalizeTranscript('400683713', { call_transcription: [{ sentence: 'unbound text' }] }); assert.strictEqual(result.status, 'TRANSCRIPT_FAILED'); assert.strictEqual(result.reason, 'TRANSCRIPT_CALL_ID_MISSING'); });
  await test('93 incomplete system evidence cannot label a final note', async () => { const result = await inspect(harness()); assert.throws(() => buildCallNote({ call: result.call, match: result.match, transcript: result.transcript, transcriptEvidence: { source: 'SYSTEM', callId: result.call.callId }, conversation: result.conversation, extraction: result.extraction, nextAction: result.nextAction, summary: 'Unverified.' }), /FALLBACK_TRANSCRIPT_NOT_AUTHORIZED/); });
  await test('94 metadata-only note is not labeled as provider transcript', async () => { const result = await inspect(harness({ callRecord: makeCall({ status: 'no_answer', meaningfulConversation: false, intendedPersonReached: false }), aiData: { callId: 'jc-100', transcript_status: 'pending' } })); assert.ok(result.note.body.includes('JustCall verified call metadata; no transcript used')); assert.strictEqual(result.note.body.includes('AI transcript endpoint'), false); });
  await test('95 conflicting AI call ID aliases are rejected', () => { const result = normalizeTranscript('400683713', { id: 400683713, callId: 999, call_transcription: [{ sentence: 'conflicted' }] }); assert.strictEqual(result.reason, 'TRANSCRIPT_CALL_ID_CONFLICT'); });
  await test('96 fetched ID-less AI transcript stays unverified', async () => { const h = harness(); delete h.aiData.callId; const result = await inspect(h); assert.strictEqual(result.status, 'TRANSCRIPT_FAILED'); assert.strictEqual(result.reason, 'TRANSCRIPT_CALL_ID_MISSING'); assert.strictEqual(result.note, undefined); });
  await test('97 supplied provider evidence must match transcript text', async () => { const result = await inspect(harness()); const evidence = buildTranscriptEvidence({ source: 'PROVIDER', callId: result.call.callId, text: 'different transcript' }); assert.throws(() => buildCallNote({ call: result.call, match: result.match, transcript: result.transcript, transcriptEvidence: evidence, conversation: result.conversation, extraction: result.extraction, nextAction: result.nextAction, summary: 'Unverified.' }), /PROVIDER_TRANSCRIPT_EVIDENCE_MISMATCH/); });
  await test('98 polling rejects conflicting AI call ID aliases', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713 }); jc.fetchCallAiData = async () => ({ id: 400683713, callId: 999, call_transcription: [{ sentence: 'conflicted' }] }); const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0] }); assert.strictEqual(result.reason, 'AI_CALL_ID_CONFLICT'); });
  await test('99 polling rejects conflicting nested AI call ID', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713 }); jc.fetchCallAiData = async () => ({ id: 400683713, justcall_ai: { id: 999, call_transcription: [{ sentence: 'conflicted' }] } }); const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0] }); assert.strictEqual(result.reason, 'AI_CALL_ID_CONFLICT'); });
  await test('100 polling rejects ID-less nested AI transcript container', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713 }); jc.fetchCallAiData = async () => ({ id: 400683713, justcall_ai: { call_transcription: [{ sentence: 'unbound' }] } }); const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0] }); assert.strictEqual(result.reason, 'AI_CALL_ID_MISSING'); });
  await test('101 polling rejects conflicting call-detail ID aliases', async () => { const jc = new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }); jc.fetchCallDetails = async () => ({ id: 400683713, call_id: 999 }); const result = await jc.pollCallTranscript(400683713, { scheduleMs: [0] }); assert.strictEqual(result.reason, 'CALL_ID_CONFLICT'); });

  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed}/${passed + failed} tests passed`);
  if (failed > 0) process.exit(1);
})().catch(error => { console.error(error); process.exit(1); });
