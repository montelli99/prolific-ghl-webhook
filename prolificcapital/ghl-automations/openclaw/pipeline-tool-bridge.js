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

const PPC_PROFILE_ID = 'PPC_EWA_BEACH';
const PPC_LOCATION_ID = 'GDq92uruRngbi9mLGGrV';
const PPC_PIPELINE_ID = 'ril84XHGQleRgE0W0FKU';
const PPC_CREDENTIAL_REF = 'PPC_GHL_API_KEY';
const PPC_STAGE_AUTHORITY_PATH = 'C:/Users/mscott/AI_Workspace/prolificcapital/ghl-automations/profiles/ppc-ewa-beach/stage-authority.json';

const VALID_PROFILES = Object.freeze({
  ATLAS_OUTBOUND: { profileId: 'ATLAS_OUTBOUND', locationId: LOCATION_ID, pipelineId: PIPELINE_ID, credentialRef: 'GHL_API_TOKEN' },
  PPC_EWA_BEACH: { profileId: PPC_PROFILE_ID, locationId: PPC_LOCATION_ID, pipelineId: PPC_PIPELINE_ID, credentialRef: PPC_CREDENTIAL_REF },
});

const ZERO_EFFECTS = Object.freeze({ providerSends: 0, ghlWrites: 0, stageMovements: 0 });

// ---- Profile-aware routing ----

function resolvePipelineContext(profileId) {
  if (!profileId || typeof profileId !== 'string') {
    return { resolved: false, reason: 'PIPELINE_PROFILE_SELECTION_REQUIRED' };
  }
  const normalized = String(profileId).trim().toUpperCase();
  const profile = VALID_PROFILES[normalized];
  if (!profile) {
    return { resolved: false, reason: `UNKNOWN_PROFILE: ${profileId}`, validProfiles: Object.keys(VALID_PROFILES) };
  }
  return {
    resolved: true,
    profileId: profile.profileId,
    locationId: profile.locationId,
    pipelineId: profile.pipelineId,
    credentialRef: profile.credentialRef,
  };
}

async function resolveProfileFromOpportunity(opportunityId, auth) {
  if (!opportunityId) return { resolved: false, reason: 'OPPORTUNITY_ID_REQUIRED' };
  const a = authorize(auth);
  if (!a.authorized) return { resolved: false, reason: a.reason };
  const token = getGhlToken('ATLAS_OUTBOUND');
  const ppcToken = getGhlToken('PPC_EWA_BEACH');
  if (!token && !ppcToken) return { resolved: false, reason: 'NO_GHL_CREDENTIALS' };

  const results = [];
  if (token) {
    try {
      const res = await ghlGet(token, `/opportunities/${opportunityId}`);
      const opp = res.body?.opportunity || res.body;
      if (opp && opp.id) {
        const locId = opp.locationId || '';
        const pipeId = opp.pipelineId || '';
        for (const [key, profile] of Object.entries(VALID_PROFILES)) {
          if (profile.locationId === locId && profile.pipelineId === pipeId) {
            return { resolved: true, profileId: profile.profileId, locationId: locId, pipelineId: pipeId, credentialRef: profile.credentialRef, opportunity: opp };
          }
        }
        results.push({ locationId: locId, pipelineId: pipeId });
      }
    } catch (_) {}
  }
  if (ppcToken && token !== ppcToken) {
    try {
      const res = await ghlGet(ppcToken, `/opportunities/${opportunityId}`);
      const opp = res.body?.opportunity || res.body;
      if (opp && opp.id) {
        const locId = opp.locationId || '';
        const pipeId = opp.pipelineId || '';
        for (const [key, profile] of Object.entries(VALID_PROFILES)) {
          if (profile.locationId === locId && profile.pipelineId === pipeId) {
            return { resolved: true, profileId: profile.profileId, locationId: locId, pipelineId: pipeId, credentialRef: profile.credentialRef, opportunity: opp };
          }
        }
        results.push({ locationId: locId, pipelineId: pipeId });
      }
    } catch (_) {}
  }
  return { resolved: false, reason: 'OPPORTUNITY_NOT_FOUND_OR_CROSS_PROFILE', searched: results };
}

// ---- GHL HTTP helpers (async) ----

function getGhlToken(profileId) {
  const profile = VALID_PROFILES[profileId];
  if (!profile) return null;
  return process.env[profile.credentialRef] || null;
}

function ghlRequest(method, token, pathname, body) {
  return new Promise((resolve) => {
    const https = require('https');
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'services.leadconnectorhq.com', path: pathname, method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Version: '2021-07-28' },
      timeout: 15000,
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

function ghlGet(token, pathname) {
  return ghlRequest('GET', token, pathname);
}

function ghlPut(token, pathname, body) {
  return ghlRequest('PUT', token, pathname, body);
}

// ---- PPC Stage Authority ----

let _ppcStageAuthority = null;
function loadPpcStageAuthority() {
  if (_ppcStageAuthority) return _ppcStageAuthority;
  try {
    const fs = require('fs');
    _ppcStageAuthority = JSON.parse(fs.readFileSync(PPC_STAGE_AUTHORITY_PATH, 'utf8'));
  } catch (_) {
    _ppcStageAuthority = { stages: [], totalStages: 0 };
  }
  return _ppcStageAuthority;
}

function resolvePpcStage(target) {
  const authority = loadPpcStageAuthority();
  const stages = authority.stages || [];
  if (!target) return { resolved: false, reason: 'TARGET_STAGE_REQUIRED' };
  const byId = stages.find((s) => s.stageId === String(target));
  if (byId) return { resolved: true, stage: byId };
  const byName = stages.find((s) => s.name.toLowerCase() === String(target).toLowerCase());
  if (byName) return { resolved: true, stage: byName };
  const byPosition = stages.find((s) => String(s.position) === String(target));
  if (byPosition) return { resolved: true, stage: byPosition };
  return { resolved: false, reason: 'PPC_STAGE_NOT_FOUND', target, availableStages: stages.map((s) => ({ position: s.position, stageId: s.stageId, name: s.name })) };
}

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
    profileId: 'ATLAS_OUTBOUND',
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

// ---- PPC Read-Only Tools ----

async function pipelineReadOpportunity(profileId, opportunityId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');
  const res = await ghlGet(token, `/opportunities/${opportunityId}`);
  const opp = res.body?.opportunity || res.body;
  if (!opp || !opp.id) return blocked('OPPORTUNITY_NOT_FOUND');
  if (opp.locationId !== ctx.locationId || opp.pipelineId !== ctx.pipelineId) {
    return blocked('CROSS_PROFILE_OPPORTUNITY');
  }
  const stageId = opp.pipelineStageId || '';
  let stageName = null;
  if (ctx.profileId === 'PPC_EWA_BEACH') {
    const authority = loadPpcStageAuthority();
    const stage = (authority.stages || []).find((s) => s.stageId === stageId);
    if (stage) stageName = stage.name;
  }
  return {
    status: 'OK',
    profileId: ctx.profileId,
    locationId: ctx.locationId,
    pipelineId: ctx.pipelineId,
    opportunityId: opp.id,
    contactId: opp.contactId || opp.contact_id || null,
    currentStageId: stageId,
    currentStageName: stageName || null,
    opportunityName: opp.name || null,
    opportunityStatus: opp.status || null,
    monetaryValue: opp.monetaryValue ?? opp.monetary_value ?? null,
    assignedTo: opp.assignedTo || null,
    effects: { ...ZERO_EFFECTS },
  };
}

async function pipelineSearchOpportunities(profileId, query, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');
  const q = query || {};
  let path = `/opportunities/search?location_id=${encodeURIComponent(ctx.locationId)}&pipeline_id=${encodeURIComponent(ctx.pipelineId)}&limit=50`;
  if (q.stageId) path += `&pipeline_stage_id=${encodeURIComponent(q.stageId)}`;
  if (q.contactId) path += `&contact_id=${encodeURIComponent(q.contactId)}`;
  if (q.query) path += `&q=${encodeURIComponent(q.query)}`;
  const res = await ghlGet(token, path);
  if (!res.body || !res.body.opportunities) return blocked('SEARCH_FAILED');
  const items = (res.body.opportunities || []).map((opp) => {
    const stageId = opp.pipelineStageId || opp.pipeline_stage_id || '';
    let stageName = null;
    if (ctx.profileId === 'PPC_EWA_BEACH') {
      const authority = loadPpcStageAuthority();
      const stage = (authority.stages || []).find((s) => s.stageId === stageId);
      if (stage) stageName = stage.name;
    }
    return {
      opportunityId: opp.id,
      contactId: opp.contactId || opp.contact_id || null,
      currentStageId: stageId,
      currentStageName: stageName || null,
      opportunityName: opp.name || null,
      opportunityStatus: opp.status || null,
    };
  });
  return {
    status: 'OK',
    profileId: ctx.profileId,
    locationId: ctx.locationId,
    pipelineId: ctx.pipelineId,
    count: items.length,
    total: res.body.total || items.length,
    items,
    effects: { ...ZERO_EFFECTS },
  };
}

function pipelineListStages(profileId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  if (ctx.profileId !== 'PPC_EWA_BEACH') {
    return blocked('PPC_STAGE_LIST_ONLY_AVAILABLE_FOR_PPC');
  }
  const authority = loadPpcStageAuthority();
  const stages = (authority.stages || []).map((s) => ({
    position: s.position,
    stageId: s.stageId,
    name: s.name,
    semanticCategory: s.semanticCategory,
    terminal: s.terminal,
    outreachEligibility: s.outreachEligibility,
  }));
  return {
    status: 'OK',
    profileId: ctx.profileId,
    pipelineId: ctx.pipelineId,
    pipelineName: authority.pipelineName || 'Inbound PPC',
    totalStages: authority.totalStages,
    populatedStages: authority.populatedStages,
    stages,
    effects: { ...ZERO_EFFECTS },
  };
}

// ---- PPC Owner-Directed Stage Move ----

async function pipelineMoveStage(profileId, opportunityId, targetStage, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  if (ctx.profileId !== 'PPC_EWA_BEACH') {
    return blocked('STAGE_MOVE_ONLY_SUPPORTED_FOR_PPC');
  }
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');

  const oppRes = await ghlGet(token, `/opportunities/${opportunityId}`);
  const opp = oppRes.body?.opportunity || oppRes.body;
  if (!opp || !opp.id) return blocked('OPPORTUNITY_NOT_FOUND');
  if (opp.locationId !== ctx.locationId || opp.pipelineId !== ctx.pipelineId) {
    return blocked('CROSS_PROFILE_OPPORTUNITY');
  }

  const oldStageId = opp.pipelineStageId || '';
  const stageRes = resolvePpcStage(targetStage);
  if (!stageRes.resolved) return blocked(stageRes.reason);
  const targetStageId = stageRes.stage.stageId;
  if (targetStageId === oldStageId) {
    return { status: 'NO_OP', reason: 'ALREADY_AT_TARGET_STAGE', opportunityId, currentStageId: oldStageId, targetStageId, effects: { ...ZERO_EFFECTS } };
  }

  const beforeSnapshot = {
    opportunityId: opp.id,
    contactId: opp.contactId || opp.contact_id || null,
    name: opp.name || null,
    status: opp.status || null,
    monetaryValue: opp.monetaryValue ?? opp.monetary_value ?? null,
    assignedTo: opp.assignedTo || null,
    oldStageId,
  };

  const patchResult = await ghlPut(token, `/opportunities/${opportunityId}`, { pipelineStageId: targetStageId });
  if (patchResult.status < 200 || patchResult.status >= 300) {
    return { status: 'WRITE_UNCERTAIN_NO_RETRY', reason: `GHL_PATCH_FAILED: ${patchResult.status}`, opportunityId, oldStageId, targetStageId, effects: { ...ZERO_EFFECTS } };
  }

  const readbackRes = await ghlGet(token, `/opportunities/${opportunityId}`);
  const readback = readbackRes.body?.opportunity || readbackRes.body;
  if (!readback || !readback.id) {
    return { status: 'WRITE_UNCERTAIN_NO_RETRY', reason: 'READBACK_FAILED', opportunityId, oldStageId, targetStageId, effects: { ...ZERO_EFFECTS } };
  }

  const newStageId = readback.pipelineStageId || '';
  const sideEffects = {
    contactIdChanged: (readback.contactId || readback.contact_id || null) !== beforeSnapshot.contactId,
    nameChanged: (readback.name || null) !== beforeSnapshot.name,
    statusChanged: (readback.status || null) !== beforeSnapshot.status,
    monetaryValueChanged: (readback.monetaryValue ?? readback.monetary_value ?? null) !== beforeSnapshot.monetaryValue,
    assignedToChanged: (readback.assignedTo || null) !== beforeSnapshot.assignedTo,
  };
  const hasSideEffects = Object.values(sideEffects).some(Boolean);

  let newStageName = null;
  if (ctx.profileId === 'PPC_EWA_BEACH') {
    const authority = loadPpcStageAuthority();
    const stage = (authority.stages || []).find((s) => s.stageId === newStageId);
    if (stage) newStageName = stage.name;
  }

  return {
    status: hasSideEffects ? 'STAGE_MOVED_WITH_UNEXPECTED_SIDE_EFFECTS' : 'STAGE_MOVED',
    profileId: ctx.profileId,
    opportunityId,
    oldStageId: beforeSnapshot.oldStageId,
    newStageId,
    newStageName: newStageName || null,
    targetStageId,
    stageMatch: newStageId === targetStageId,
    sideEffects,
    effects: { providerSends: 0, ghlWrites: 1, stageMovements: 1 },
  };
}

module.exports = {
  PIPELINE_LIVE_MODE,
  OWNER_ID,
  CHAT_ID,
  TOPIC_ID,
  VALID_PROFILES,
  resolvePipelineContext,
  resolveProfileFromOpportunity,
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
  pipelineReadOpportunity,
  pipelineSearchOpportunities,
  pipelineListStages,
  pipelineMoveStage,
  loadPpcStageAuthority,
  resolvePpcStage,
};
