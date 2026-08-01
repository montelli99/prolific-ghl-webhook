'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_OWNER_USER_ID = '718718959';

const ownerAuth = require('./owner-auth');
const convRouter = require('./conversation-router');
const convState = require('./conversation-state');
const classifier = require('./intent-classifier');

const PIPELINE_CHAT_ID = '-1003975794600';
const PIPELINE_TOPIC_ID = 389;
const OWNER_ID = '718718959';
const OTHER_ID = '999999999';

function msg(text, opts = {}) {
  return {
    message_id: opts.messageId || 1,
    from: { id: opts.userId || OWNER_ID, is_bot: false, username: opts.username || 'ProlificInvestments' },
    chat: { id: opts.chatId || PIPELINE_CHAT_ID, type: 'supergroup' },
    message_thread_id: opts.threadId !== undefined ? opts.threadId : PIPELINE_TOPIC_ID,
    text,
    date: Math.floor(Date.now() / 1000),
    ...opts.extra,
  };
}

function replyMsg(text, opts = {}) {
  return msg(text, {
    ...opts,
    extra: {
      reply_to_message: {
        message_id: 100,
        from: { id: 8524789360, is_bot: true, username: 'Prolificclawd_bot' },
        chat: { id: PIPELINE_CHAT_ID },
        text: 'prior bot message',
      },
    },
  });
}

function mentionMsg(text, opts = {}) {
  return msg(`@Prolificclawd_bot ${text}`, { ...opts, extra: { entities: [{ offset: 0, length: 18, type: 'mention' }] } });
}

let tests = 0;
let passed = 0;
let failed = 0;

async function test(name, fn) {
  tests++;
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name} — ${e.message}`);
  }
}

function resetState() {
  convState.expireState(PIPELINE_CHAT_ID, OWNER_ID);
  convState.expireState(PIPELINE_CHAT_ID, OTHER_ID);
}

// CONTEXT FILTERING
test('1 wrong chat ignored', () => {
  const m = msg('hello', { chatId: '-999999999999' });
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, false);
  assert.strictEqual(r.reason, 'WRONG_CHANNEL');
});

test('2 wrong topic ignored', () => {
  const m = msg('hello', { threadId: 999 });
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, false);
  assert.strictEqual(r.reason, 'WRONG_CHANNEL');
});

test('3 unrelated discussion ignored', () => {
  resetState();
  const m = msg('hey team what do you think about this deal');
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, false);
  assert.strictEqual(r.reason, 'UNRELATED_DISCUSSION');
});

test('4 mention triggers bot', () => {
  const m = mentionMsg('show me leads');
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, true);
  assert.strictEqual(r.reason, 'BOT_MENTIONED');
});

test('5 reply to bot triggers bot', () => {
  const m = replyMsg('visible');
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, true);
  assert.strictEqual(r.reason, 'REPLY_TO_BOT');
});

test('6 active session continues without mention', () => {
  resetState();
  convState.touchState(PIPELINE_CHAT_ID, OWNER_ID);
  const m = msg('show me the script');
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, true);
  assert.strictEqual(r.reason, 'ACTIVE_CONVERSATION');
});

test('7 bot messages ignored', () => {
  const m = msg('status', { extra: { from: { id: 8524789360, is_bot: true } } });
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, false);
  assert.strictEqual(r.reason, 'BOT_MESSAGE');
});

test('8 slash command always processed', () => {
  const m = msg('/status');
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, true);
  assert.strictEqual(r.reason, 'SLASH_COMMAND');
});

test('9 safety command always processed', () => {
  const m = msg('stop');
  const r = convRouter.shouldProcessMessage(m);
  assert.strictEqual(r.process, true);
  assert.strictEqual(r.reason, 'SAFETY_COMMAND');
});

// SAFETY COMMANDS
test('10 stop is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('stop'), true);
});

test('11 pause is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('pause'), true);
});

test('12 cancel is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('cancel'), true);
});

test('13 dont send is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand("don't send"), true);
});

test('14 do not send is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('do not send'), true);
});

test('15 never mind is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('never mind'), true);
});

test('16 abort is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('abort'), true);
});

test('17 hold is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('hold'), true);
});

test('18 pause everything is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('pause everything'), true);
});

test('19 cancel that is safety command', () => {
  assert.strictEqual(convRouter.isSafetyCommand('cancel that'), true);
});

// DETERMINISTIC FALLBACK
test('20 visible is acknowledgment', () => {
  const r = classifier.deterministicFallback('visible', {});
  assert.strictEqual(r.intent, 'ACKNOWLEDGMENT');
});

test('21 got it is acknowledgment', () => {
  const r = classifier.deterministicFallback('got it', {});
  assert.strictEqual(r.intent, 'ACKNOWLEDGMENT');
});

test('22 ok is acknowledgment', () => {
  const r = classifier.deterministicFallback('ok', {});
  assert.strictEqual(r.intent, 'ACKNOWLEDGMENT');
});

test('23 okay is acknowledgment', () => {
  const r = classifier.deterministicFallback('okay', {});
  assert.strictEqual(r.intent, 'ACKNOWLEDGMENT');
});

test('24 thanks is acknowledgment', () => {
  const r = classifier.deterministicFallback('thanks', {});
  assert.strictEqual(r.intent, 'ACKNOWLEDGMENT');
});

test('25 yes with no pending question is acknowledgment', () => {
  const r = classifier.deterministicFallback('yes', {});
  assert.strictEqual(r.intent, 'ACKNOWLEDGMENT');
});

test('26 yes with pending approval requires clarification', () => {
  const r = classifier.deterministicFallback('yes', { expectedAnswerType: 'PLAN_APPROVAL', pendingQuestion: 'Approve plan?' });
  assert.strictEqual(r.intent, 'PLAN_APPROVAL_REQUEST');
  assert.strictEqual(r.requiresClarification, true);
});

test('27 help is help request', () => {
  const r = classifier.deterministicFallback('help', {});
  assert.strictEqual(r.intent, 'HELP_REQUEST');
});

test('28 status is status request', () => {
  const r = classifier.deterministicFallback('status', {});
  assert.strictEqual(r.intent, 'STATUS_REQUEST');
});

test('29 activity is activity request', () => {
  const r = classifier.deterministicFallback('activity', {});
  assert.strictEqual(r.intent, 'ACTIVITY_REQUEST');
});

test('30 resume is resume dry run', () => {
  const r = classifier.deterministicFallback('resume', {});
  assert.strictEqual(r.intent, 'RESUME_DRY_RUN');
});

test('31 no with pending approval is plan cancel', () => {
  const r = classifier.deterministicFallback('no', { expectedAnswerType: 'PLAN_APPROVAL' });
  assert.strictEqual(r.intent, 'PLAN_CANCEL');
});

// APPROVAL PARSER
test('32 explicit approval detected', () => {
  assert.strictEqual(convRouter.isExplicitApproval('approve all three'), true);
  assert.strictEqual(convRouter.isExplicitApproval('send those three'), true);
  assert.strictEqual(convRouter.isExplicitApproval('send items 1 and 3'), true);
  assert.strictEqual(convRouter.isExplicitApproval('execute the plan'), true);
  assert.strictEqual(convRouter.isExplicitApproval('go ahead'), true);
  assert.strictEqual(convRouter.isExplicitApproval('proceed'), true);
});

test('33 non-approval not detected', () => {
  assert.strictEqual(convRouter.isExplicitApproval('visible'), false);
  assert.strictEqual(convRouter.isExplicitApproval('looks good'), false);
  assert.strictEqual(convRouter.isExplicitApproval('okay'), false);
  assert.strictEqual(convRouter.isExplicitApproval('cool'), false);
});

test('34 extract numbers from text', () => {
  const n = convRouter.extractNumbers('send items 1, 2, and 3');
  assert.deepStrictEqual(n, [1, 2, 3]);
});

test('35 extract numbers from approve all three', () => {
  const n = convRouter.extractNumbers('approve all three');
  assert.deepStrictEqual(n, []);
});

// CONVERSATION STATE
test('36 fresh state is not active', () => {
  resetState();
  assert.strictEqual(convState.isActive(PIPELINE_CHAT_ID, OWNER_ID), false);
});

test('37 touch makes state active', () => {
  resetState();
  convState.touchState(PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(convState.isActive(PIPELINE_CHAT_ID, OWNER_ID), true);
});

test('38 expire removes state', () => {
  resetState();
  convState.touchState(PIPELINE_CHAT_ID, OWNER_ID);
  convState.expireState(PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(convState.isActive(PIPELINE_CHAT_ID, OWNER_ID), false);
});

test('39 set pending question', () => {
  resetState();
  convState.setPendingQuestion(PIPELINE_CHAT_ID, OWNER_ID, 'Approve plan?', 'PLAN_APPROVAL');
  const ctx = convState.getConversationContext(PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(ctx.pendingQuestion, 'Approve plan?');
  assert.strictEqual(ctx.expectedAnswerType, 'PLAN_APPROVAL');
});

test('40 clear pending question', () => {
  resetState();
  convState.setPendingQuestion(PIPELINE_CHAT_ID, OWNER_ID, 'Approve?', 'PLAN_APPROVAL');
  convState.clearPendingQuestion(PIPELINE_CHAT_ID, OWNER_ID);
  const ctx = convState.getConversationContext(PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(ctx.pendingQuestion, null);
  assert.strictEqual(ctx.expectedAnswerType, null);
});

test('41 set active plan', () => {
  resetState();
  convState.setActivePlan(PIPELINE_CHAT_ID, OWNER_ID, 'canary_test123');
  const ctx = convState.getConversationContext(PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(ctx.activePlanId, 'canary_test123');
});

test('42 set stage', () => {
  resetState();
  convState.setStage(PIPELINE_CHAT_ID, OWNER_ID, 'Stage 1', 'session_abc');
  const ctx = convState.getConversationContext(PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(ctx.currentStage, 'Stage 1');
  assert.strictEqual(ctx.currentSessionId, 'session_abc');
});

test('43 add correction', () => {
  resetState();
  convState.addCorrection(PIPELINE_CHAT_ID, OWNER_ID, 'That is the agent, not owner');
  const ctx = convState.getConversationContext(PIPELINE_CHAT_ID, OWNER_ID);
  assert.strictEqual(ctx.corrections.length, 1);
  assert.strictEqual(ctx.corrections[0].text, 'That is the agent, not owner');
});

// BOT MENTION / REPLY DETECTION
test('44 bot mention detected', () => {
  const m = mentionMsg('hello');
  assert.strictEqual(convRouter.isBotMentioned(m), true);
});

test('45 no mention when no entities', () => {
  const m = msg('hello');
  assert.strictEqual(convRouter.isBotMentioned(m), false);
});

test('46 reply to bot detected', () => {
  const m = replyMsg('visible');
  assert.strictEqual(convRouter.isReplyToBot(m), true);
});

test('47 no reply to bot when no reply_to_message', () => {
  const m = msg('visible');
  assert.strictEqual(convRouter.isReplyToBot(m), false);
});

// CONVERSATIONAL REPLIES
test('48 acknowledgment reply is brief', () => {
  const reply = convRouter.buildConversationalReply({ intent: 'ACKNOWLEDGMENT' }, {});
  assert.strictEqual(reply, 'Got it.');
});

test('49 help reply contains commands', () => {
  const reply = convRouter.buildConversationalReply({ intent: 'HELP_REQUEST' }, {});
  assert.ok(reply.includes('Available Commands'));
});

test('50 status reply contains kill switch', () => {
  const reply = convRouter.buildConversationalReply({ intent: 'STATUS_REQUEST' }, {});
  assert.ok(reply.includes('Kill switch'));
});

test('51 correction reply is safe', () => {
  const reply = convRouter.buildConversationalReply({ intent: 'CORRECTION' }, {});
  assert.ok(reply.includes('No production action'));
});

test('52 plan cancel reply is safe', () => {
  const reply = convRouter.buildConversationalReply({ intent: 'PLAN_CANCEL' }, {});
  assert.ok(reply.includes('No sends occurred'));
});

// INTENT CLASSIFIER ALLOWLIST
test('53 all intents in allowlist', () => {
  const intents = ['ACKNOWLEDGMENT', 'CASUAL_CONVERSATION', 'HELP_REQUEST', 'STATUS_REQUEST',
    'SHOW_WORK', 'SHOW_LEADS', 'START_STAGE1', 'START_STAGE2', 'START_STAGE3',
    'STAGE_GUIDANCE', 'SHOW_SCRIPT', 'CONTACT_PATH_SELECTION', 'CALL_OUTCOME',
    'RECORD_INFORMATION', 'SHOW_NOTES', 'PLAN_REVIEW', 'PLAN_SELECTION',
    'PLAN_APPROVAL_REQUEST', 'PLAN_CANCEL', 'PAUSE', 'RESUME_DRY_RUN',
    'CANARY_ENABLE_REQUEST', 'ACTIVITY_REQUEST', 'CORRECTION', 'UNKNOWN'];
  for (const intent of intents) {
    assert.ok(classifier.ALLOWED_INTENTS.has(intent), `Missing intent: ${intent}`);
  }
});

test('54 all intents have handlers', () => {
  for (const intent of classifier.ALLOWED_INTENTS) {
    assert.ok(classifier.INTENT_TO_HANDLER[intent] !== undefined, `Missing handler for: ${intent}`);
  }
});

// OWNER AUTH
test('55 owner recognized', () => {
  assert.strictEqual(ownerAuth.isOwner('718718959'), true);
});

test('56 non-owner not recognized', () => {
  assert.strictEqual(ownerAuth.isOwner('999999999'), false);
});

test('57 pipeline channel recognized', () => {
  assert.strictEqual(ownerAuth.isPipelineChannel('-1003975794600', 389), true);
});

test('58 wrong chat not pipeline', () => {
  assert.strictEqual(ownerAuth.isPipelineChannel('-999999999', 389), false);
});

test('59 wrong topic not pipeline', () => {
  assert.strictEqual(ownerAuth.isPipelineChannel('-1003975794600', 999), false);
});

test('60 null thread still matches pipeline chat', () => {
  assert.strictEqual(ownerAuth.isPipelineChannel('-1003975794600', null), true);
});

(async () => {
  await new Promise(r => setTimeout(r, 100));
  console.log(`\nConversation Tests: ${passed} passed, ${failed} failed, ${tests} total\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
