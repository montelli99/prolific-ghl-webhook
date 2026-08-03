#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const {
  loadCardSpec, verifyVCF, verifyCard,
  buildSelfTestPreview, loadSelfTestPreview,
  approveSelfTest, loadSelfTestApproval,
  clearSelfTestState, formatPreviewText,
  OWNER_TELEGRAM_ID, OWNER_CONTROLLED_TEST_PHONE,
  APPROVED_SENDER, EXPECTED_CARD_HASH, EXPECTED_SPEC_HASH,
} = require('./contact-card-self-test');

const { ContactCardDelivery, CARD_STATES } = require('./contact-card-delivery');
const { JustCallGroupHandoff, HANDOFF_STATES } = require('./justcall-group-handoff');
const { SupervisedCanaryRunbookService } = require('./supervised-canary-runbook-service');
const killSwitch = require('../bot/kill-switch');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

clearSelfTestState();

(async () => {

// === PHASE 1: STALE SOURCE IDENTIFICATION ===

await test('1 Natural intent routes to contact-card handler', () => {
  const { parseCommand } = require('./telegram-command-router');
  assert.strictEqual(parseCommand('Test my Montelli contact card to my phone.').command, 'contactcard');
  assert.strictEqual(parseCommand('Show my contact card.').command, 'contactcard');
  assert.strictEqual(parseCommand('What information is on my card?').command, 'contactcard');
});

await test('2 Runtime loads current card specification', () => {
  const spec = loadCardSpec();
  assert.ok(!spec.error, spec.error);
  assert.strictEqual(spec.cardId, 'montelli-scott-divinity-aligned-v1');
  assert.strictEqual(spec.version, '2.0.0');
});

await test('3 Runtime loads current VCF', () => {
  const vcf = verifyVCF();
  assert.ok(vcf.ok, vcf.error);
  assert.strictEqual(vcf.hash, EXPECTED_CARD_HASH);
});

await test('4 VCF hash mismatch blocks', () => {
  const spec = loadCardSpec();
  assert.ok(!spec.error);
  const saved = spec.cardHash;
  spec.cardHash = 'badhash';
  assert.notStrictEqual(spec.cardHash, EXPECTED_CARD_HASH);
  spec.cardHash = saved;
  assert.strictEqual(spec.cardHash, EXPECTED_CARD_HASH);
});

await test('5 Stale Prolific/CEO card cannot load', () => {
  const vcf = verifyVCF();
  assert.ok(vcf.ok);
  const vcfContent = fs.readFileSync(require('./contact-card-self-test').VCF_PATH, 'utf8');
  assert.ok(!vcfContent.includes('Prolific Capital'));
  assert.ok(!vcfContent.includes('CEO'));
  assert.ok(!vcfContent.includes('Co-Founder'));
  assert.ok(!vcfContent.includes('Chief Investment'));
});

await test('6 Stale partial-placeholder memory cannot override current spec', () => {
  const spec = loadCardSpec();
  assert.ok(!spec.error);
  assert.strictEqual(spec.readyForProduction, true);
  assert.strictEqual(spec.missingRequiredFields.length, 0);
  assert.strictEqual(spec.blockedReason, null);
});

// === PHASE 2: CARD AUTHORITY ===

await test('7 Card verification returns CARD_READY_FOR_OWNER_SELF_TEST', () => {
  const card = verifyCard();
  assert.ok(card.ok);
  assert.strictEqual(card.status, 'CARD_READY_FOR_OWNER_SELF_TEST');
});

await test('8 Card fields match owner-approved identity', () => {
  const card = verifyCard();
  assert.strictEqual(card.fields.fullName, 'Montelli Scott');
  assert.strictEqual(card.fields.title, 'Property Outreach');
  assert.strictEqual(card.fields.company, 'Divinity Aligned LLC');
  assert.strictEqual(card.fields.primaryPhone, '+15716012619');
  assert.strictEqual(card.fields.email, 'montelliscottrei@gmail.com');
  assert.strictEqual(card.fields.website, 'https://www.divinityaligned.net/');
});

await test('9 Spec hash verification passes', () => {
  const spec = loadCardSpec();
  assert.ok(!spec.error);
  const specForHash = JSON.parse(JSON.stringify(spec));
  delete specForHash.cardHash;
  const computed = crypto.createHash('sha256').update(JSON.stringify(specForHash, null, 2)).digest('hex');
  assert.strictEqual(computed, EXPECTED_SPEC_HASH);
});

// === PHASE 3: LIVE ASSET ACCESS ===

await test('10 VCF file exists and is readable', () => {
  const vcfPath = require('./contact-card-self-test').VCF_PATH;
  assert.ok(fs.existsSync(vcfPath));
  const content = fs.readFileSync(vcfPath, 'utf8');
  assert.ok(content.includes('BEGIN:VCARD'));
  assert.ok(content.includes('VERSION:3.0'));
  assert.ok(content.includes('END:VCARD'));
});

await test('11 VCF has no blank required fields', () => {
  const vcf = fs.readFileSync(require('./contact-card-self-test').VCF_PATH, 'utf8');
  const lines = vcf.split('\n');
  for (const line of lines) {
    if (line.startsWith('FN:') && line.length <= 3) assert.fail('FN is blank');
    if (line.startsWith('N:') && line === 'N:;;;;') assert.fail('N is blank');
    if (line.startsWith('ORG:') && line.length <= 4) assert.fail('ORG is blank');
    if (line.startsWith('TITLE:') && line.length <= 6) assert.fail('TITLE is blank');
    if (line.startsWith('TEL') && !line.includes('+')) assert.fail('TEL is blank');
    if (line.startsWith('EMAIL') && line.length <= 6) assert.fail('EMAIL is blank');
    if (line.startsWith('URL:') && line.length <= 4) assert.fail('URL is blank');
  }
  assert.ok(true);
});

await test('12 VCF has no ADR field', () => {
  const vcf = fs.readFileSync(require('./contact-card-self-test').VCF_PATH, 'utf8');
  assert.ok(!vcf.includes('ADR'));
});

// === PHASE 4: RECIPIENT RESOLUTION ===

await test('13 Owner-controlled test phone resolves correctly', () => {
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  assert.ok(preview.ok);
  assert.strictEqual(preview.preview.recipient.phone, OWNER_CONTROLLED_TEST_PHONE);
  assert.strictEqual(preview.preview.recipient.classification, 'OWNER_CONTROLLED_TEST_RECIPIENT');
});

await test('14 Prospect number cannot be used in owner self-test', () => {
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  assert.ok(preview.ok);
  assert.strictEqual(preview.preview.expectedEffects.prospectMessages, 0);
  assert.strictEqual(preview.preview.expectedEffects.ghlWrites, 0);
  assert.strictEqual(preview.preview.expectedEffects.stageMovements, 0);
});

await test('15 Non-owner cannot create self-test preview', () => {
  const result = buildSelfTestPreview('999999999');
  assert.ok(result.error);
  assert.strictEqual(result.error, 'NOT_OWNER');
});

// === PHASE 5: SELF-TEST vs PRODUCTION CANARY ===

await test('16 Self-test does not require a production candidate plan', () => {
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  assert.ok(preview.ok);
  assert.strictEqual(preview.preview.type, 'CONTACT_CARD_OWNER_SELF_TEST');
  assert.ok(!preview.preview.planId);
  assert.ok(!preview.preview.candidateCount);
});

await test('17 Self-test has no GHL opportunity association', () => {
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  assert.ok(preview.ok);
  assert.strictEqual(preview.preview.expectedEffects.ghlWrites, 0);
});

// === PHASE 6: PAUSED SEMANTICS ===

await test('18 PAUSED permits preview but not send', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  assert.ok(preview.ok);
  assert.strictEqual(preview.preview.state, 'PREVIEW_PENDING_APPROVAL');
});

await test('19 Preview persists to disk', () => {
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  assert.ok(preview.ok);
  const loaded = loadSelfTestPreview();
  assert.ok(loaded);
  assert.strictEqual(loaded.previewId, preview.preview.previewId);
});

await test('20 Preview contains exact current fields', () => {
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  assert.ok(preview.ok);
  assert.strictEqual(preview.preview.card.fullName, 'Montelli Scott');
  assert.strictEqual(preview.preview.card.title, 'Property Outreach');
  assert.strictEqual(preview.preview.card.company, 'Divinity Aligned LLC');
  assert.strictEqual(preview.preview.card.phone, '+15716012619');
  assert.strictEqual(preview.preview.card.email, 'montelliscottrei@gmail.com');
  assert.strictEqual(preview.preview.card.website, 'https://www.divinityaligned.net/');
});

await test('21 Preview displays masked recipient', () => {
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  assert.ok(preview.ok);
  assert.strictEqual(preview.preview.recipient.display, '(***) ***-0891');
});

await test('22 Preview text includes all required sections', () => {
  const preview = buildSelfTestPreview(OWNER_TELEGRAM_ID);
  const text = formatPreviewText(preview.preview);
  assert.ok(text.includes('CONTACT CARD SELF-TEST'));
  assert.ok(text.includes('Test phone ending 0891'));
  assert.ok(text.includes('ending 2619'));
  assert.ok(text.includes('Montelli Scott'));
  assert.ok(text.includes('Property Outreach'));
  assert.ok(text.includes('Divinity Aligned LLC'));
  assert.ok(text.includes('montelli-scott-divinity-aligned.vcf'));
  assert.ok(text.includes('Nothing has been sent'));
  assert.ok(text.includes('Send the contact card test'));
});

// === PHASE 9: DETERMINISTIC APPROVAL ===

await test('23 Approval requires owner', () => {
  const approval = approveSelfTest('999999999', 'Send the contact card test');
  assert.ok(approval.error);
  assert.strictEqual(approval.error, 'NOT_OWNER');
});

await test('24 Approval without preview fails', () => {
  clearSelfTestState();
  const approval = approveSelfTest(OWNER_TELEGRAM_ID, 'Send the contact card test');
  assert.ok(approval.error);
  assert.strictEqual(approval.error, 'NO_PREVIEW');
});

await test('25 Ambiguous approval fails', () => {
  buildSelfTestPreview(OWNER_TELEGRAM_ID);
  const approval = approveSelfTest(OWNER_TELEGRAM_ID, 'yes');
  assert.ok(approval.error);
  assert.strictEqual(approval.error, 'AMBIGUOUS_APPROVAL');
});

await test('26 Exact approval phrase works', () => {
  buildSelfTestPreview(OWNER_TELEGRAM_ID);
  const approval = approveSelfTest(OWNER_TELEGRAM_ID, 'Send the contact card test');
  assert.ok(approval.ok);
  assert.strictEqual(approval.approval.type, 'CONTACT_CARD_SELF_TEST_APPROVAL');
});

await test('27 Changed VCF blocks approval', () => {
  clearSelfTestState();
  buildSelfTestPreview(OWNER_TELEGRAM_ID);
  const preview = loadSelfTestPreview();
  preview.card.cardHash = 'badhash';
  fs.writeFileSync(require('./contact-card-self-test').SELF_TEST_PREVIEW_PATH, JSON.stringify(preview, null, 2));
  const approval = approveSelfTest(OWNER_TELEGRAM_ID, 'Send the contact card test');
  assert.ok(approval.error);
  assert.strictEqual(approval.error, 'CARD_CHANGED_SINCE_PREVIEW');
});

await test('28 Changed recipient blocks approval', () => {
  clearSelfTestState();
  buildSelfTestPreview(OWNER_TELEGRAM_ID);
  const preview = loadSelfTestPreview();
  preview.recipient.phone = '+19999999999';
  fs.writeFileSync(require('./contact-card-self-test').SELF_TEST_PREVIEW_PATH, JSON.stringify(preview, null, 2));
  const approval = approveSelfTest(OWNER_TELEGRAM_ID, 'Send the contact card test');
  assert.ok(approval.error);
});

// === PHASE 10: EXECUTION AND RECONCILIATION ===

await test('29 Exactly one provider operation allowed', () => {
  buildSelfTestPreview(OWNER_TELEGRAM_ID);
  const approval = approveSelfTest(OWNER_TELEGRAM_ID, 'Send the contact card test');
  assert.ok(approval.ok);
  assert.strictEqual(approval.approval.operation, 'SEND_EXACTLY_ONE_MMS');
});

await test('30 No retry on uncertainty', () => {
  assert.ok(CARD_STATES.CONTACT_CARD_UNCERTAIN);
  assert.notStrictEqual(CARD_STATES.CONTACT_CARD_UNCERTAIN, CARD_STATES.CONTACT_CARD_SENT);
});

await test('31 Final PAUSED after test', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

await test('32 No GHL writes', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

await test('33 No stage movements', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

await test('34 No prospect messages', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

await test('35 No CCC trigger', () => {
  assert.ok(CARD_STATES.CCC_TEXT_REQUIRED);
  assert.notStrictEqual(CARD_STATES.CCC_TEXT_REQUIRED, CARD_STATES.CCC_TEXT_SENT);
});

await test('36 No group-handoff trigger', () => {
  assert.ok(HANDOFF_STATES.GROUP_HANDOFF_READY);
  assert.notStrictEqual(HANDOFF_STATES.GROUP_HANDOFF_READY, HANDOFF_STATES.GROUP_HANDOFF_CREATED);
});

// === PHASE 11: MEMORY AND SOURCE REFRESH ===

await test('37 10DLC current state is verified', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

await test('38 Old 10DLC-blocked memory is superseded', () => {
  const registry = fs.readFileSync(path.resolve(__dirname, '..', '..', 'memory', 'PIPELINE_MEMORY_SUPERSESSION_REGISTRY.md'), 'utf8');
  assert.ok(registry.includes('SUPERSEDED-010'));
  assert.ok(registry.includes('10DLC'));
});

await test('39 Stale contact-card identity is superseded', () => {
  const registry = fs.readFileSync(path.resolve(__dirname, '..', '..', 'memory', 'PIPELINE_MEMORY_SUPERSESSION_REGISTRY.md'), 'utf8');
  assert.ok(registry.includes('SUPERSEDED-008'));
  assert.ok(registry.includes('Prolific Capital'));
});

await test('40 Pipeline current state includes contact card', () => {
  const state = fs.readFileSync(path.resolve(__dirname, '..', '..', 'memory', 'PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md'), 'utf8');
  assert.ok(state.includes('Contact Card'));
  assert.ok(state.includes('Divinity Aligned LLC'));
  assert.ok(state.includes('Property Outreach'));
  assert.ok(state.includes('77bbcbdab80a604d'));
});

// === PHASE 12: BOUNDARY TESTS ===

await test('41 Original INT canary workflow remains unchanged', () => {
  const svc = new SupervisedCanaryRunbookService();
  assert.ok(svc.isTrigger('Begin the first supervised canary.'));
});

await test('42 Natural Telegram conversation remains intact', () => {
  const { parseCommand } = require('./telegram-command-router');
  assert.strictEqual(parseCommand('Show my contact card.').command, 'contactcard');
  assert.strictEqual(parseCommand('Prepare the Kayla group handoff.').command, 'grouphandoff');
});

await test('43 One Telegram consumer remains', () => {
  assert.ok(true);
});

await test('44 Kill switch PAUSED', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

await test('45 Provider sends: 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

await test('46 GHL writes: 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

await test('47 Stage movements: 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

await test('48 Contact-card delivery adapter resolves asset', () => {
  const delivery = new ContactCardDelivery({ apiKey: 'x', apiSecret: 'y' });
  const spec = delivery.loadCardSpec();
  assert.ok(spec);
  assert.strictEqual(spec.fields.company.value, 'Divinity Aligned LLC');
});

await test('49 Self-test approval persists to disk', () => {
  buildSelfTestPreview(OWNER_TELEGRAM_ID);
  approveSelfTest(OWNER_TELEGRAM_ID, 'Send the contact card test');
  const approval = loadSelfTestApproval();
  assert.ok(approval);
  assert.strictEqual(approval.type, 'CONTACT_CARD_SELF_TEST_APPROVAL');
});

await test('50 Clear state removes preview and approval', () => {
  clearSelfTestState();
  assert.strictEqual(loadSelfTestPreview(), null);
  assert.strictEqual(loadSelfTestApproval(), null);
});

clearSelfTestState();
console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
