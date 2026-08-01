'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const memCtx = require('../modules/pipeline-memory-context');
const proactiveEvents = require('../modules/proactive-event-handler');
const convState = require('./conversation-state');
const killSwitch = require('./kill-switch');
const ownerAuth = require('./owner-auth');

const PIPELINE_CHAT_ID = '-1003975794600';
const OWNER_ID = '718718959';

let tests = 0;
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests++;
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL: ${name} — ${e.message}`); }
}

function cleanup() {
  const dataDir = path.resolve(__dirname, '..', 'data');
  try { fs.unlinkSync(path.join(dataDir, 'pipeline-corrections.jsonl')); } catch (_) {}
  try { fs.unlinkSync(path.join(dataDir, 'pipeline-improvement-proposals.jsonl')); } catch (_) {}
  try { fs.unlinkSync(path.join(dataDir, 'pipeline-preferences.json')); } catch (_) {}
  convState.expireState(PIPELINE_CHAT_ID, OWNER_ID);
}

cleanup();

// MEMORY ADAPTER TESTS
test('1 existing stores are reused', () => {
  const ctx = memCtx.buildBoundedContext(PIPELINE_CHAT_ID, OWNER_ID, 'test');
  assert.ok(ctx.safety, 'safety state missing');
  assert.ok(ctx.conversation, 'conversation missing');
  assert.ok(ctx.preferences, 'preferences missing');
  assert.ok(ctx.canonicalRules, 'canonical rules missing');
  assert.ok(ctx.recentHistory, 'recent history missing');
});

test('2 no new duplicate database', () => {
  const dataDir = path.resolve(__dirname, '..', 'data');
  assert.ok(!fs.existsSync(path.join(dataDir, 'prolificclawd-memory')), 'duplicate memory dir should not exist');
});

test('3 context is bounded', () => {
  const ctx = memCtx.buildBoundedContext(PIPELINE_CHAT_ID, OWNER_ID, 'test');
  assert.ok(ctx.message.length <= 200, 'message not bounded');
  assert.ok(ctx.recentHistory.journalEntries.length <= 5, 'history not bounded');
});

test('4 live safety outranks memory', () => {
  const safety = memCtx.getSafetyState();
  assert.strictEqual(safety.authority, memCtx.AUTHORITY.LIVE_SAFETY);
  const conv = memCtx.getConversationContext(PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(conv.authority, memCtx.AUTHORITY.LIVE_OPERATIONAL);
  assert.ok(safety.authority < conv.authority, 'safety should outrank operational');
});

test('5 canonical rules outrank learned preferences', () => {
  const rules = memCtx.getCanonicalRules();
  assert.strictEqual(rules.authority, memCtx.AUTHORITY.CANONICAL);
  const prefs = memCtx.getOwnerPreferences();
  assert.ok(rules.authority < memCtx.AUTHORITY.OWNER_PREFERENCE, 'canonical should outrank preferences');
});

test('6 existing pipeline-console preference is retrieved', () => {
  const prefs = memCtx.getOwnerPreferences();
  assert.strictEqual(prefs.consoleChannel, 'pipeline-topic-389');
  assert.strictEqual(prefs.noAutonomousOutreach, true);
  assert.strictEqual(prefs.noAutonomousStageMovement, true);
});

test('7 duplicate preference is not created', () => {
  memCtx.updatePreference('consoleChannel', 'pipeline-topic-389');
  const prefs = memCtx.getOwnerPreferences();
  assert.strictEqual(prefs.consoleChannel, 'pipeline-topic-389');
  const dataDir = path.resolve(__dirname, '..', 'data');
  const prefFile = path.join(dataDir, 'pipeline-preferences.json');
  assert.ok(fs.existsSync(prefFile), 'preferences file should exist');
  const raw = JSON.parse(fs.readFileSync(prefFile, 'utf8'));
  assert.strictEqual(raw.consoleChannel, 'pipeline-topic-389');
});

// CORRECTION TESTS
test('8 one-lead correction stays lead-scoped', () => {
  const entry = memCtx.recordCorrection('this is the listing agent', 'THIS_CONTACT', PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(entry.scope, 'THIS_CONTACT');
  assert.strictEqual(entry.project, 'prolificcapital');
});

test('9 project-level correction persists', () => {
  const entry = memCtx.recordCorrection('Pipeline topic is the console', 'PIPELINE_PROJECT', PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(entry.scope, 'PIPELINE_PROJECT');
  const corrections = memCtx.getCorrections({ scope: 'PIPELINE_PROJECT' });
  assert.ok(corrections.length >= 1);
});

test('10 correction has provenance', () => {
  const corrections = memCtx.getCorrections({ limit: 1 });
  assert.ok(corrections.length > 0);
  assert.ok(corrections[0].memoryId);
  assert.ok(corrections[0].createdAt);
  assert.ok(corrections[0].text);
});

test('11 provenance is explainable', () => {
  const corrections = memCtx.getCorrections({ limit: 1 });
  if (corrections.length > 0) {
    const source = memCtx.explainSource(corrections[0].memoryId);
    assert.strictEqual(source.type, 'correction');
    assert.ok(source.text);
  }
});

// PROPOSAL TESTS
test('12 proposal can be created', () => {
  const prop = memCtx.recordProposal({
    evidence: 'repeated routing miss for "show me what we got"',
    frequency: 3,
    proposedChange: 'add synonym to intent classifier',
    affectedFiles: ['intent-classifier.js'],
    risk: 'low',
    canonicalImpact: 'none',
    requiredTests: ['test synonym routing'],
  });
  assert.strictEqual(prop.status, 'PROPOSED');
  assert.ok(prop.proposalId);
});

test('13 proposals can be retrieved', () => {
  const proposals = memCtx.getProposals({ status: 'PROPOSED' });
  assert.ok(proposals.length >= 1);
});

test('14 proposal does not modify code', () => {
  const proposals = memCtx.getProposals({ status: 'PROPOSED' });
  if (proposals.length > 0) {
    assert.strictEqual(proposals[0].status, 'PROPOSED');
    assert.strictEqual(proposals[0].approvedBy, null);
  }
});

// PROACTIVE EVENT TESTS
test('15 call completed asks whether they answered', () => {
  const result = proactiveEvents.handleCallCompleted({
    callId: 'call-1', contactId: 'c1', opportunityId: 'o1',
    propertyContext: '123 Test St', duration: 45,
  });
  assert.ok(result);
  assert.strictEqual(result.type, 'CALL_COMPLETED');
  assert.ok(result.reply.includes('Did they answer'));
});

test('16 call duration alone does not infer outcome', () => {
  const result = proactiveEvents.handleCallCompleted({
    callId: 'call-2', contactId: 'c2', opportunityId: 'o2',
    propertyContext: '456 Test Ave', duration: 120,
  });
  assert.ok(result.reply.includes('Did they answer'));
  assert.ok(!result.reply.includes('answered'));
  assert.ok(!result.reply.includes('no answer'));
});

test('17 inbound reply surfaces in Pipeline topic', () => {
  const result = proactiveEvents.handleInboundReply({
    messageId: 'msg-1', contactId: 'c1', opportunityId: 'o1',
    propertyContext: '123 Test St', message: 'Yes, still accepting offers',
  });
  assert.ok(result);
  assert.strictEqual(result.type, 'INBOUND_REPLY');
  assert.ok(result.reply.includes('Yes, still accepting offers'));
});

test('18 STOP triggers deterministic safety', () => {
  const result = proactiveEvents.handleInboundReply({
    messageId: 'msg-2', contactId: 'c2', opportunityId: 'o2',
    propertyContext: '456 Test Ave', message: 'STOP',
  });
  assert.ok(result);
  assert.strictEqual(result.type, 'STOP_HELP');
  assert.ok(result.reply.includes('PAUSED'));
  assert.ok(result.reply.includes('must not receive'));
});

test('19 SMS delivered reports correctly', () => {
  const result = proactiveEvents.handleSmsDelivered({
    messageId: 'msg-3', contactId: 'c1', opportunityId: 'o1',
    propertyContext: '123 Test St',
  });
  assert.ok(result);
  assert.strictEqual(result.type, 'SMS_DELIVERED');
  assert.ok(result.reply.includes('No stage movement'));
});

test('20 SMS failure reports and pauses', () => {
  const result = proactiveEvents.handleSmsFailed({
    messageId: 'msg-4', contactId: 'c1', opportunityId: 'o1',
    propertyContext: '123 Test St', error: 'INVALID_NUMBER',
  });
  assert.ok(result);
  assert.strictEqual(result.type, 'SMS_FAILED');
  assert.ok(result.reply.includes('No retry'));
});

test('21 provider uncertainty prohibits retry', () => {
  const result = proactiveEvents.handleProviderUncertainty({
    error: 'API_TIMEOUT',
  });
  assert.ok(result);
  assert.strictEqual(result.type, 'PROVIDER_UNCERTAINTY');
  assert.ok(result.reply.includes('PAUSED'));
});

test('22 duplicate event does not post twice', () => {
  const r1 = proactiveEvents.handleSmsDelivered({
    messageId: 'msg-dup', contactId: 'c-dup', opportunityId: 'o-dup',
    propertyContext: 'Dup St',
  });
  assert.ok(r1);
  const r2 = proactiveEvents.handleSmsDelivered({
    messageId: 'msg-dup', contactId: 'c-dup', opportunityId: 'o-dup',
    propertyContext: 'Dup St',
  });
  assert.strictEqual(r2, null);
});

test('23 no proactive send', () => {
  const result = proactiveEvents.handleCallCompleted({
    callId: 'call-3', contactId: 'c3', opportunityId: 'o3',
    propertyContext: '789 Test Blvd', duration: 30,
  });
  assert.ok(!result.reply.toLowerCase().includes('send'));
  assert.ok(!result.reply.toLowerCase().includes('sms'));
});

test('24 no proactive stage movement', () => {
  const result = proactiveEvents.handleSmsDelivered({
    messageId: 'msg-5', contactId: 'c1', opportunityId: 'o1',
    propertyContext: '123 Test St',
  });
  assert.ok(result.reply.includes('No stage movement'), 'should confirm no stage movement occurred');
  assert.ok(!result.reply.toLowerCase().includes('moved to'), 'should not claim stage was moved');
});

test('25 no proactive GHL write', () => {
  const result = proactiveEvents.handleInboundReply({
    messageId: 'msg-6', contactId: 'c1', opportunityId: 'o1',
    propertyContext: '123 Test St', message: 'Call me back',
  });
  assert.ok(!result.reply.toLowerCase().includes('ghl'));
  assert.ok(!result.reply.toLowerCase().includes('write'));
  assert.ok(!result.reply.toLowerCase().includes('update'));
});

// SAFETY TESTS
test('26 kill switch remains PAUSED', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

test('27 provider sends remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends || 0, 0);
});

test('28 GHL writes remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites || 0, 0);
});

test('29 stage movements remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements || 0, 0);
});

test('30 owner recognized', () => {
  assert.strictEqual(ownerAuth.isOwner(OWNER_ID), true);
});

console.log(`\nIntegration Tests: ${passed} passed, ${failed} failed, ${tests} total\n`);
process.exit(failed > 0 ? 1 : 0);
