'use strict';

// pipeline-tool-bridge.js
//
// Thin adapter between the OpenClaw `pipeline-tools` extension and the
// authoritative Prolific Capital modules. This bridge never reimplements
// business logic; every operation delegates to the authoritative modules:
//
//   - safety state              -> bot/kill-switch
//   - canary previews           -> modules/canary-plan-builder (CanaryPlanBuilder)
//   - plan persistence/status   -> modules/plan-store (PlanStore)
//   - approvals                 -> modules/approval-store (ApprovalStore)
//   - runbook v2 review/approve -> modules/supervised-canary-runbook-service
//   - execution/reconciliation  -> bot/canary-executor
//   - memory provenance         -> modules/pipeline-memory-context
//   - stage/script guidance     -> modules/kayla-course-spec
//
// The extension (extensions/pipeline-tools/index.ts) already marks every tool
// `ownerOnly: true`, which the platform enforces mechanically (wrapOwnerOnlyToolExecution
// in src/agents/tools/common.ts). As defense in depth, every state-changing or
// context-sensitive method additionally enforces owner/chat/topic here via
// authorize() BEFORE touching any authoritative store or operation. Read-only
// tools (which the extension invokes without context) are covered by the platform
// owner gate and only expose aggregated state; they never mutate anything.
//
// Kill switch stays PAUSED in production; execution is blocked by the kill switch
// itself (KILL_SWITCH_BLOCKS_SEND) and by the approval/provenance gates in the
// runbook service before any provider action can occur.

const OWNER_ID = '718718959';
const CHAT_ID = '-1003975794600';
const TOPIC_ID = '389';
const PIPELINE_LIVE_MODE = 'READ_ONLY_SUPERVISED';
const LOCATION_ID = '61XPzSqRy7UKMwW9DeB8';
const PIPELINE_ID = 'nSf3NXYVkt8X4PgW9aZ3';
const RUNBOOK_ID = 'runbook_supervised_canary_v2';
const RUNBOOK_CANONICAL_HASH = '9126b05e2c39d2ee6d8fb35ed2ad065a95969badf316c65124b74315ff17b750';
const SECRETS_ENV_PATH = 'C:/Users/mscott/AI_Workspace/prolificcapital/secrets/.env';

const ZERO_EFFECTS = Object.freeze({ providerSends: 0, ghlWrites: 0, stageMovements: 0 });

// Authoritative module singletons. `_setDeps` is a test-only seam that lets the
// pre-restart harness substitute hermetic stubs; production always uses these.
const deps = {
  killSwitch: require('../bot/kill-switch'),
  PlanStore: require('../modules/plan-store').PlanStore,
  ApprovalStore: require('../modules/approval-store').ApprovalStore,
  CanaryPlanBuilder: require('../modules/canary-plan-builder').CanaryPlanBuilder,
  SupervisedCanaryRunbookService: require('../modules/supervised-canary-runbook-service').SupervisedCanaryRunbookService,
  executor: require('../bot/canary-executor'),
  mem: require('../modules/pipeline-memory-context'),
  spec: require('../modules/kayla-course-spec'),
};

function _setDeps(override) {
  Object.assign(deps, override || {});
  runbookService = null;
  return deps;
}

let runbookService = null;
function getRunbookService() {
  if (!runbookService) {
    runbookService = new deps.SupervisedCanaryRunbookService({
      planStore: new deps.PlanStore(),
      approvalStore: new deps.ApprovalStore(),
    });
  }
  return runbookService;
}

// Load Prolific secrets into the gateway process env (read-only file read) so the
// authoritative modules can construct read clients (GHL token, JustCall creds).
// Never overwrites an already-set environment variable.
function loadSecretsIntoEnv() {
  try {
    const fs = require('fs');
    const content = fs.readFileSync(SECRETS_ENV_PATH, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].replace(/^['"]|['"]$/g, '').trim();
      if (value && !(key in process.env)) process.env[key] = value;
    }
  } catch (_) {
    // Keep whatever env the gateway already has.
  }
}
loadSecretsIntoEnv();

function authorize(auth) {
  const ctx = auth || {};
  if (ctx.mode && ctx.mode !== PIPELINE_LIVE_MODE) {
    return { authorized: false, reason: 'PIPELINE_LIVE_MODE_REQUIRED' };
  }
  if (String(ctx.telegramUserId || '') !== OWNER_ID) {
    return { authorized: false, reason: 'OWNER_REQUIRED' };
  }
  if (String(ctx.chatId || '') !== CHAT_ID) {
    return { authorized: false, reason: 'GROUP_REQUIRED' };
  }
  if (String(ctx.topicId || '') !== TOPIC_ID) {
    return { authorized: false, reason: 'TOPIC_389_REQUIRED' };
  }
  return { authorized: true };
}

function runbookCtx(auth) {
  return {
    telegramUserId: auth && auth.telegramUserId,
    chatId: auth && auth.chatId,
    topicId: auth && auth.topicId,
    messageId: (auth && auth.messageId) || null,
  };
}

function blocked(reason) {
  return { status: 'BLOCKED', reason, effects: { ...ZERO_EFFECTS } };
}

function safetySnapshot(ks) {
  return {
    killSwitch: ks.state,
    canSend: deps.killSwitch.canSend(ks.state),
    canSimulate: deps.killSwitch.canSimulate(ks.state),
    isPaused: deps.killSwitch.isPaused(ks.state),
    counts: {
      liveSends: ks.liveSends || 0,
      productionWrites: ks.productionWrites || 0,
      stageMovements: ks.stageMovements || 0,
    },
  };
}

// ---- Read-only tools (platform owner-gated; aggregated state only) ----

function getKillSwitchState() {
  const ks = deps.killSwitch.readKillSwitch();
  return {
    status: 'OK',
    state: ks.state,
    canSend: deps.killSwitch.canSend(ks.state),
    canSimulate: deps.killSwitch.canSimulate(ks.state),
    isPaused: deps.killSwitch.isPaused(ks.state),
    counts: { liveSends: ks.liveSends || 0, productionWrites: ks.productionWrites || 0, stageMovements: ks.stageMovements || 0 },
    file: deps.killSwitch.KILL_SWITCH_PATH,
    effects: { ...ZERO_EFFECTS },
  };
}

function getPipelineCurrentState() {
  const ks = deps.killSwitch.readKillSwitch();
  const planStore = new deps.PlanStore();
  const service = getRunbookService();
  const runbook = service.loadRunbook();
  const activePlanId = service.getActivePlanId();
  return {
    status: 'OK',
    mode: PIPELINE_LIVE_MODE,
    subsystem: 'certified',
    productionWrites: 'blocked',
    safety: safetySnapshot(ks),
    runbook: runbook
      ? { instructionId: runbook.instructionId, status: runbook.status, version: runbook.version, hashVerified: !runbook._hashMismatch }
      : null,
    plans: {
      pending: planStore.listPlans({ status: 'PREVIEW_PENDING_APPROVAL' }).length,
      approved: planStore.listPlans({ status: 'APPROVED_PENDING_EXECUTION' }).length,
      activePlanId,
    },
    provider: { provider: 'JustCall', sender: `+*******${deps.spec.SELECTED_SENDER_SUFFIX}`, tenDLC: 'APPROVED' },
    effects: { ...ZERO_EFFECTS },
  };
}

function getPipelineWorkSummary() {
  const ks = deps.killSwitch.readKillSwitch();
  const service = getRunbookService();
  const planStore = new deps.PlanStore();
  const activePlanId = service.getActivePlanId();
  const activePlan = activePlanId ? planStore.loadPlan(activePlanId) : null;
  return {
    status: 'OK',
    mode: PIPELINE_LIVE_MODE,
    safety: safetySnapshot(ks),
    activePlan: activePlan
      ? { planId: activePlan.planId, status: activePlan.status, selectedCount: activePlan.selectedCount, expiresAt: activePlan.expiresAt, executable: Boolean(activePlan.executable) }
      : null,
    availableTools: [
      'pipeline_current_state', 'pipeline_work_summary', 'pipeline_stage_guidance', 'pipeline_kayla_script',
      'pipeline_kill_switch', 'pipeline_pause', 'pipeline_dry_run', 'pipeline_provider_status',
      'pipeline_memory_provenance', 'pipeline_canary_candidates', 'pipeline_canary_preview',
      'pipeline_canary_review', 'pipeline_canary_expire', 'pipeline_canary_approve',
      'pipeline_canary_execute', 'pipeline_canary_reconcile', 'pipeline_record_correction',
      'pipeline_session_status',
    ],
    nextMilestones: ['Prepare the first supervised canary preview (owner in Pipeline topic 389)'],
    effects: { ...ZERO_EFFECTS },
  };
}

function getStageGuidance(stage) {
  let stages;
  try {
    stages = deps.spec.loadKaylaCourseSpec().stages;
  } catch (_) {
    stages = null;
  }
  const source = stages || deps.spec.STAGES || [];
  const s = source.find((x) => Number(x.order || x[0]) === Number(stage));
  if (!s) return { status: 'BLOCKED', reason: 'INVALID_STAGE', validRange: '1-21', effects: { ...ZERO_EFFECTS } };
  if (Array.isArray(s)) {
    return {
      status: 'OK',
      stage: Number(s[0]),
      name: s[1],
      mode: s[2],
      textShortcut: s[3],
      purpose: s[4],
      effects: { ...ZERO_EFFECTS },
    };
  }
  return {
    status: 'OK',
    stage: s.order,
    name: s.stageName,
    mode: s.mode,
    textShortcut: s.textShortcut,
    purpose: s.coursePurpose,
    allowedAutomation: s.allowedAutomation,
    effects: { ...ZERO_EFFECTS },
  };
}

function getKaylaScript(stage) {
  let spec;
  try {
    spec = deps.spec.loadKaylaCourseSpec();
  } catch (_) {
    spec = null;
  }
  const stages = (spec && spec.stages) || deps.spec.STAGES || [];
  const s = stages.find((x) => Number(x.order || x[0]) === Number(stage));
  if (!s) return { status: 'BLOCKED', reason: 'INVALID_STAGE', validRange: '1-21', effects: { ...ZERO_EFFECTS } };
  const shortcutName = Array.isArray(s) ? s[3] : s.textShortcut;
  const script = (spec && spec.shortcuts && spec.shortcuts.find((c) => c.name === shortcutName)) || null;
  return {
    status: 'PREVIEW_ONLY',
    stage: Number(Array.isArray(s) ? s[0] : s.order),
    stageName: Array.isArray(s) ? s[1] : s.stageName,
    shortcut: shortcutName || null,
    script: script ? script.body : null,
    senderName: 'Montelli',
    effects: { ...ZERO_EFFECTS },
  };
}

function getProviderStatus() {
  const ks = deps.killSwitch.readKillSwitch();
  return {
    status: 'OK',
    provider: 'JustCall',
    sender: `+*******${deps.spec.SELECTED_SENDER_SUFFIX}`,
    tenDLC: 'APPROVED',
    killSwitch: ks.state,
    sendsPossible: deps.killSwitch.canSend(ks.state),
    effects: { ...ZERO_EFFECTS },
  };
}

function getMemoryProvenance() {
  const corrections = deps.mem.getCorrections({ limit: 10 });
  return {
    status: 'OK',
    authority: deps.mem.AUTHORITY || null,
    recentCorrections: corrections.map((c) => ({
      memoryId: c.memoryId,
      text: c.text,
      scope: c.scope,
      supersedes: c.supersedes || null,
      createdAt: c.createdAt,
    })),
    preferences: deps.mem.getOwnerPreferences(),
    effects: { ...ZERO_EFFECTS },
  };
}

function listSafeCanaryCandidates() {
  const builder = new deps.CanaryPlanBuilder({
    ghlToken: process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || '',
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
  });
  return builder
    .buildPreview({
      now: new Date(),
      ownerId: OWNER_ID,
      chatId: CHAT_ID,
      topicId: Number(TOPIC_ID),
      runbookId: RUNBOOK_ID,
      runbookHash: RUNBOOK_CANONICAL_HASH,
    })
    .then((plan) => ({
      status: 'OK',
      count: plan.selectedCount,
      totalCandidates: plan.totalCandidates,
      blockedCount: plan.blockedCount,
      blockerDistribution: plan.blockerDistribution,
      previewPlanId: plan.planId,
      constraints: {
        maxCanary: 3,
        sendWindow: 'Monday-Friday 12:00 PM - 6:00 PM property-local time',
        noPriorOutreach: true,
        noDncStop: true,
        rolePriority: 'agent > broker > owner',
      },
      effects: { ...ZERO_EFFECTS },
    }))
    .catch((err) => ({ status: 'BLOCKED', reason: err.message || String(err), effects: { ...ZERO_EFFECTS } }));
}

function reviewCanaryPlan(planId) {
  const planStore = new deps.PlanStore();
  const plan = planStore.loadPlan(planId);
  if (!plan) return blocked('PLAN_NOT_FOUND');
  return {
    status: 'OK',
    planId: plan.planId,
    planHash: plan.planHash,
    planStatus: plan.status,
    executable: Boolean(plan.executable),
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    selectedCount: plan.selectedCount,
    totalCandidates: plan.totalCandidates,
    items: (plan.items || []).map((i) => ({
      number: i.number,
      contactName: i.contactName,
      contactRole: i.contactRole,
      propertyAddress: i.propertyAddress,
      timezone: i.timezone,
      renderedMessage: i.renderedMessage,
    })),
    persisted: planStore.planPath(planId),
    effects: { ...ZERO_EFFECTS },
  };
}

function getCanaryReconciliation(planId) {
  const planStore = new deps.PlanStore();
  const plan = planStore.loadPlan(planId);
  if (plan) {
    const items = plan.items || [];
    const executed = (plan.executionResults || []).filter((r) => r && typeof r.ok === 'boolean');
    return {
      status: 'OK',
      planId,
      planStatus: plan.status,
      total: items.length,
      sent: executed.filter((r) => r.ok).length,
      failed: executed.filter((r) => !r.ok).length,
      pending: items.length - executed.length,
      executionResults: executed,
      effects: { ...ZERO_EFFECTS },
    };
  }
  const executorPlan = deps.executor.loadCanaryPlan(planId);
  if (executorPlan) {
    return { status: 'OK', ...deps.executor.reconcileCanaryPlan(executorPlan), effects: { ...ZERO_EFFECTS } };
  }
  return blocked('PLAN_NOT_FOUND');
}

// ---- Auth-gated state-changing / context methods ----

function pauseOutreach(auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ks = deps.killSwitch.readKillSwitch();
  if (!deps.killSwitch.transitionAllowed(ks.state, 'PAUSED', auth.telegramUserId, [], OWNER_ID)) {
    return blocked('TRANSITION_NOT_ALLOWED');
  }
  const updated = deps.killSwitch.writeKillSwitch('PAUSED');
  return { status: 'PAUSED', state: updated.state, effects: { ...ZERO_EFFECTS } };
}

function enableDryRun(auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ks = deps.killSwitch.readKillSwitch();
  if (!deps.killSwitch.transitionAllowed(ks.state, 'DRY_RUN_ONLY', auth.telegramUserId, [], OWNER_ID)) {
    return blocked('TRANSITION_NOT_ALLOWED');
  }
  const updated = deps.killSwitch.writeKillSwitch('DRY_RUN_ONLY');
  return { status: 'DRY_RUN_ONLY', state: updated.state, effects: { ...ZERO_EFFECTS } };
}

function recordCorrection(text, scope, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (!text || !String(text).trim()) return blocked('CORRECTION_TEXT_REQUIRED');
  const entry = deps.mem.recordCorrection(String(text).trim(), scope || 'general', auth.chatId, auth.telegramUserId);
  return { status: 'RECORDED', memoryId: entry.memoryId, scope: entry.scope, effects: { ...ZERO_EFFECTS } };
}

async function createCanaryPreview(records, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const service = getRunbookService();
  const result = await service.beginPreparation(runbookCtx(auth));
  if (!result.plan) {
    return { status: 'PREVIEW_FAILED', reason: result.reply, effects: { ...ZERO_EFFECTS } };
  }
  const plan = result.plan;
  return {
    status: 'PREVIEW_READY',
    planId: plan.planId,
    planHash: plan.planHash,
    executable: false,
    planStatus: plan.status,
    expiresAt: plan.expiresAt,
    selectedCount: plan.selectedCount,
    totalCandidates: plan.totalCandidates,
    items: (plan.items || []).map((i) => ({
      number: i.number,
      contactName: i.contactName,
      contactRole: i.contactRole,
      propertyAddress: i.propertyAddress,
      timezone: i.timezone,
      renderedMessage: i.renderedMessage,
      guardStates: Object.fromEntries(Object.entries(i.guardEvidence || {}).map(([k, v]) => [k, v.state])),
    })),
    persisted: `data/production-plans/${plan.planId}.json`,
    reply: result.reply,
    effects: { ...ZERO_EFFECTS },
  };
}

async function expireCanaryPlan(planId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const service = getRunbookService();
  const result = await service.handleCancel(planId, runbookCtx(auth));
  return { status: 'EXPIRED_OR_CANCELLED', planId, reply: result.reply, effects: { ...ZERO_EFFECTS } };
}

async function approveCanaryPlan(planId, itemNumbers, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const numbers = (itemNumbers || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1);
  if (numbers.length === 0) return blocked('ITEM_NUMBERS_REQUIRED');
  const approvalText = `Send items ${numbers.join(', ')}`;
  const service = getRunbookService();
  const result = await service.handleApproval(planId, approvalText, runbookCtx(auth));
  if (!result.approval) {
    return { status: 'APPROVAL_BLOCKED', reason: result.reply, planId, effects: { ...ZERO_EFFECTS } };
  }
  return {
    status: 'APPROVED',
    planId,
    approvalId: result.approval.approvalId,
    approvalHash: result.approval.approvalHash,
    items: result.approval.selectedItems,
    executable: false,
    reply: result.reply,
    effects: { ...ZERO_EFFECTS },
  };
}

async function executeCanary(planId, itemNumber, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ks = deps.killSwitch.readKillSwitch();
  if (!deps.killSwitch.canSend(ks.state)) {
    return blocked(`KILL_SWITCH_BLOCKS_SEND: current state is ${ks.state}`);
  }
  const result = await deps.executor.executeApprovedPlan(planId, [Number(itemNumber)], {
    planStore: new deps.PlanStore(),
    approvalStore: new deps.ApprovalStore(),
  });
  if (!result.ok) return blocked(result.error);
  return {
    status: 'EXECUTED',
    planId,
    itemNumber: Number(itemNumber),
    results: (result.results || []).map((r) => ({ itemNumber: r.item ? r.item.number : null, ok: r.ok, error: r.error || null })),
    effects: { providerSends: (result.results || []).filter((r) => r.ok).length, ghlWrites: 0, stageMovements: 0 },
  };
}

function getSessionStatus(auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ks = deps.killSwitch.readKillSwitch();
  const service = getRunbookService();
  const planStore = new deps.PlanStore();
  const activePlanId = service.getActivePlanId();
  const activePlan = activePlanId ? planStore.loadPlan(activePlanId) : null;
  return {
    status: 'OK',
    mode: PIPELINE_LIVE_MODE,
    session: { ownerId: String(auth.telegramUserId), chatId: String(auth.chatId), topicId: String(auth.topicId) },
    safety: { killSwitch: ks.state, canSend: deps.killSwitch.canSend(ks.state) },
    activePlan: activePlan
      ? { planId: activePlan.planId, status: activePlan.status, expiresAt: activePlan.expiresAt, executable: Boolean(activePlan.executable) }
      : null,
    effects: { ...ZERO_EFFECTS },
  };
}

module.exports = {
  PIPELINE_LIVE_MODE,
  OWNER_ID,
  CHAT_ID,
  TOPIC_ID,
  authorize,
  _setDeps,
  getPipelineCurrentState,
  getPipelineWorkSummary,
  getStageGuidance,
  getKaylaScript,
  getKillSwitchState,
  pauseOutreach,
  enableDryRun,
  getProviderStatus,
  getMemoryProvenance,
  recordCorrection,
  listSafeCanaryCandidates,
  createCanaryPreview,
  reviewCanaryPlan,
  expireCanaryPlan,
  approveCanaryPlan,
  executeCanary,
  getCanaryReconciliation,
  getSessionStatus,
};
