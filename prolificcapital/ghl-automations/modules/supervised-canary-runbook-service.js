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
const killSwitch = require('../bot/kill-switch');
const { verifyRunbookHash, computeRunbookHash } = require('./runbook-hash');
const { resolveProfile } = require('./account-profile-resolver');
const {
  QUEUE_NAMES,
  buildOperatorQueues,
  applyCompletion,
  parseOperatorCommand,
} = require('./course-guided-action-engine');

const RUNBOOK_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'supervised-canary-runbook-v2.json');
const RUNBOOK_ID = 'runbook_supervised_canary_v2';
const V1_HISTORICAL_RUNBOOK_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'supervised-canary-runbook.json');
const OWNER_ID = '718718959';
const CHAT_ID = '-1003975794600';
const TOPIC_ID = 389;
const PROVIDER_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

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
  /send\s+(number\s+)?(\d+)\s+only/i,
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
    this.providerConfirmationFile = config.providerConfirmationFile || path.resolve(__dirname, '..', 'data', 'runtime', 'supervised-canary-provider-confirmation.json');
    this.builder = null;
  }

  loadRunbook() {
    if (!fs.existsSync(this.runbookPath)) return null;
    const runbook = JSON.parse(fs.readFileSync(this.runbookPath, 'utf8'));
    const verification = verifyRunbookHash(runbook);
    if (!verification.ok) {
      return { ...runbook, _hashMismatch: true, _verification: verification };
    }
    return runbook;
  }

  loadV1HistoricalRunbook() {
    if (!fs.existsSync(V1_HISTORICAL_RUNBOOK_PATH)) return null;
    const runbook = JSON.parse(fs.readFileSync(V1_HISTORICAL_RUNBOOK_PATH, 'utf8'));
    return { ...runbook, _historical: true, _executable: false };
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

  parseOperatorCommand(text) {
    return parseOperatorCommand(text);
  }

  isOperatorCommand(text) {
    return Boolean(this.parseOperatorCommand(text));
  }

  validateContext(ctx = {}) {
    const errors = [];
    if (String(ctx.telegramUserId) !== OWNER_ID) errors.push('NOT_OWNER');
    if (String(ctx.chatId) !== CHAT_ID) errors.push('WRONG_CHAT');
    if (String(ctx.topicId) !== String(TOPIC_ID)) errors.push('WRONG_TOPIC');
    return { ok: errors.length === 0, errors, ownerId: OWNER_ID, chatId: CHAT_ID, topicId: TOPIC_ID };
  }

  providerConfirmationPath() {
    return this.providerConfirmationFile;
  }

  recordProviderConfirmation(ctx = {}) {
    const activePlanId = this.getActivePlanId();
    if (!activePlanId) return { recorded: false, reason: 'ACTIVE_PLAN_REQUIRED' };
    const record = {
      recorded: true,
      ownerUserId: OWNER_ID,
      chatId: CHAT_ID,
      topicId: TOPIC_ID,
      planId: activePlanId,
      originatingMessageId: ctx.messageId || null,
      confirmedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + PROVIDER_CONFIRMATION_TTL_MS).toISOString(),
      reason: 'MANUAL_FUNDING_CONFIRMATION',
    };
    record.confirmationHash = stableHash(record);
    const tmp = this.providerConfirmationPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
    fs.renameSync(tmp, this.providerConfirmationPath());
    return record;
  }

  loadProviderConfirmation() {
    const p = this.providerConfirmationPath();
    if (!fs.existsSync(p)) return null;
    try {
      const record = JSON.parse(fs.readFileSync(p, 'utf8'));
      const { confirmationHash, ...payload } = record;
      if (!confirmationHash || stableHash(payload) !== confirmationHash) return { _integrityError: true };
      if (new Date(record.expiresAt) <= new Date()) return { ...record, _expired: true };
      return record;
    } catch (e) {
      return null;
    }
  }

  getCurrentRuntimeRevision() {
    try {
      const root = path.resolve(__dirname, '..', '..');
      return require('child_process').execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    } catch (e) {
      return 'UNKNOWN';
    }
  }

  async beginPreparation(ctx = {}) {
    const contextCheck = this.validateContext(ctx);
    if (!contextCheck.ok) {
      return { reply: `Cannot begin canary preparation: ${contextCheck.errors.join(', ')}. This workflow is restricted to owner ${OWNER_ID} in topic ${TOPIC_ID}.` };
    }

    const runbook = this.loadRunbook();
    if (!runbook) return { reply: 'Runbook not found. The supervised canary workflow has not been initialized.' };
    if (runbook._hashMismatch) return { reply: `Runbook hash mismatch. The runbook may have been tampered with. Cannot proceed. computed=${runbook._verification?.computed} declared=${runbook._verification?.declared}` };
    if (runbook.status !== 'PENDING_NOT_EXECUTED') return { reply: `Runbook status is ${runbook.status}. Cannot begin preparation.` };

    const ks = killSwitch.readKillSwitch();
    if (ks.state !== 'PAUSED') return { reply: `Kill switch is ${ks.state}, not PAUSED. Transition to PAUSED first.` };

    const stalePlan = this.planStore.loadPlan('plan_4986dcaa4139c38e');
    if (stalePlan && stalePlan.status === 'PREVIEW_PENDING_APPROVAL') {
      this.planStore.supersedePlan(stalePlan.planId, 'SUPERSEDED_EXPIRED_UNTRUSTED_CONTEXT');
    }

    const existingPlans = this.planStore.listPlans({ status: 'PREVIEW_PENDING_APPROVAL' })
      .concat(this.planStore.listPlans({ status: 'APPROVED_PENDING_EXECUTION' }));
    for (const plan of existingPlans) {
      this.planStore.supersedePlan(plan.planId, 'new preparation started');
    }

    const now = new Date();

    this.builder = new CanaryPlanBuilder({
      profileId: 'ATLAS_OUTBOUND',
      ghlToken: process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || '',
      locationId: '61XPzSqRy7UKMwW9DeB8',
      pipelineId: 'nSf3NXYVkt8X4PgW9aZ3',
      suppression: new JustCallSuppressionReadService(),
      history: new JustCallTextHistoryReadService({ senderSuffix: SELECTED_SENDER_SUFFIX }),
      localRegistry: new LocalSuppressionRegistry(),
      planStore: this.planStore,
    });

    try {
      const runtimeRevision = this.getCurrentRuntimeRevision();
      const plan = await this.builder.buildPreview({
        now,
        ownerId: OWNER_ID,
        chatId: CHAT_ID,
        topicId: TOPIC_ID,
        originatingMessageId: ctx.messageId || null,
        runbookId: runbook.instructionId || RUNBOOK_ID,
        runbookHash: runbook.canonicalHash || computeRunbookHash(runbook),
        runtimeRevision,
      });

      const windowCheck = this.evaluateSelectedWindows(plan.items, now);
      if (windowCheck.inWindow.length === 0) {
        this.planStore.supersedePlan(plan.planId, 'ALL_CANDIDATES_OUTSIDE_LOCAL_WINDOW');
        return {
          reply: this.formatWindowBlocked(plan, windowCheck),
        };
      }

      const filtered = this.filterPlanToWindow(plan, windowCheck.inWindow);
      const filteredPlan = filtered.items.length === plan.items.length
        ? plan
        : this.planStore.replacePreviewItems(plan.planId, filtered.items, {
          filteredFromOriginalCount: plan.items.length,
          filterReason: 'OUTSIDE_LOCAL_WINDOW',
        });

      return {
        reply: this.formatPreview(filteredPlan),
        plan: filteredPlan,
        state: 'PREVIEW_READY',
      };
    } catch (e) {
      return { reply: `Preparation failed: ${e.message}. Remaining PAUSED.` };
    }
  }

  evaluateSelectedWindows(items, now = new Date()) {
    const inWindow = [];
    const outOfWindow = [];
    for (const item of items) {
      const tz = item.timezone;
      if (!tz) {
        outOfWindow.push({ item, reason: 'UNKNOWN_TIMEZONE_BLOCKS_CANARY' });
        continue;
      }
      const window = evaluateCanaryWindow({ now, timeZone: tz });
      if (window.ok) inWindow.push(item);
      else outOfWindow.push({ item, reason: window.reason, window });
    }
    return { inWindow, outOfWindow };
  }

  filterPlanToWindow(plan, inWindowItems) {
    const allowedNumbers = new Set(inWindowItems.map(i => i.number));
    const filteredItems = plan.items
      .filter(i => allowedNumbers.has(i.number))
      .map((item, index) => ({ ...item, number: index + 1 }));
    const filteredPlan = { ...plan, items: filteredItems, selectedCount: filteredItems.length };
    if (filteredItems.length < plan.items.length) {
      filteredPlan.filteredFromOriginalCount = plan.items.length;
      filteredPlan.filterReason = 'OUTSIDE_LOCAL_WINDOW';
    }
    return filteredPlan;
  }

  formatWindowBlocked(plan, windowCheck) {
    const lines = [
      '*Supervised Canary Preview — No Sendable Candidates Right Now*',
      '',
      `Plan: \`${plan.planId.slice(0, 16)}\` (superseded: ALL_CANDIDATES_OUTSIDE_LOCAL_WINDOW)`,
      `Generated: ${new Date(plan.createdAt).toLocaleString('en-US')}`,
      `State: PAUSED — nothing sent`,
      '',
      `Evaluated ${plan.items.length} candidate(s) against their property-local business windows:`,
    ];
    for (const { item, reason, window } of windowCheck.outOfWindow) {
      lines.push(`• ${item.number}. ${item.contactName} — ${item.propertyAddress}`);
      lines.push(`  Timezone: ${item.timezone} | ${reason}`);
      if (window && window.hour != null) lines.push(`  Local time: ${window.hour}:${String(window.minute || 0).padStart(2, '0')}`);
    }
    lines.push('');
    lines.push('Next valid window: Monday–Friday 12:00 PM – 6:00 PM in each property\'s local timezone.');
    lines.push('_I remain PAUSED._');
    return lines.join('\n');
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

  async handleReview(planId, question, ctx = {}) {
    const contextCheck = this.validateContext(ctx);
    if (!contextCheck.ok) return { reply: `Review denied: ${contextCheck.errors.join(', ')}.` };
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
        if (!num) return { reply: plan.items.map(candidate => `*Message for number ${candidate.number}:*\n\n${candidate.renderedMessage}`).join('\n\n') };
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
    if (!plan.ownerId || !plan.chatId || !plan.topicId || !plan.originatingMessageId || !plan.runbookId || !plan.runbookHash) {
      return { reply: 'Plan lacks trusted provenance (owner/chat/topic/message/runbook). Cannot approve.' };
    }
    if (this.planStore.computePlanHash(plan) !== plan.planHash) {
      return { reply: 'Plan hash no longer matches the persisted approval-bound actions. Cannot approve.' };
    }
    const runbook = this.loadRunbook();
    if (!runbook || runbook._hashMismatch || plan.runbookHash !== runbook.canonicalHash) {
      return { reply: 'Runbook provenance no longer matches this plan. Cannot approve.' };
    }
    if (plan.policyVersion !== POLICY_VERSION || plan.templateId !== TEMPLATE_ID) {
      return { reply: 'Plan policy or template no longer matches the frozen canary baseline. Cannot approve.' };
    }
    if (!plan.runtimeRevision || plan.runtimeRevision !== this.getCurrentRuntimeRevision()) {
      return { reply: 'Plan runtime revision no longer matches the active code. Generate a fresh plan before approval.' };
    }
    if (/\b(stop|pause|cancel|abort|don'?t\s*send|do\s+not\s+send|never\s+mind)\b/i.test(text)) {
      return { reply: 'Approval denied because the message contains cancellation or pause language.' };
    }

    const parsed = this.parseApproval(text);
    if (!parsed || parsed.items.length === 0) {
      return { reply: 'I need explicit item numbers to approve. Try: "Send all three" or "Approve items 1 and 3" or "Send number 2 only."' };
    }

    const validItems = parsed.items.filter(n => plan.items.some(i => i.number === n));
    if (validItems.length !== parsed.items.length) {
      return { reply: `Approval is atomic and cannot silently omit invalid items. Requested: ${parsed.items.join(', ')}. Valid items: ${plan.items.map(i => i.number).join(', ')}.` };
    }

    const selected = validItems.map(number => plan.items.find(item => item.number === number));
    const windowCheck = this.evaluateSelectedWindows(selected, new Date());
    if (windowCheck.outOfWindow.length > 0) {
      return { reply: `Approval denied because ${windowCheck.outOfWindow.length} selected item(s) are outside their current property-local send window. Generate a fresh plan. Remaining PAUSED.` };
    }
    const providerConfirmation = this.loadProviderConfirmation();
    if (!providerConfirmation || providerConfirmation._expired || providerConfirmation._integrityError) {
      return { reply: 'Approval denied: a current integrity-verified manual JustCall readiness confirmation is required. Remaining PAUSED.' };
    }
    if (providerConfirmation.ownerUserId !== OWNER_ID || providerConfirmation.chatId !== CHAT_ID || String(providerConfirmation.topicId) !== String(TOPIC_ID)) {
      return { reply: 'Approval denied: provider confirmation is not bound to the trusted owner/chat/topic session. Remaining PAUSED.' };
    }
    if (providerConfirmation.planId !== plan.planId) {
      return { reply: 'Approval denied: provider confirmation belongs to a different canary plan. Remaining PAUSED.' };
    }
    const invalidAction = selected.find(item => item?.preparedAction?.actionType !== 'SEND_INT');
    if (invalidAction || !plan.canaryScope?.allowedActionTypes?.includes('SEND_INT')) {
      return { reply: 'The first supervised canary authorizes exact INT actions only. No downstream action was approved.' };
    }
    const actionScopes = selected.map(item => ({
      itemNumber: item.number,
      actionId: item.preparedAction.actionId,
      actionType: item.preparedAction.actionType,
      scopeHash: item.preparedAction.approvalScope.scopeHash,
      authorizesOnly: item.preparedAction.approvalScope.authorizesOnly,
    }));

    let approval;
    try {
      approval = this.approvalStore.createApproval({
        planId: plan.planId,
        planHash: plan.planHash,
        selectedItems: validItems,
        actionScopes,
        ownerUserId: OWNER_ID,
        chatId: CHAT_ID,
        topicId: TOPIC_ID,
        originatingMessageId: ctx.messageId || null,
        approvalText: text,
        policyVersion: plan.policyVersion,
      });
    } catch (error) {
      return { reply: `Approval was not recorded: ${error.message}. Plan remains pending and PAUSED.` };
    }

    try {
      this.planStore.updateStatus(planId, 'APPROVED_PENDING_EXECUTION', {
        approvedAt: new Date().toISOString(),
        approvedBy: OWNER_ID,
        approvedActionIds: actionScopes.map(scope => scope.actionId),
        approvalId: approval.approvalId,
        approvalHash: approval.approvalHash,
        providerConfirmationHash: providerConfirmation.confirmationHash,
        executable: false,
      }, { expectedStatus: 'PREVIEW_PENDING_APPROVAL' });
    } catch (error) {
      this.approvalStore.revokeApproval(approval.approvalId, `PLAN_TRANSITION_FAILED: ${error.message}`);
      return { reply: `Approval was revoked because the plan transition failed: ${error.message}. Remaining PAUSED.` };
    }

    return {
      reply: `*INT approval recorded.*\n\nPlan: \`${plan.planId.slice(0, 16)}\`\nItems: ${validItems.join(', ')}\nApproval: \`${approval.approvalId.slice(0, 16)}\`\nAuthorized only: ${actionScopes.map(scope => scope.actionType).join(', ')}\n\nCalls, second sends, CCC, contact cards, notes, stage movement, follow-up, offers, and handoffs remain blocked. Kill switch remains PAUSED.`,
      approval,
      plan,
    };
  }

  async handleCancel(planId, ctx = {}) {
    const contextCheck = this.validateContext(ctx);
    if (!contextCheck.ok) return { reply: `Cancellation denied: ${contextCheck.errors.join(', ')}.` };
    const plan = this.planStore.loadPlan(planId);
    if (plan) {
      this.planStore.supersedePlan(planId, 'cancelled by owner');
      const approval = this.approvalStore.findApprovalForPlan(planId);
      if (approval) this.approvalStore.revokeApproval(approval.approvalId, 'plan cancelled');
    }
    return { reply: 'Cancelled. Plan superseded, approval revoked if present. Remaining PAUSED.' };
  }

  async handleOperatorCommand(text, ctx = {}) {
    const command = this.parseOperatorCommand(text);
    if (!command) return { reply: 'I did not recognize that Pipeline operator request.' };
    const contextCheck = this.validateContext(ctx);
    if (!contextCheck.ok) return { reply: `Operator request denied: ${contextCheck.errors.join(', ')}.` };

    const planId = this.getActivePlanId();
    if (!planId) return { reply: 'No active supervised plan. Say "Begin the first supervised canary" to prepare an INT-only plan.' };
    const plan = this.planStore.loadPlan(planId);
    const states = (plan.items || []).map(item => item.operatorState).filter(Boolean);

    if (command.type === 'QUEUE') {
      const queues = buildOperatorQueues(states);
      return { reply: this.formatOperatorQueues(queues, command.queue) };
    }

    const requestedNumber = Number((text.match(/(?:number|item)\s+(\d+)/i) || [])[1] || 0);
    let item = requestedNumber ? plan.items.find(candidate => candidate.number === requestedNumber) : null;
    if (!item && plan.items.length === 1) item = plan.items[0];
    if (!item) return { reply: `Specify an item number. Active items: ${plan.items.map(candidate => candidate.number).join(', ')}.` };

    if (command.type === 'COMPLETE') {
      const event = { type: command.event };
      const currentAction = buildOperatorQueues([item.operatorState]);
      const current = QUEUE_NAMES.flatMap(name => currentAction[name]).find(Boolean);
      if (command.attempt && current?.actionType !== `CALL_ATTEMPT_${command.attempt}`) {
        return { reply: `Completion not recorded: call attempt ${command.attempt} is not the current due action. Current action: ${current?.actionType || 'unknown'}. Remaining PAUSED.` };
      }
      let recalculated;
      try {
        recalculated = applyCompletion(item.operatorState, event);
      } catch (error) {
        return { reply: `Completion not recorded: ${error.message}. Remaining PAUSED.` };
      }
      this.planStore.updateOperatorState(planId, item.opportunityId, recalculated.state, {
        type: event.type,
        queue: recalculated.queue,
        source: 'OWNER_MANUAL_CONFIRMATION',
      });
      return { reply: this.formatNextAction(recalculated.queueItem, 'Manual completion recorded locally for coaching. No GHL or provider write occurred.') };
    }

    const evaluatedQueues = buildOperatorQueues([item.operatorState]);
    const current = QUEUE_NAMES.flatMap(name => evaluatedQueues[name]).find(Boolean);
    return { reply: this.formatNextAction(current, 'The requested action is prepared only when its course prerequisites are satisfied.') };
  }

  formatOperatorQueues(queues, selectedQueue = 'ALL') {
    const names = selectedQueue === 'ALL' ? QUEUE_NAMES : [selectedQueue];
    const lines = ['*Course-Guided Pipeline Work Queue*', 'State: PAUSED — coaching and preparation only', ''];
    for (const name of names) {
      const items = queues[name] || [];
      if (items.length === 0) continue;
      lines.push(`*${name}* (${items.length})`);
      for (const item of items) {
        lines.push(`• ${item.property} — ${item.contact.name} (${item.currentStage})`);
        lines.push(`  Next: ${item.exactNextAction}`);
        lines.push(`  Why: ${item.whyDue}`);
        lines.push(`  Rule: ${item.courseRule.id}`);
        lines.push(`  Approval: ${item.approvalRequirement}`);
        lines.push(`  After: ${item.afterCompletion}`);
      }
      lines.push('');
    }
    if (lines.length === 3) lines.push('No items are currently in that queue.');
    lines.push('_No send, GHL write, task creation, or stage movement occurred._');
    return lines.join('\n');
  }

  formatNextAction(item, prefix = '') {
    if (!item) return 'No next action could be calculated from the current state.';
    const lines = [prefix, `*${item.property} — ${item.contact.name}*`, `Stage: ${item.currentStage}`, `Next: ${item.exactNextAction}`, `Why: ${item.whyDue}`, `Course rule: ${item.courseRule.id}`, `Approval: ${item.approvalRequirement}`, `After completion: ${item.afterCompletion}`, `Blocked: ${item.remainsBlocked.join(', ') || 'none'}`, '', '_PAUSED — no external action occurred._'];
    return lines.filter(Boolean).join('\n');
  }

  getActivePlanId() {
    const pending = this.planStore.listPlans({ status: 'PREVIEW_PENDING_APPROVAL' });
    const approved = this.planStore.listPlans({ status: 'APPROVED_PENDING_EXECUTION' });
    const all = [...pending, ...approved]
      .filter(p => new Date(p.expiresAt) > new Date())
      .filter(p => Boolean(
        p.ownerId === OWNER_ID &&
        p.chatId === CHAT_ID &&
        p.topicId === TOPIC_ID &&
        p.originatingMessageId &&
        p.runbookId === RUNBOOK_ID &&
        p.runbookHash
      ));
    return all.length > 0 ? all[0].planId : null;
  }
}

module.exports = {
  SupervisedCanaryRunbookService,
  RUNBOOK_PATH,
  RUNBOOK_ID,
  V1_HISTORICAL_RUNBOOK_PATH,
  OWNER_ID,
  CHAT_ID,
  TOPIC_ID,
  TRIGGER_PATTERNS,
  PROVIDER_CONFIRM_PATTERNS,
  SAFETY_COMMANDS,
  REVIEW_PATTERNS,
  APPROVAL_PATTERNS,
};
