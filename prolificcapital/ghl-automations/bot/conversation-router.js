'use strict';

const crypto = require('crypto');
const ownerAuth = require('./owner-auth');
const killSwitch = require('./kill-switch');
const canary = require('./canary-executor');
const convState = require('./conversation-state');
const classifier = require('./intent-classifier');

const PIPELINE_CHAT_ID = ownerAuth.PIPELINE_CHAT_ID;
const PIPELINE_TOPIC_ID = ownerAuth.PIPELINE_TOPIC_ID;

function hashId(id) { return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 8); }

function isBotMentioned(msg) {
  if (!msg.entities) return false;
  return msg.entities.some(e => e.type === 'mention' && msg.text.slice(e.offset, e.offset + e.length) === '@Prolificclawd_bot');
}

function isReplyToBot(msg) {
  if (!msg.reply_to_message) return false;
  return msg.reply_to_message.from && msg.reply_to_message.from.id === 8524789360;
}

function isSafetyCommand(text) {
  const t = text.toLowerCase().trim();
  return /^(stop|pause|cancel|abort|hold|never\s*mind|don'?t\s*send|do\s*not\s*send|pause\s*outreach|pause\s*everything|cancel\s*that)$/i.test(t);
}

function isSlashCommand(text) {
  return /^\//.test(text.trim());
}

function isAcknowledgment(text) {
  const t = text.toLowerCase().replace(/[.,!?]+$/, '').trim();
  return /^(visible|got\s*it|ok|okay|k|kk|cool|nice|thanks|thx|ty|done|great|perfect|awesome|sounds?\s*good|looks?\s*good|good\s*to\s*know|understood|roger|10-?4|will\s*do|on\s*it|noted|alright|all\s*right|fine|sweet|excellent|wonderful|fantastic|lovely|brilliant|superb?|yep|yeah|yup|yes|no|nope|nah|not\s*now|i\s*see|makes?\s*sense|that\s*works|works?\s*for\s*me)$/i.test(t) ||
         /^(yes|yeah|yep|yup)[,.\s]+.*(see|got|understand|follow|works?)/i.test(t) ||
         /^(i\s+)?(can\s+)?see\s+(it|you|that|this)/i.test(t) ||
         /^(confirmed|acknowledged|received|copied|roger\s*that)$/i.test(t);
}

function isExplicitApproval(text) {
  const t = text.toLowerCase().trim();
  return /^(approve|send\s*(those|them|all|items?|it)|execute|go\s*ahead|proceed)/i.test(t) ||
         /^(approve\s*all|send\s*all|approve\s*items?|send\s*items?|approve\s*numbers?|send\s*numbers?)/i.test(t) ||
         /^(yes[,.]?\s*(send|approve|do\s*it|go|please))/i.test(t);
}

function extractNumbers(text) {
  const matches = text.match(/\d+/g);
  if (!matches) return [];
  return matches.map(Number).filter(n => n >= 1);
}

function validateApproval(msg, plan) {
  if (!plan) return { ok: false, reason: 'NO_ACTIVE_PLAN' };
  if (plan.state === 'EXPIRED' || plan.state === 'SUPERSEDED' || plan.state === 'COMPLETED' || plan.state === 'FAILED') {
    return { ok: false, reason: `PLAN_${plan.state}` };
  }
  if (new Date(plan.expiresAt) < new Date()) return { ok: false, reason: 'PLAN_EXPIRED' };
  if (String(msg.from.id) !== String(plan.createdBy)) return { ok: false, reason: 'NOT_PLAN_CREATOR' };
  if (!ownerAuth.isOwner(msg.from.id)) return { ok: false, reason: 'NOT_OWNER' };
  if (msg.forward_date || msg.forward_from) return { ok: false, reason: 'FORWARDED' };
  if (msg.edit_date) return { ok: false, reason: 'EDITED' };
  const ks = killSwitch.readKillSwitch();
  if (!killSwitch.canSend(ks.state)) return { ok: false, reason: `KILL_SWITCH_${ks.state}` };
  return { ok: true };
}

function shouldProcessMessage(msg) {
  const chatId = String(msg.chat.id);
  const messageThreadId = msg.message_thread_id;
  const userId = String(msg.from.id);

  if (!ownerAuth.isPipelineChannel(chatId, messageThreadId)) return { process: false, reason: 'WRONG_CHANNEL' };
  if (msg.from.is_bot) return { process: false, reason: 'BOT_MESSAGE' };

  if (isSafetyCommand(msg.text)) return { process: true, reason: 'SAFETY_COMMAND' };
  if (isSlashCommand(msg.text)) return { process: true, reason: 'SLASH_COMMAND' };
  if (isBotMentioned(msg)) return { process: true, reason: 'BOT_MENTIONED' };
  if (isReplyToBot(msg)) return { process: true, reason: 'REPLY_TO_BOT' };
  if (convState.isActive(chatId, userId)) return { process: true, reason: 'ACTIVE_CONVERSATION' };

  return { process: false, reason: 'UNRELATED_DISCUSSION' };
}

function resolveReplyContext(msg) {
  if (!isReplyToBot(msg)) return null;
  const replyTo = msg.reply_to_message;
  return {
    messageId: replyTo.message_id,
    text: replyTo.text || '',
    date: replyTo.date,
  };
}

async function routeMessage(msg, handlers) {
  const chatId = String(msg.chat.id);
  const userId = String(msg.from.id);
  const text = String(msg.text || '').trim();

  const filter = shouldProcessMessage(msg);
  if (!filter.process) return { action: 'IGNORE', reason: filter.reason };

  if (isReplyToBot(msg)) {
    const replyCtx = resolveReplyContext(msg);
    convState.touchState(chatId, userId);
    if (replyCtx) {
      convState.setLastBotMessage(chatId, userId, replyCtx.messageId, replyCtx.text);
    }
  }

  if (isSafetyCommand(text)) {
    killSwitch.writeKillSwitch('PAUSED');
    convState.expireState(chatId, userId);
    return { action: 'SAFETY_PAUSE', reply: 'Operations PAUSED. All pending actions canceled.' };
  }

  if (isSlashCommand(text)) {
    return { action: 'SLASH_COMMAND', text };
  }

  if (isAcknowledgment(text)) {
    convState.clearPendingQuestion(chatId, userId);
    return { action: 'ACKNOWLEDGMENT' };
  }

  const ks = killSwitch.readKillSwitch();
  const ctx = convState.getConversationContext(chatId, userId);

  if (isExplicitApproval(text) && ctx.activePlanId) {
    const plan = canary.loadCanaryPlan(ctx.activePlanId);
    const approval = validateApproval(msg, plan);
    if (approval.ok) {
      const numbers = extractNumbers(text);
      const items = numbers.length ? numbers : plan.items.filter(i => i.status === 'PENDING').map(i => i.number);
      if (!items.length) {
        return { action: 'CLARIFY', reply: 'Which items should I send? For example: "send 1 and 3" or "send all three".' };
      }
      return { action: 'APPROVE_CANARY', planId: ctx.activePlanId, items };
    }
    return { action: 'APPROVAL_BLOCKED', reply: `Cannot approve: ${approval.reason}.` };
  }

  const intent = await classifier.classifyIntent(text, {
    killSwitchState: ks.state,
    currentStage: ctx.currentStage,
    activePlanId: ctx.activePlanId,
    pendingQuestion: ctx.pendingQuestion,
    expectedAnswerType: ctx.expectedAnswerType,
    selectedLead: ctx.selectedLead,
  });

  convState.touchState(chatId, userId);

  if (intent.requiresClarification && intent.clarificationQuestion) {
    return { action: 'CLARIFY', reply: intent.clarificationQuestion };
  }

  return { action: 'INTENT', intent };
}

function buildConversationalReply(intent, context) {
  const ks = killSwitch.readKillSwitch();

  switch (intent.intent) {
    case 'ACKNOWLEDGMENT':
      return null;
    case 'CASUAL_CONVERSATION':
      return 'Noted. I\'m here when you need me.';
    case 'HELP_REQUEST':
      return [
        '*Available Commands*',
        '',
        '*/start* — Welcome and command list',
        '*/help* — This help',
        '*/status* — Kill switch, sessions, canary state',
        '*/health* — Runtime health report',
        '*/outreach* — Load leads, begin Stage 1',
        '*/kayla* — Show Kayla course rules',
        '*/pause* — Pause all operations (admin only)',
        '*/resume* — Resume dry-run mode (admin only)',
        '*/canary* — Enable canary mode (owner only)',
        '*/cancel* — Cancel current session',
        '*/activity* — Show today\'s activity',
        '',
        'Or just talk naturally: "Show me leads", "Start Stage 1", "Show INT", etc.',
      ].join('\n');
    case 'STATUS_REQUEST':
      return [
        '*Pipeline Status*',
        `Kill switch: ${ks.state}`,
        `Canary sends today: ${ks.liveSends || 0}`,
        `Production writes: ${ks.productionWrites || 0}`,
        `Stage movements: ${ks.stageMovements || 0}`,
        `Stage movement: disabled`,
      ].join('\n');
    case 'ACTIVITY_REQUEST':
      return [
        '*Today\'s Activity*',
        `Canary sends: ${ks.liveSends || 0}`,
        `Production writes: ${ks.productionWrites || 0}`,
        `Stage movements: ${ks.stageMovements || 0}`,
        `Mode: ${ks.state}`,
      ].join('\n');
    case 'PAUSE':
      killSwitch.writeKillSwitch('PAUSED');
      return 'Operations PAUSED. No sends, no writes, no stage movements.';
    case 'RESUME_DRY_RUN':
      if (!ownerAuth.isAdmin(context.userId)) return 'Only admins can resume operations.';
      killSwitch.writeKillSwitch('DRY_RUN_ONLY');
      return 'Resumed in DRY_RUN_ONLY mode. Simulations allowed. No live sends.';
    case 'CANARY_ENABLE_REQUEST':
      if (!ownerAuth.isOwner(context.userId)) return 'Only the owner can enable canary mode.';
      if (ks.state !== 'DRY_RUN_ONLY') return `Cannot enable canary from ${ks.state}. Must be in DRY_RUN_ONLY first.`;
      killSwitch.writeKillSwitch('CANARY_ALLOWED');
      return 'CANARY_ALLOWED. Live sends permitted with restrictions: max 3, sequential, no retries, no stage movement.';
    case 'PLAN_CANCEL':
      if (context.activePlanId) {
        const plan = canary.loadCanaryPlan(context.activePlanId);
        if (plan) { plan.state = 'CANCELED'; canary.saveCanaryPlan(plan); }
      }
      return 'Plan canceled. No sends occurred.';
    case 'CORRECTION':
      return 'Understood. I\'ve noted the correction. No production action has occurred.';
    case 'UNKNOWN':
    default:
      if (ks.state === 'PAUSED') {
        return "I'm currently paused. Would you like me to resume in dry-run mode so we can rehearse, or would you prefer to check the pipeline status first?";
      }
      if (ks.state === 'DRY_RUN_ONLY') {
        return "I'm in dry-run mode. Want me to load the latest leads and walk through a rehearsal, or check on something specific?";
      }
      if (ks.state === 'CANARY_ALLOWED') {
        return 'Canary mode is active. Want me to generate a fresh 3-lead canary plan for your review, or check the pipeline status?';
      }
      return "What would you like me to help with? I can load leads, check pipeline status, run a dry-run rehearsal, or walk through any stage.";
  }
}

module.exports = {
  shouldProcessMessage,
  routeMessage,
  buildConversationalReply,
  isSafetyCommand,
  isSlashCommand,
  isAcknowledgment,
  isExplicitApproval,
  validateApproval,
  extractNumbers,
  isBotMentioned,
  isReplyToBot,
  resolveReplyContext,
};
