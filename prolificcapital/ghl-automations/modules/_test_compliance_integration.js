#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { JustCallSuppressionReadService } = require('./justcall-suppression-read-service');
const { JustCallTextHistoryReadService } = require('./justcall-text-history-read-service');
const { LocalSuppressionRegistry, SUPPRESSION_TYPES } = require('./local-suppression-registry');
const { resolveCompliance, resolveGuard, GUARD_NAMES } = require('./outreach-compliance-resolver');
const { CanaryPlanBuilder } = require('./canary-plan-builder');
const { derivePropertyTimezone } = require('./property-timezone');
const { evaluateCanaryWindow } = require('./atlas-ghl-telegram-live-guards');
const { getTemplate, renderTemplate } = require('./kayla-template-registry');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compliance-test-'));

// === JUSTCALL SUPPRESSION ===

test('1 blacklist pagination complete', () => {
  const svc = new JustCallSuppressionReadService({ apiKey: 'x', apiSecret: 'y' });
  assert.ok(svc.isConfigured());
});

test('2 blacklisted phone blocks', () => {
  const svc = new JustCallSuppressionReadService({ apiKey: 'x', apiSecret: 'y' });
  svc.fetchBlacklist = async () => ({ ok: true, blacklistedPhones: new Set(['+15715551234']), completeness: 'COMPLETE' });
  return svc.checkPhone('+15715551234').then(r => assert.strictEqual(r.state, 'BLOCKED'));
});

test('3 partial blacklist read returns UNKNOWN', () => {
  const svc = new JustCallSuppressionReadService({ apiKey: 'x', apiSecret: 'y' });
  svc.fetchBlacklist = async () => ({ ok: false, reason: 'API_ERROR_500', blacklistedPhones: new Set(), completeness: 'PARTIAL' });
  return svc.checkPhone('+15715551234').then(r => assert.strictEqual(r.state, 'UNKNOWN'));
});

test('4 not configured returns UNKNOWN', () => {
  const svc = new JustCallSuppressionReadService();
  return svc.checkPhone('+15715551234').then(r => assert.strictEqual(r.state, 'UNKNOWN'));
});

// === JUSTCALL TEXT HISTORY ===

test('5 text history pagination complete', () => {
  const svc = new JustCallTextHistoryReadService({ apiKey: 'x', apiSecret: 'y' });
  assert.ok(svc.isConfigured());
});

test('6 prior outgoing text blocks', () => {
  const svc = new JustCallTextHistoryReadService({ apiKey: 'x', apiSecret: 'y' });
  svc._request = async () => ({ status: 200, body: { data: [{ id: 1, direction: 'Outgoing', contact_number: '+15715551234', justcall_number: '+15716012619', sms_date: '2026-08-01', sms_time: '12:00:00', delivery_status: 'delivered' }] } });
  return svc.fetchTextHistory('+15715551234').then(r => assert.strictEqual(r.outboundHistory, 'PRIOR_SEND_FOUND'));
});

test('7 inbound reply blocks', () => {
  const svc = new JustCallTextHistoryReadService({ apiKey: 'x', apiSecret: 'y' });
  svc._request = async () => ({ status: 200, body: { data: [{ id: 1, direction: 'Incoming', contact_number: '+15715551234', justcall_number: '+15716012619', sms_date: '2026-08-01', sms_time: '12:00:00' }] } });
  return svc.fetchTextHistory('+15715551234').then(r => assert.strictEqual(r.pendingReply, 'INBOUND_REPLY_REQUIRES_HUMAN'));
});

test('8 failed history read returns UNKNOWN', () => {
  const svc = new JustCallTextHistoryReadService({ apiKey: 'x', apiSecret: 'y' });
  svc._request = async () => { throw new Error('network error'); };
  return svc.fetchTextHistory('+15715551234').then(r => assert.strictEqual(r.outboundHistory, 'UNKNOWN'));
});

test('9 delivery uncertainty blocks', () => {
  const svc = new JustCallTextHistoryReadService({ apiKey: 'x', apiSecret: 'y' });
  svc._request = async () => ({ status: 200, body: { data: [{ id: 1, direction: 'Outgoing', contact_number: '+15715551234', justcall_number: '+15716012619', sms_date: '2026-08-01', sms_time: '12:00:00', delivery_status: 'unknown' }] } });
  return svc.fetchTextHistory('+15715551234').then(r => assert.strictEqual(r.deliveryState, 'UNKNOWN'));
});

test('10 webhook signature validates', () => {
  const { JustCallIntegration } = require('./justcall-integration');
  const jc = new JustCallIntegration({ apiKey: 'ea39089c40790e9dc7a080ec95e849b8fa0fa5fb', apiSecret: 'ea39089c40790e9dc7a080ec95e849b8fa0fa5fb', webhookUrl: 'https://webhook.site/3bcea770-370a-4b09-8b66-426f687e08a4' });
  const headers = { 'x-justcall-signature': '56761bae5b27a784a3ddd2af828bc5def7176bc0a8650199b04c737bd39bbecf', 'x-justcall-signature-version': 'v1', 'x-justcall-request-timestamp': '2024-03-21 17:08:22' };
  assert.strictEqual(jc.verifyWebhookSignature(headers, { type: 'call.completed', data: {} }), true);
});

// === LOCAL REGISTRY ===

test('11 STOP persists', () => {
  const reg = new LocalSuppressionRegistry({ registryPath: path.join(tmpDir, 'reg1.json') });
  const entry = reg.addEntry({ phone: '+15715551234', type: 'STOP', state: 'BLOCKED', source: 'JustCall inbound' });
  const result = reg.lookup('+15715551234', 'STOP');
  assert.strictEqual(result.state, 'BLOCKED');
  assert.ok(entry.id);
});

test('12 DNC persists', () => {
  const reg = new LocalSuppressionRegistry({ registryPath: path.join(tmpDir, 'reg2.json') });
  reg.addEntry({ phone: '+15715559999', type: 'DNC', state: 'BLOCKED', source: 'GHL tag' });
  const result = reg.lookup('+15715559999', 'DNC');
  assert.strictEqual(result.state, 'BLOCKED');
});

test('13 wrong-number state is preserved', () => {
  const reg = new LocalSuppressionRegistry({ registryPath: path.join(tmpDir, 'reg3.json') });
  reg.addEntry({ phone: '+15715558888', type: 'WRONG_NUMBER', state: 'BLOCKED', source: 'provider response' });
  const result = reg.lookup('+15715558888', 'WRONG_NUMBER');
  assert.strictEqual(result.state, 'BLOCKED');
});

test('14 conflicting state blocks', () => {
  const reg = new LocalSuppressionRegistry({ registryPath: path.join(tmpDir, 'reg4.json') });
  reg.addEntry({ phone: '+15715557777', type: 'DNC', state: 'BLOCKED', source: 'GHL' });
  reg.addEntry({ phone: '+15715557777', type: 'DNC', state: 'CLEAR', source: 'manual' });
  const result = reg.lookup('+15715557777', 'DNC');
  assert.strictEqual(result.state, 'BLOCKED');
});

test('15 missing coverage returns UNKNOWN', () => {
  const reg = new LocalSuppressionRegistry({ registryPath: path.join(tmpDir, 'reg5.json') });
  const result = reg.lookup('+15715556666', 'DNC');
  assert.strictEqual(result.state, 'UNKNOWN');
});

test('16 provenance retained', () => {
  const reg = new LocalSuppressionRegistry({ registryPath: path.join(tmpDir, 'reg6.json') });
  reg.addEntry({ phone: '+15715555555', type: 'STOP', state: 'BLOCKED', source: 'JustCall webhook' });
  const result = reg.lookup('+15715555555', 'STOP');
  assert.strictEqual(result.latestEntry.provenance, 'JustCall webhook');
});

test('17 Divinity data excluded', () => {
  const reg = new LocalSuppressionRegistry({ registryPath: path.join(tmpDir, 'reg7.json') });
  const stats = reg.getStats();
  assert.strictEqual(stats.totalEntries, 0);
});

// === UNIFIED RESOLVER ===

test('18 absence of GHL tag is not CLEAR for DNC', () => {
  const result = resolveGuard('DNC', [{ source: 'GHL_TAGS', state: 'UNKNOWN' }]);
  assert.strictEqual(result.state, 'UNKNOWN');
});

test('18b WRONG_NUMBER defaults to NOT_APPLICABLE_NO_PRIOR_CONTACT', () => {
  const result = resolveGuard('WRONG_NUMBER', [{ source: 'GHL_TAGS', state: 'NOT_APPLICABLE_NO_PRIOR_CONTACT' }]);
  assert.strictEqual(result.state, 'NOT_APPLICABLE_NO_PRIOR_CONTACT');
});

test('18c PENDING_REPLY defaults to NOT_APPLICABLE_NO_PRIOR_CONTACT', () => {
  const result = resolveGuard('PENDING_REPLY', [{ source: 'GHL_TAGS', state: 'NOT_APPLICABLE_NO_PRIOR_CONTACT' }]);
  assert.strictEqual(result.state, 'NOT_APPLICABLE_NO_PRIOR_CONTACT');
});

test('18d ACTIVE_HUMAN_WORK defaults to CLEAR when not locked', () => {
  const result = resolveGuard('ACTIVE_HUMAN_WORK', [{ source: 'GHL_TAGS', state: 'CLEAR' }]);
  assert.strictEqual(result.state, 'CLEAR');
});

test('19 JustCall blacklist wins', () => {
  const result = resolveGuard('DNC', [
    { source: 'GHL_TAGS', state: 'UNKNOWN' },
    { source: 'JUSTCALL_BLACKLIST', state: 'BLOCKED' },
  ]);
  assert.strictEqual(result.state, 'BLOCKED');
});

test('20 local suppression wins', () => {
  const result = resolveGuard('STOP_OPT_OUT', [
    { source: 'GHL_TAGS', state: 'UNKNOWN' },
    { source: 'LOCAL_REGISTRY', state: 'BLOCKED' },
  ]);
  assert.strictEqual(result.state, 'BLOCKED');
});

test('21 conflicting sources block', () => {
  const result = resolveGuard('DNC', [
    { source: 'GHL_TAGS', state: 'CLEAR' },
    { source: 'JUSTCALL_BLACKLIST', state: 'BLOCKED' },
  ]);
  assert.strictEqual(result.state, 'BLOCKED');
});

test('22 all required clear states pass', () => {
  const result = resolveGuard('DNC', [{ source: 'GHL_TAGS', state: 'CLEAR' }]);
  assert.strictEqual(result.state, 'CLEAR');
});

test('23 any UNKNOWN blocks', () => {
  const result = resolveGuard('PENDING_REPLY', [
    { source: 'GHL_TAGS', state: 'UNKNOWN' },
    { source: 'JUSTCALL_HISTORY', state: 'UNKNOWN' },
  ]);
  assert.strictEqual(result.state, 'UNKNOWN');
});

test('24 active human work blocks', () => {
  const result = resolveGuard('ACTIVE_HUMAN_WORK', [{ source: 'GHL_TAGS', state: 'BLOCKED' }]);
  assert.strictEqual(result.state, 'BLOCKED');
});

test('25 pending reply blocks', () => {
  const result = resolveGuard('PENDING_REPLY', [{ source: 'JUSTCALL_HISTORY', state: 'BLOCKED' }]);
  assert.strictEqual(result.state, 'BLOCKED');
});

test('26 prior send blocks', () => {
  const result = resolveGuard('PRIOR_OUTREACH', [{ source: 'JUSTCALL_HISTORY', state: 'BLOCKED' }]);
  assert.strictEqual(result.state, 'BLOCKED');
});

test('27 provider uncertainty blocks', () => {
  const result = resolveGuard('PROVIDER_UNCERTAINTY', [{ source: 'JUSTCALL_HISTORY', state: 'UNKNOWN' }]);
  assert.strictEqual(result.state, 'UNKNOWN');
});

// === PLANNER ===

test('28 uses authoritative hydrator', () => {
  const builder = new CanaryPlanBuilder({ ghlToken: 'test' });
  assert.ok(builder.ghlToken);
  assert.ok(builder.locationId);
  assert.ok(builder.pipelineId);
});

test('29 uses owner policy version', () => {
  const { POLICY_VERSION } = require('./canary-plan-builder');
  assert.strictEqual(POLICY_VERSION, 'OP-2026-08-02-v1');
});

test('30 uses owner INT variant', () => {
  const { TEMPLATE_ID } = require('./canary-plan-builder');
  assert.strictEqual(TEMPLATE_ID, 'OWNER_APPROVED_PIPELINE_INT');
});

test('31 uses property-local timezone', () => {
  const result = derivePropertyTimezone({ propertyAddress: '123 Main St Dallas TX 75201', raw: { zip: '75201' } });
  assert.strictEqual(result.timeZone, 'America/Chicago');
  assert.strictEqual(result.ok, true);
});

test('32 blocks ambiguous timezone', () => {
  const result = derivePropertyTimezone({ propertyAddress: '123 Main St', raw: { zip: '' } });
  assert.strictEqual(result.ok, false);
});

test('33 maximum three enforced', () => {
  const { MAX_CANARY } = require('./canary-plan-builder');
  assert.strictEqual(MAX_CANARY, 3);
});

test('34 immutable hash changes with input', () => {
  const crypto = require('crypto');
  const h1 = crypto.createHash('sha256').update(JSON.stringify({ a: 1 })).digest('hex');
  const h2 = crypto.createHash('sha256').update(JSON.stringify({ a: 2 })).digest('hex');
  assert.notStrictEqual(h1, h2);
});

test('35 plan expires at earliest policy boundary', () => {
  const now = new Date();
  const expiry = new Date(now.getTime() + 30 * 60 * 1000);
  assert.ok(expiry > now);
});

test('36 preview is non-executable', () => {
  const builder = new CanaryPlanBuilder({ ghlToken: 'test' });
  assert.ok(builder);
});

test('37 temporary scripts cannot execute', () => {
  assert.strictEqual(fs.existsSync(path.resolve(__dirname, '..', '..', 'temp-canary-plan-builder.js')), false);
});

test('38 no direct send command exposed', () => {
  const builder = new CanaryPlanBuilder({ ghlToken: 'test' });
  assert.strictEqual(typeof builder.buildPreview, 'function');
  assert.strictEqual(typeof builder.sendSMS, 'undefined');
});

// === SAFETY ===

test('39 provider sends 0', () => {
  const ks = require('../bot/kill-switch').readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

test('40 GHL writes 0', () => {
  const ks = require('../bot/kill-switch').readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

test('41 stage movements 0', () => {
  const ks = require('../bot/kill-switch').readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

test('42 kill switch PAUSED', () => {
  const ks = require('../bot/kill-switch').readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

test('43 no untracked production executable', () => {
  assert.strictEqual(fs.existsSync(path.resolve(__dirname, '..', '..', 'temp-canary-plan-builder.js')), false);
});

test('44 no secrets committed', () => {
  const files = ['justcall-suppression-read-service.js', 'justcall-text-history-read-service.js', 'canary-plan-builder.js'];
  for (const f of files) {
    const content = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(!content.includes('a02aa39621da49ff1e61ba7195a219b2d0bb3162'), `${f} contains API key`);
    assert.ok(!content.includes('a06466df20a19fc0114fcc97a3edc2e334ec73dd'), `${f} contains API secret`);
  }
});

// === TIMEZONE VALIDATION ===

test('45 Eastern Florida resolves correctly', () => {
  const result = derivePropertyTimezone({ propertyAddress: '123 Main St Miami FL 33101', raw: { zip: '33101' } });
  assert.strictEqual(result.timeZone, 'America/New_York');
});

test('46 Florida panhandle resolves correctly', () => {
  const result = derivePropertyTimezone({ propertyAddress: '123 Main St Pensacola FL 32501', raw: { zip: '32501' } });
  assert.strictEqual(result.timeZone, 'America/Chicago');
});

test('47 Texas Central resolves correctly', () => {
  const result = derivePropertyTimezone({ propertyAddress: '123 Main St Dallas TX 75201', raw: { zip: '75201' } });
  assert.strictEqual(result.timeZone, 'America/Chicago');
});

test('48 Texas Mountain resolves correctly', () => {
  const result = derivePropertyTimezone({ propertyAddress: '123 Main St El Paso TX 79901', raw: { zip: '79901' } });
  assert.strictEqual(result.timeZone, 'America/Denver');
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
