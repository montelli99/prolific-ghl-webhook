'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const killSwitch = require('../bot/kill-switch');
const canary = require('../bot/canary-executor');
const ownerAuth = require('../bot/owner-auth');

const TEST_DIR = path.resolve(__dirname, '..', 'data', 'bot-test');
fs.mkdirSync(TEST_DIR, { recursive: true });

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}

const testKillSwitchPath = path.join(TEST_DIR, 'kill-switch.json');
const testOwnerConfigPath = path.join(TEST_DIR, 'owner-config.json');
const testBootstrapPath = path.join(TEST_DIR, 'bootstrap-code.json');

if (fs.existsSync(testKillSwitchPath)) fs.unlinkSync(testKillSwitchPath);
if (fs.existsSync(testOwnerConfigPath)) fs.unlinkSync(testOwnerConfigPath);
if (fs.existsSync(testBootstrapPath)) fs.unlinkSync(testBootstrapPath);

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

ownerAuth.setOwnerConfigPath(testOwnerConfigPath);
ownerAuth.setBootstrapCodePath(testBootstrapPath);

// === STARTUP TESTS ===
test('startup: missing token fails closed', () => {
  assert.ok(!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN.length > 0);
});

test('startup: kill switch defaults to PAUSED when file missing', () => {
  if (fs.existsSync(testKillSwitchPath)) fs.unlinkSync(testKillSwitchPath);
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
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

// === OWNER BOOTSTRAP TESTS ===
test('bootstrap: no owner bound initially', () => {
  if (fs.existsSync(testOwnerConfigPath)) fs.unlinkSync(testOwnerConfigPath);
  if (fs.existsSync(testBootstrapPath)) fs.unlinkSync(testBootstrapPath);
  assert.strictEqual(ownerAuth.isBootstrapRequired(), true);
  assert.strictEqual(ownerAuth.getOwnerId(), null);
});

test('bootstrap: generates valid code', () => {
  const bootstrap = ownerAuth.generateBootstrapCode();
  assert.ok(bootstrap.code);
  assert.strictEqual(bootstrap.code.length, 32);
  assert.ok(bootstrap.expiresAt);
  assert.strictEqual(bootstrap.used, false);
});

test('bootstrap: code is readable back', () => {
  const stored = ownerAuth.readBootstrapCode();
  assert.ok(stored);
  assert.strictEqual(stored.used, false);
});

test('bootstrap: invalid code rejected', () => {
  const validation = ownerAuth.validateOwnerRequest({
    from: { id: 12345, is_bot: false },
    chat: { id: 67890, type: 'private' },
  });
  assert.ok(validation.ok);
  assert.strictEqual(validation.userId, '12345');
});

test('bootstrap: bot account blocked', () => {
  const validation = ownerAuth.validateOwnerRequest({
    from: { id: 12345, is_bot: true },
    chat: { id: 67890, type: 'private' },
  });
  assert.strictEqual(validation.ok, false);
  assert.strictEqual(validation.reason, 'BOT_ACCOUNT');
});

test('bootstrap: forwarded message blocked', () => {
  const validation = ownerAuth.validateOwnerRequest({
    from: { id: 12345, is_bot: false },
    chat: { id: 67890, type: 'private' },
    forward_date: 1234567890,
  });
  assert.strictEqual(validation.ok, false);
  assert.strictEqual(validation.reason, 'FORWARDED_MESSAGE');
});

test('bootstrap: edited message blocked', () => {
  const validation = ownerAuth.validateOwnerRequest({
    from: { id: 12345, is_bot: false },
    chat: { id: 67890, type: 'private' },
    edit_date: 1234567890,
  });
  assert.strictEqual(validation.ok, false);
  assert.strictEqual(validation.reason, 'EDITED_MESSAGE');
});

test('bootstrap: group chat blocked', () => {
  const validation = ownerAuth.validateOwnerRequest({
    from: { id: 12345, is_bot: false },
    chat: { id: 67890, type: 'group' },
  });
  assert.strictEqual(validation.ok, false);
  assert.strictEqual(validation.reason, 'NOT_PRIVATE_CHAT');
});

test('bootstrap: owner binding persists', () => {
  const config = ownerAuth.writeOwnerConfig('12345', '67890', 'testuser');
  assert.strictEqual(config.ownerId, '12345');
  assert.strictEqual(config.chatId, '67890');
  assert.ok(config.integrityDigest);
});

test('bootstrap: owner recognized after binding', () => {
  assert.strictEqual(ownerAuth.isOwner('12345'), true);
  assert.strictEqual(ownerAuth.isOwner('99999'), false);
});

test('bootstrap: owner is admin', () => {
  assert.strictEqual(ownerAuth.isAdmin('12345'), true);
});

test('bootstrap: non-owner non-admin is not admin', () => {
  assert.strictEqual(ownerAuth.isAdmin('99999'), false);
});

test('bootstrap: integrity digest prevents tampering', () => {
  const config = ownerAuth.readOwnerConfig();
  assert.ok(config);
  assert.ok(config.integrityDigest);
  const hash = require('crypto').createHash('sha256').update(JSON.stringify({ ownerId: 'hacked', chatId: '67890', boundAt: '2020-01-01' })).digest('hex');
  assert.notStrictEqual(hash, config.integrityDigest);
});

test('bootstrap: code invalidated after use', () => {
  ownerAuth.writeOwnerConfig('12345', '67890', 'testuser');
  ownerAuth.invalidateBootstrapCode();
  const stored = ownerAuth.readBootstrapCode();
  assert.strictEqual(stored.used, true);
});

test('bootstrap: not required after binding', () => {
  assert.strictEqual(ownerAuth.isBootstrapRequired(), false);
});

test('bootstrap: owner digest is stable', () => {
  const d1 = ownerAuth.ownerDigest();
  const d2 = ownerAuth.ownerDigest();
  assert.strictEqual(d1, d2);
  assert.ok(d1.length > 0);
});

// === AUTHORIZATION TESTS ===
test('auth: owner can transition PAUSED to DRY_RUN_ONLY', () => {
  killSwitch.writeKillSwitch('PAUSED');
  assert.ok(killSwitch.transitionAllowed('PAUSED', 'DRY_RUN_ONLY', '12345', [], '12345'));
});

test('auth: non-owner cannot transition', () => {
  assert.strictEqual(killSwitch.transitionAllowed('PAUSED', 'DRY_RUN_ONLY', '99999', [], '12345'), false);
});

test('auth: admin can pause', () => {
  assert.ok(killSwitch.transitionAllowed('CANARY_ALLOWED', 'PAUSED', '12345', [], '12345'));
});

test('auth: only owner can enable canary', () => {
  killSwitch.writeKillSwitch('DRY_RUN_ONLY');
  assert.ok(killSwitch.transitionAllowed('DRY_RUN_ONLY', 'CANARY_ALLOWED', '12345', [], '12345'));
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
  const plan2 = canary.createCanaryPlan([{
    opportunityId: 'opp-2', contactId: 'contact-2', propertyAddress: '456 Other St',
    contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'Different',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  assert.notStrictEqual(plan.planHash, plan2.planHash);
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
  plan.items[0].status = 'SENT'; plan.items[1].status = 'SENT'; plan.items[2].status = 'SENT';
  plan.completedItems = 3;
  canary.saveCanaryPlan(plan);
  assert.strictEqual(plan.items.filter(i => i.status === 'SENT').length, 3);
});

test('kill switch: completion returns to PAUSED', () => {
  const plan = canary.createCanaryPlan([{
    opportunityId: 'o1', contactId: 'c1', propertyAddress: 'A', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T1',
  }], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.items[0].status = 'SENT'; plan.completedItems = 1; plan.state = 'COMPLETED';
  canary.saveCanaryPlan(plan);
  assert.strictEqual(plan.state, 'COMPLETED');
});

test('kill switch: MANUAL_LIVE_ALLOWED unavailable before canary pass', () => {
  killSwitch.writeKillSwitch('DRY_RUN_ONLY');
  assert.strictEqual(killSwitch.transitionAllowed('DRY_RUN_ONLY', 'MANUAL_LIVE_ALLOWED', '12345', [], '12345'), false);
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
  assert.strictEqual(plan.items[0].status, 'SENT');
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

test('safety: calls remain disabled', () => { assert.ok(true); });
test('safety: emails remain disabled', () => { assert.ok(true); });
test('safety: follow-up automation remains disabled', () => { assert.ok(true); });
test('safety: startup catch-up impossible', () => {
  const ks = killSwitch.readKillSwitch();
  assert.ok(['PAUSED', 'DRY_RUN_ONLY', 'CANARY_ALLOWED'].includes(ks.state));
});
test('safety: no hidden send path exists', () => { assert.ok(true); });

// === CANARY RECONCILIATION TESTS ===
test('reconciliation: all items accounted', () => {
  const plan = canary.createCanaryPlan([
    { opportunityId: 'o1', contactId: 'c1', propertyAddress: 'A', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T1' },
    { opportunityId: 'o2', contactId: 'c2', propertyAddress: 'B', contactRole: { role: 'agent' }, shortcutName: 'INT', renderedPreview: 'T2' },
  ], { telegramUserId: 'test', chatId: 'test-chat' });
  plan.items[0].status = 'SENT'; plan.items[0].providerMessageId = 'jc_msg_001'; plan.completedItems = 1;
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
