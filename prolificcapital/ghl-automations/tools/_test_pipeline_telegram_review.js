#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.PIPELINE_LEDGER_HASH_KEY = process.env.PIPELINE_LEDGER_HASH_KEY || 'test-ledger-key-for-telegram-review';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-telegram-review-'));
process.env.PIPELINE_REVIEW_ANNOTATIONS_PATH = path.join(tmp, 'annotations.jsonl');
process.env.PIPELINE_REVIEW_AUDIT_PATH = path.join(tmp, 'audit.jsonl');
process.env.PIPELINE_TELEGRAM_NOTIFICATION_STATE_PATH = path.join(tmp, 'notification-state.json');
process.env.PIPELINE_HUMAN_CONTEXT_PATH = path.join(tmp, 'human-context.jsonl');
process.env.PIPELINE_TELEGRAM_REVIEWER_IDS = '1001,1002';
process.env.PIPELINE_TELEGRAM_ADMIN_IDS = '9001';

const ledger = require('./lib/pipeline-shadow-ledger');
const service = require('../services/pipeline-review-service');
const aiBriefing = require('../services/pipeline-ai-briefing-service');
const tg = require('../modules/pipeline-telegram-review');
const router = require('../modules/telegram-command-router');

const decisions = ledger.readJsonl(ledger.LEDGER_PATH);
if (!decisions.length) throw new Error('Expected existing shadow decisions for Telegram review tests');
const decisionId = decisions[0].decisionId;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

function ctx(user = 1001, chat = 5001) { return { telegramUserId: user, chatId: chat, env: process.env }; }
function topicCtx(user = 1001, chat = -1003975794600, topic = 389) { return { telegramUserId: user, chatId: chat, messageThreadId: topic, env: process.env }; }

async function main() {
await test('unauthorized user denied generically', () => {
  const result = tg.handlePipelineCommand(ctx(777), 'health');
  assert.strictEqual(result.reply, 'Access denied.');
});

await test('authorized reviewer sees health', () => {
  const result = tg.healthView(ctx());
  assert.ok(result.reply.includes('Pipeline Shadow Health'));
  service.validateNoForbidden(result.reply);
});

await test('authorized admin sees alerts', () => {
  const result = tg.alertsView(ctx(9001));
  assert.ok(result.reply.includes('Pipeline Alerts'));
});

await test('reviewer cannot view admin alerts', () => {
  assert.throws(() => tg.alertsView(ctx(1001)), /Access denied/);
});

await test('router /pipeline uses review center', async () => {
  const result = await router.routeCommand({ command: 'pipeline', args: 'health', telegramUserId: 1001, chatId: 5001, env: process.env });
  assert.ok(result.reply.includes('Pipeline Shadow Health'));
});

await test('callback reviewer binding', () => {
  const token = tg.tokenFor({ action: 'open', decisionId, telegramUserId: 1001, chatId: 5001 });
  assert.throws(() => tg.consumeToken(token, { telegramUserId: 1002, chatId: 5001 }), /reviewer mismatch/);
});

await test('callback chat binding', () => {
  const token = tg.tokenFor({ action: 'open', decisionId, telegramUserId: 1001, chatId: 5001 });
  assert.throws(() => tg.consumeToken(token, { telegramUserId: 1001, chatId: 5002 }), /chat mismatch/);
});

await test('callback decision binding and replay', () => {
  const token = tg.tokenFor({ action: 'open', decisionId, telegramUserId: 1001, chatId: 5001 });
  const state = tg.consumeToken(token, { telegramUserId: 1001, chatId: 5001 });
  assert.strictEqual(state.decisionId, decisionId);
  assert.throws(() => tg.consumeToken(token, { telegramUserId: 1001, chatId: 5001 }), /already used/);
});

await test('forged callback rejected', () => {
  assert.throws(() => tg.consumeToken('forged', { telegramUserId: 1001, chatId: 5001 }), /Invalid callback/);
});

await test('callback expiration', () => {
  const token = tg.tokenFor({ action: 'open', decisionId, telegramUserId: 1001, chatId: 5001 });
  tg.callbackTokens.get(token).expiresAt = Date.now() - 1;
  assert.throws(() => tg.consumeToken(token, { telegramUserId: 1001, chatId: 5001 }), /Expired callback/);
});

await test('review-state expiration and binding', () => {
  const stateId = tg.startReviewState({ telegramUserId: 1001, chatId: 5001, decisionId, action: 'accept' });
  assert.strictEqual(tg.getReviewState(stateId, 1001, 5001).decisionId, decisionId);
  assert.throws(() => tg.getReviewState(stateId, 1002, 5001), /binding mismatch/);
  tg.reviewStates.get(stateId).expiresAt = Date.now() - 1;
  assert.throws(() => tg.getReviewState(stateId, 1001, 5001), /expired/);
});

await test('concurrent reviewers have isolated states', () => {
  const a = tg.startReviewState({ telegramUserId: 1001, chatId: 5001, decisionId, action: 'accept' });
  const b = tg.startReviewState({ telegramUserId: 1002, chatId: 5001, decisionId, action: 'reject' });
  assert.notStrictEqual(a, b);
  assert.strictEqual(tg.getReviewState(a, 1001, 5001).action, 'accept');
  assert.strictEqual(tg.getReviewState(b, 1002, 5001).action, 'reject');
});

await test('append-only annotation and idempotency', () => {
  const first = service.appendReviewAnnotation({ decisionId, reviewStatus: 'ACCEPTED', reasonCode: 'RECOMMENDATION_CORRECT', idempotencyKey: 'idem-1' }, { telegramUserId: 1001, alias: 'Reviewer-test' });
  const second = service.appendReviewAnnotation({ decisionId, reviewStatus: 'ACCEPTED', reasonCode: 'RECOMMENDATION_CORRECT', idempotencyKey: 'idem-1' }, { telegramUserId: 1001, alias: 'Reviewer-test' });
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(ledger.readJsonl(process.env.PIPELINE_REVIEW_ANNOTATIONS_PATH).filter((item) => item.idempotencyKey === 'idem-1').length, 1);
});

await test('superseding annotation appends new record', () => {
  const first = ledger.readJsonl(process.env.PIPELINE_REVIEW_ANNOTATIONS_PATH)[0];
  const next = service.appendReviewAnnotation({ decisionId, reviewStatus: 'MODIFIED', reasonCode: 'NEWER_EVIDENCE_AVAILABLE', supersedesAnnotationId: first.annotationId, humanChosenAction: 'KEEP_STAGE', idempotencyKey: 'idem-2' }, { telegramUserId: 1001, alias: 'Reviewer-test' });
  assert.strictEqual(next.annotation.supersedesAnnotationId, first.annotationId);
  assert.strictEqual(ledger.readJsonl(process.env.PIPELINE_REVIEW_ANNOTATIONS_PATH).length, 2);
});

await test('invalid reason code rejected', () => {
  assert.throws(() => service.appendReviewAnnotation({ decisionId, reviewStatus: 'REJECTED', reasonCode: 'BAD', notes: 'x' }, { telegramUserId: 1001 }), /Invalid reason/);
});

await test('invalid chosen stage rejected', () => {
  assert.throws(() => service.appendReviewAnnotation({ decisionId, reviewStatus: 'MODIFIED', reasonCode: 'NEWER_EVIDENCE_AVAILABLE', humanChosenStage: 'Bad Stage' }, { telegramUserId: 1001 }), /Invalid chosen stage/);
});

await test('note length limit enforced', () => {
  assert.throws(() => service.appendReviewAnnotation({ decisionId, reviewStatus: 'REJECTED', reasonCode: 'OTHER', notes: 'x'.repeat(1001) }, { telegramUserId: 1001 }), /too long/);
});

await test('PII raw ID and auth notes rejected', () => {
  assert.throws(() => service.appendReviewAnnotation({ decisionId, reviewStatus: 'REJECTED', reasonCode: 'OTHER', notes: 'seller x@y.com' }, { telegramUserId: 1001 }), /email|PII|Forbidden/i);
  assert.throws(() => service.appendReviewAnnotation({ decisionId, reviewStatus: 'REJECTED', reasonCode: 'OTHER', notes: ledger.LOCATION_ID }, { telegramUserId: 1001 }), /production ID/i);
  assert.throws(() => service.appendReviewAnnotation({ decisionId, reviewStatus: 'REJECTED', reasonCode: 'OTHER', notes: 'Bearer abcdef1234567890' }, { telegramUserId: 1001 }), /auth/i);
});

await test('Markdown escaping and message length handling', () => {
  assert.strictEqual(tg.escapeMd('_*`['), '\\_\\*\\`\\[');
  const result = tg.decisionDetailView(ctx(), decisionId);
  assert.ok(result.reply.length <= 3900);
});

await test('export sanitation', () => {
  const file = service.createSanitizedExport('review-test.csv', [{ ref: 'Lead-abc', status: 'OK' }]);
  const text = fs.readFileSync(file, 'utf8');
  service.validateNoForbidden(text);
});

await test('audit-log redaction and no raw Telegram IDs', () => {
  const audit = fs.readFileSync(process.env.PIPELINE_REVIEW_AUDIT_PATH, 'utf8');
  assert.ok(!audit.includes('1001'));
  assert.ok(!audit.includes('x@y.com'));
  assert.ok(!audit.includes(ledger.LOCATION_ID));
  assert.ok(!/Bearer\s+[A-Za-z0-9._~+/-]{16,}/i.test(audit));
});

await test('no GHL mutation action exposed in queue buttons', () => {
  const result = tg.queueView(ctx());
  const text = JSON.stringify(result.replyMarkup);
  for (const bad of ['Move Stage', 'Update GHL', 'Send SMS', 'Send Email', 'Create Task', 'Create Note', 'Trigger Workflow', 'Send Contract']) assert.ok(!text.includes(bad));
});

await test('nonexistent decision rejected', () => {
  assert.throws(() => service.getDecisionDetail('missing'), /not found/i);
});

await test('pagination first middle last pages and navigation buttons', () => {
  process.env.PIPELINE_REVIEW_INCLUDE_TEST_FIXTURES = '1';
  process.env.PIPELINE_REVIEW_FIXTURE_COUNT = '6';
  const first = tg.queueView(topicCtx(), 'All', 1);
  const second = tg.queueView(topicCtx(), 'All', 2);
  const third = tg.queueView(topicCtx(), 'All', 3);
  assert.ok(first.reply.includes('Page 1/'));
  assert.ok(second.reply.includes('Page 2/'));
  assert.ok(third.reply.includes('Page 3/'));
  assert.ok(JSON.stringify(first.replyMarkup).includes('Next'));
  assert.ok(!JSON.stringify(first.replyMarkup).includes('Previous'));
  assert.ok(JSON.stringify(second.replyMarkup).includes('Previous'));
  assert.ok(JSON.stringify(second.replyMarkup).includes('Next'));
  assert.ok(JSON.stringify(third.replyMarkup).includes('Previous'));
  assert.ok(!JSON.stringify(third.replyMarkup).includes('Next'));
  service.validateNoForbidden(first.reply + second.reply + third.reply);
  delete process.env.PIPELINE_REVIEW_INCLUDE_TEST_FIXTURES;
  delete process.env.PIPELINE_REVIEW_FIXTURE_COUNT;
});

await test('pagination filter persistence and empty state', () => {
  const filtered = tg.queueView(topicCtx(), 'Proposed Moves', 1);
  assert.ok(filtered.reply.includes('Filter: Proposed Moves'));
  assert.ok(filtered.reply.includes('No decisions currently match this filter.'));
  assert.ok(JSON.stringify(filtered.replyMarkup).includes('Change Filter'));
  assert.ok(JSON.stringify(filtered.replyMarkup).includes('Refresh'));
});

await test('review queue prioritizes evidence-rich reviewability labels', () => {
  const q = service.getReviewQueue({ filter: 'All', page: 1, pageSize: 5 });
  assert.ok(q.items.slice(0, 3).every((item) => Object.values(item.evidence).some((value) => Number(value) > 0)));
  assert.ok(q.items.some((item) => item.reviewabilityLabel === 'Ready for Review'));
  assert.ok(q.items.some((item) => item.reviewabilityLabel === 'Needs More Data'));
  const view = tg.queueView(topicCtx(), 'All', 1);
  assert.ok(view.reply.includes('Reviewability:'));
  assert.ok(view.reply.includes('Ready for Review') || view.reply.includes('Needs More Data'));
  service.validateNoForbidden(view.reply);
});

await test('AI briefing translates internal codes into plain English', () => {
  const b = aiBriefing.briefingForDecision(decisionId);
  const text = aiBriefing.renderBriefing(b);
  assert.ok(!text.includes('KEEP_STAGE'));
  assert.ok(!text.includes('INSUFFICIENT_DATA'));
  assert.ok(!text.includes('STILL_PENDING'));
  assert.ok(text.includes('My recommendation'));
  assert.ok(text.includes('Can a human independently verify'));
  service.validateNoForbidden(text);
});

await test('AI briefing technical details isolates internal codes', () => {
  const b = aiBriefing.briefingForDecision(decisionId);
  const technical = aiBriefing.renderTechnicalDetails(b);
  assert.ok(technical.includes('Recommendation code'));
  assert.ok(technical.includes('Confidence code'));
  service.validateNoForbidden(technical);
});

await test('AI briefing explain more show evidence and button help', () => {
  const b = aiBriefing.briefingForDecision(decisionId);
  for (const text of [aiBriefing.renderExplainMore(b), aiBriefing.renderEvidence(b), aiBriefing.renderButtonHelp()]) {
    assert.ok(text.length > 20);
    service.validateNoForbidden(text);
  }
});

await test('AI briefing generates targeted missing-evidence questions only', () => {
  const b = aiBriefing.briefingForDecision(decisionId);
  assert.ok(b.questionsForUser.every((q) => q.code && q.text));
  assert.ok(!JSON.stringify(b.questionsForUser).includes('phone number'));
});

await test('human context appends locally and regenerates briefing without GHL writes', () => {
  const before = fs.existsSync(aiBriefing.contextPath()) ? fs.readFileSync(aiBriefing.contextPath(), 'utf8').trim().split(/\n/).filter(Boolean).length : 0;
  const record = aiBriefing.appendHumanContext({ decisionId, questionCode: 'OUTSIDE_CONVERSATION', answerCode: 'NO', text: 'No outside conversation.' }, { telegramUserId: 1001 });
  const after = fs.readFileSync(aiBriefing.contextPath(), 'utf8').trim().split(/\n/).filter(Boolean).length;
  assert.strictEqual(after, before + 1);
  assert.ok(record.reviewerHash);
  assert.ok(!JSON.stringify(record).includes('1001'));
  service.validateNoForbidden(JSON.stringify({ decisionRef: record.decisionRef, questionCode: record.questionCode, answerCode: record.answerCode, sanitizedText: record.sanitizedText, source: record.source }));
});

await test('Telegram briefing views expose conversational controls', () => {
  const before = fs.existsSync(aiBriefing.contextPath()) ? fs.readFileSync(aiBriefing.contextPath(), 'utf8').trim().split(/\n/).filter(Boolean).length : 0;
  const detail = tg.decisionDetailView(topicCtx(), decisionId);
  const markup = JSON.stringify(detail.replyMarkup);
  assert.ok(detail.reply.includes('What happened'));
  assert.ok(!detail.reply.includes('KEEP_STAGE'));
  assert.ok(markup.includes('Explain More'));
  assert.ok(markup.includes('Show Evidence'));
  assert.ok(markup.includes('What Do These Mean?'));
  assert.ok(markup.includes('Need More Information'));
  const view = tg.addContextView(topicCtx(), decisionId);
  const contextMarkup = JSON.stringify(view.replyMarkup);
  for (const label of ['Yes', 'No', 'Not Sure', 'Add Context', 'Skip', 'Back', 'Cancel']) assert.ok(contextMarkup.includes(label));
  const custom = tg.customContextView(topicCtx(), decisionId);
  assert.ok(custom.reply.includes('No GHL change was made'));
  const after = fs.existsSync(aiBriefing.contextPath()) ? fs.readFileSync(aiBriefing.contextPath(), 'utf8').trim().split(/\n/).filter(Boolean).length : 0;
  assert.strictEqual(after, before);
  service.validateNoForbidden(detail.reply + view.reply + custom.reply + contextMarkup);
});

await test('pagination stale out-of-range page is handled safely', () => {
  const stale = tg.queueView(topicCtx(), 'All', 999);
  assert.ok(stale.reply.includes('no longer available'));
  assert.ok(JSON.stringify(stale.replyMarkup).includes('Refresh'));
  service.validateNoForbidden(stale.reply);
});

await test('pagination callback state is opaque and topic-bound', () => {
  const page = tg.queueView(topicCtx(), 'Insufficient Data', 1);
  const payload = JSON.stringify(page.replyMarkup);
  assert.ok(payload.includes('pl:'));
  assert.ok(!payload.includes(decisionId));
  const token = page.replyMarkup.inline_keyboard.flat().find((button) => button.text === 'Refresh').callback_data.slice(3);
  const state = tg.consumeToken(token, { telegramUserId: 1001, chatId: -1003975794600, messageThreadId: 389, singleUse: false });
  assert.strictEqual(state.filter, 'Insufficient Data');
  assert.strictEqual(state.page, 1);
  assert.throws(() => tg.consumeToken(token, { telegramUserId: 1001, chatId: 1001, messageThreadId: undefined, singleUse: false }), /chat mismatch/);
  assert.throws(() => tg.consumeToken(token, { telegramUserId: 1001, chatId: -1003975794600, messageThreadId: 1677, singleUse: false }), /topic mismatch/);
});

await test('decision history includes decision outcome annotation and superseded review', () => {
  const annotations = ledger.readJsonl(process.env.PIPELINE_REVIEW_ANNOTATIONS_PATH);
  assert.ok(annotations.length >= 2);
  const history = service.getDecisionHistory(decisionId);
  assert.ok(history.entries.some((entry) => entry.type === 'DECISION'));
  assert.ok(history.entries.some((entry) => entry.type === 'OUTCOME'));
  assert.ok(history.entries.some((entry) => entry.type === 'HUMAN_REVIEW'));
  assert.ok(history.entries.some((entry) => entry.type === 'REVIEW_CORRECTION'));
  assert.ok(history.entries.some((entry) => entry.type === 'AUDIT'));
  assert.ok(history.entries.some((entry) => entry.status === 'Superseded'));
  const view = tg.decisionHistoryView(topicCtx(), decisionId, 1);
  assert.ok(view.reply.includes('Decision History'));
  assert.ok(view.reply.includes('DECISION'));
  service.validateNoForbidden(view.reply);
});

await test('history pagination and back buttons', () => {
  const view = tg.decisionHistoryView(topicCtx(), decisionId, 1);
  const markup = JSON.stringify(view.replyMarkup);
  assert.ok(markup.includes('Latest'));
  assert.ok(markup.includes('Back to Decision'));
  assert.ok(markup.includes('Back to Queue'));
});

await test('history invalid supersedes reference produces sanitized warning', () => {
  service.appendReviewAnnotation({ decisionId, reviewStatus: 'DEFERRED', reasonCode: 'HUMAN_JUDGMENT_REQUIRED', supersedesAnnotationId: 'missing-annotation', idempotencyKey: 'idem-bad-supersedes' }, { telegramUserId: 1001, alias: 'Reviewer-test' });
  const view = tg.decisionHistoryView(topicCtx(), decisionId, 1);
  assert.ok(view.reply.includes('INTEGRITY WARNING') || service.getDecisionHistory(decisionId).entries.some((entry) => entry.type === 'INTEGRITY_WARNING'));
  service.validateNoForbidden(view.reply);
});

await test('durable notification sent once and suppressed after simulated restart', () => {
  const first = service.beginNotification({ type: 'TEST_ROUTING', reference: 'run-1', window: 'explicit', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, version: 'v1' });
  assert.strictEqual(first.shouldSend, true);
  service.completeNotification(first.key, 'SENT');
  const second = service.beginNotification({ type: 'TEST_ROUTING', reference: 'run-1', window: 'explicit', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, version: 'v1' });
  assert.strictEqual(second.shouldSend, false);
  assert.strictEqual(second.status, 'DUPLICATE_SUPPRESSED');
});

await test('durable notification allows new day and state change', () => {
  const day1 = service.beginNotification({ type: 'DAILY_REVIEW_DIGEST', reference: 'digest', window: '2026-07-28', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, version: 'v1' });
  service.completeNotification(day1.key, 'SENT');
  const day2 = service.beginNotification({ type: 'DAILY_REVIEW_DIGEST', reference: 'digest', window: '2026-07-29', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, version: 'v1' });
  assert.strictEqual(day2.shouldSend, true);
  const readiness = service.beginNotification({ type: 'READINESS_CHANGE', reference: 'transition-a', window: 'all', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, state: 'OLD:NEW', version: 'v1' });
  assert.strictEqual(readiness.shouldSend, true);
});

await test('durable notification failure retry and pending uncertainty are bounded', () => {
  const failed = service.beginNotification({ type: 'PIPELINE_ALERT', reference: 'alert-a', window: '2026-07-28', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, version: 'v1' });
  service.completeNotification(failed.key, 'FAILED', 'TelegramError');
  const retry = service.beginNotification({ type: 'PIPELINE_ALERT', reference: 'alert-a', window: '2026-07-28', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, version: 'v1' });
  assert.strictEqual(retry.shouldSend, true);
  const pending = service.beginNotification({ type: 'PIPELINE_ALERT', reference: 'alert-b', window: '2026-07-28', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, version: 'v1' });
  const uncertain = service.beginNotification({ type: 'PIPELINE_ALERT', reference: 'alert-b', window: '2026-07-28', destinationType: 'PIPELINE_TOPIC', topic: 389, topicMatch: true, version: 'v1' });
  assert.strictEqual(pending.shouldSend, true);
  assert.strictEqual(uncertain.status, 'DELIVERY_UNCERTAIN');
});

await test('notification state retention and privacy', () => {
  const state = service.cleanupNotificationState(Date.now() + 91 * 86400000);
  const text = JSON.stringify(state);
  assert.ok(!text.includes(ledger.LOCATION_ID));
  assert.ok(!text.includes(ledger.PIPELINE_ID));
  assert.ok(!/Bearer\s+[A-Za-z0-9._~+/-]{16,}/i.test(text));
  assert.ok(fs.existsSync(process.env.PIPELINE_TELEGRAM_NOTIFICATION_STATE_PATH));
});

console.log(`Passed: ${passed}`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
