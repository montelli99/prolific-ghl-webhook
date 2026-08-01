'use strict';

const killSwitch = require('../bot/kill-switch');
const memCtx = require('./pipeline-memory-context');
const convState = require('../bot/conversation-state');

const PIPELINE_CHAT_ID = '-1003975794600';
const PIPELINE_TOPIC_ID = 389;

const NOTIFIED_EVENTS = new Map();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

function dedupeKey(type, id) { return `${type}_${id}`; }

function shouldNotify(type, id) {
  const key = dedupeKey(type, id);
  const last = NOTIFIED_EVENTS.get(key);
  if (last && Date.now() - last < DEDUP_WINDOW_MS) return false;
  NOTIFIED_EVENTS.set(key, Date.now());
  if (NOTIFIED_EVENTS.size > 500) {
    const oldest = [...NOTIFIED_EVENTS.entries()].sort((a, b) => a[1] - b[1])[0];
    NOTIFIED_EVENTS.delete(oldest[0]);
  }
  return true;
}

function handleCallCompleted(data) {
  const ks = killSwitch.readKillSwitch();
  if (!shouldNotify('call_completed', data.callId || data.contactId || 'unknown')) return null;

  return {
    type: 'CALL_COMPLETED',
    reply: `I saw the call for ${data.propertyContext || 'a lead'} end. Did they answer?`,
    priority: 'ACTIVE_HUMAN_COMMITMENTS',
    data: { callId: data.callId, contactId: data.contactId, opportunityId: data.opportunityId, duration: data.duration },
  };
}

function handleInboundReply(data) {
  if (!shouldNotify('inbound_reply', data.messageId || data.contactId || 'unknown')) return null;

  const ks = killSwitch.readKillSwitch();
  const message = data.message || '(message content unavailable)';
  const safeMessage = message.length > 200 ? message.slice(0, 197) + '...' : message;

  if (/^(stop|stopall|unsubscribe|remove|optout|opt out|help)/i.test(message.trim())) {
    killSwitch.writeKillSwitch('PAUSED');
    memCtx.recordCorrection(
      `STOP/HELP received for ${data.propertyContext || 'lead'}`,
      'THIS_CONTACT', PIPELINE_CHAT_ID, '718718959'
    );
    return {
      type: 'STOP_HELP',
      reply: `STOP/HELP received for ${data.propertyContext || 'a lead'}.\n\nOperations PAUSED. This contact must not receive further outreach.`,
      priority: 'STOP_DNC_COMPLIANCE',
    };
  }

  return {
    type: 'INBOUND_REPLY',
    reply: `New reply for ${data.propertyContext || 'a lead'}:\n\n"${safeMessage}"\n\nWhat do you want to do?`,
    priority: 'INBOUND_REPLIES',
    data: { messageId: data.messageId, contactId: data.contactId, opportunityId: data.opportunityId },
  };
}

function handleSmsDelivered(data) {
  if (!shouldNotify('sms_delivered', data.messageId || data.contactId || 'unknown')) return null;

  memCtx.recordCorrection(
    `SMS delivered to ${data.propertyContext || 'lead'}`,
    'THIS_CONTACT', PIPELINE_CHAT_ID, '718718959'
  );

  return {
    type: 'SMS_DELIVERED',
    reply: `SMS delivered for ${data.propertyContext || 'a lead'}. No stage movement occurred. Watching for reply, STOP/HELP, or wrong-number response.`,
    priority: 'ROUTINE_MONITORING',
  };
}

function handleSmsFailed(data) {
  if (!shouldNotify('sms_failed', data.messageId || data.contactId || 'unknown')) return null;

  return {
    type: 'SMS_FAILED',
    reply: `SMS FAILED for ${data.propertyContext || 'a lead'}: ${data.error || 'unknown error'}. No retry attempted.`,
    priority: 'PROVIDER_UNCERTAINTY',
  };
}

function handleProviderUncertainty(data) {
  if (!shouldNotify('provider_uncertainty', data.error || 'unknown')) return null;

  return {
    type: 'PROVIDER_UNCERTAINTY',
    reply: `Provider uncertainty: ${data.error || 'unknown issue'}. Operations remain PAUSED until resolved.`,
    priority: 'PROVIDER_UNCERTAINTY',
  };
}

function handleOwnerReturns(chatId, userId) {
  if (!shouldNotify('owner_returns', `${chatId}_${userId}`)) return null;

  const ctx = memCtx.getConversationContext(chatId, userId);
  if (!ctx.active || !ctx.currentStage) return null;

  return {
    type: 'SESSION_RESUME',
    reply: `Welcome back. You were working on ${ctx.currentStage}${ctx.currentSessionId ? ' (session ' + ctx.currentSessionId + ')' : ''}. Want to continue where you left off?`,
    priority: 'INCOMPLETE_SESSIONS',
  };
}

function handleCanaryReconciliation(plan) {
  if (!shouldNotify('canary_recon', plan.planId)) return null;

  return {
    type: 'CANARY_RECONCILIATION',
    reply: `Canary plan ${plan.planId.slice(0, 16)} reconciled: ${plan.completedItems}/${plan.totalItems} sent, ${plan.failedItems} failed.`,
    priority: 'ROUTINE_MONITORING',
  };
}

function handleEvent(eventType, data) {
  switch (eventType) {
    case 'call_completed': return handleCallCompleted(data);
    case 'inbound_reply': return handleInboundReply(data);
    case 'sms_delivered': return handleSmsDelivered(data);
    case 'sms_failed': return handleSmsFailed(data);
    case 'provider_uncertainty': return handleProviderUncertainty(data);
    case 'owner_returns': return handleOwnerReturns(data.chatId, data.userId);
    case 'canary_reconciliation': return handleCanaryReconciliation(data.plan);
    default: return null;
  }
}

module.exports = {
  handleEvent,
  handleCallCompleted,
  handleInboundReply,
  handleSmsDelivered,
  handleSmsFailed,
  handleProviderUncertainty,
  handleOwnerReturns,
  handleCanaryReconciliation,
};
