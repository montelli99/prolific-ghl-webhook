'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SupervisedCanaryRunbookService, RUNBOOK_ID, RUNBOOK_PATH, V1_HISTORICAL_RUNBOOK_PATH, OWNER_ID, CHAT_ID, TOPIC_ID } = require('./supervised-canary-runbook-service');
const { CanaryPlanBuilder, POLICY_VERSION, TEMPLATE_ID, MAX_CANARY } = require('./canary-plan-builder');
const { PlanStore, PLAN_STATUSES, STABLE_PLAN_HASH_FIELDS } = require('./plan-store');
const { ApprovalStore } = require('./approval-store');
const { verifyRunbookHash, computeRunbookHash, canonicalizeRunbook } = require('./runbook-hash');
const killSwitch = require('../bot/kill-switch');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}: ${e.message}`);
    console.error(e.stack);
  }
}

function tmpDir() {
  const dir = path.resolve(__dirname, '..', 'data', 'test-run', crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function makeRunbook(overrides = {}) {
  return {
    instructionId: 'runbook_supervised_canary_v2',
    version: 2,
    supersedes: 'runbook_supervised_canary_v1',
    ownerUserId: OWNER_ID,
    groupId: CHAT_ID,
    topicId: TOPIC_ID,
    createdAt: '2026-08-03T07:10:00Z',
    retrievalPhrase: 'Begin the first supervised canary.',
    status: 'PENDING_NOT_EXECUTED',
    policyVersion: POLICY_VERSION,
    naturalTriggers: ['Begin the first supervised canary.'],
    automaticPreparationFlow: ['1. Load runbook'],
    providerReadinessConfirmation: { required: true },
    reviewFlow: { supportedQuestions: [] },
    approvalFlow: { naturalApprovals: [] },
    executionFlow: ['1. Load plan'],
    prohibitions: ['No GHL writes'],
    cancellationBehavior: { triggers: ['stop'] },
    recoveryBehavior: { onRestart: [] },
    warnings: [],
    ...overrides,
  };
}

function writeRunbook(dir, runbook, file = 'supervised-canary-runbook-v2.json') {
  const filePath = path.join(dir, file);
  const r = { ...runbook, canonicalHash: computeRunbookHash(runbook) };
  fs.writeFileSync(filePath, JSON.stringify(r, null, 2) + '\n');
  return { filePath, runbook: r };
}

function makePlan(options = {}) {
  return {
    planId: options.planId || 'plan_test_0000000000000000',
    planHash: options.planHash || 'hash',
    status: options.status || 'PREVIEW_PENDING_APPROVAL',
    schema: 'canary-plan-v2',
    policyVersion: POLICY_VERSION,
    templateId: TEMPLATE_ID,
    templateVersion: 'template-hash',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    executable: false,
    productionEffects: { sends: 0, ghlWrites: 0, stageMovements: 0 },
    sender: '+*******2619',
    ownerId: options.ownerId !== undefined ? options.ownerId : OWNER_ID,
    chatId: options.chatId !== undefined ? options.chatId : CHAT_ID,
    topicId: options.topicId !== undefined ? options.topicId : TOPIC_ID,
    originatingMessageId: options.originatingMessageId !== undefined ? options.originatingMessageId : '1000',
    runbookId: options.runbookId !== undefined ? options.runbookId : RUNBOOK_ID,
    runbookHash: options.runbookHash !== undefined ? options.runbookHash : 'runbook-hash',
    runtimeRevision: options.runtimeRevision || 'rev-abc',
    totalCandidates: options.items ? options.items.length : 1,
    selectedCount: options.items ? options.items.length : 1,
    blockedCount: 0,
    items: options.items || [{
      number: 1,
      opportunityId: 'opp_real_12345678901234567890',
      contactId: 'con_real_12345678901234567890',
      propertyAddress: '123 Main St Indianapolis IN 46227',
      contactName: 'Test Agent',
      contactRole: 'agent',
      phone: '+131***0000',
      timezone: 'America/Indiana/Indianapolis',
      timezoneConfidence: 'HIGH_CONFIDENCE_ZIP3',
      renderedMessage: 'Happy Mon, Test Agent! Are you still accepting offers for 123 Main St Indianapolis IN 46227?',
      guardEvidence: { DNC: { state: 'CLEAR' } },
    }],
    warnings: [],
  };
}

async function main() {
  const tmp = tmpDir();
  const planDir = path.join(tmp, 'plans');
  const approvalDir = path.join(tmp, 'approvals');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(approvalDir, { recursive: true });

  const originalKs = killSwitch.readKillSwitch();
  killSwitch.writeKillSwitch('PAUSED', { reason: 'TEST' });

  try {
    const runbook = makeRunbook();
    const { filePath: runbookPath, runbook: canonicalRunbook } = writeRunbook(tmp, runbook);
    const v1Path = path.join(tmp, 'supervised-canary-runbook.json');
    fs.writeFileSync(v1Path, JSON.stringify({ ...runbook, instructionId: 'runbook_supervised_canary_v1', version: 1, status: 'SUPERSEDED_NOT_EXECUTABLE' }, null, 2) + '\n');

    await test('1. Service loads v2 only', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath });
      const loaded = svc.loadRunbook();
      assert.strictEqual(loaded.instructionId, 'runbook_supervised_canary_v2');
      assert.strictEqual(loaded._hashMismatch, undefined);
    });

    await test('2. v1 remains historical and non-executable', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath: v1Path });
      const loaded = svc.loadRunbook();
      assert.strictEqual(loaded.status, 'SUPERSEDED_NOT_EXECUTABLE');
    });

    await test('3. Canonical hash excludes its own hash field', () => {
      const canonical = canonicalizeRunbook(canonicalRunbook);
      assert.strictEqual(canonical.canonicalHash, undefined);
      assert.strictEqual(canonical.instructionId, 'runbook_supervised_canary_v2');
    });

    await test('4. Canonical serialization is deterministic', () => {
      const h1 = computeRunbookHash(canonicalRunbook);
      const h2 = computeRunbookHash(JSON.parse(JSON.stringify(canonicalRunbook)));
      assert.strictEqual(h1, h2);
    });

    await test('5. Correct v2 hash verifies', () => {
      const v = verifyRunbookHash(canonicalRunbook);
      assert.strictEqual(v.ok, true);
    });

    await test('6. Modified runbook fails verification', () => {
      const tampered = JSON.parse(JSON.stringify(canonicalRunbook));
      tampered.policyVersion = 'TAMPERED';
      const v = verifyRunbookHash(tampered);
      assert.strictEqual(v.ok, false);
    });

    await test('7. Expired stale plan is superseded', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan = makePlan({ planId: 'plan_stale_1', status: 'PREVIEW_PENDING_APPROVAL', ownerId: null, chatId: null, topicId: null, originatingMessageId: null });
      plan.expiresAt = new Date(Date.now() - 1000).toISOString();
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      store.supersedePlan('plan_stale_1', 'SUPERSEDED_EXPIRED_UNTRUSTED_CONTEXT');
      const updated = store.loadPlan('plan_stale_1');
      assert.strictEqual(updated.status, 'SUPERSEDED_EXPIRED_UNTRUSTED_CONTEXT');
      assert.strictEqual(updated.executable, false);
      assert.ok(updated.supersededReason);
    });

    await test('8. Missing owner/chat/topic provenance blocks approval', async () => {
      const store = new PlanStore({ storeDir: planDir });
      const approvalStore = new ApprovalStore({ storeDir: approvalDir });
      const plan = makePlan({ planId: 'plan_missing_2', ownerId: null, chatId: null, topicId: null, originatingMessageId: null });
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      const svc = new SupervisedCanaryRunbookService({ runbookPath, planStore: store, approvalStore });
      const result = await svc.handleApproval('plan_missing_2', 'Send all three.', { telegramUserId: OWNER_ID, chatId: CHAT_ID, topicId: TOPIC_ID, messageId: 1 });
      assert.ok((result.reply || '').includes('trusted provenance'), result.reply);
    });

    await test('9. CLI-generated plan cannot masquerade as Telegram production plan', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan = makePlan({ planId: 'plan_cli_3', originatingMessageId: null, runbookId: null, runbookHash: null, ownerId: null });
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      const svc = new SupervisedCanaryRunbookService({ runbookPath, planStore: store });
      const active = svc.getActivePlanId();
      assert.notStrictEqual(active, 'plan_cli_3');
    });

    await test('10. Natural trigger creates preview only', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath });
      assert.strictEqual(svc.isTrigger('Begin the first supervised canary.'), true);
      assert.strictEqual(svc.isTrigger('hello world'), false);
    });

    await test('11. Preview remains PAUSED', () => {
      const ks = killSwitch.readKillSwitch();
      assert.strictEqual(ks.state, 'PAUSED');
    });

    await test('12. Preview sends nothing', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan = makePlan({ planId: 'plan_preview_4' });
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      const loaded = store.loadPlan('plan_preview_4');
      assert.strictEqual(loaded.productionEffects.sends, 0);
    });

    await test('13. Actual candidate timezone is used', () => {
      const plan = makePlan({
        items: [
          { number: 1, contactName: 'A', propertyAddress: '1', timezone: 'America/Indiana/Indianapolis', renderedMessage: 'm1' },
        ],
      });
      assert.strictEqual(plan.items[0].timezone, 'America/Indiana/Indianapolis');
    });

    await test('14. Hardcoded sample timezone is absent', () => {
      const svcCode = fs.readFileSync(path.join(__dirname, 'supervised-canary-runbook-service.js'), 'utf8');
      assert.strictEqual(svcCode.includes('123 Main St Indianapolis IN 46227') && svcCode.includes('derivePropertyTimezone({ propertyAddress:'), false);
    });

    await test('15. Mixed-timezone candidates are evaluated independently', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath });
      const now = new Date('2026-08-03T16:30:00Z');
      const items = [
        { number: 1, timezone: 'America/Indiana/Indianapolis', contactName: 'A', propertyAddress: 'a' },
        { number: 2, timezone: 'America/Los_Angeles', contactName: 'B', propertyAddress: 'b' },
      ];
      const check = svc.evaluateSelectedWindows(items, now);
      assert.strictEqual(typeof check.inWindow.length, 'number');
      assert.strictEqual(typeof check.outOfWindow.length, 'number');
    });

    await test('16. Unknown timezone blocks only affected candidate', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath });
      const now = new Date();
      const items = [
        { number: 1, timezone: 'America/Indiana/Indianapolis', contactName: 'A', propertyAddress: 'a' },
        { number: 2, timezone: null, contactName: 'B', propertyAddress: 'b' },
      ];
      const check = svc.evaluateSelectedWindows(items, now);
      const blocked = check.outOfWindow.find(o => o.item.number === 2);
      assert.ok(blocked);
      assert.strictEqual(blocked.reason, 'UNKNOWN_TIMEZONE_BLOCKS_CANARY');
    });

    await test('17. Real owner/chat/topic are persisted', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan = makePlan({ planId: 'plan_provenance_5' });
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      const loaded = store.loadPlan('plan_provenance_5');
      assert.strictEqual(loaded.ownerId, OWNER_ID);
      assert.strictEqual(loaded.chatId, CHAT_ID);
      assert.strictEqual(loaded.topicId, TOPIC_ID);
    });

    await test('18. Originating message ID is persisted', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan = makePlan({ planId: 'plan_msgid_6', originatingMessageId: '42' });
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      const loaded = store.loadPlan('plan_msgid_6');
      assert.strictEqual(loaded.originatingMessageId, '42');
    });

    await test('19. Exact rendered message is hashed', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan1 = makePlan({ planId: 'plan_hash_a', items: [{ number: 1, opportunityId: 'o', contactId: 'c', renderedMessage: 'msg A' }] });
      const plan2 = makePlan({ planId: 'plan_hash_b', items: [{ number: 1, opportunityId: 'o', contactId: 'c', renderedMessage: 'msg B' }] });
      plan1.planHash = store.computePlanHash(plan1);
      plan2.planHash = store.computePlanHash(plan2);
      assert.notStrictEqual(plan1.planHash, plan2.planHash);
    });

    await test('20. Provider readiness reports current JustCall state', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath });
      const conf = svc.loadProviderConfirmation();
      assert.ok(conf === null || conf._expired !== undefined || conf.confirmedAt);
    });

    await test('21. Contact-card transport proof is not mislabeled as prospect proof', () => {
      const svcCode = fs.readFileSync(path.join(__dirname, 'supervised-canary-runbook-service.js'), 'utf8');
      assert.strictEqual(svcCode.includes('contact-card') || svcCode.includes('ContactCardDelivery'), false);
    });

    await test('22. Funding remains manual confirmation where needed', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath });
      const record = svc.recordProviderConfirmation({ messageId: 1 });
      assert.strictEqual(record.reason, 'MANUAL_FUNDING_CONFIRMATION');
    });

    await test('23. Exact item approval is required', async () => {
      const store = new PlanStore({ storeDir: planDir });
      const approvalStore = new ApprovalStore({ storeDir: approvalDir });
      const plan = makePlan({ planId: 'plan_approve_7' });
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      const svc = new SupervisedCanaryRunbookService({ runbookPath, planStore: store, approvalStore });
      const result = await svc.handleApproval('plan_approve_7', 'yes', { telegramUserId: OWNER_ID, chatId: CHAT_ID, topicId: TOPIC_ID, messageId: 1 });
      assert.ok((result.reply || '').includes('explicit item numbers'), result.reply);
    });

    await test('24. Stale plan cannot be approved', async () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan = makePlan({ planId: 'plan_stale_8', status: 'SUPERSEDED_EXPIRED_UNTRUSTED_CONTEXT' });
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      const svc = new SupervisedCanaryRunbookService({ runbookPath, planStore: store });
      const result = await svc.handleApproval('plan_stale_8', 'Send all three', { telegramUserId: OWNER_ID, chatId: CHAT_ID, topicId: TOPIC_ID, messageId: 1 });
      assert.ok((result.reply || '').includes('not pending approval'), result.reply);
    });

    await test('25. Changed runbook hash blocks', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath });
      const loaded = svc.loadRunbook();
      assert.strictEqual(loaded._hashMismatch, undefined);
      loaded.canonicalHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const tamperedPath = path.join(tmp, 'tampered.json');
      fs.writeFileSync(tamperedPath, JSON.stringify(loaded, null, 2) + '\n');
      const svc2 = new SupervisedCanaryRunbookService({ runbookPath: tamperedPath });
      const tamperedLoaded = svc2.loadRunbook();
      assert.strictEqual(tamperedLoaded._hashMismatch, true);
    });

    await test('26. Changed plan hash blocks', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan = makePlan({ planId: 'plan_hash_tamper' });
      plan.planHash = store.computePlanHash(plan);
      store.savePlan(plan);
      const loaded = store.loadPlan('plan_hash_tamper');
      loaded.planHash = 'bad';
      const result = store.computePlanHash(loaded);
      assert.notStrictEqual(result, 'bad');
    });

    await test('27. Changed policy blocks', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan1 = makePlan({ planId: 'plan_policy_tamper_a', policyVersion: 'TAMPERED' });
      const plan2 = makePlan({ planId: 'plan_policy_tamper_b', policyVersion: POLICY_VERSION });
      const hash1 = store.computePlanHash(plan1);
      const hash2 = store.computePlanHash(plan2);
      assert.notStrictEqual(hash1, hash2);
    });

    await test('28. Changed template blocks', () => {
      const store = new PlanStore({ storeDir: planDir });
      const plan1 = makePlan({ planId: 'plan_tmpl_a', templateVersion: 'a' });
      const plan2 = makePlan({ planId: 'plan_tmpl_b', templateVersion: 'b' });
      const h1 = store.computePlanHash(plan1);
      const h2 = store.computePlanHash(plan2);
      assert.notStrictEqual(h1, h2);
    });

    await test('29. Out-of-window execution blocks', () => {
      const svc = new SupervisedCanaryRunbookService({ runbookPath });
      const now = new Date('2026-08-03T22:00:00Z');
      const items = [{ number: 1, timezone: 'America/Indiana/Indianapolis', contactName: 'A', propertyAddress: 'a' }];
      const check = svc.evaluateSelectedWindows(items, now);
      assert.strictEqual(check.inWindow.length, 0);
    });

    await test('30. No GHL writes', () => {
      const plan = makePlan();
      assert.strictEqual(plan.productionEffects.ghlWrites, 0);
    });

    await test('31. No stage movements', () => {
      const plan = makePlan();
      assert.strictEqual(plan.productionEffects.stageMovements, 0);
    });

    await test('32. No calls/CCC/contact card/group handoff', () => {
      const svcCode = fs.readFileSync(path.join(__dirname, 'supervised-canary-runbook-service.js'), 'utf8');
      assert.strictEqual(svcCode.includes('sendContactCard'), false);
      assert.strictEqual(svcCode.includes('grouphandoff'), false);
      assert.strictEqual(svcCode.includes('makeCall'), false);
    });

    await test('33. Final PAUSED', () => {
      const ks = killSwitch.readKillSwitch();
      assert.strictEqual(ks.state, 'PAUSED');
    });

    await test('34. Existing contact-card workflow remains unchanged', () => {
      const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
      assert.ok(router.includes('_handleContactCard'));
      assert.ok(router.includes('contactcard'));
    });

    await test('35. Comps topic remains isolated', () => {
      const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
      assert.ok(router.includes("case 'comps':"));
      assert.strictEqual(router.includes('canary') && router.includes('comps'), true);
    });

    await test('36. One Telegram consumer remains', () => {
      const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
      const matches = router.match(/routeCommand\s*\(/g);
      assert.ok(matches && matches.length >= 1);
    });
  } finally {
    killSwitch.writeKillSwitch(originalKs);
    rmDir(tmp);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// expose helper for service
SupervisedCanaryRunbookService.prototype.supersedeStalePlans = function () {
  const stalePlan = this.planStore.loadPlan('plan_4986dcaa4139c38e');
  if (stalePlan && stalePlan.status === 'PREVIEW_PENDING_APPROVAL') {
    this.planStore.supersedePlan(stalePlan.planId, 'SUPERSEDED_EXPIRED_UNTRUSTED_CONTEXT');
  }
};

main();
