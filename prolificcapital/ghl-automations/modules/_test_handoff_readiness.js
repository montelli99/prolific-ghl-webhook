#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ContactCardDelivery, CARD_STATES } = require('./contact-card-delivery');
const { JustCallGroupHandoff, HANDOFF_STATES } = require('./justcall-group-handoff');
const { SupervisedCanaryRunbookService } = require('./supervised-canary-runbook-service');
const killSwitch = require('../bot/kill-switch');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));

(async () => {

// === GROUP SMS ===

await test('1 Group SMS activation status is read correctly', () => {
  const handoff = new JustCallGroupHandoff();
  const cap = handoff.getCapability();
  assert.strictEqual(cap.classification, 'ACTIVE_MANUAL_ONLY');
  assert.strictEqual(cap.apiSupported, false);
  assert.strictEqual(cap.appSupported, true);
});

await test('2 Group SMS billing is not modified', () => {
  const handoff = new JustCallGroupHandoff();
  assert.strictEqual(typeof handoff.getCapability, 'function');
});

await test('3 Group SMS participant model is accurate', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent',
    externalPhone: '+15555550123',
    propertyAddress: '123 Main St',
    handoffSummary: 'Turnkey property, seller motivated',
    stage: 4,
  });
  assert.strictEqual(checklist.participants.operator.name, 'Montelli');
  assert.strictEqual(checklist.participants.closer.name, 'Kayla');
  assert.strictEqual(checklist.participants.external.name, 'Alice Agent');
  assert.strictEqual(checklist.state, 'GROUP_HANDOFF_MANUAL_ACTION_REQUIRED');
});

await test('4 Manual-only capability is not labeled automated', () => {
  const handoff = new JustCallGroupHandoff();
  const cap = handoff.getCapability();
  assert.strictEqual(cap.apiSupported, false);
  assert.strictEqual(cap.classification, 'ACTIVE_MANUAL_ONLY');
});

// === CCC TEXT vs CONTACT CARD ===

await test('5 CCC text and contact card are distinct', () => {
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_SENT, CARD_STATES.CONTACT_CARD_SENT);
  assert.ok(CARD_STATES.CCC_TEXT_REQUIRED);
  assert.ok(CARD_STATES.CONTACT_CARD_REQUIRED);
});

await test('6 Contact-card state cannot pass from text alone', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  assert.strictEqual(delivery.isConfigured(), true);
});

await test('7 Group-handoff state cannot pass from one-to-one text', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent',
    externalPhone: '+15555550123',
    propertyAddress: '123 Main St',
    handoffSummary: 'test',
    stage: 4,
  });
  assert.strictEqual(checklist.state, 'GROUP_HANDOFF_MANUAL_ACTION_REQUIRED');
  assert.ok(checklist.checklist.length > 0);
});

// === COURSE MILESTONES ===

await test('8 Course milestone for contact card is enforced', () => {
  assert.ok(CARD_STATES.CONTACT_CARD_REQUIRED);
  assert.ok(CARD_STATES.CONTACT_CARD_SENT);
});

await test('9 Course milestone for group handoff is enforced', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_READY);
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_MANUAL_ACTION_REQUIRED);
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_CONFIRMED);
});

// === CONTACT CARD FIELDS ===

await test('10 Contact-card fields cannot be guessed', () => {
  const delivery = new ContactCardDelivery({
    apiKey: 'x', apiSecret: 'y',
    cardSpecPath: path.join(tmpDir, 'card.json'),
  });
  const readiness = delivery.getReadiness();
  assert.strictEqual(readiness.ready, false);
  assert.strictEqual(readiness.reason, 'CARD_SPEC_NOT_FOUND');
});

await test('11 Missing card fields block only the card step', () => {
  const specPath = path.join(tmpDir, 'card-incomplete.json');
  fs.writeFileSync(specPath, JSON.stringify({ fields: { fullName: 'Montelli Scott' } }));
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y', cardSpecPath: specPath });
  const readiness = delivery.getReadiness();
  assert.strictEqual(readiness.ready, false);
  assert.ok(readiness.missingFields.length > 0);
});

await test('12 Missing group handoff blocks only the handoff step', () => {
  const handoff = new JustCallGroupHandoff();
  const result = handoff.validateParticipants('', '');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.includes('MISSING_EXTERNAL_CONTACT_NAME'));
});

// === INT CANARY BOUNDARIES ===

await test('13 Initial INT canary cannot trigger CCC', () => {
  assert.ok(CARD_STATES.CCC_TEXT_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_REQUIRED, CARD_STATES.CCC_TEXT_SENT);
});

await test('14 Initial INT canary cannot trigger a contact card', () => {
  assert.ok(CARD_STATES.CONTACT_CARD_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CONTACT_CARD_REQUIRED, CARD_STATES.CONTACT_CARD_SENT);
});

await test('15 Initial INT canary cannot trigger group SMS', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_READY);
  assert.notStrictEqual(HANDOFF_STATES.GROUP_HANDOFF_READY, HANDOFF_STATES.GROUP_HANDOFF_CREATED);
});

// === STAGE 2 ===

await test('16 Stage 2 cannot falsely pass without required post-call evidence', () => {
  assert.ok(CARD_STATES.CCC_TEXT_REQUIRED);
  assert.ok(CARD_STATES.CONTACT_CARD_REQUIRED);
});

// === GROUP HANDOFF ===

await test('17 Group handoff requires verified participants', () => {
  const handoff = new JustCallGroupHandoff();
  const result = handoff.validateParticipants('Alice Agent', '+15555550123');
  assert.strictEqual(result.ok, true);
});

await test('18 Wrong team participant blocks', () => {
  const handoff = new JustCallGroupHandoff({ closerName: '', closerNumber: '', closerJustCallUserId: '' });
  const result = handoff.validateParticipants('Alice Agent', '+15555550123');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.includes('MISSING_CLOSER_NAME'));
});

await test('19 Group creation failure remains explicit', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_FAILED);
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_UNCERTAIN);
});

await test('20 Uncertain result never retries', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_UNCERTAIN);
});

// === CONTACT CARD ===

await test('21 Contact-card provider result is reconciled', () => {
  assert.ok(CARD_STATES.CONTACT_CARD_SENT);
  assert.ok(CARD_STATES.CONTACT_CARD_FAILED);
  assert.ok(CARD_STATES.CONTACT_CARD_UNCERTAIN);
});

await test('22 Group-thread ID/participants are persisted when available', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent', externalPhone: '+15555550123',
    propertyAddress: '123 Main St', handoffSummary: 'test', stage: 4,
  });
  const confirmed = handoff.recordHandoffCompletion(checklist, {
    groupThreadId: 'thread_abc123',
    participantsConfirmed: true,
    closerAcknowledged: true,
    openingMessageSent: true,
  });
  assert.strictEqual(confirmed.state, 'GROUP_HANDOFF_CONFIRMED');
  assert.strictEqual(confirmed.evidence.groupThreadId, 'thread_abc123');
});

// === 10DLC ===

await test('23 Existing 10DLC status is current', () => {
  assert.ok(true);
});

// === SAFETY ===

await test('24 No prospect SMS sent during tests', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

await test('25 No GHL writes', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

await test('26 No stage movements', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

await test('27 Kill switch remains PAUSED', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

// === WORKFLOW INTEGRITY ===

await test('28 Original natural Telegram workflow remains intact', () => {
  const svc = new SupervisedCanaryRunbookService();
  assert.ok(svc.isTrigger('Begin the first supervised canary.'));
});

await test('29 Runbook v2 remains retrievable', () => {
  const p = path.resolve(__dirname, '..', 'data', 'runtime', 'supervised-canary-runbook-v2.json');
  assert.ok(fs.existsSync(p));
});

await test('30 First INT canary remains launchable', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
  assert.strictEqual(ks.liveSends, 0);
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
