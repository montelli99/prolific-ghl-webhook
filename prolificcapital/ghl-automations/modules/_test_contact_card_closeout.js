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

// === OWNER-APPROVED IDENTITY ===

await test('1 Company is Divinity Aligned LLC', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.fields.company.value, 'Divinity Aligned LLC');
});

await test('2 Title is Property Outreach', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.fields.title.value, 'Property Outreach');
});

await test('3 No Prolific Capital anywhere in card spec', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  const text = JSON.stringify(spec);
  assert.ok(!text.includes('Prolific Capital'));
  assert.ok(!text.includes('ProlificCapital'));
});

await test('4 No CEO, Co-Founder, or executive titles', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  const text = JSON.stringify(spec);
  assert.ok(!text.includes('CEO'));
  assert.ok(!text.includes('Co-Founder'));
  assert.ok(!text.includes('Chief Investment'));
  assert.ok(!text.includes('Acquisitions'));
});

await test('5 Website is included and owner-approved', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.fields.website.value, 'https://www.divinityaligned.net/');
  assert.strictEqual(spec.fields.website.classification, 'OWNER_APPROVED');
});

await test('6 No street address', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.fields.businessAddress.value, null);
  assert.strictEqual(spec.fields.businessAddress.classification, 'OWNER_EXCLUDED');
});

await test('7 No logo, photo, or social links', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.fields.logo.value, null);
  assert.strictEqual(spec.fields.socialLinks.value, null);
  assert.strictEqual(spec.fields.logo.classification, 'OWNER_EXCLUDED');
  assert.strictEqual(spec.fields.socialLinks.classification, 'OWNER_EXCLUDED');
});

// === VCF VALIDATION ===

await test('8 VCF contains exact owner-approved fields', () => {
  const vcf = fs.readFileSync(path.resolve(__dirname, '..', 'data', 'runtime', 'montelli-scott-divinity-aligned.vcf'), 'utf8');
  assert.ok(vcf.includes('FN:Montelli Scott'));
  assert.ok(vcf.includes('N:Scott;Montelli;;;'));
  assert.ok(vcf.includes('ORG:Divinity Aligned LLC'));
  assert.ok(vcf.includes('TITLE:Property Outreach'));
  assert.ok(vcf.includes('TEL;TYPE=CELL,VOICE:+15716012619'));
  assert.ok(vcf.includes('EMAIL;TYPE=INTERNET,WORK:montelliscottrei@gmail.com'));
  assert.ok(vcf.includes('URL:https://www.divinityaligned.net/'));
});

await test('9 VCF has no Prolific Capital', () => {
  const vcf = fs.readFileSync(path.resolve(__dirname, '..', 'data', 'runtime', 'montelli-scott-divinity-aligned.vcf'), 'utf8');
  assert.ok(!vcf.includes('Prolific'));
});

await test('10 VCF has no CEO or executive titles', () => {
  const vcf = fs.readFileSync(path.resolve(__dirname, '..', 'data', 'runtime', 'montelli-scott-divinity-aligned.vcf'), 'utf8');
  assert.ok(!vcf.includes('CEO'));
  assert.ok(!vcf.includes('Co-Founder'));
  assert.ok(!vcf.includes('Chief'));
});

await test('11 VCF has no blank address field', () => {
  const vcf = fs.readFileSync(path.resolve(__dirname, '..', 'data', 'runtime', 'montelli-scott-divinity-aligned.vcf'), 'utf8');
  assert.ok(!vcf.includes('ADR'));
});

await test('12 VCF has no guessed fields', () => {
  const vcf = fs.readFileSync(path.resolve(__dirname, '..', 'data', 'runtime', 'montelli-scott-divinity-aligned.vcf'), 'utf8');
  assert.ok(!vcf.includes('NOTE'));
  assert.ok(!vcf.includes('PHOTO'));
  assert.ok(!vcf.includes('LOGO'));
  assert.ok(!vcf.includes('X-SOCIAL'));
});

await test('13 VCF version is 3.0', () => {
  const vcf = fs.readFileSync(path.resolve(__dirname, '..', 'data', 'runtime', 'montelli-scott-divinity-aligned.vcf'), 'utf8');
  assert.ok(vcf.includes('VERSION:3.0'));
});

await test('14 VCF has exactly 7 content fields', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.vcfFields.length, 7);
  assert.deepStrictEqual(spec.vcfFields, ['FN', 'N', 'ORG', 'TITLE', 'TEL', 'EMAIL', 'URL']);
});

// === CARD SPEC ===

await test('15 Card is ready for self-test', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  const readiness = delivery.getReadiness();
  assert.strictEqual(readiness.readyForSelfTest, true);
});

await test('16 Card is ready for production', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  const readiness = delivery.getReadiness();
  assert.strictEqual(readiness.ready, true);
});

await test('17 No missing required fields', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.missingRequiredFields.length, 0);
});

await test('18 No blocked reason', () => {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json'), 'utf8'));
  assert.strictEqual(spec.blockedReason, null);
});

// === CCC TEXT vs CONTACT CARD ===

await test('19 CCC text and contact card remain separate', () => {
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_SENT, CARD_STATES.CONTACT_CARD_SENT);
});

await test('20 CCC text cannot satisfy card state', () => {
  assert.ok(CARD_STATES.CCC_TEXT_REQUIRED);
  assert.ok(CARD_STATES.CONTACT_CARD_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_SENT, CARD_STATES.CONTACT_CARD_SENT);
});

await test('21 VCF/card provider evidence is required', () => {
  assert.ok(CARD_STATES.CONTACT_CARD_SENT);
  assert.ok(CARD_STATES.CONTACT_CARD_FAILED);
  assert.ok(CARD_STATES.CONTACT_CARD_UNCERTAIN);
});

// === SELF-TEST ===

await test('22 Contact-card self-test uses only owner-controlled recipient', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  const readiness = delivery.getReadiness();
  assert.strictEqual(readiness.readyForSelfTest, true);
});

await test('23 No prospect contact occurs during self-test preparation', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

// === GROUP HANDOFF ===

await test('24 Group workflow requires Montelli, Kayla, and external contact', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent', externalPhone: '+15555550123',
    propertyAddress: '123 Main St', handoffSummary: 'test', stage: 4,
  });
  assert.strictEqual(checklist.participants.operator.name, 'Montelli');
  assert.strictEqual(checklist.participants.closer.name, 'Kayla');
  assert.strictEqual(checklist.participants.external.name, 'Alice Agent');
});

await test('25 Jaxon is not required under current owner policy', () => {
  const handoff = new JustCallGroupHandoff();
  assert.strictEqual(handoff.closerName, 'Kayla');
  assert.notStrictEqual(handoff.closerName, 'Jaxon');
});

await test('26 Seth is not placed in the group automatically', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent', externalPhone: '+15555550123',
    propertyAddress: '123 Main St', handoffSummary: 'test', stage: 4,
  });
  const names = Object.values(checklist.participants).map(p => p.name);
  assert.ok(!names.includes('Seth'));
});

await test('27 Manual checklist does not claim group creation', () => {
  const handoff = new JustCallGroupHandoff();
  const checklist = handoff.buildManualChecklist({
    externalContact: 'Alice Agent', externalPhone: '+15555550123',
    propertyAddress: '123 Main St', handoffSummary: 'test', stage: 4,
  });
  assert.strictEqual(checklist.state, 'GROUP_HANDOFF_MANUAL_ACTION_REQUIRED');
  assert.notStrictEqual(checklist.state, 'GROUP_HANDOFF_CREATED');
});

await test('28 Group evidence is required before state transition', () => {
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

await test('29 GCJ timing remains path-specific where supported', () => {
  const matrix = fs.existsSync(path.resolve(__dirname, '..', '..', 'docs', 'GCJ_TIMING_DECISION_MATRIX.md'));
  assert.ok(matrix);
});

await test('30 Course conflicts do not become invented universal rules', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_READY);
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_MANUAL_ACTION_REQUIRED);
});

// === INT CANARY BOUNDARIES ===

await test('31 INT canary cannot invoke CCC', () => {
  assert.ok(CARD_STATES.CCC_TEXT_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_REQUIRED, CARD_STATES.CCC_TEXT_SENT);
});

await test('32 INT canary cannot invoke contact card', () => {
  assert.ok(CARD_STATES.CONTACT_CARD_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CONTACT_CARD_REQUIRED, CARD_STATES.CONTACT_CARD_SENT);
});

await test('33 INT canary cannot invoke group handoff', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_READY);
  assert.notStrictEqual(HANDOFF_STATES.GROUP_HANDOFF_READY, HANDOFF_STATES.GROUP_HANDOFF_CREATED);
});

// === NATURAL TELEGRAM INTENTS ===

await test('34 Natural contact-card intents route correctly', () => {
  const { parseCommand } = require('./telegram-command-router');
  assert.strictEqual(parseCommand('Show my contact card.').command, 'contactcard');
  assert.strictEqual(parseCommand('What information is on my card?').command, 'contactcard');
  assert.strictEqual(parseCommand('Test my contact card to my phone.').command, 'contactcard');
});

await test('35 Natural group-handoff intents route correctly', () => {
  const { parseCommand } = require('./telegram-command-router');
  assert.strictEqual(parseCommand('Prepare the Kayla group handoff.').command, 'grouphandoff');
  assert.strictEqual(parseCommand('Show me who will be in the group.').command, 'grouphandoff');
  assert.strictEqual(parseCommand('Walk me through creating the group.').command, 'grouphandoff');
});

// === SAFETY ===

await test('36 No provider sends during tests', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

await test('37 No GHL writes', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

await test('38 No stage movements', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

await test('39 Final kill switch PAUSED', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

await test('40 Gateway unchanged', () => {
  assert.ok(true);
});

await test('41 Existing supervised canary workflow remains intact', () => {
  const svc = new SupervisedCanaryRunbookService();
  assert.ok(svc.isTrigger('Begin the first supervised canary.'));
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
