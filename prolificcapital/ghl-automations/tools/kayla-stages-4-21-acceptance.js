'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const framework = require('../modules/kayla-post-offer-framework');
const telegram = require('../modules/kayla-stages-4-21-telegram');

const REPORTS_DIR = path.resolve(__dirname, '..', 'reports', 'kayla-stages-4-21');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}

function mockCtx() { return { chatId: 'test-chat', telegramUserId: 'test-operator' }; }
function mockPriorSession(stageNum, overrides = {}) {
  return {
    schema: `kayla-stage${stageNum}-transaction-v1`,
    transactionId: `stage${stageNum}_test`,
    sessionId: `stage${stageNum}_session_test`,
    opportunityId: 'opp-test-001',
    property: { address: '123 Main St', fingerprint: 'abc123' },
    contactPath: 'LISTING_AGENT',
    state: 'EXIT_ELIGIBLE',
    stageNumber: stageNum,
    offerSentDate: new Date().toISOString(),
    importedFacts: [
      { field: 'contactName', value: 'Jane Agent', disposition: 'RECORDED' },
      { field: 'contactPhone', value: '555-0100', disposition: 'RECORDED' },
    ],
    ...overrides,
  };
}

// === FRAMEWORK TESTS ===
test('STAGE_SPECS has all 7 post-offer stages', () => {
  for (let i = 4; i <= 10; i++) {
    assert.ok(framework.STAGE_SPECS[i], `Stage ${i} spec missing`);
  }
});

test('MONITOR_STAGES has 11 stages (11-21)', () => {
  assert.strictEqual(framework.MONITOR_STAGES.length, 11);
  assert.ok(framework.MONITOR_STAGES.includes(11));
  assert.ok(framework.MONITOR_STAGES.includes(21));
});

test('createPostOfferSession for stage 4', () => {
  const s3 = mockPriorSession(3);
  const s4 = framework.createPostOfferSession(s3, 4);
  assert.strictEqual(s4.currentPipelineStage, 'Offer Sent to Lead');
  assert.strictEqual(s4.stageNumber, 4);
  assert.strictEqual(s4.operatorRole, 'active');
  assert.strictEqual(s4.state, 'ENTRY_REVIEW_REQUIRED');
});

test('createPostOfferSession for stage 9 (monitor)', () => {
  const s8 = mockPriorSession(8);
  const s9 = framework.createPostOfferSession(s8, 9);
  assert.strictEqual(s9.currentPipelineStage, 'Active Negotiation');
  assert.strictEqual(s9.operatorRole, 'monitor');
});

test('createMonitorSession for stage 11', () => {
  const s10 = mockPriorSession(10);
  const s11 = framework.createMonitorSession(s10, 11);
  assert.strictEqual(s11.currentPipelineStage, 'Contract Sent');
  assert.strictEqual(s11.operatorRole, 'monitor');
  assert.strictEqual(s11.state, 'MONITORING');
});

test('createMonitorSession for stage 21', () => {
  const s20 = mockPriorSession(20);
  const s21 = framework.createMonitorSession(s20, 21);
  assert.strictEqual(s21.currentPipelineStage, 'Closed / Archived');
});

test('addEvent is idempotent', () => {
  const s3 = mockPriorSession(3);
  const s4 = framework.createPostOfferSession(s3, 4);
  const r1 = framework.addEvent(s4, 'SESSION_STARTED', {});
  const r2 = framework.addEvent(s4, 'SESSION_STARTED', {});
  assert.ok(r2.duplicate);
  assert.strictEqual(s4.journal.length, 1);
});

test('post-offer events: full stage 4 flow', () => {
  const s3 = mockPriorSession(3);
  const s4 = framework.createPostOfferSession(s3, 4);
  const op = { operatorId: 'test' };

  framework.addEvent(s4, 'SESSION_STARTED', {}, op);
  framework.addEvent(s4, 'ENTRY_VERIFIED', {}, op);
  assert.strictEqual(s4.state, 'OPERATOR_WORK_REQUIRED');

  framework.addEvent(s4, 'CONFIRMATION_CALL_MADE', {}, op);
  assert.ok(s4.confirmationCallMade);

  framework.addEvent(s4, 'RECEIPT_CONFIRMED', {}, op);
  assert.ok(s4.receiptConfirmed);

  framework.addEvent(s4, 'OPERATOR_WORK_COMPLETE', {}, op);
  framework.addEvent(s4, 'EXIT_SIMULATED', {}, op);
  assert.strictEqual(s4.state, 'EXIT_ELIGIBLE');
  assert.ok(s4.exitEligible);
});

test('post-offer events: stage 7 no-answer escalation', () => {
  const s6 = mockPriorSession(6);
  const s7 = framework.createPostOfferSession(s6, 7);
  const op = { operatorId: 'test' };

  framework.addEvent(s7, 'SESSION_STARTED', {}, op);
  framework.addEvent(s7, 'ENTRY_VERIFIED', {}, op);
  framework.addEvent(s7, 'VOICE_MEMO_SENT', {}, op);
  framework.addEvent(s7, 'LOI2DAYS_SENT', {}, op);
  framework.addEvent(s7, 'SD_SENT', {}, op);
  framework.addEvent(s7, 'DOM_NOTED', {}, op);
  framework.addEvent(s7, 'LISTING_EXPIRY_CALCULATED', {}, op);

  assert.ok(s7.voiceMemoSent);
  assert.ok(s7.loi2daysSent);
  assert.ok(s7.sdSent);
  assert.ok(s7.domNoted);
  assert.ok(s7.listingExpiryCalculated);
});

test('post-offer events: stage 8 seller declined', () => {
  const s7 = mockPriorSession(7);
  const s8 = framework.createPostOfferSession(s7, 8);
  const op = { operatorId: 'test' };

  framework.addEvent(s8, 'SESSION_STARTED', {}, op);
  framework.addEvent(s8, 'ENTRY_VERIFIED', {}, op);
  framework.addEvent(s8, 'SD_SENT', {}, op);
  framework.addEvent(s8, 'OTHER_PROPERTIES_ASKED', {}, op);
  framework.addEvent(s8, 'DOM_NOTED', {}, op);
  framework.addEvent(s8, 'REVISIT_SCHEDULED', {}, op);

  assert.ok(s8.sdSent);
  assert.ok(s8.otherPropertiesAsked);
  assert.ok(s8.revisitScheduled);
});

test('post-offer events: stage 9 negotiation (monitor)', () => {
  const s8 = mockPriorSession(8);
  const s9 = framework.createPostOfferSession(s8, 9);
  const op = { operatorId: 'test' };

  framework.addEvent(s9, 'SESSION_STARTED', {}, op);
  framework.addEvent(s9, 'ENTRY_VERIFIED', {}, op);
  framework.addEvent(s9, 'NEGOTIATION_OUTCOME_RECORDED', {}, op);
  assert.ok(s9.negotiationOutcomeRecorded);
});

test('post-offer events: stage 10 terms agreed (monitor)', () => {
  const s9 = mockPriorSession(9);
  const s10 = framework.createPostOfferSession(s9, 10);
  const op = { operatorId: 'test' };

  framework.addEvent(s10, 'SESSION_STARTED', {}, op);
  framework.addEvent(s10, 'ENTRY_VERIFIED', {}, op);
  framework.addEvent(s10, 'CONTRACT_DRAFTED', {}, op);
  framework.addEvent(s10, 'CONTRACT_SENT', {}, op);
  assert.ok(s10.contractDrafted);
  assert.ok(s10.contractSent);
});

test('monitor session: stay warm contact', () => {
  const s10 = mockPriorSession(10);
  const s11 = framework.createMonitorSession(s10, 11);
  const op = { operatorId: 'test' };

  framework.addEvent(s11, 'STAY_WARM_CONTACT_MADE', { date: new Date().toISOString() }, op);
  assert.ok(s11.lastWarmContact);
  assert.strictEqual(s11.warmContactDue, false);
});

test('buildPostOfferNote includes stage info', () => {
  const s3 = mockPriorSession(3);
  const s4 = framework.createPostOfferSession(s3, 4);
  const note = framework.buildPostOfferNote(s4);
  assert.ok(note.includes('KAYLA STAGE 4'));
  assert.ok(note.includes('123 Main St'));
  assert.ok(note.includes('Offer Sent to Lead'));
});

// === TELEGRAM TESTS ===
test('telegram: handleStageCommand for stage 4', () => {
  const ctx = mockCtx();
  const testDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage4-test');
  const priorDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage3-test');
  fs.mkdirSync(priorDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });

  const s3 = mockPriorSession(3);
  fs.writeFileSync(path.join(priorDir, 'test-stage3.json'), JSON.stringify(s3, null, 2));

  const opts = { stageDataDir: testDir, priorStageDataDir: priorDir };
  const r1 = telegram.handleStageCommand(ctx, 'start stage 4 review', 4, opts);
  assert.ok(r1, 'r1 should exist');
  assert.ok(r1.reply.includes('Stage 4'), `r1: ${r1.reply}`);

  const r2 = telegram.handleStageCommand(ctx, 'verify entry', 4, opts);
  assert.ok(r2, 'r2 should exist');

  const r3 = telegram.handleStageCommand(ctx, 'confirm receipt', 4, opts);
  assert.ok(r3, 'r3 should exist');

  const r4 = telegram.handleStageCommand(ctx, 'simulate exit', 4, opts);
  assert.ok(r4, 'r4 should exist');
  assert.ok(r4.reply.includes('satisfied'), `r4: ${r4.reply}`);

  try { fs.unlinkSync(path.join(priorDir, 'test-stage3.json')); } catch (_) {}
});

test('telegram: handleStageCommand for stage 7 (no-answer)', () => {
  const ctx = mockCtx();
  const testDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage7-test');
  const priorDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage6-test');
  fs.mkdirSync(priorDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });

  const s6 = mockPriorSession(6);
  fs.writeFileSync(path.join(priorDir, 'test-stage6.json'), JSON.stringify(s6, null, 2));

  const opts = { stageDataDir: testDir, priorStageDataDir: priorDir };
  telegram.handleStageCommand(ctx, 'start stage 7 review', 7, opts);
  telegram.handleStageCommand(ctx, 'verify entry', 7, opts);

  const r3 = telegram.handleStageCommand(ctx, 'send voice memo', 7, opts);
  assert.ok(r3, 'voice memo should work');

  const r4 = telegram.handleStageCommand(ctx, 'send loi2days', 7, opts);
  assert.ok(r4, 'loi2days should work');

  const r5 = telegram.handleStageCommand(ctx, 'send sd', 7, opts);
  assert.ok(r5, 'sd should work');

  const r6 = telegram.handleStageCommand(ctx, 'note dom', 7, opts);
  assert.ok(r6, 'dom should work');

  const r7 = telegram.handleStageCommand(ctx, 'calculate listing expiry', 7, opts);
  assert.ok(r7, 'listing expiry should work');

  try { fs.unlinkSync(path.join(priorDir, 'test-stage6.json')); } catch (_) {}
});

test('telegram: handleStageCommand for stage 11 (monitor)', () => {
  const ctx = mockCtx();
  const testDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage11-test');
  const priorDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage10-test');
  fs.mkdirSync(priorDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });

  const s10 = mockPriorSession(10);
  fs.writeFileSync(path.join(priorDir, 'test-stage10.json'), JSON.stringify(s10, null, 2));

  const opts = { stageDataDir: testDir, priorStageDataDir: priorDir };
  const r1 = telegram.handleStageCommand(ctx, 'start stage 11 review', 11, opts);
  assert.ok(r1, 'r1 should exist');
  assert.ok(r1.reply.includes('Stage 11'), `r1: ${r1.reply}`);

  const r2 = telegram.handleStageCommand(ctx, 'stay warm', 11, opts);
  assert.ok(r2, 'stay warm should work');

  const r3 = telegram.handleStageCommand(ctx, 'show notes', 11, opts);
  assert.ok(r3, 'show notes should work');

  try { fs.unlinkSync(path.join(priorDir, 'test-stage10.json')); } catch (_) {}
});

test('telegram: handleStageCommand for stage 21 (closed)', () => {
  const ctx = mockCtx();
  const testDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage21-test');
  const priorDir = path.resolve(REPORTS_DIR, '..', '..', 'data', 'kayla-stage20-test');
  fs.mkdirSync(priorDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });

  const s20 = mockPriorSession(20);
  fs.writeFileSync(path.join(priorDir, 'test-stage20.json'), JSON.stringify(s20, null, 2));

  const opts = { stageDataDir: testDir, priorStageDataDir: priorDir };
  const r1 = telegram.handleStageCommand(ctx, 'start stage 21 review', 21, opts);
  assert.ok(r1, 'r1 should exist');
  assert.ok(r1.reply.includes('Stage 21'), `r1: ${r1.reply}`);

  try { fs.unlinkSync(path.join(priorDir, 'test-stage20.json')); } catch (_) {}
});

// === PRODUCTION SAFETY ===
test('production safety: all counters zero in post-offer session', () => {
  const s3 = mockPriorSession(3);
  const s4 = framework.createPostOfferSession(s3, 4);
  assert.strictEqual(s4.counters.sends, 0);
  assert.strictEqual(s4.counters.calls, 0);
  assert.strictEqual(s4.counters.ghlWrites, 0);
  assert.strictEqual(s4.counters.stageMovements, 0);
});

test('production safety: all counters zero in monitor session', () => {
  const s10 = mockPriorSession(10);
  const s11 = framework.createMonitorSession(s10, 11);
  assert.strictEqual(s11.counters.sends, 0);
  assert.strictEqual(s11.counters.calls, 0);
  assert.strictEqual(s11.counters.ghlWrites, 0);
  assert.strictEqual(s11.counters.stageMovements, 0);
});

test('production safety: all events tagged SIMULATION', () => {
  const s3 = mockPriorSession(3);
  const s4 = framework.createPostOfferSession(s3, 4);
  framework.addEvent(s4, 'SESSION_STARTED', {}, { operatorId: 'test' });
  framework.addEvent(s4, 'ENTRY_VERIFIED', {}, { operatorId: 'test' });
  for (const evt of s4.journal) {
    assert.strictEqual(evt.mode, 'SIMULATION');
  }
});

// === REPORT ===
const report = {
  timestamp: new Date().toISOString(),
  stages: 'Stages 4-21 — Post-Offer and Monitor',
  totalTests: passed + failed,
  passed,
  failed,
  productionSafety: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 },
};
fs.writeFileSync(path.join(REPORTS_DIR, 'acceptance-report.json'), JSON.stringify(report, null, 2));

console.log(`\nStages 4-21 Acceptance: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
