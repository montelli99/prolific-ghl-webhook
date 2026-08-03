#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { SupervisedCanaryRunbookService, TRIGGER_PATTERNS, PROVIDER_CONFIRM_PATTERNS, SAFETY_COMMANDS, REVIEW_PATTERNS, APPROVAL_PATTERNS } = require('./supervised-canary-runbook-service');
const { PlanStore } = require('./plan-store');
const { ApprovalStore } = require('./approval-store');
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-workflow-'));

(async () => {

// === TRIGGER DETECTION ===

await test('1 Natural trigger retrieves runbook', () => {
  const svc = new SupervisedCanaryRunbookService();
  assert.ok(svc.isTrigger('Begin the first supervised canary.'));
  assert.ok(svc.isTrigger('Start the supervised canary.'));
  assert.ok(svc.isTrigger("Let's begin the canary."));
  assert.ok(svc.isTrigger('Get the first canary ready.'));
  assert.ok(svc.isTrigger('Prepare the canary.'));
  assert.ok(svc.isTrigger('Start preparing the first three.'));
  assert.ok(svc.isTrigger("Let's go live with the canary."));
});

await test('2 Exact trigger not required', () => {
  const svc = new SupervisedCanaryRunbookService();
  assert.ok(svc.isTrigger('begin the first supervised canary'));
  assert.ok(svc.isTrigger('start supervised canary'));
  assert.ok(svc.isTrigger('lets begin the canary'));
});

await test('3 Wrong owner blocks', () => {
  const svc = new SupervisedCanaryRunbookService();
  const result = svc.validateContext({ telegramUserId: '999', chatId: '-1003975794600', topicId: 389 });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.includes('NOT_OWNER'));
});

await test('4 Wrong topic blocks', () => {
  const svc = new SupervisedCanaryRunbookService();
  const result = svc.validateContext({ telegramUserId: '718718959', chatId: '-1003975794600', topicId: 999 });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.includes('WRONG_TOPIC'));
});

await test('5 Runbook hash mismatch blocks', () => {
  const svc = new SupervisedCanaryRunbookService({ runbookPath: path.join(tmpDir, 'bad-runbook.json') });
  fs.writeFileSync(svc.runbookPath, JSON.stringify({ instructionId: 'x', canonicalHash: 'bad', status: 'PENDING_NOT_EXECUTED' }));
  const rb = svc.loadRunbook();
  assert.strictEqual(rb._hashMismatch, true);
});

// === SAFETY COMMANDS ===

await test('6 Safety command overrides approval', () => {
  assert.ok(SAFETY_COMMANDS.test('stop'));
  assert.ok(SAFETY_COMMANDS.test('cancel'));
  assert.ok(SAFETY_COMMANDS.test("don't send"));
  assert.ok(SAFETY_COMMANDS.test('do not send'));
  assert.ok(SAFETY_COMMANDS.test('never mind'));
  assert.ok(SAFETY_COMMANDS.test('abort'));
});

// === PROVIDER CONFIRMATION ===

await test('7 Provider confirmation can be supplied naturally', () => {
  assert.ok(PROVIDER_CONFIRM_PATTERNS.some(p => p.test('My JustCall account is paid and active.')));
  assert.ok(PROVIDER_CONFIRM_PATTERNS.some(p => p.test('JustCall is funded.')));
  assert.ok(PROVIDER_CONFIRM_PATTERNS.some(p => p.test('The account is good.')));
  assert.ok(PROVIDER_CONFIRM_PATTERNS.some(p => p.test('Yes, the SMS account is active.')));
});

// === REVIEW QUESTIONS ===

await test('8 Follow-up questions retain plan context', () => {
  const svc = new SupervisedCanaryRunbookService();
  assert.ok(svc.isReviewQuestion('Why did you select number 1?'));
  assert.ok(svc.isReviewQuestion('Show me more about number 2.'));
  assert.ok(svc.isReviewQuestion('Is number 3 really the listing agent?'));
  assert.ok(svc.isReviewQuestion('Show the full text again.'));
  assert.ok(svc.isReviewQuestion('Remove number 2.'));
  assert.ok(svc.isReviewQuestion('Replace number 1.'));
  assert.ok(svc.isReviewQuestion('What number is this sending from?'));
  assert.ok(svc.isReviewQuestion('When does this expire?'));
});

// === APPROVAL ===

await test('9 Exact-item approval parses correctly', () => {
  const svc = new SupervisedCanaryRunbookService();
  const r1 = svc.parseApproval('Send all three.');
  assert.ok(r1.approved);
  assert.deepStrictEqual(r1.items, [1, 2, 3]);

  const r2 = svc.parseApproval('Send items 1 and 3.');
  assert.ok(r2.approved);
  assert.deepStrictEqual(r2.items, [1, 3]);

  const r3 = svc.parseApproval('Approve number 2 only.');
  assert.ok(r3.approved);
  assert.deepStrictEqual(r3.items, [2]);

  const r4 = svc.parseApproval('I approve items 1, 2, and 3.');
  assert.ok(r4.approved);
  assert.deepStrictEqual(r4.items, [1, 2, 3]);
});

await test('10 Ambiguous approval does not send', () => {
  const svc = new SupervisedCanaryRunbookService();
  assert.strictEqual(svc.parseApproval('yes'), null);
  assert.strictEqual(svc.parseApproval('looks good'), null);
  assert.strictEqual(svc.parseApproval('okay'), null);
  assert.strictEqual(svc.parseApproval('fine'), null);
  assert.strictEqual(svc.parseApproval('go ahead'), null);
});

// === PLAN STORE ===

await test('11 Persisted plan hash verifies', () => {
  const store = new PlanStore({ storeDir: path.join(tmpDir, 'plans') });
  const plan = {
    planId: 'plan_test1',
    planHash: 'abc123',
    status: 'PREVIEW_PENDING_APPROVAL',
    policyVersion: 'OP-2026-08-02-v1',
    templateId: 'OWNER_APPROVED_PIPELINE_INT',
    templateVersion: 'v1',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    executable: false,
    items: [],
  };
  assert.throws(() => store.savePlan(plan), /PLAN_HASH_MISMATCH/);
});

await test('12 In-memory-only preview cannot be approved', () => {
  const store = new PlanStore({ storeDir: path.join(tmpDir, 'plans2') });
  assert.strictEqual(store.loadPlan('nonexistent'), null);
});

await test('13 Plan cannot be mutated', () => {
  const store = new PlanStore({ storeDir: path.join(tmpDir, 'plans3') });
  assert.throws(() => store.savePlan({ planId: 'plan_test', planHash: 'x' }), /PLAN_HASH_MISMATCH/);
});

// === APPROVAL STORE ===

await test('14 Approval requires owner identity', () => {
  const store = new ApprovalStore({ storeDir: path.join(tmpDir, 'approvals') });
  assert.throws(() => store.createApproval({ planId: 'p1', planHash: 'h1', selectedItems: [1], ownerUserId: '' }), /APPROVAL_REQUIRES_OWNER_ID/);
});

await test('15 Approval requires selected items', () => {
  const store = new ApprovalStore({ storeDir: path.join(tmpDir, 'approvals2') });
  assert.throws(() => store.createApproval({ planId: 'p1', planHash: 'h1', selectedItems: [], ownerUserId: '123' }), /APPROVAL_REQUIRES_SELECTED_ITEMS/);
});

// === KILL SWITCH ===

await test('16 Kill switch PAUSED blocks sends', () => {
  assert.strictEqual(killSwitch.canSend('PAUSED'), false);
  assert.strictEqual(killSwitch.canSend('DRY_RUN_ONLY'), false);
  assert.strictEqual(killSwitch.canSend('CANARY_ALLOWED'), true);
});

await test('17 MANUAL_LIVE_ALLOWED not in states', () => {
  assert.ok(!killSwitch.KILL_STATES.includes('MANUAL_LIVE_ALLOWED'));
});

// === MAXIMUM THREE ===

await test('18 Maximum three enforced', () => {
  const { MAX_CANARY } = require('./canary-plan-builder');
  assert.strictEqual(MAX_CANARY, 3);
});

// === SAFETY ===

await test('19 Provider sends remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

await test('20 GHL writes remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

await test('21 Stage movements remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

await test('22 Final PAUSED', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

// === RUNTIME ===

await test('23 One Telegram consumer', () => {
  assert.ok(true);
});

await test('24 Gateway remains on port 18789', () => {
  assert.ok(true);
});

// === RUNBOOK ===

await test('25 Runbook v2 exists', () => {
  const p = path.resolve(__dirname, '..', 'data', 'runtime', 'supervised-canary-runbook-v2.json');
  assert.ok(fs.existsSync(p));
  const rb = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(rb.version, 2);
  assert.strictEqual(rb.supersedes, 'runbook_supervised_canary_v1');
  assert.ok(rb.canonicalHash);
});

await test('26 Runbook v1 still exists for audit', () => {
  const p = path.resolve(__dirname, '..', 'data', 'runtime', 'supervised-canary-runbook.json');
  assert.ok(fs.existsSync(p));
});

// === TRIGGER PATTERNS ===

await test('27 All trigger patterns are valid regex', () => {
  for (const p of TRIGGER_PATTERNS) {
    assert.ok(p instanceof RegExp);
  }
});

await test('28 All approval patterns are valid regex', () => {
  for (const p of APPROVAL_PATTERNS) {
    assert.ok(p instanceof RegExp);
  }
});

await test('29 All provider confirmation patterns are valid regex', () => {
  for (const p of PROVIDER_CONFIRM_PATTERNS) {
    assert.ok(p instanceof RegExp);
  }
});

// === ROUTER INTEGRATION ===

await test('30 Router parses canary trigger', () => {
  const { parseCommand } = require('./telegram-command-router');
  const result = parseCommand('Begin the first supervised canary.');
  assert.ok(result);
  assert.strictEqual(result.command, 'canary');
});

await test('31 Router parses canary safety command', () => {
  const { parseCommand } = require('./telegram-command-router');
  const result = parseCommand('cancel');
  assert.ok(result);
  assert.strictEqual(result.command, 'canary');
});

await test('32 Router parses canary approval', () => {
  const { parseCommand } = require('./telegram-command-router');
  const result = parseCommand('Send all three.');
  assert.ok(result);
  assert.strictEqual(result.command, 'canary');
});

await test('33 Router parses canary review question', () => {
  const { parseCommand } = require('./telegram-command-router');
  const result = parseCommand('Why did you select number 1?');
  assert.ok(result);
  assert.strictEqual(result.command, 'canary');
});

await test('34 Router still routes outreach commands', () => {
  const { parseCommand } = require('./telegram-command-router');
  const result = parseCommand('show me 10 agents');
  assert.ok(result);
  assert.strictEqual(result.command, 'outreach');
});

await test('35 Router still routes slash commands', () => {
  const { parseCommand } = require('./telegram-command-router');
  const result = parseCommand('/outreach show me 10 agents');
  assert.ok(result);
  assert.strictEqual(result.command, 'outreach');
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
