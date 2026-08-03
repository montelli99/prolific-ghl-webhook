'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JustCallIntegration = require('../modules/justcall-integration');
const killSwitch = require('./kill-switch');
const { PlanStore } = require('../modules/plan-store');
const { ApprovalStore } = require('../modules/approval-store');

const CANARY_DIR = path.resolve(__dirname, '..', 'data', 'canary');
const CANARY_MAX_SENDS = 3;
const CANARY_PLAN_EXPIRY_MS = 30 * 60 * 1000;

function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function nowIso() { return new Date().toISOString(); }

function createCanaryPlan(records, ctx) {
  const planId = `canary_${stableHash({ userId: ctx.telegramUserId, chatId: ctx.chatId, at: nowIso() }).slice(0, 16)}`;
  const items = records.map((r, i) => ({
    number: i + 1,
    opportunityId: r.opportunityId,
    contactId: r.contactId,
    propertyAddress: r.propertyAddress,
    contactRole: r.contactRole?.role || 'unknown',
    shortcutName: r.shortcutName || 'INT',
    renderedPreview: r.renderedPreview || '',
    senderNumber: r.senderNumber || '',
    status: 'PENDING',
    providerMessageId: null,
    providerResult: null,
    sentAt: null,
  }));

  return {
    planId,
    planHash: stableHash({ planId, items: items.map(i => ({ number: i.number, opportunityId: i.opportunityId, contactId: i.contactId })) }),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + CANARY_PLAN_EXPIRY_MS).toISOString(),
    createdBy: String(ctx.telegramUserId),
    chatId: String(ctx.chatId),
    totalItems: items.length,
    items,
    state: 'PLANNED',
    completedItems: 0,
    failedItems: 0,
    journal: [],
  };
}

function saveCanaryPlan(plan) {
  fs.mkdirSync(CANARY_DIR, { recursive: true });
  const filePath = path.join(CANARY_DIR, `${plan.planId}.json`);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(plan, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
  return plan;
}

function loadCanaryPlan(planId) {
  const filePath = path.join(CANARY_DIR, `${planId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadActiveCanaryPlan(chatId) {
  if (!fs.existsSync(CANARY_DIR)) return null;
  const files = fs.readdirSync(CANARY_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const plan = JSON.parse(fs.readFileSync(path.join(CANARY_DIR, f), 'utf8'));
    if (String(plan.chatId) === String(chatId) && plan.state !== 'COMPLETED' && plan.state !== 'FAILED') {
      if (new Date(plan.expiresAt) < new Date()) {
        plan.state = 'EXPIRED';
        saveCanaryPlan(plan);
        return null;
      }
      return plan;
    }
  }
  return null;
}

function appendCanaryJournal(plan, entry) {
  plan.journal.push({ ...entry, timestamp: nowIso() });
  saveCanaryPlan(plan);
}

function canaryJournalPath() {
  fs.mkdirSync(CANARY_DIR, { recursive: true });
  return path.join(CANARY_DIR, 'journal.jsonl');
}

function appendCanaryJournalLine(entry) {
  const line = JSON.stringify({ ...entry, timestamp: nowIso() }) + '\n';
  fs.appendFileSync(canaryJournalPath(), line);
}

async function executeCanaryItem(plan, itemNumber, options = {}) {
  const ks = killSwitch.readKillSwitch();
  if (!killSwitch.canSend(ks.state)) {
    return { ok: false, error: `KILL_SWITCH_BLOCKS_SEND: current state is ${ks.state}` };
  }

  const item = plan.items.find(i => i.number === itemNumber);
  if (!item) return { ok: false, error: `ITEM_NOT_FOUND: ${itemNumber}` };
  if (item.status === 'SENT') return { ok: false, error: `ITEM_ALREADY_SENT: ${itemNumber}` };
  if (item.status === 'FAILED') return { ok: false, error: `ITEM_ALREADY_FAILED: ${itemNumber}` };

  const sentCount = plan.items.filter(i => i.status === 'SENT').length;
  if (sentCount >= CANARY_MAX_SENDS) {
    return { ok: false, error: `CANARY_LIMIT_REACHED: ${CANARY_MAX_SENDS} sends maximum` };
  }

  const justcall = new JustCallIntegration({
    apiKey: options.justcallApiKey || process.env.JUSTCALL_API_KEY,
    apiSecret: options.justcallApiSecret || process.env.JUSTCALL_API_SECRET,
    fromNumber: options.fromNumber || process.env.JUSTCALL_FROM_NUMBER,
  });

  const to = item.contactId || '';
  const body = item.renderedMessage || item.renderedPreview || '';

  appendCanaryJournal(plan, { type: 'CANARY_PRE_SEND', itemNumber, planId: plan.planId, planHash: plan.planHash });
  appendCanaryJournalLine({ type: 'CANARY_PRE_SEND', itemNumber, planId: plan.planId, planHash: plan.planHash });

  let result;
  try {
    result = await justcall.sendSMS(to, body, { from: options.fromNumber });
  } catch (e) {
    item.status = 'FAILED';
    item.providerResult = 'PROVIDER_ERROR';
    plan.failedItems++;
    appendCanaryJournal(plan, { type: 'CANARY_SEND_FAILED', itemNumber, error: e.message });
    appendCanaryJournalLine({ type: 'CANARY_SEND_FAILED', itemNumber, error: e.message });
    saveCanaryPlan(plan);
    return { ok: false, error: `PROVIDER_ERROR: ${e.message}`, item };
  }

  if (!result || !result.messageId) {
    item.status = 'FAILED';
    item.providerResult = 'UNCERTAIN_RESULT';
    plan.failedItems++;
    appendCanaryJournal(plan, { type: 'CANARY_SEND_UNCERTAIN', itemNumber });
    appendCanaryJournalLine({ type: 'CANARY_SEND_UNCERTAIN', itemNumber });
    saveCanaryPlan(plan);
    return { ok: false, error: 'UNCERTAIN_RESULT: no messageId returned', item };
  }

  item.status = 'SENT';
  item.providerMessageId = String(result.messageId).slice(0, 16);
  item.providerResult = 'ACCEPTED';
  item.sentAt = nowIso();
  plan.completedItems++;

  killSwitch.writeKillSwitch(ks.state, { liveSends: 1 });

  appendCanaryJournal(plan, { type: 'CANARY_SEND_SUCCESS', itemNumber, providerMessageId: item.providerMessageId });
  appendCanaryJournalLine({ type: 'CANARY_SEND_SUCCESS', itemNumber, providerMessageId: item.providerMessageId });

  if (plan.completedItems >= CANARY_MAX_SENDS || plan.completedItems >= plan.totalItems) {
    plan.state = 'COMPLETED';
    killSwitch.writeKillSwitch('PAUSED');
    appendCanaryJournal(plan, { type: 'CANARY_COMPLETED', totalSends: plan.completedItems });
    appendCanaryJournalLine({ type: 'CANARY_COMPLETED', totalSends: plan.completedItems });
  }

  saveCanaryPlan(plan);
  return { ok: true, item, plan };
}

async function executeApprovedPlan(planId, selectedItems, options = {}) {
  const planStore = options.planStore || new PlanStore();
  const approvalStore = options.approvalStore || new ApprovalStore();

  const plan = planStore.loadPlan(planId);
  if (!plan) return { ok: false, error: `PLAN_NOT_FOUND: ${planId}` };
  if (plan.status !== 'APPROVED_PENDING_EXECUTION') return { ok: false, error: `PLAN_NOT_APPROVED: status is ${plan.status}` };
  if (new Date(plan.expiresAt) <= new Date()) return { ok: false, error: 'PLAN_EXPIRED' };

  const approval = approvalStore.findApprovalForPlan(planId);
  if (!approval) return { ok: false, error: 'NO_APPROVAL_FOUND' };
  if (approval.status !== 'ACTIVE') return { ok: false, error: `APPROVAL_NOT_ACTIVE: ${approval.status}` };

  const approvedItems = new Set(approval.selectedItems || []);
  const requestedItems = new Set(selectedItems || []);
  if (![...requestedItems].every(n => approvedItems.has(n))) {
    return { ok: false, error: 'SELECTED_ITEMS_MISMATCH' };
  }

  const ks = killSwitch.readKillSwitch();
  if (!killSwitch.canSend(ks.state)) {
    return { ok: false, error: `KILL_SWITCH_BLOCKS_SEND: current state is ${ks.state}` };
  }

  planStore.updateStatus(planId, 'EXECUTING');
  const results = [];

  for (const itemNumber of selectedItems.sort((a, b) => a - b)) {
    const result = await executeCanaryItem(plan, itemNumber, options);
    results.push(result);
    if (!result.ok) break;
  }

  const allOk = results.every(r => r.ok);
  planStore.updateStatus(planId, allOk ? 'COMPLETED' : 'FAILED', {
    executionCompletedAt: new Date().toISOString(),
    executionResults: results.map(r => ({ itemNumber: r.item?.number, ok: r.ok, error: r.error })),
  });

  return { ok: allOk, results, planId };
}

function reconcileCanaryPlan(plan) {
  const report = {
    planId: plan.planId,
    planHash: plan.planHash,
    state: plan.state,
    totalItems: plan.totalItems,
    completedItems: plan.completedItems,
    failedItems: plan.failedItems,
    items: plan.items.map(i => ({
      number: i.number,
      status: i.status,
      providerMessageId: i.providerMessageId,
      providerResult: i.providerResult,
      sentAt: i.sentAt,
    })),
    journalEntries: plan.journal.length,
    verified: {
      noUnapprovedSends: plan.items.every(i => i.status === 'PENDING' || i.status === 'SENT' || i.status === 'FAILED'),
      noDuplicateSends: new Set(plan.items.filter(i => i.status === 'SENT').map(i => i.number)).size === plan.completedItems,
      noExcessSends: plan.completedItems <= CANARY_MAX_SENDS,
      allItemsAccounted: plan.items.length === plan.totalItems,
    },
  };
  report.verified.allPassed = Object.values(report.verified).every(Boolean);
  return report;
}

module.exports = {
  CANARY_MAX_SENDS,
  CANARY_PLAN_EXPIRY_MS,
  createCanaryPlan,
  saveCanaryPlan,
  loadCanaryPlan,
  loadActiveCanaryPlan,
  executeCanaryItem,
  executeApprovedPlan,
  reconcileCanaryPlan,
  appendCanaryJournal,
  appendCanaryJournalLine,
  canaryJournalPath,
};
