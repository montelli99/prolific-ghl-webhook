'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CanaryPlanBuilder, POLICY_VERSION, TEMPLATE_ID, MAX_CANARY } = require('./canary-plan-builder');
const { PlanStore } = require('./plan-store');
const { ApprovalStore } = require('./approval-store');
const { JustCallSuppressionReadService } = require('./justcall-suppression-read-service');
const { JustCallTextHistoryReadService } = require('./justcall-text-history-read-service');
const { LocalSuppressionRegistry } = require('./local-suppression-registry');
const { SELECTED_SENDER_SUFFIX } = require('./kayla-course-spec');
const { evaluateCanaryWindow } = require('./atlas-ghl-telegram-live-guards');
const { derivePropertyTimezone } = require('./property-timezone');
const killSwitch = require('../bot/kill-switch');

const RUNBOOK_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'supervised-canary-runbook.json');
const RUNBOOK_ID = 'runbook_supervised_canary_v1';
const OWNER_ID = '718718959';
const CHAT_ID = '-1003975794600';
const TOPIC_ID = 389;

const TRIGGER_PATTERNS = [
  /begin\s+(the\s+)?first\s+supervised\s+canary/i,
  /start\s+(the\s+)?supervised\s+canary/i,
  /let'?s\s+begin\s+(the\s+)?canary/i,
  /get\s+(the\s+)?first\s+canary\s+ready/i,
  /prepare\s+(the\s+)?canary/i,
  /start\s+preparing\s+(the\s+)?first\s+three/i,
  /let'?s\s+go\s+live\s+with\s+(the\s+)?canary/i,
];

const PROVIDER_CONFIRM_PATTERNS = [
  /justcall\s+(is\s+)?(paid|active|funded|good)/i,
  /(my\s+)?justcall\s+account\s+(is\s+)?(paid|active|funded|good)/i,
  /(the\s+)?account\s+(is\s+)?(good|active|paid|funded)/i,
  /yes[,.\s]+(the\s+)?sms\s+account\s+(is\s+)?active/i,
  /sms\s+account\s+(is\s+)?(active|good|ready)/i,
];

const SAFETY_COMMANDS = /^(stop|pause|cancel|abort|don'?t\s*send|do\s*not\s*send|never\s*mind)$/i;

const REVIEW_PATTERNS = {
  why: /why\s+(did\s+you\s+)?(select|pick|choose)\s+(number\s+)?(\d+)/i,
  showMore: /show\s+(me\s+)?more\s+about\s+(number\s+)?(\d+)/i,
  isAgent: /is\s+(number\s+)?(\d+)\s+(really\s+)?(the\s+)?(listing\s+)?agent/i,
  showText: /show\s+(the\s+)?(full\s+)?text\s+(again|for\s+(number\s+)?(\d+))/i,
  removeItem: /remove\s+(number\s+)?(\d+)/i,
  replaceItem: /replace\s+(number\s+)?(\d+)/i,
  whatNumber: /what\s+number\s+(is\s+this\s+)?sending\s+from/i,
  whenExpire: /when\s+does\s+this\s+expire/i,
  dontSend: /don'?t\s*send\s*anything/i,
  cancelPlan: /cancel\s+(the\s+)?plan/i,
};

const APPROVAL_PATTERNS = [
  /send\s+all\s+three/i,
  /send\s+items?\s+(\d+(?:\s*(?:,|and)\s*\d+)*)/i,
  /approve\s+(number\s+)?(\d+)\s+only/i,
  /send\s+the\s+three\s+shown/i,
  /i\s+approve\s+items?\s+(\d+(?:\s*(?:,|and)\s*\d+)*)/i,
  /approve\s+all/i,
  /send\s+all/i,
];

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

class SupervisedCanaryRunbookService {
  constructor(config = {}) {
    this.runbookPath = config.runbookPath || RUNBOOK_PATH;
    this.planStore = config.planStore || new PlanStore();
    this.approvalStore = config.approvalStore || new ApprovalStore();
    this.builder = null;
  }

  loadRunbook() {
    if (!fs.existsSync(this.runbookPath)) return null;
    const runbook = JSON.parse(fs.readFileSync(this.runbookPath, 'utf8'));
    const computedHash = stableHash(runbook);
    if (runbook.canonicalHash && computedHash !== runbook.canonicalHash) {
      return { ...runbook, _hashMismatch: true };
    }
    return runbook;
  }

  isTrigger(text) {
    return TRIGGER_PATTERNS.some(p => p.test(text));
  }

  isProviderConfirmation(text) {
    return PROVIDER_CONFIRM_PATTERNS.some(p => p.test(text));
  }

  isSafetyCommand(text) {
    return SAFETY_COMMANDS.test(text.trim());
  }

  isReviewQuestion(text) {
    for (const [key, pattern] of Object.entries(REVIEW_PATTERNS)) {
      if (pattern.test(text)) return { type: key, match: text.match(pattern) };
    }
    return null;
  }

  parseApproval(text) {
    const t = text.toLowerCase().trim();
    if (/send\s+all\s+three/i.test(t) || /send\s+the\s+three\s+shown/i.test(t) || /approve\s+all/i.test(t) || /send\s+all/i.test(t)) {
      return { approved: true, items: [1, 2, 3] };
    }
    for (const pattern of APPROVAL_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const numbers = (text.match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= MAX_CANARY);
        if (numbers.length > 0) return { approved: true, items: [...new Set(numbers)].sort((a, b) => a - b) };
      }
    }
    return null;
  }

  validateContext(ctx = {}) {
    const errors = [];
    if (String(ctx.telegramUserId) !== OWNER_ID) errors.push('NOT_OWNER');
    if (String(ctx.chatId) !== CHAT_ID) errors.push('WRONG_CHAT');
    if (ctx.topicId && String(ctx.topicId) !== String(TOPIC_ID)) errors.push('WRONG_TOPIC');
    return { ok: errors.length === 0, errors };
  }

  async beginPreparation(ctx = {}) {
    const contextCheck = this.validateContext(ctx);
    if (!contextCheck.ok) {
      return { reply: `Cannot begin canary preparation: ${contextCheck.errors.join(', ')}. This workflow is restricted to owner ${OWNER_ID} in topic ${TOPIC_ID}.` };
    }

    const runbook = this.loadRunbook();
    if (!runbook) return { reply: 'Runbook not found. The supervised canary workflow has not been initialized.' };
    if (runbook._hashMismatch) return { reply: 'Runbook hash mismatch. The runbook may have been tampered with. Cannot proceed.' };
    if (runbook.status !== 'PENDING_NOT_EXECUTED') return { reply: `Runbook status is ${runbook.status}. Cannot begin preparation.` };

    const ks = killSwitch.readKillSwitch();
    if (ks.state !== 'PAUSED') return { reply: `Kill switch is ${ks.state}, not PAUSED. Transition to PAUSED first.` };

    const existingPlans = this.planStore.listPlans({ status: 'PREVIEW_PENDING_APPROVAL' })
      .concat(this.planStore.listPlans({ status: 'APPROVED_PENDING_EXECUTION' }));
    for (const plan of existingPlans) {
      if (new Date(plan.expiresAt) > new Date()) {
        return { reply: `An active plan already exists (${plan.planId}). Cancel or supersede it first.` };
      }
      this.planStore.supersedePlan(plan.planId, 'new preparation started');
    }

    const now = new Date();
    const sampleTz = derivePropertyTimezone({ propertyAddress: '123 Main St Indianapolis IN 46227', raw: { zip: '46227' } }, { now });
    const window = evaluateCanaryWindow({ now, timeZone: sampleTz.timeZone });

    if (!window.ok) {
      const nextWindow = window.reason === 'WEEKEND_BLOCKS_CANARY'
        ? 'next Monday at 12:00 PM'
        : 'today at 12:00 PM';
      return {
        reply: `Cannot create an approvable production plan right now.\n\nCurrent time: ${sampleTz.currentWeekday} ${sampleTz.currentLocalTime} ${sampleTz.timeZone}\nWindow: ${window.reason}\n\nNext valid preparation window: ${nextWindow} ${sampleTz.timeZone}.\n\nI remain PAUSED. Try again during business hours.`,
      };
    }

    this.builder = new CanaryPlanBuilder({
      ghlToken: process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || '',
      locationId: '61XPzSqRy7UKMwW9DeB8',
      pipelineId: 'nSf3NXYVkt8X4PgW9aZ3',
      suppression: new JustCallSuppressionReadService(),
      history: new JustCallTextHistoryReadService({ senderSuffix: SELECTED_SENDER_SUFFIX }),
      localRegistry: new LocalSuppressionRegistry(),
      planStore: this.planStore,
    });

    try {
      const plan = await this.builder.buildPreview({
        now,
        ownerId: OWNER_ID,
        chatId: CHAT_ID,
        topicId: TOPIC_ID,
      });

      return {
        reply: this.formatPreview(plan),
        plan,
        state: 'PREVIEW_READY',
      };
    } catch (e) {
      return { reply: `Preparation failed: ${e.message}. Remaining PAUSED.` };
    }
  }

  formatPreview(plan) {
    const lines = [
      '*Supervised Canary Preview*',
      '',
      `Plan: \`${plan.planId.slice(0, 16)}\``,
      `Hash: \`${plan.planHash.slice(0, 16)}\``,
      `Status: ${plan.status}`,
      `Expires: ${new Date(plan.expiresAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`,
      `Sender: ${plan.sender}`,
      `Policy: ${plan.policyVersion}`,
      `Template: ${plan.templateId}`,
      '',
      `Selected: ${plan.selectedCount} of ${plan.totalCandidates} candidates`,
      `State: PAUSED — nothing sent`,
      '',
    ];

    for (const item of plan.items) {
      lines.push(`*${item.number}. ${item.contactName}*`);
      lines.push(`Role: ${item.contactRole} | ${item.propertyAddress}`);
      lines.push(`Time: ${item.timezone}`);
      lines.push(`Message: ${item.renderedMessage}`);
      lines.push(`Guards: ${Object.entries(item.guardEvidence).map(([k, v]) => `${k}=${v.state}`).join(', ')}`);
      lines.push('');
    }

    lines.push(`Full hash: \`${plan.planHash}\``);
    lines.push(`Persisted: \`data/production-plans/${plan.planId}.json\``);
    lines.push('');
    lines.push('Stop conditions: weekend, outside 12-6 PM, DNC/STOP, prior outreach, provider failure, uncertain result.');
    lines.push('');
    lines.push('_Nothing has been sent. Review the items and tell me exactly which item numbers you approve._');

    return lines.join('\n');
  }

  async handleReview(planId, question) {
    const plan = this.planStore.loadPlan(planId);
    if (!plan) return { reply: 'Plan not found. It may have expired or been superseded.' };

    const review = this.isReviewQuestion(question);
    if (!review) return { reply: 'I didn\'t understand that question. Try: "Why did you select number 1?" or "Show me more about number 2."' };

    const num = review.match ? Number(review.match[review.match.length - 1]) : null;
    const item = num ? plan.items.find(i => i.number === num) : null;

    switch (review.type) {
      case 'why':
        if (!item) return { reply: `Item ${num} not found in this plan.` };
        return {
          reply: `*Why number ${num} was selected:*\n\n${item.contactName} — ${item.propertyAddress}\nRole: ${item.contactRole}\nTimezone: ${item.timezone}\n\nAll 8 compliance guards passed:\n${Object.entries(item.guardEvidence).map(([k, v]) => `- ${k}: ${v.state}`).join('\n')}\n\nRanking: agents first, then brokers, then owners. Stable tie-breaker by source order.`,
        };
      case 'showMore':
        if (!item) return { reply: `Item ${num} not found in this plan.` };
        return {
          reply: `*Details for number ${num}:*\n\nContact: ${item.contactName}\nProperty: ${item.propertyAddress}\nRole: ${item.contactRole}\nPhone: ${item.phone}\nTimezone: ${item.timezone} (${item.timezoneConfidence})\n\nRendered INT:\n${item.renderedMessage}\n\nGuard evidence:\n${JSON.stringify(item.guardEvidence, null, 2)}`,
        };
      case 'isAgent':
        if (!item) return { reply: `Item ${num} not found in this plan.` };
        return { reply: `Number ${num} (${item.contactName}) is classified as *${item.contactRole}* based on Atlas/Propwire source record classification.` };
      case 'showText':
        if (!item) return { reply: `Item ${num} not found in this plan.` };
        return { reply: `*Message for number ${num}:*\n\n${item.renderedMessage}` };
      case 'removeItem':
        if (!item) return { reply: `Item ${num} not found in this plan.` };
        this.planStore.supersedePlan(planId, `item ${num} removed by owner`);
        return { reply: `Item ${num} (${item.contactName}) removed. The plan has been superseded. Generate a new plan with the remaining candidates.` };
      case 'replaceItem':
        if (!item) return { reply: `Item ${num} not found in this plan.` };
        this.planStore.supersedePlan(planId, `item ${num} replacement requested`);
        return { reply: `Item ${num} flagged for replacement. The plan has been superseded. Generate a new plan for a fresh selection.` };
      case 'whatNumber':
        return { reply: `All messages send from *571-601-2619* (Montelli, JustCall 10DLC verified, business approved).` };
      case 'whenExpire':
        return { reply: `This plan expires at ${new Date(plan.expiresAt).toLocaleString('en-US')}. Plans cannot be held across day boundaries or business windows.` };
      case 'dontSend':
      case 'cancelPlan':
        this.planStore.supersedePlan(planId, 'cancelled by owner');
        return { reply: 'Plan cancelled. All items superseded. Remaining PAUSED.' };
      default:
        return { reply: 'I didn\'t understand that. Try asking about a specific item number.' };
    }
  }

  async handleApproval(planId, text, ctx = {}) {
    const contextCheck = this.validateContext(ctx);
    if (!contextCheck.ok) {
      return { reply: `Approval denied: ${contextCheck.errors.join(', ')}.` };
    }

    const plan = this.planStore.loadPlan(planId);
    if (!plan) return { reply: 'Plan not found. It may have expired.' };
    if (plan.status !== 'PREVIEW_PENDING_APPROVAL') return { reply: `Plan status is ${plan.status}, not pending approval.` };
    if (new Date(plan.expiresAt) <= new Date()) return { reply: 'Plan has expired. Generate a new plan.' };

    const parsed = this.parseApproval(text);
    if (!parsed || parsed.items.length === 0) {
      return { reply: 'I need explicit item numbers to approve. Try: "Send all three" or "Approve items 1 and 3" or "Send number 2 only."' };
    }

    const validItems = parsed.items.filter(n => plan.items.some(i => i.number === n));
    if (validItems.length === 0) {
      return { reply: `None of the specified items (${parsed.items.join(', ')}) exist in this plan. Valid items: ${plan.items.map(i => i.number).join(', ')}.` };
    }

    const approval = this.approvalStore.createApproval({
      planId: plan.planId,
      planHash: plan.planHash,
      selectedItems: validItems,
      ownerUserId: OWNER_ID,
      chatId: CHAT_ID,
      topicId: TOPIC_ID,
      originatingMessageId: ctx.messageId || null,
      approvalText: text,
      policyVersion: plan.policyVersion,
    });

    this.planStore.updateStatus(planId, 'APPROVED_PENDING_EXECUTION', {
      approvedAt: new Date().toISOString(),
      approvedBy: OWNER_ID,
    });

    return {
      reply: `*Approved.*\n\nPlan: \`${plan.planId.slice(0, 16)}\`\nItems: ${validItems.join(', ')}\nApproval: \`${approval.approvalId.slice(0, 16)}\`\n\nTo execute, transition the kill switch to CANARY_ALLOWED and say "Execute the approved plan."`,
      approval,
      plan,
    };
  }

  async handleCancel(planId) {
    const plan = this.planStore.loadPlan(planId);
    if (plan) {
      this.planStore.supersedePlan(planId, 'cancelled by owner');
      const approval = this.approvalStore.findApprovalForPlan(planId);
      if (approval) this.approvalStore.revokeApproval(approval.approvalId, 'plan cancelled');
    }
    return { reply: 'Cancelled. Plan superseded, approval revoked if present. Remaining PAUSED.' };
  }

  getActivePlanId() {
    const pending = this.planStore.listPlans({ status: 'PREVIEW_PENDING_APPROVAL' });
    const approved = this.planStore.listPlans({ status: 'APPROVED_PENDING_EXECUTION' });
    const all = [...pending, ...approved].filter(p => new Date(p.expiresAt) > new Date());
    return all.length > 0 ? all[0].planId : null;
  }
}

module.exports = {
  SupervisedCanaryRunbookService,
  RUNBOOK_PATH,
  RUNBOOK_ID,
  OWNER_ID,
  CHAT_ID,
  TOPIC_ID,
  TRIGGER_PATTERNS,
  PROVIDER_CONFIRM_PATTERNS,
  SAFETY_COMMANDS,
  REVIEW_PATTERNS,
  APPROVAL_PATTERNS,
};
