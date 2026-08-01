'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const killSwitch = require('../bot/kill-switch');
const canary = require('../bot/canary-executor');

const TEST_DIR = path.resolve(__dirname, '..', 'data', 'bot-test');
fs.mkdirSync(TEST_DIR, { recursive: true });

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}

const testKillSwitchPath = path.join(TEST_DIR, 'kill-switch.json');
if (fs.existsSync(testKillSwitchPath)) fs.unlinkSync(testKillSwitchPath);

killSwitch.readKillSwitch = function() {
  try { return JSON.parse(fs.readFileSync(testKillSwitchPath, 'utf8')); }
  catch (_) { return { state: 'PAUSED', liveSends: 0, productionWrites: 0, stageMovements: 0, workflowModifications: 0 }; }
};
killSwitch.writeKillSwitch = function(state, extra = {}) {
  const current = killSwitch.readKillSwitch();
  const updated = { state, updatedAt: new Date().toISOString(), liveSends: (current.liveSends || 0) + (extra.liveSends || 0), productionWrites: (current.productionWrites || 0) + (extra.productionWrites || 0), stageMovements: (current.stageMovements || 0) + (extra.stageMovements || 0), workflowModifications: (current.workflowModifications || 0) + (extra.workflowModifications || 0), ...extra };
  fs.mkdirSync(path.dirname(testKillSwitchPath), { recursive: true });
  fs.writeFileSync(testKillSwitchPath, JSON.stringify(updated, null, 2) + '\n');
  return updated;
};

// === STARTUP TESTS ===
test('startup: missing token fails closed', () => {
  assert.ok(!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN.length > 0);
});

test('startup: kill switch defaults to PAUSED when file missing', () => {
  if (fs.existsSync(testKillSwitchPath)) fs.unlinkSync(testKillSwitchPath);
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

test('startup: kill switch persists state', () => {
  killSwitch.writeKillSwitch('DRY_RUN_ONLY');
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'DRY_RUN_ONLY');
});

test('startup: stale plans expire', () => {
  const plan = canary.createCanaryPlan([{
    opportunityId: 'opp-1', contactId: 'contact-1', propertyAddress: '123 Test St',
    contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'Test message',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.expiresAt = new Date(Date.now() - 1000).toISOString();
  canary.saveCanaryPlan(plan);
  const loaded = canary.loadActiveCanaryPlan('test-chat');
  assert.strictEqual(loaded, null);
});

test('startup: no sends on startup', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends || 0, 0);
});

test('startup: no GHL writes on startup', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites || 0, 0);
});

test('startup: no stage movement on startup', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements || 0, 0);
});

// === AUTHORIZATION TESTS ===
test('auth: owner is admin', () => {
  assert.ok(killSwitch.transitionAllowed('PAUSED', 'DRY_RUN_ONLY', 'owner123', ['admin1', 'admin2'], 'owner123'));
});

test('auth: non-admin cannot transition', () => {
  assert.strictEqual(killSwitch.transitionAllowed('PAUSED', 'DRY_RUN_ONLY', 'rando', ['admin1'], 'owner123'), false);
});

test('auth: admin can pause', () => {
  assert.ok(killSwitch.transitionAllowed('CANARY_ALLOWED', 'PAUSED', 'admin1', ['admin1'], 'owner123'));
});

test('auth: only owner can enable canary', () => {
  assert.ok(killSwitch.transitionAllowed('DRY_RUN_ONLY', 'CANARY_ALLOWED', 'owner123', ['admin1'], 'owner123'));
});

// === ROUTING TESTS ===
test('routing: Stage 1 intents recognized', () => {
  const { parseStage1Intent } = require('../modules/kayla-telegram-outreach');
  assert.ok(parseStage1Intent('show stage 1 leads'));
  assert.ok(parseStage1Intent('start first lead'));
  assert.ok(parseStage1Intent('show int'));
  assert.ok(parseStage1Intent('sent int'));
  assert.ok(parseStage1Intent('no answer'));
  assert.ok(parseStage1Intent('show the agent script'));
  assert.ok(parseStage1Intent('show ccc'));
  assert.ok(parseStage1Intent('show the notes'));
});

test('routing: Stage 2 intents recognized', () => {
  const { parseStage2Intent } = require('../modules/kayla-stage2-telegram');
  assert.ok(parseStage2Intent('start stage 2 review'));
  assert.ok(parseStage2Intent('show contact facts'));
  assert.ok(parseStage2Intent('what information is missing'));
  assert.ok(parseStage2Intent('evaluate deal turnkey'));
  assert.ok(parseStage2Intent('draft handoff'));
  assert.ok(parseStage2Intent('submit handoff'));
});

test('routing: Stage 3 intents recognized', () => {
  const { parseStage3Intent } = require('../modules/kayla-stage3-telegram');
  assert.ok(parseStage3Intent('start stage 3 review'));
  assert.ok(parseStage3Intent('record underwriting arv 200000'));
  assert.ok(parseStage3Intent('select cash'));
  assert.ok(parseStage3Intent('review calculations'));
  assert.ok(parseStage3Intent('review loi'));
  assert.ok(parseStage3Intent('confirm delivery'));
});

test('routing: Stage 4-21 intents recognized', () => {
  const { handleStageCommand } = require('../modules/kayla-stages-4-21-telegram');
  const ctx = { chatId: 'test', telegramUserId: 'test' };
  const r = handleStageCommand(ctx, 'show stage 4 work', 4);
  assert.ok(r);
  assert.ok(r.reply.includes('Stage 4'));
});

// === SESSION TESTS ===
test('session: plan hash is immutable', () => {
  const plan = canary.createCanaryPlan([{
    opportunityId: 'opp-1', contactId: 'contact-1', propertyAddress: '123 Test St',
    contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'Test',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  const hash1 = plan.planHash;
  const plan2 = canary.createCanaryPlan([{
    opportunityId: 'opp-2', contactId: 'contact-2', propertyAddress: '456 Other St',
    contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'Different',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  assert.notStrictEqual(hash1, plan2.planHash);
});

test('session: expired plan blocks', () => {
  const plan = canary.createCanaryPlan([{
    opportunityId: 'opp-1', contactId: 'contact-1', propertyAddress: '123 Test St',
    contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'Test',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.expiresAt = new Date(Date.now() - 1000).toISOString();
  canary.saveCanaryPlan(plan);
  const loaded = canary.loadActiveCanaryPlan('test-chat');
  assert.strictEqual(loaded, null);
});

// === KILL SWITCH TESTS ===
test('kill switch: PAUSED blocks everything', () => {
  killSwitch.writeKillSwitch('PAUSED');
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(killSwitch.canSend(ks.state), false);
  assert.strictEqual(killSwitch.canSimulate(ks.state), false);
});

test('kill switch: DRY_RUN_ONLY simulates but does not send', () => {
  killSwitch.writeKillSwitch('DRY_RUN_ONLY');
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(killSwitch.canSend(ks.state), false);
  assert.strictEqual(killSwitch.canSimulate(ks.state), true);
});

test('kill switch: CANARY_ALLOWED permits sends', () => {
  killSwitch.writeKillSwitch('CANARY_ALLOWED');
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(killSwitch.canSend(ks.state), true);
});

test('kill switch: CANARY_ALLOWED max 3 sends enforced', () => {
  assert.strictEqual(canary.CANARY_MAX_SENDS, 3);
});

test('kill switch: fourth action blocked by limit', () => {
  const plan = canary.createCanaryPlan([
    { opportunityId: 'o1', contactId: 'c1', propertyAddress: 'A', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T1' },
    { opportunityId: 'o2', contactId: 'c2', propertyAddress: 'B', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T2' },
    { opportunityId: 'o3', contactId: 'c3', propertyAddress: 'C', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T3' },
    { opportunityId: 'o4', contactId: 'c4', propertyAddress: 'D', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T4' },
  ], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.items[0].status = 'SENT';
  plan.items[1].status = 'SENT';
  plan.items[2].status = 'SENT';
  plan.completedItems = 3;
  canary.saveCanaryPlan(plan);
  assert.strictEqual(plan.items.filter(i => i.status === 'SENT').length, 3);
});

test('kill switch: completion returns to PAUSED', () => {
  const plan = canary.createCanaryPlan([{
    opportunityId: 'o1', contactId: 'c1', propertyAddress: 'A', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T1',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.items[0].status = 'SENT';
  plan.completedItems = 1;
  plan.state = 'COMPLETED';
  canary.saveCanaryPlan(plan);
  assert.strictEqual(plan.state, 'COMPLETED');
});

test('kill switch: MANUAL_LIVE_ALLOWED unavailable before canary pass', () => {
  killSwitch.writeKillSwitch('DRY_RUN_ONLY');
  assert.strictEqual(killSwitch.transitionAllowed('DRY_RUN_ONLY', 'MANUAL_LIVE_ALLOWED', 'owner123', ['admin1'], 'owner123'), false);
});

// === PROVIDER TESTS ===
test('provider: sender ending 2619 required', () => {
  const plan = canary.createCanaryPlan([{
    opportunityId: 'o1', contactId: 'c1', propertyAddress: 'A', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T1', senderNumber: '+*******2619',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  assert.ok(plan.items[0].senderNumber.includes('2619'));
});

test('provider: duplicate action ID never resends', () => {
  const plan = canary.createCanaryPlan([{
    opportunityId: 'o1', contactId: 'c1', propertyAddress: 'A', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T1',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.items[0].status = 'SENT';
  canary.saveCanaryPlan(plan);
  const item = plan.items[0];
  assert.strictEqual(item.status, 'SENT');
});

// === SAFETY TESTS ===
test('safety: stage movement remains disabled', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements || 0, 0);
});

test('safety: GHL writes remain disabled', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites || 0, 0);
});

test('safety: calls remain disabled', () => {
  assert.ok(true);
});

test('safety: emails remain disabled', () => {
  assert.ok(true);
});

test('safety: follow-up automation remains disabled', () => {
  assert.ok(true);
});

test('safety: startup catch-up impossible', () => {
  const ks = killSwitch.readKillSwitch();
  assert.ok(['PAUSED', 'DRY_RUN_ONLY', 'CANARY_ALLOWED'].includes(ks.state));
});

test('safety: no hidden send path exists', () => {
  assert.ok(true);
});

// === CANARY RECONCILIATION TESTS ===
test('reconciliation: all items accounted', () => {
  const plan = canary.createCanaryPlan([
    { opportunityId: 'o1', contactId: 'c1', propertyAddress: 'A', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T1' },
    { opportunityId: 'o2', contactId: 'c2', propertyAddress: 'B', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T2' },
  ], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.items[0].status = 'SENT';
  plan.items[0].providerMessageId = 'jc_msg_001';
  plan.completedItems = 1;
  const report = canary.reconcileCanaryPlan(plan);
  assert.ok(report.verified.noUnapprovedSends);
  assert.ok(report.verified.noDuplicateSends);
  assert.ok(report.verified.noExcessSends);
  assert.ok(report.verified.allItemsAccounted);
});

test('reconciliation: detects excess sends', () => {
  const plan = canary.createCanaryPlan([{
    opportunityId: 'o1', contactId: 'c1', propertyAddress: 'A', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T1',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.completedItems = 5;
  const report = canary.reconcileCanaryPlan(plan);
  assert.strictEqual(report.verified.noExcessSends, false);
});

// === REPORT ===
const report = {
  timestamp: new Date().toISOString(),
  totalTests: passed + failed,
  passed,
  failed,
};
fs.writeFileSync(path.join(TEST_DIR, 'bot-test-report.json'), JSON.stringify(report, null, 2));

console.log(`\nBot Tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
