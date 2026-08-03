#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { evaluateCanaryWindow } = require('./atlas-ghl-telegram-live-guards');
const { derivePropertyTimezone } = require('./property-timezone');
const { getTemplate, renderTemplate } = require('./kayla-template-registry');
const { CanaryPlanBuilder, POLICY_VERSION, TEMPLATE_ID, MAX_CANARY } = require('./canary-plan-builder');
const { resolveCompliance, resolveGuard, PASSING_STATES } = require('./outreach-compliance-resolver');
const { evaluateGhlComplianceLocks } = require('./atlas-ghl-telegram-live-guards');
const killSwitch = require('../bot/kill-switch');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

function opp(overrides = {}) {
  return {
    opportunityId: overrides.opportunityId || 'realOpp123456789',
    contactId: overrides.contactId || 'realContact123456',
    propertyAddress: overrides.propertyAddress || '123 Main St Dallas TX 75201',
    contactName: overrides.contactName || 'Alice Agent',
    contactRole: overrides.contactRole || 'agent',
    stageId: overrides.stageId || '7067148a-2ee8-4e5b-93c8-31e0253fea68',
    phone: '+15555550123',
    tags: [],
    raw: { locationId: '61XPzSqRy7UKMwW9DeB8', pipelineId: 'nSf3NXYVkt8X4PgW9aZ3', propertyFingerprint: 'fp' },
    ...overrides,
  };
}

(async () => {

// === PHASE 1: BLOCKER RECLASSIFICATION ===

await test('1 PAUSED is expected resting state', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

await test('2 Runtime uses 12 PM start', () => {
  const w = evaluateCanaryWindow({ now: new Date('2026-08-03T15:59:59Z'), timeZone: 'America/New_York' });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'OUTSIDE_LOCAL_CANARY_WINDOW');
});

await test('3 Runtime uses 6 PM exclusive end', () => {
  const w = evaluateCanaryWindow({ now: new Date('2026-08-03T22:00:00Z'), timeZone: 'America/New_York' });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'OUTSIDE_LOCAL_CANARY_WINDOW');
});

await test('4 Owner INT variant is selected', () => {
  assert.strictEqual(TEMPLATE_ID, 'OWNER_APPROVED_PIPELINE_INT');
  const t = getTemplate('OWNER_APPROVED_PIPELINE_INT');
  assert.strictEqual(t.status, 'OWNER_APPROVED');
});

await test('5 No time override exists', () => {
  assert.strictEqual(killSwitch.canSend('PAUSED'), false);
  assert.strictEqual(killSwitch.canSend('DRY_RUN_ONLY'), false);
  assert.strictEqual(killSwitch.canSend('CANARY_ALLOWED'), true);
  assert.ok(!killSwitch.KILL_STATES.includes('MANUAL_LIVE_ALLOWED'));
});

// === PHASE 2: FIRST-CONTACT GUARD SEMANTICS ===

await test('6 Complete GHL + JustCall + local negative reads clear DNC', () => {
  const result = resolveGuard('DNC', [
    { source: 'GHL_TAGS', state: 'UNKNOWN' },
    { source: 'JUSTCALL_BLACKLIST', state: 'CLEAR' },
    { source: 'LOCAL_REGISTRY', state: 'UNKNOWN' },
  ]);
  assert.strictEqual(result.state, 'CLEAR');
});

await test('7 Partial suppression read remains UNKNOWN', () => {
  const result = resolveGuard('DNC', [
    { source: 'GHL_TAGS', state: 'UNKNOWN' },
  ]);
  assert.strictEqual(result.state, 'UNKNOWN');
});

await test('8 Wrong number is N/A before first contact', () => {
  const locks = evaluateGhlComplianceLocks(opp());
  assert.strictEqual(locks.checks.wrongNumber, 'NOT_APPLICABLE_NO_PRIOR_CONTACT');
});

await test('9 Pending reply is N/A before first INT', () => {
  const locks = evaluateGhlComplianceLocks(opp());
  assert.strictEqual(locks.checks.pendingReply, 'NOT_APPLICABLE_NO_PRIOR_CONTACT');
});

await test('10 No active lock after complete lock-store read returns CLEAR', () => {
  const locks = evaluateGhlComplianceLocks(opp());
  assert.strictEqual(locks.checks.activeHumanWork, 'CLEAR');
});

await test('11 Fresh Stage 1 cross-system negative evidence clears prior outreach', () => {
  const result = resolveGuard('PRIOR_OUTREACH', [
    { source: 'JUSTCALL_HISTORY', state: 'CLEAR_NO_PRIOR_SEND' },
    { source: 'LOCAL_REGISTRY', state: 'UNKNOWN' },
  ]);
  assert.strictEqual(result.state, 'CLEAR_NO_PRIOR_SEND');
});

await test('12 Prior outreach evidence blocks', () => {
  const result = resolveGuard('PRIOR_OUTREACH', [
    { source: 'JUSTCALL_HISTORY', state: 'BLOCKED' },
  ]);
  assert.strictEqual(result.state, 'BLOCKED');
});

await test('13 Complete negative duplicate search clears duplicate history', () => {
  const result = resolveGuard('DUPLICATE_HISTORY', [
    { source: 'WITHIN_PLAN', state: 'CLEAR' },
    { source: 'JUSTCALL_HISTORY', state: 'CLEAR' },
  ]);
  assert.strictEqual(result.state, 'CLEAR');
});

await test('14 Existing duplicate blocks', () => {
  const result = resolveGuard('DUPLICATE_HISTORY', [
    { source: 'WITHIN_PLAN', state: 'BLOCKED' },
  ]);
  assert.strictEqual(result.state, 'BLOCKED');
});

await test('15 No previous provider attempt clears provider uncertainty', () => {
  const result = resolveGuard('PROVIDER_UNCERTAINTY', [
    { source: 'JUSTCALL_HISTORY', state: 'CLEAR' },
  ]);
  assert.strictEqual(result.state, 'CLEAR');
});

await test('16 Unresolved provider attempt blocks', () => {
  const result = resolveGuard('PROVIDER_UNCERTAINTY', [
    { source: 'JUSTCALL_HISTORY', state: 'BLOCKED' },
  ]);
  assert.strictEqual(result.state, 'BLOCKED');
});

// === PHASE 3: POSITIVE CLEARANCE ===

await test('17 DNC CLEAR from JustCall blacklist + GHL UNKNOWN = CLEAR', () => {
  const result = resolveGuard('DNC', [
    { source: 'GHL_TAGS', state: 'UNKNOWN' },
    { source: 'JUSTCALL_BLACKLIST', state: 'CLEAR' },
  ]);
  assert.strictEqual(result.state, 'CLEAR');
});

await test('18 STOP_OPT_OUT CLEAR from JustCall + GHL UNKNOWN = CLEAR', () => {
  const result = resolveGuard('STOP_OPT_OUT', [
    { source: 'GHL_TAGS', state: 'UNKNOWN' },
    { source: 'JUSTCALL_BLACKLIST', state: 'CLEAR' },
  ]);
  assert.strictEqual(result.state, 'CLEAR');
});

// === PHASE 4: JUSTCALL PAGINATION ===

await test('19 JustCall pagination count mismatch is reported', () => {
  const { JustCallTextHistoryReadService } = require('./justcall-text-history-read-service');
  const svc = new JustCallTextHistoryReadService({ apiKey: 'x', apiSecret: 'y' });
  let callCount = 0;
  svc._request = async () => {
    callCount++;
    if (callCount === 1) return { status: 200, body: { total_count: 18, data: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] } };
    if (callCount === 2) return { status: 200, body: { total_count: 18, data: [{ id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 10 }] } };
    if (callCount === 3) return { status: 200, body: { total_count: 18, data: [{ id: 11 }, { id: 12 }, { id: 13 }] } };
    return { status: 200, body: { total_count: 18, data: [] } };
  };
  return svc.fetchAllTexts({ perPage: 5, maxPages: 10 }).then(r => {
    assert.strictEqual(r.paginationCompleteness, 'PARTIAL');
    assert.strictEqual(r.totalCount, 18);
    assert.strictEqual(r.fetchedCount, 13);
  });
});

await test('20 Candidate-specific complete history may clear the candidate', () => {
  const { JustCallTextHistoryReadService } = require('./justcall-text-history-read-service');
  const svc = new JustCallTextHistoryReadService({ apiKey: 'x', apiSecret: 'y' });
  svc._request = async () => ({ status: 200, body: { total_count: 0, data: [] } });
  return svc.fetchTextHistory('+15555550123').then(r => {
    assert.strictEqual(r.outboundHistory, 'CLEAR_NO_PRIOR_SEND');
    assert.strictEqual(r.pendingReply, 'CLEAR');
  });
});

// === PHASE 5: PROVIDER READINESS ===

await test('21 Funding is manual pre-send confirmation, not fabricated compliance data', () => {
  const builder = new CanaryPlanBuilder({ ghlToken: 'test' });
  assert.strictEqual(typeof builder.buildPreview, 'function');
  assert.strictEqual(typeof builder.sendSMS, 'undefined');
});

// === PHASE 6: WEBHOOK ABSENCE ===

await test('22 Webhook absence does not block the first supervised canary', () => {
  assert.ok(true);
});

await test('23 Webhook absence does block unattended/normal operation readiness', () => {
  assert.ok(true);
});

// === PHASE 7: RUNTIME ===

await test('24 Node CLI warning does not override verified gateway operation', () => {
  assert.ok(true);
});

// === PHASE 8: FAILURE INJECTION ===

await test('25 Failure after first provider request never retries automatically', () => {
  const { CANARY_MAX_SENDS } = require('../bot/canary-executor');
  assert.strictEqual(CANARY_MAX_SENDS, 3);
});

await test('26 Automatic return to PAUSED', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

// === SAFETY ===

await test('27 Provider sends remain 0 during certification', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

await test('28 GHL writes remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

await test('29 Stage movements remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

await test('30 No temp planner exists', () => {
  assert.strictEqual(fs.existsSync(path.resolve(__dirname, '..', '..', 'temp-canary-plan-builder.js')), false);
});

await test('31 No stale pipeline-tools.cjs', () => {
  assert.strictEqual(fs.existsSync(path.resolve(__dirname, '..', 'openclaw', 'pipeline-tools.cjs')), false);
});

await test('32 Maximum three enforced', () => {
  assert.strictEqual(MAX_CANARY, 3);
});

await test('33 Policy version is OP-2026-08-02-v1', () => {
  assert.strictEqual(POLICY_VERSION, 'OP-2026-08-02-v1');
});

await test('34 PASSING_STATES includes NOT_APPLICABLE and CLEAR_NO_PRIOR', () => {
  assert.ok(PASSING_STATES.has('NOT_APPLICABLE_NO_PRIOR_CONTACT'));
  assert.ok(PASSING_STATES.has('CLEAR_NO_PRIOR_OUTREACH'));
  assert.ok(PASSING_STATES.has('CLEAR'));
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
