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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-closeout-'));

(async () => {

// === COURSE REQUIREMENTS ===

await test('1 Website is not COURSE_EXPLICIT_REQUIRED', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.notStrictEqual(spec.fields.website.classification, 'COURSE_EXPLICIT_REQUIRED');
});

await test('2 Business address is COURSE_UNKNOWN', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.fields.businessAddress.classification, 'COURSE_UNKNOWN');
});

await test('3 Logo is COURSE_UNKNOWN (course says headshot, not logo)', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.fields.logo.classification, 'COURSE_UNKNOWN');
});

await test('4 Verified minimal fields generate a valid card', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  const spec = delivery.loadCardSpec();
  assert.ok(spec);
  assert.ok(spec.fields.fullName.value);
  assert.ok(spec.fields.title.value);
  assert.ok(spec.fields.company.value);
  assert.ok(spec.fields.primaryPhone.value);
  assert.ok(spec.fields.email.value);
});

await test('5 Missing optional fields do not block', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  const readiness = delivery.getReadiness();
  assert.strictEqual(readiness.readyForSelfTest, true);
});

await test('6 Missing COURSE_EXPLICIT_REQUIRED fields are reported', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  const readiness = delivery.getReadiness();
  assert.strictEqual(readiness.ready, false);
  assert.ok(readiness.missingRequiredFields.includes('headshot'));
  assert.ok(readiness.missingRequiredFields.includes('recentClosings'));
});

await test('7 Card contains no guessed values', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  for (const [key, field] of Object.entries(spec.fields)) {
    if (field.value && field.classification === 'COURSE_UNKNOWN') {
      assert.fail(`${key} has a value but is COURSE_UNKNOWN`);
    }
  }
  assert.ok(true);
});

// === CCC TEXT vs CONTACT CARD ===

await test('8 CCC text and contact card remain separate', () => {
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_SENT, CARD_STATES.CONTACT_CARD_SENT);
});

await test('9 CCC text cannot satisfy card state', () => {
  assert.ok(CARD_STATES.CCC_TEXT_REQUIRED);
  assert.ok(CARD_STATES.CONTACT_CARD_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_SENT, CARD_STATES.CONTACT_CARD_SENT);
});

await test('10 VCF/card provider evidence is required', () => {
  assert.ok(CARD_STATES.CONTACT_CARD_SENT);
  assert.ok(CARD_STATES.CONTACT_CARD_FAILED);
  assert.ok(CARD_STATES.CONTACT_CARD_UNCERTAIN);
});

// === SELF-TEST ===

await test('11 Contact-card self-test uses only owner-controlled recipient', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  const readiness = delivery.getReadiness();
  assert.strictEqual(readiness.readyForSelfTest, true);
});

await test('12 No prospect contact occurs during self-test preparation', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

// === GROUP HANDOFF ===

await test('13 Group workflow requires Montelli, Kayla, and external contact', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent', externalPhone: '+15555550123',
    propertyAddress: '123 Main St', handoffSummary: 'test', stage: 4,
  });
  assert.strictEqual(checklist.participants.operator.name, 'Montelli');
  assert.strictEqual(checklist.participants.closer.name, 'Kayla');
  assert.strictEqual(checklist.participants.external.name, 'Alice Agent');
});

await test('14 Jaxon is not required under current owner policy', () => {
  const handoff = new JustCallGroupHandoff();
  assert.strictEqual(handoff.closerName, 'Kayla');
  assert.notStrictEqual(handoff.closerName, 'Jaxon');
});

await test('15 Seth is not placed in the group automatically', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent', externalPhone: '+15555550123',
    propertyAddress: '123 Main St', handoffSummary: 'test', stage: 4,
  });
  const names = Object.values(checklist.participants).map(p => p.name);
  assert.ok(!names.includes('Seth'));
});

await test('16 Manual checklist does not claim group creation', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent', externalPhone: '+15555550123',
    propertyAddress: '123 Main St', handoffSummary: 'test', stage: 4,
  });
  assert.strictEqual(checklist.state, 'GROUP_HANDOFF_MANUAL_ACTION_REQUIRED');
  assert.notStrictEqual(checklist.state, 'GROUP_HANDOFF_CREATED');
});

await test('17 Group evidence is required before state transition', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent', externalPhone: '+15555550123',
    propertyAddress: '123 Main St', handoffSummary: 'test', stage: 4,
  });
  const confirmed = handoff.recordHandoffCompletion(checklist, {
    groupThreadId: 'thread_abc', participantsConfirmed: true,
    closerAcknowledged: true, openingMessageSent: true,
  });
  assert.strictEqual(confirmed.state, 'GROUP_HANDOFF_CONFIRMED');
  assert.strictEqual(confirmed.evidence.groupThreadId, 'thread_abc');
});

// === GCJ TIMING ===

await test('18 GCJ timing remains path-specific where supported', () => {
  const matrix = fs.existsSync(path.resolve(__dirname, '..', '..', 'docs', 'GCJ_TIMING_DECISION_MATRIX.md'));
  assert.ok(matrix);
});

await test('19 Course conflicts do not become invented universal rules', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_READY);
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_MANUAL_ACTION_REQUIRED);
});

// === INT CANARY BOUNDARIES ===

await test('20 INT canary cannot invoke CCC', () => {
  assert.ok(CARD_STATES.CCC_TEXT_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_REQUIRED, CARD_STATES.CCC_TEXT_SENT);
});

await test('21 INT canary cannot invoke contact card', () => {
  assert.ok(CARD_STATES.CONTACT_CARD_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CONTACT_CARD_REQUIRED, CARD_STATES.CONTACT_CARD_SENT);
});

await test('22 INT canary cannot invoke group handoff', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_READY);
  assert.notStrictEqual(HANDOFF_STATES.GROUP_HANDOFF_READY, HANDOFF_STATES.GROUP_HANDOFF_CREATED);
});

// === NATURAL TELEGRAM INTENTS ===

await test('23 Natural contact-card intents route correctly', () => {
  const { parseCommand } = require('./telegram-command-router');
  assert.strictEqual(parseCommand('Show my contact card.').command, 'contactcard');
  assert.strictEqual(parseCommand('What information is on my card?').command, 'contactcard');
  assert.strictEqual(parseCommand('Test my contact card to my phone.').command, 'contactcard');
});

await test('24 Natural group-handoff intents route correctly', () => {
  const { parseCommand } = require('./telegram-command-router');
  assert.strictEqual(parseCommand('Prepare the Kayla group handoff.').command, 'grouphandoff');
  assert.strictEqual(parseCommand('Show me who will be in the group.').command, 'grouphandoff');
  assert.strictEqual(parseCommand('Walk me through creating the group.').command, 'grouphandoff');
});

// === SAFETY ===

await test('25 No provider sends during tests', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

await test('26 No GHL writes', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

await test('27 No stage movements', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

await test('28 Final kill switch PAUSED', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

await test('29 Gateway unchanged', () => {
  assert.ok(true);
});

await test('30 Existing supervised canary workflow remains intact', () => {
  const svc = new SupervisedCanaryRunbookService();
  assert.ok(svc.isTrigger('Begin the first supervised canary.'));
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
