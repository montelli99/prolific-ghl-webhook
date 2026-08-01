'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const contract = require('../modules/kayla-stage3-contract');
const tx = require('../modules/kayla-stage3-transaction');
const availability = require('../modules/kayla-stage3-action-availability');
const telegram = require('../modules/kayla-stage3-telegram');

const REPORTS_DIR = path.resolve(__dirname, '..', 'reports', 'kayla-stage3');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}

function mockCtx() { return { chatId: 'test-chat', telegramUserId: 'test-operator' }; }
function mockStage2Session(overrides = {}) {
  return {
    schema: 'kayla-stage2-transaction-v1',
    transactionId: 'stage2_test',
    sessionId: 'stage2_session_test',
    opportunityId: 'opp-test-001',
    property: { address: '123 Main St', fingerprint: 'abc123' },
    contactPath: 'LISTING_AGENT',
    state: 'OFFER_READY_EXIT_ELIGIBLE',
    dealType: 'TURNKEY_OR_GOOD_CONDITION',
    handoffDestination: 'SETH_LOI',
    handoffSubmitted: true,
    exitEligible: true,
    importedFacts: [
      { field: 'contactName', value: 'Jane Agent', disposition: 'RECORDED' },
      { field: 'contactPhone', value: '555-0100', disposition: 'RECORDED' },
      { field: 'contactEmail', value: 'jane@example.com', disposition: 'RECORDED' },
      { field: 'occupancy', value: 'vacant', disposition: 'RECORDED' },
      { field: 'roofAge', value: '5 years', disposition: 'RECORDED' },
      { field: 'hvacAge', value: '3 years', disposition: 'RECORDED' },
    ],
    ...overrides,
  };
}

// === CONTRACT TESTS ===
test('contract validates with 9 resolved + 1 unresolved', () => {
  const v = contract.validateContract();
  assert.ok(v.ok);
  assert.strictEqual(v.resolvedCount, 9);
  assert.strictEqual(v.unresolvedCount, 1);
  assert.ok(v.s3Alt001Unresolved);
});

test('contract has all offer types', () => {
  const types = contract.RESOLVED_RULES.S3_TYPE_001.offerTypes;
  assert.ok(types.CASH);
  assert.ok(types.STACK_50);
  assert.ok(types.DOWN_10);
  assert.ok(types.SUBTO);
});

test('contract has corrected equity rule', () => {
  const calc = contract.RESOLVED_RULES.S3_CALC_001;
  assert.ok(calc.formulas.stack50.includes('Min 50% equity'));
  assert.ok(calc.formulas.stack50.includes('Preferred 65%+'));
});

test('contract has corrected 72 month rule', () => {
  const calc = contract.RESOLVED_RULES.S3_CALC_001;
  assert.ok(calc.formulas.subto.includes('negotiable'));
});

test('contract has corrected 1% rule as guidance', () => {
  const calc = contract.RESOLVED_RULES.S3_CALC_001;
  assert.strictEqual(calc.onePercentRule.mandatory, false);
  assert.ok(calc.onePercentRule.rule.toLowerCase().includes('screening guidance'));
});

// === TRANSACTION TESTS ===
test('createStage3Session imports stage 2 facts', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  assert.strictEqual(s3.currentPipelineStage, 'Offer Ready to be Sent to Seller');
  assert.ok(s3.importedFacts.length >= 6);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.STAGE3_ENTRY_REVIEW_REQUIRED);
});

test('evaluateEntry allows when stage 2 complete', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  const entry = tx.evaluateEntry(s3);
  assert.ok(entry.allowed);
});

test('evaluateEntry blocks when stage 2 incomplete', () => {
  const s2 = mockStage2Session({ exitEligible: false, handoffSubmitted: false, state: 'CONTACT_FACTS_REVIEW_REQUIRED' });
  const s3 = tx.createStage3Session(s2);
  const entry = tx.evaluateEntry(s3);
  assert.strictEqual(entry.allowed, false);
});

test('addEvent is idempotent', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  const r1 = tx.addEvent(s3, 'STAGE3_SESSION_STARTED', {});
  const r2 = tx.addEvent(s3, 'STAGE3_SESSION_STARTED', {});
  assert.ok(r2.duplicate);
  assert.strictEqual(s3.journal.length, 1);
});

test('full stage 3 flow: entry -> handoff -> underwriting -> offer type -> calculations -> LOI -> generation -> approval -> delivery -> exit', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  const op = { operatorId: 'test-op' };

  tx.addEvent(s3, 'STAGE3_SESSION_STARTED', {}, op);
  tx.addEvent(s3, 'STAGE2_HANDOFF_LOADED', {}, op);
  tx.addEvent(s3, 'STAGE3_ENTRY_VERIFIED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.HANDOFF_REVIEW_REQUIRED);

  tx.addEvent(s3, 'HANDOFF_REVIEWED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.UNDERWRITING_DATA_REVIEW_REQUIRED);

  tx.addEvent(s3, 'UNDERWRITING_DATA_RECORDED', { data: { arv: '200000', purchasePrice: '150000', repairEstimate: '30000', marketRent: '2000' } }, op);
  tx.addEvent(s3, 'UNDERWRITING_DATA_REVIEWED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.OFFER_TYPE_SELECTION_REQUIRED);

  tx.addEvent(s3, 'OFFER_TYPE_SELECTED', { offerType: contract.OFFER_TYPES.CASH }, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.CALCULATIONS_DISPLAYED);

  tx.addEvent(s3, 'CALCULATIONS_REVIEWED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.LOI_STATUS_REVIEWED);

  tx.addEvent(s3, 'LOI_STATUS_REVIEWED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.OFFER_GENERATION_AWAITED);

  tx.addEvent(s3, 'OFFER_GENERATION_SIMULATED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.OFFER_APPROVAL_AWAITED);

  tx.addEvent(s3, 'OFFER_APPROVAL_SIMULATED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.OFFER_DELIVERY_CONFIRMATION_REQUIRED);

  tx.addEvent(s3, 'OFFER_DELIVERY_CONFIRMED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.OFFER_DELIVERY_CONFIRMED);
  assert.ok(s3.offerDeliveryConfirmed);
  assert.ok(s3.offerSentDate);

  tx.addEvent(s3, 'STAGE3_OPERATOR_WORK_COMPLETE', {}, op);
  tx.addEvent(s3, 'OFFER_SENT_EXIT_SIMULATED', {}, op);
  assert.strictEqual(s3.state, contract.STAGE3_STATES.STAGE3_EXIT_ELIGIBLE);
  assert.ok(s3.exitEligible);
});

// === ACTION AVAILABILITY TESTS ===
test('action availability: START_REVIEW always available', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  const av = availability.evaluateActionAvailability(s3, availability.STAGE3_ACTIONS.START_REVIEW);
  assert.ok(av.available);
});

test('action availability: SELECT_OFFER_TYPE available', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  const av = availability.evaluateActionAvailability(s3, availability.STAGE3_ACTIONS.SELECT_OFFER_TYPE);
  assert.ok(av.available);
});

test('action availability: SIMULATE_OFFER_GENERATION blocked before LOI review', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  const av = availability.evaluateActionAvailability(s3, availability.STAGE3_ACTIONS.SIMULATE_OFFER_GENERATION);
  assert.strictEqual(av.available, false);
});

test('action availability: ALTERNATE_OUTCOME always blocked', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  const av = availability.evaluateActionAvailability(s3, availability.STAGE3_ACTIONS.SELECT_ALTERNATE_OUTCOME);
  assert.strictEqual(av.available, false);
  assert.ok(av.blockingReason.includes('COURSE_UNKNOWN'));
});

// === TELEGRAM TESTS ===
test('telegram: parseStage3Intent recognizes start review', () => {
  const intent = telegram.parseStage3Intent('start stage 3 review');
  assert.strictEqual(intent.intent, 'START_STAGE3_REVIEW');
});

test('telegram: parseStage3Intent recognizes offer type selection', () => {
  const cash = telegram.parseStage3Intent('select cash offer type');
  assert.strictEqual(cash.intent, 'SELECT_OFFER_TYPE');
  assert.strictEqual(cash.offerType, contract.OFFER_TYPES.CASH);

  const stack = telegram.parseStage3Intent('select 50 down stack');
  assert.strictEqual(stack.intent, 'SELECT_OFFER_TYPE');
  assert.strictEqual(stack.offerType, contract.OFFER_TYPES.STACK_50);

  const subto = telegram.parseStage3Intent('select subto');
  assert.strictEqual(subto.intent, 'SELECT_OFFER_TYPE');
  assert.strictEqual(subto.offerType, contract.OFFER_TYPES.SUBTO);
});

test('telegram: parseStage3Intent recognizes underwriting data', () => {
  const intent = telegram.parseStage3Intent('record underwriting arv 200000 price 150000 repair 30000 rent 2000');
  assert.strictEqual(intent.intent, 'RECORD_UNDERWRITING');
  assert.strictEqual(intent.data.arv, '200000');
  assert.strictEqual(intent.data.purchasePrice, '150000');
  assert.strictEqual(intent.data.repairEstimate, '30000');
  assert.strictEqual(intent.data.marketRent, '2000');
});

test('telegram: handleStage3Command full flow', () => {
  const ctx = mockCtx();
  const testDataDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage3-test');
  const stage2TestDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage2-test');
  fs.mkdirSync(stage2TestDir, { recursive: true });
  fs.mkdirSync(testDataDir, { recursive: true });

  const s2 = mockStage2Session();
  fs.writeFileSync(path.join(stage2TestDir, 'test-stage2.json'), JSON.stringify(s2, null, 2));

  const opts = { stage2DataDir: stage2TestDir, stage3DataDir: testDataDir };

  const r1 = telegram.handleStage3Command(ctx, 'start stage 3 review', opts);
  assert.ok(r1, 'r1 should exist');
  assert.ok(r1.reply.includes('Stage 3'), 'r1 should include Stage 3');

  const r2 = telegram.handleStage3Command(ctx, 'verify entry', opts);
  assert.ok(r2, 'r2 should exist');
  assert.ok(r2.reply.includes('verified'), `r2 reply: ${r2.reply}`);

  const r3 = telegram.handleStage3Command(ctx, 'review handoff', opts);
  assert.ok(r3, 'r3 should exist');

  const r4 = telegram.handleStage3Command(ctx, 'record underwriting arv 200000 price 150000 repair 30000 rent 2000', opts);
  assert.ok(r4, 'r4 should exist');

  const r5 = telegram.handleStage3Command(ctx, 'review underwriting', opts);
  assert.ok(r5, 'r5 should exist');

  const r6 = telegram.handleStage3Command(ctx, 'select cash', opts);
  assert.ok(r6, 'r6 should exist');
  assert.ok(r6.reply.includes('CASH'), `r6 reply: ${r6.reply}`);

  const r7 = telegram.handleStage3Command(ctx, 'review calculations', opts);
  assert.ok(r7, 'r7 should exist');

  const r8 = telegram.handleStage3Command(ctx, 'review loi', opts);
  assert.ok(r8, 'r8 should exist');

  const r9 = telegram.handleStage3Command(ctx, 'generate offer', opts);
  assert.ok(r9, 'r9 should exist');
  assert.ok(r9.reply.includes('generated'), `r9 reply: ${r9.reply}`);

  const r10 = telegram.handleStage3Command(ctx, 'approve offer', opts);
  assert.ok(r10, 'r10 should exist');
  assert.ok(r10.reply.includes('approved'), `r10 reply: ${r10.reply}`);

  const r11 = telegram.handleStage3Command(ctx, 'confirm delivery', opts);
  assert.ok(r11, 'r11 should exist');
  assert.ok(r11.reply.includes('delivery confirmed'), `r11 reply: ${r11.reply}`);

  const r12 = telegram.handleStage3Command(ctx, 'simulate move to offer sent', opts);
  assert.ok(r12, 'r12 should exist');
  assert.ok(r12.reply.includes('satisfied'), `r12 reply: ${r12.reply}`);

  try { fs.unlinkSync(path.join(stage2TestDir, 'test-stage2.json')); } catch (_) {}
});

// === PRODUCTION SAFETY ===
test('production safety: all counters zero', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  assert.strictEqual(s3.counters.sends, 0);
  assert.strictEqual(s3.counters.calls, 0);
  assert.strictEqual(s3.counters.ghlWrites, 0);
  assert.strictEqual(s3.counters.stageMovements, 0);
});

test('production safety: all events tagged SIMULATION', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  tx.addEvent(s3, 'STAGE3_SESSION_STARTED', {}, { operatorId: 'test' });
  tx.addEvent(s3, 'STAGE3_ENTRY_VERIFIED', {}, { operatorId: 'test' });
  for (const evt of s3.journal) {
    assert.strictEqual(evt.mode, 'SIMULATION');
  }
});

// === NOTES TESTS ===
test('buildStage3Note includes all sections', () => {
  const s2 = mockStage2Session();
  const s3 = tx.createStage3Session(s2);
  const note = tx.buildStage3Note(s3);
  assert.ok(note.includes('KAYLA STAGE 3'));
  assert.ok(note.includes('123 Main St'));
  assert.ok(note.includes('LISTING_AGENT'));
});

// === REPORT ===
const report = {
  timestamp: new Date().toISOString(),
  stage: 'Stage 3 — Offer Ready to be Sent to Seller',
  totalTests: passed + failed,
  passed,
  failed,
  productionSafety: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 },
  contractValid: contract.validateContract(),
};
fs.writeFileSync(path.join(REPORTS_DIR, 'acceptance-report.json'), JSON.stringify(report, null, 2));

console.log(`\nStage 3 Acceptance: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
