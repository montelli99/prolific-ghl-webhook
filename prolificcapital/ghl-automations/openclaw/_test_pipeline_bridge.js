'use strict';

// Pre-restart harness for the pipeline-tool bridge.
// Run: node ghl-automations/openclaw/_test_pipeline_bridge.js
//
// Covers the 12 required checks:
//   1. bridge loads and has no _loadError
//   2. all 18 expected tool methods exist
//   3. no unexpected exports beyond the documented surface
//   4. read-only tools work against the real authoritative modules
//   5. stage guidance + kayla script work for valid stages and block invalid ones
//   6. canary preview is non-executable and never sends
//   7. approval requires the exact owner context
//   8. PAUSED kill switch blocks execute with KILL_SWITCH_BLOCKS_SEND
//   9. wrong topic is blocked (733)
//  10. wrong owner is blocked
//  11. zero effects (providerSends/ghlWrites/stageMovements) on every path
//  12. session status works only for the owner context
//
// Uses the real kill switch (currently PAUSED) but stubs the runbook service and
// executor for preview/approval paths so no GHL read or plan write occurs. The
// kill switch is only ever written to PAUSED (idempotent) or left untouched.

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const BRIDGE_PATH = path.join(__dirname, 'pipeline-tool-bridge.js');
const bridge = require(BRIDGE_PATH);

const AUTH = { telegramUserId: bridge.OWNER_ID, chatId: bridge.CHAT_ID, topicId: bridge.TOPIC_ID };
const BAD_AUTH = { telegramUserId: '999', chatId: bridge.CHAT_ID, topicId: bridge.TOPIC_ID };
const WRONG_TOPIC_AUTH = { telegramUserId: bridge.OWNER_ID, chatId: bridge.CHAT_ID, topicId: '733' };

const EXPECTED_METHODS = [
  'getPipelineCurrentState', 'getPipelineWorkSummary', 'getStageGuidance', 'getKaylaScript',
  'getKillSwitchState', 'pauseOutreach', 'enableDryRun', 'getProviderStatus',
  'getMemoryProvenance', 'listSafeCanaryCandidates', 'createCanaryPreview', 'reviewCanaryPlan',
  'expireCanaryPlan', 'approveCanaryPlan', 'executeCanary', 'getCanaryReconciliation',
  'recordCorrection', 'getSessionStatus', 'getPpcPostCallSyncStatus',
  'pipelineReadOpportunity', 'pipelineSearchOpportunities', 'pipelineListStages', 'pipelineMoveStage',
  'loadPpcStageAuthority', 'resolvePpcStage', 'getPpcCallQueue', 'getPpcCallCard', 'getPpcRecentCall',
  'getPpcCallContext', 'startPpcCallIntelligence', 'getPpcCallIntelligence', 'applyPpcDnc', 'applyPpcWrongNumber',
  'getPpcCallingDeskStatus', 'sendPpcPin',
];

const ALLOWED_EXPORTS = new Set([
  ...EXPECTED_METHODS, 'authorize', '_setDeps', '_setPostCallDelay',
  'PIPELINE_LIVE_MODE', 'OWNER_ID', 'CHAT_ID', 'TOPIC_ID', 'VALID_PROFILES', 'resolvePipelineContext', 'resolveProfileFromOpportunity',
  'PPC_STAGE_1_NEW_LEAD_ID', 'PPC_STAGE_2_CALLED_ONCE_ID', 'PPC_STAGE_3_CALLED_ANOTHER_DAY_ID',
]);

const ksPath = bridge.OWNER_ID && require(path.join(__dirname, '..', 'bot', 'kill-switch')).KILL_SWITCH_PATH;
const realKillSwitch = require(path.join(__dirname, '..', 'bot', 'kill-switch'));

function zeroEffects(obj) {
  assert.strictEqual(obj.effects.providerSends, 0, 'providerSends must be 0');
  assert.strictEqual(obj.effects.ghlWrites, 0, 'ghlWrites must be 0');
  assert.strictEqual(obj.effects.stageMovements, 0, 'stageMovements must be 0');
}

function stubRunbook() {
  const { PlanStore } = require('../modules/plan-store');
  const { ApprovalStore } = require('../modules/approval-store');
  const plan = {
    planId: 'plan_bridge_harness_1',
    planHash: 'harness_hash_'.padEnd(64, '0'),
    status: 'PREVIEW_PENDING_APPROVAL',
    executable: false,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    selectedCount: 2,
    totalCandidates: 2,
    items: [
      { number: 1, contactName: 'Test Agent', contactRole: 'agent', propertyAddress: '123 Test St', timezone: 'America/New_York', renderedMessage: '[Name], are you still accepting offers?', guardEvidence: { g1: { state: 'PASS' } } },
      { number: 2, contactName: 'Test Owner', contactRole: 'owner', propertyAddress: '456 Test Ave', timezone: 'America/New_York', renderedMessage: '[Name], are you still accepting offers?', guardEvidence: { g1: { state: 'PASS' } } },
    ],
    ownerId: bridge.OWNER_ID, chatId: bridge.CHAT_ID, topicId: Number(bridge.TOPIC_ID),
    originatingMessageId: 1, runbookId: 'runbook_supervised_canary_v2', runbookHash: 'harness_runbook_hash',
  };
  const approval = {
    approvalId: 'approval_harness_1', approvalHash: 'harness_approval_hash', planId: plan.planId,
    selectedItems: [1, 2], status: 'ACTIVE',
  };
  const fake = {
    loadRunbook: () => ({ instructionId: 'runbook_supervised_canary_v2', status: 'PENDING_NOT_EXECUTED', version: 2 }),
    getActivePlanId: () => plan.planId,
    beginPreparation: async () => ({ reply: 'PREVIEW_READY', plan, state: 'PREVIEW_READY' }),
    handleApproval: async () => ({ reply: 'approved', approval, plan }),
    handleCancel: async () => ({ reply: 'cancelled' }),
    providerConfirmationPath: () => '',
    getCurrentRuntimeRevision: () => 'harness',
  };
  return {
    Service: class { constructor() { Object.assign(this, fake); } },
    plan, approval,
  };
}

function repeat(count, factory) {
  return Array.from({ length: count }, (_, idx) => typeof factory === 'function' ? factory(idx) : factory);
}

async function withMockHttps(routeMap, fn) {
  const https = require('https');
  const originalRequest = https.request;
  https.request = (opts, cb) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
      const queue = routeMap.get(opts.path) || [];
      const next = queue.length > 0 ? queue.shift() : { status: 404, body: { message: `Unmocked path: ${opts.path}` } };
      const res = new EventEmitter();
      res.statusCode = next.status;
      process.nextTick(() => {
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify(next.body)));
        res.emit('end');
      });
    };
    return req;
  };

  try {
    await fn();
  } finally {
    https.request = originalRequest;
  }
}

function makePostCallRouteMap(options = {}) {
  const locationId = 'GDq92uruRngbi9mLGGrV';
  const contactId = 'contact-1';
  const opportunityId = 'opp-1';
  const phone = '+15718140891';
  const messageFactory = options.messageFactory || (() => []);
  const duplicateContacts = options.duplicateContacts || [{ id: contactId, phone, dnd: false, tags: [] }];
  const contact = options.contact === null ? null : {
    id: contactId,
    phone,
    dnd: false,
    wrongNumber: false,
    customFields: [],
    ...(options.contact || {}),
  };
  const opportunity = {
    id: opportunityId,
    pipelineStageId: options.pipelineStageId || 'd31c50be-0148-4769-b3bd-cf32c2a16bff',
    ...(options.opportunity || {}),
  };
  return new Map([
    [`/contacts/${contactId}`, repeat(4, () => ({ status: contact ? 200 : 500, body: contact ? { contact } : {} }))],
    [`/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(phone)}`, repeat(4, () => ({ status: 200, body: { contacts: duplicateContacts } }))],
    [`/contacts/${contactId}/notes/`, repeat(4, () => ({ status: 200, body: { notes: options.notes || [] } }))],
    [`/contacts/${contactId}/tasks`, repeat(4, () => ({ status: 200, body: { tasks: options.tasks || [] } }))],
    [`/opportunities/${opportunityId}`, repeat(4, () => ({ status: 200, body: { opportunity } }))],
    [`/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}`, repeat(4, () => ({ status: 200, body: { conversations: [{ id: 'conv-1', lastMessageDate: '2026-08-13T20:07:35.000Z', type: 1 }] } }))],
    [`/conversations/conv-1/messages`, repeat(4, (idx) => ({ status: 200, body: { messages: { messages: messageFactory(idx), nextPage: false, lastMessageId: 'm1' } } }))],
  ]);
}

(async () => {
  let passed = 0, failed = 0;
  const results = [];
  function test(name, fn) {
    return Promise.resolve()
      .then(fn)
      .then(() => { passed++; results.push(`PASS ${name}`); })
      .catch((e) => { failed++; results.push(`FAIL ${name}: ${e && e.message}`); });
  }

  // Reset deps to the real modules before each test batch so stubs never leak.
  const resetDeps = () => {
    bridge._setDeps({
      killSwitch: require('../bot/kill-switch'),
      PlanStore: require('../modules/plan-store').PlanStore,
      ApprovalStore: require('../modules/approval-store').ApprovalStore,
      CanaryPlanBuilder: require('../modules/canary-plan-builder').CanaryPlanBuilder,
      SupervisedCanaryRunbookService: require('../modules/supervised-canary-runbook-service').SupervisedCanaryRunbookService,
      executor: require('../bot/canary-executor'),
      mem: require('../modules/pipeline-memory-context'),
      spec: require('../modules/kayla-course-spec'),
    });
  };

  const killSwitchBefore = realKillSwitch.readKillSwitch();

  await test('1. bridge loads without _loadError', () => {
    assert.ok(bridge, 'bridge is falsy');
    assert.strictEqual(bridge._loadError, undefined, 'bridge._loadError should be undefined');
  });

  await test('2. all 18 expected tool methods exist as functions', () => {
    for (const m of EXPECTED_METHODS) {
      assert.strictEqual(typeof bridge[m], 'function', `${m} is not a function`);
    }
  });

  await test('3. no unexpected exports', () => {
    const exported = Object.keys(bridge);
    const unexpected = exported.filter((k) => !ALLOWED_EXPORTS.has(k));
    assert.deepStrictEqual(unexpected, [], `unexpected exports: ${unexpected.join(', ')}`);
  });

  await test('4. read-only tools work against real modules', () => {
    const state = bridge.getPipelineCurrentState();
    assert.strictEqual(state.status, 'OK');
    assert.strictEqual(state.safety.killSwitch, 'PAUSED');
    assert.strictEqual(state.runbook.instructionId, 'runbook_supervised_canary_v2');
    assert.strictEqual(state.runbook.status, 'PENDING_NOT_EXECUTED');
    zeroEffects(state);

    const ks = bridge.getKillSwitchState();
    assert.strictEqual(ks.status, 'OK');
    assert.strictEqual(ks.state, 'PAUSED');
    zeroEffects(ks);

    const prov = bridge.getProviderStatus();
    assert.strictEqual(prov.status, 'OK');
    zeroEffects(prov);

    const mem = bridge.getMemoryProvenance();
    assert.strictEqual(mem.status, 'OK');
    zeroEffects(mem);

    const ws = bridge.getPipelineWorkSummary();
    assert.strictEqual(ws.status, 'OK');
    zeroEffects(ws);
  });

  await test('5. stage guidance + script work; invalid stages blocked', () => {
    const s1 = bridge.getStageGuidance('PPC_EWA_BEACH', 1);
    assert.strictEqual(s1.status, 'OK');
    assert.strictEqual(s1.name, 'New Lead / Call ASAP');
    zeroEffects(s1);

    const sc = bridge.getKaylaScript('PPC_EWA_BEACH', 2);
    assert.strictEqual(sc.status, 'PREVIEW_ONLY');
    assert.ok(Array.isArray(sc.scripts) && sc.scripts.length > 0, 'script body missing');
    zeroEffects(sc);

    const bad = bridge.getStageGuidance('PPC_EWA_BEACH', 99);
    assert.strictEqual(bad.status, 'BLOCKED');
    assert.strictEqual(bad.reason, 'INVALID_STAGE');
    zeroEffects(bad);
  });

  await test('6. canary preview is non-executable and never sends', async () => {
    const { Service, plan } = stubRunbook();
    bridge._setDeps({ SupervisedCanaryRunbookService: Service });
    const result = await bridge.createCanaryPreview([{ id: 1 }, { id: 2 }], AUTH);
    assert.strictEqual(result.status, 'PREVIEW_READY');
    assert.strictEqual(result.planId, plan.planId);
    assert.strictEqual(result.executable, false);
    zeroEffects(result);

    const blocked = await bridge.createCanaryPreview([{ id: 1 }], BAD_AUTH);
    assert.strictEqual(blocked.status, 'BLOCKED');
    zeroEffects(blocked);
    resetDeps();
  });

  await test('7. approval requires the exact owner context', async () => {
    const { Service, approval } = stubRunbook();
    bridge._setDeps({ SupervisedCanaryRunbookService: Service });
    const denied = await bridge.approveCanaryPlan('plan_x', [1], BAD_AUTH);
    assert.strictEqual(denied.status, 'BLOCKED');
    assert.strictEqual(denied.reason, 'OWNER_REQUIRED');
    zeroEffects(denied);

    const approved = await bridge.approveCanaryPlan('plan_bridge_harness_1', [1, 2], AUTH);
    assert.strictEqual(approved.status, 'APPROVED');
    assert.strictEqual(approved.approvalId, approval.approvalId);
    assert.strictEqual(approved.executable, false);
    zeroEffects(approved);
    resetDeps();
  });

  await test('8. PAUSED kill switch blocks execute with KILL_SWITCH_BLOCKS_SEND', async () => {
    bridge._setDeps({ executor: { executeApprovedPlan: async () => { throw new Error('should not be called'); } } });
    const result = await bridge.executeCanary('plan_bridge_harness_1', 1, AUTH);
    assert.strictEqual(result.status, 'BLOCKED');
    assert.ok(result.reason.includes('KILL_SWITCH_BLOCKS_SEND'), `reason: ${result.reason}`);
    zeroEffects(result);
    resetDeps();
  });

  await test('9. wrong topic is blocked', () => {
    const ksBefore = realKillSwitch.readKillSwitch();
    const result = bridge.pauseOutreach(WRONG_TOPIC_AUTH);
    assert.strictEqual(result.status, 'BLOCKED');
    assert.strictEqual(result.reason, 'TOPIC_389_REQUIRED');
    zeroEffects(result);
    assert.deepStrictEqual(realKillSwitch.readKillSwitch(), ksBefore, 'kill switch must be untouched');
  });

  await test('10. wrong owner is blocked', () => {
    const ksBefore = realKillSwitch.readKillSwitch();
    const result = bridge.pauseOutreach(BAD_AUTH);
    assert.strictEqual(result.status, 'BLOCKED');
    assert.strictEqual(result.reason, 'OWNER_REQUIRED');
    zeroEffects(result);
    assert.deepStrictEqual(realKillSwitch.readKillSwitch(), ksBefore, 'kill switch must be untouched');
  });

  await test('11. zero effects on every path (read-only + blocked)', () => {
    for (const m of ['getPipelineCurrentState', 'getPipelineWorkSummary', 'getKillSwitchState', 'getProviderStatus', 'getMemoryProvenance']) {
      zeroEffects(bridge[m]());
    }
    zeroEffects(bridge.reviewCanaryPlan('plan_does_not_exist'));
    zeroEffects(bridge.getCanaryReconciliation('plan_does_not_exist'));
    zeroEffects(bridge.pauseOutreach(BAD_AUTH));
    zeroEffects(bridge.enableDryRun({}));
    zeroEffects(bridge.recordCorrection('x', 'general', {}));
  });

  await test('12. session status works only for owner context', () => {
    const denied = bridge.getSessionStatus(BAD_AUTH);
    assert.strictEqual(denied.status, 'BLOCKED');
    zeroEffects(denied);

    const ok = bridge.getSessionStatus(AUTH);
    assert.strictEqual(ok.status, 'OK');
    assert.strictEqual(ok.mode, 'READ_ONLY_SUPERVISED');
    zeroEffects(ok);
  });

  await test('13. post-call sync success is detected', async () => {
    process.env.PPC_GHL_API_KEY = process.env.PPC_GHL_API_KEY || 'test-key';
    bridge._setPostCallDelay(async () => {});
    const routes = makePostCallRouteMap({
      messageFactory: () => [{ body: 'JustCall call 404220464', messageType: 'TYPE_CALL', dateAdded: '2026-08-13T20:07:40.000Z' }],
    });
    await withMockHttps(routes, async () => {
      const result = await bridge.getPpcPostCallSyncStatus('PPC_EWA_BEACH', 'contact-1', 'opp-1', '+15718140891', { callId: 404220464, answered: true, duration: 35, recordingUrl: 'https://recording.example', callAt: '2026-08-13T20:07:33.000Z' }, AUTH);
      assert.strictEqual(result.status, 'OK');
      assert.strictEqual(result.synced, true);
      assert.strictEqual(result.contactMatched, true);
      assert.strictEqual(result.callLogged, true);
      assert.strictEqual(result.duplicateCount, 1);
    });
    bridge._setPostCallDelay();
  });

  await test('14. post-call sync delayed visibility is detected', async () => {
    process.env.PPC_GHL_API_KEY = process.env.PPC_GHL_API_KEY || 'test-key';
    bridge._setPostCallDelay(async () => {});
    const routes = makePostCallRouteMap({
      messageFactory: (idx) => idx === 0 ? [] : [{ body: 'Call completed 404220464', messageType: 'TYPE_CALL', dateAdded: '2026-08-13T20:07:40.000Z' }],
    });
    await withMockHttps(routes, async () => {
      const result = await bridge.getPpcPostCallSyncStatus('PPC_EWA_BEACH', 'contact-1', 'opp-1', '+15718140891', { callId: 404220464, answered: true, duration: 35, recordingUrl: 'https://recording.example', callAt: '2026-08-13T20:07:33.000Z' }, AUTH);
      assert.strictEqual(result.status, 'OK');
      assert.strictEqual(result.synced, true);
      assert.strictEqual(result.waitedMs, 10000);
      assert.ok(result.attempts.length >= 2);
    });
    bridge._setPostCallDelay();
  });

  await test('15. duplicate contacts and unexpected stage mutation are surfaced', async () => {
    process.env.PPC_GHL_API_KEY = process.env.PPC_GHL_API_KEY || 'test-key';
    bridge._setPostCallDelay(async () => {});
    const routes = makePostCallRouteMap({
      duplicateContacts: [{ id: 'contact-1', phone: '+15718140891' }, { id: 'contact-2', phone: '+15718140891' }],
      pipelineStageId: 'stage-other',
      contact: { phone: '+15718140000' },
      messageFactory: () => [{ body: 'Call completed 404220464', messageType: 'TYPE_CALL', dateAdded: '2026-08-13T20:07:40.000Z' }],
    });
    await withMockHttps(routes, async () => {
      const result = await bridge.getPpcPostCallSyncStatus('PPC_EWA_BEACH', 'contact-1', 'opp-1', '+15718140891', { callId: 404220464, answered: true, duration: 35, recordingUrl: 'https://recording.example', callAt: '2026-08-13T20:07:33.000Z' }, AUTH);
      assert.strictEqual(result.status, 'OK');
      assert.strictEqual(result.synced, true);
      assert.strictEqual(result.contactMatched, false);
      assert.strictEqual(result.duplicateCount, 2);
      assert.strictEqual(result.unexpectedStageMove, true);
      assert.strictEqual(result.stageUnchanged, false);
    });
    bridge._setPostCallDelay();
  });

  await test('16. read failures never fabricate sync success', async () => {
    process.env.PPC_GHL_API_KEY = process.env.PPC_GHL_API_KEY || 'test-key';
    bridge._setPostCallDelay(async () => {});
    const routes = makePostCallRouteMap({
      contact: null,
      messageFactory: () => [],
    });
    await withMockHttps(routes, async () => {
      const result = await bridge.getPpcPostCallSyncStatus('PPC_EWA_BEACH', 'contact-1', 'opp-1', '+15718140891', { callId: 404220464, answered: true, duration: 35, recordingUrl: 'https://recording.example', callAt: '2026-08-13T20:07:33.000Z' }, AUTH);
      assert.strictEqual(result.status, 'OK');
      assert.strictEqual(result.synced, false);
      assert.strictEqual(result.pending, true);
      assert.strictEqual(result.callLogged, false);
    });
    bridge._setPostCallDelay();
  });

  await test('17. sendPpcPin requires PPC profile and owner context', async () => {
    const wrongProfile = await bridge.sendPpcPin('ATLAS_OUTBOUND', 'opp-1', AUTH);
    assert.strictEqual(wrongProfile.status, 'BLOCKED');
    assert.strictEqual(wrongProfile.reason, 'SEND_PIN_PPC_ONLY');
    zeroEffects(wrongProfile);

    const wrongAuth = await bridge.sendPpcPin('PPC_EWA_BEACH', 'opp-1', BAD_AUTH);
    assert.strictEqual(wrongAuth.status, 'BLOCKED');
  });

  await test('18. sendPpcPin sends PIN, records ledger, never moves stage', async () => {
    process.env.PPC_GHL_API_KEY = process.env.PPC_GHL_API_KEY || 'test-key';
    process.env.JUSTCALL_API_KEY = process.env.JUSTCALL_API_KEY || 'jc-test-key';
    process.env.JUSTCALL_API_SECRET = process.env.JUSTCALL_API_SECRET || 'jc-test-secret';
    const ledger = require('../modules/ppc-pin-ledger');
    const fs = require('fs');
    const ledgerOnDiskBefore = fs.existsSync(ledger.LEDGER_PATH) ? fs.readFileSync(ledger.LEDGER_PATH, 'utf8') : null;
    ledger._resetForTests();

    const routes = new Map([
      [`/opportunities/opp-1`, repeat(3, () => ({ status: 200, body: { opportunity: { id: 'opp-1', locationId: 'GDq92uruRngbi9mLGGrV', pipelineId: 'ril84XHGQleRgE0W0FKU', pipelineStageId: 'd31c50be-0148-4769-b3bd-cf32c2a16bff', name: '1234 Main St', contact: { name: 'Johnathon Test', phone: '+15718140891', tags: [] } } } }))],
      [`/v2.1/texts/new`, repeat(2, () => ({ status: 200, body: { data: { id: 585342957 } } }))],
    ]);
    await withMockHttps(routes, async () => {
      const result = await bridge.sendPpcPin('PPC_EWA_BEACH', 'opp-1', AUTH);
      assert.strictEqual(result.status, 'OK');
      assert.strictEqual(result.messageId, 585342957);
      assert.strictEqual(result.deliveryStatus, 'SENT');
      assert.strictEqual(result.effects.providerSends, 1);
      assert.strictEqual(result.effects.stageMovements, 0, 'PIN send must never move the opportunity');
      assert.strictEqual(result.effects.ghlWrites, 0, 'PIN send must not write GHL');
      assert.ok(result.body.includes('Happy'), 'body should be the filled PIN');
      assert.ok(result.body.includes('Johnathon'), 'body should be filled with contact first name');

      const entry = ledger.getPinSend('opp-1');
      assert.ok(entry, 'ledger should record the send');
      assert.strictEqual(entry.messageId, 585342957);
      assert.strictEqual(entry.deliveryStatus, 'SENT');

      // Duplicate send must be idempotent: PIN_ALREADY_SENT, zero extra SMS.
      const dup = await bridge.sendPpcPin('PPC_EWA_BEACH', 'opp-1', AUTH);
      assert.strictEqual(dup.status, 'PIN_ALREADY_SENT');
      assert.strictEqual(dup.messageId, 585342957);
      zeroEffects(dup);
      assert.strictEqual(ledger.getPinSend('opp-1').messageId, 585342957, 'ledger must not grow on duplicate');
    });
    // Isolate the harness from the real production ledger.
    if (ledgerOnDiskBefore === null) { try { fs.unlinkSync(ledger.LEDGER_PATH); } catch (_) {} }
    else { fs.writeFileSync(ledger.LEDGER_PATH, ledgerOnDiskBefore, 'utf8'); }
    ledger._resetForTests();
  });

  await test('19. sendPpcPin refuses non-stage-1, DNC, and short phone', async () => {
    process.env.PPC_GHL_API_KEY = process.env.PPC_GHL_API_KEY || 'test-key';
    const ledger = require('../modules/ppc-pin-ledger');
    ledger._resetForTests();
    const routes = new Map([
      [`/opportunities/opp-wrong-stage`, repeat(1, () => ({ status: 200, body: { opportunity: { id: 'opp-wrong-stage', locationId: 'GDq92uruRngbi9mLGGrV', pipelineId: 'ril84XHGQleRgE0W0FKU', pipelineStageId: '1a0d789b-c11d-47a2-9152-6a7ce07dc833', name: '456 Oak Ave', contact: { name: 'Jane Doe', phone: '+15718140891', tags: [] } } } }))],
      [`/opportunities/opp-dnc`, repeat(1, () => ({ status: 200, body: { opportunity: { id: 'opp-dnc', locationId: 'GDq92uruRngbi9mLGGrV', pipelineId: 'ril84XHGQleRgE0W0FKU', pipelineStageId: 'd31c50be-0148-4769-b3bd-cf32c2a16bff', name: '789 Elm Ave', contact: { name: 'DNC Buyer', phone: '+15718140891', tags: ['DNC'] } } } }))],
      [`/opportunities/opp-short-phone`, repeat(1, () => ({ status: 200, body: { opportunity: { id: 'opp-short-phone', locationId: 'GDq92uruRngbi9mLGGrV', pipelineId: 'ril84XHGQleRgE0W0FKU', pipelineStageId: 'd31c50be-0148-4769-b3bd-cf32c2a16bff', name: '101 Pine Ave', contact: { name: 'No Phone', phone: '123', tags: [] } } } }))],
    ]);
    await withMockHttps(routes, async () => {
      const wrongStage = await bridge.sendPpcPin('PPC_EWA_BEACH', 'opp-wrong-stage', AUTH);
      assert.strictEqual(wrongStage.status, 'BLOCKED');
      assert.strictEqual(wrongStage.reason, 'PIN_STAGE_1_REQUIRED');
      zeroEffects(wrongStage);

      const dnc = await bridge.sendPpcPin('PPC_EWA_BEACH', 'opp-dnc', AUTH);
      assert.strictEqual(dnc.status, 'BLOCKED');
      assert.strictEqual(dnc.reason, 'DNC_PIN_SEND_BLOCKED');
      zeroEffects(dnc);

      const shortPhone = await bridge.sendPpcPin('PPC_EWA_BEACH', 'opp-short-phone', AUTH);
      assert.strictEqual(shortPhone.status, 'BLOCKED');
      assert.strictEqual(shortPhone.reason, 'NO_PHONE_PIN_SEND_BLOCKED');
      zeroEffects(shortPhone);
    });
    ledger._resetForTests();
  });

  await test('20. getPpcCallQueue enriches items with workflowActionable/nextExpectedAction/queueReason', async () => {
    process.env.PPC_GHL_API_KEY = process.env.PPC_GHL_API_KEY || 'test-key';
    const ledger = require('../modules/ppc-pin-ledger');
    ledger._resetForTests();
    const routes = new Map([
      [`/opportunities/search?location_id=${encodeURIComponent('GDq92uruRngbi9mLGGrV')}&pipeline_id=${encodeURIComponent('ril84XHGQleRgE0W0FKU')}&limit=50`, repeat(1, () => ({ status: 200, body: { opportunities: [
        { id: 'opp-stage1', locationId: 'GDq92uruRngbi9mLGGrV', pipelineId: 'ril84XHGQleRgE0W0FKU', pipelineStageId: 'd31c50be-0148-4769-b3bd-cf32c2a16bff', name: '1234 Main St', contact: { name: 'Stage1 Lead', phone: '+15718140891', tags: [] } },
        { id: 'opp-stage2', locationId: 'GDq92uruRngbi9mLGGrV', pipelineId: 'ril84XHGQleRgE0W0FKU', pipelineStageId: '1a0d789b-c11d-47a2-9152-6a7ce07dc833', name: '456 Oak Ave', contact: { name: 'Stage2 Lead', phone: '+15718140891', tags: [] } },
        { id: 'opp-dnc', locationId: 'GDq92uruRngbi9mLGGrV', pipelineId: 'ril84XHGQleRgE0W0FKU', pipelineStageId: 'd31c50be-0148-4769-b3bd-cf32c2a16bff', name: '789 Elm Ave', contact: { name: 'DNC Buyer', phone: '+15718140891', tags: ['DNC'] } },
      ] } }))],
    ]);
    await withMockHttps(routes, async () => {
      const result = await bridge.getPpcCallQueue('PPC_EWA_BEACH', AUTH);
      assert.strictEqual(result.status, 'OK');
      const all = result.queues.flatMap((q) => q.items);
      const stage1 = all.find((item) => item.opportunityId === 'opp-stage1');
      assert.ok(stage1, 'stage-1 item should be in queue');
      assert.strictEqual(stage1.callEligible, false, 'stage-1 pre-PIN must not be call-eligible');
      assert.strictEqual(stage1.workflowActionable, true, 'stage-1 pre-PIN must be workflow-actionable');
      assert.strictEqual(stage1.nextExpectedAction, 'SEND_PIN');
      assert.ok(stage1.queueReason, 'queue item must carry a QUEUE REASON');
      assert.strictEqual(stage1.queuePriority, 1);

      const stage2 = all.find((item) => item.opportunityId === 'opp-stage2');
      assert.ok(stage2, 'stage-2 item should be in queue');
      assert.strictEqual(stage2.callEligible, true);
      assert.strictEqual(stage2.workflowActionable, true);

      const dnc = all.find((item) => item.opportunityId === 'opp-dnc');
      assert.ok(dnc, 'DNC item still surfaces in queue for visibility (guards explain)');
      assert.strictEqual(dnc.callEligible, false);
      assert.strictEqual(dnc.workflowActionable, false);
      assert.ok(dnc.eligibilityGuards.some((g) => g.guard === 'DNC'));

      assert.ok(!Array.isArray(result.totalActionable), 'totalActionable must not be an array');
      assert.strictEqual(typeof result.totalActionable, 'number');
      assert.ok(result.totalActionable >= 2, 'at least stage1 + stage2 are actionable');
    });
    ledger._resetForTests();
  });

  const killSwitchAfter = realKillSwitch.readKillSwitch();
  const killSwitchStable = JSON.stringify(killSwitchBefore) === JSON.stringify(killSwitchAfter);
  results.push(`${killSwitchStable ? 'PASS' : 'FAIL'} kill switch unchanged by harness (${killSwitchAfter.state})`);

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log('Bridge Harness Summary');
  process.exit(failed === 0 && killSwitchStable ? 0 : 1);
})();
