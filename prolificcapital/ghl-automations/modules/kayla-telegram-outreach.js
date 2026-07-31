'use strict';

const dry = require('./telegram-outreach-dry-run');
const { loadAtlasDryRunOpportunities } = require('./kayla-production-data-loader');
const ghlGuards = require('./atlas-ghl-telegram-live-guards');

function escapeMd(text) { return String(text ?? '').replace(/[_*`\[]/g, '\\$&'); }

function latest(ctx, options) {
  return dry.latestSession(ctx.chatId || ctx.sourceTopicId || 'default', ctx.telegramUserId, options);
}

function requireSession(ctx, options) {
  const session = latest(ctx, options);
  if (!session) throw new Error('NO_ACTIVE_OUTREACH_SESSION');
  return session;
}

function planForIntent(intent, ctx, options) {
  const opportunities = options?.opportunities || loadAtlasDryRunOpportunities(options);
  const plan = dry.buildPlan({ opportunities, count: intent.count || 10, roleFilter: intent.roleFilter || 'all', mode: 'INITIAL_CONTACT', ctx, options });
  const session = dry.createSession({ chatId: ctx.chatId || ctx.sourceTopicId || 'default', telegramUserId: ctx.telegramUserId, mode: 'INITIAL_CONTACT', requestedCount: intent.count || 10, requestedRoleFilter: intent.roleFilter || 'all', plan }, options);
  return { reply: dry.formatPlan(session) };
}

function abbreviated(id) { return String(id || '').slice(0, 8); }

function formatCanaryPreview(session) {
  const lines = ['*Atlas Kayla GHL Canary Preview*', `Session: ${session.sessionId}`, `Plan hash: ${session.immutablePlanHash}`, 'Live sends: 0', 'Production writes: 0', 'Stage movements: 0', ''];
  for (const item of session.selectedRecords) {
    const guard = item.ghlGuard || {};
    lines.push(`${item.number}. ${item.contactRole.role} (${Math.round((item.contactRole.confidence || 0) * 100)}%) | ${item.propertyAddress}`);
    lines.push(`Contact: ${item.maskedContact} | Opp: ${abbreviated(item.opportunityId)} | Stage: ${item.currentStage}`);
    lines.push(`Kayla rule: ${item.kaylaRule} | Shortcut: ${item.shortcutName || 'none'}`);
    lines.push(`Message: ${item.renderedPreview || '(manual action; no SMS preview)'}`);
    lines.push(`Sender: ${item.senderNumber}`);
    lines.push(`GHL guard: ${guard.passed ? 'PASSED' : 'BLOCKED'}${guard.blockedReasons?.length ? ` (${guard.blockedReasons.join(', ')})` : ''}`);
    lines.push(`Restriction: DNC ${guard.dncStatus?.passed ? 'clear' : 'blocked'} | opt-out ${guard.optOutStatus?.passed ? 'clear' : 'blocked'} | wrong-number ${guard.wrongNumberStatus?.passed ? 'clear' : 'blocked'} | pending-reply ${guard.pendingReplyStatus?.passed ? 'clear' : 'blocked'} | human-work ${guard.activeHumanWorkStatus?.passed ? 'clear' : 'blocked'}`);
    lines.push(`Workflow isolation: ${guard.workflowIsolationStatus?.status || 'WEBHOOK_ISOLATION_PENDING'}`);
    lines.push(`Stage movement: ${ghlGuards.STAGE_MOVEMENT_PENDING}`);
    lines.push(`Current sendability: ${guard.currentSendability || 'BLOCKED_GHL_GUARD'}`, '');
  }
  return lines.join('\n');
}

function canaryPreviewForIntent(intent, ctx, options) {
  const opportunities = options?.opportunities || loadAtlasDryRunOpportunities(options);
  const plan = dry.buildPlan({ opportunities, count: intent.count || 3, roleFilter: intent.roleFilter || 'all', mode: 'INITIAL_CONTACT', ctx, options });
  const now = options.now || new Date();
  const timeZone = Object.prototype.hasOwnProperty.call(options, 'timeZone') ? options.timeZone : (options.defaultTimeZone || process.env.ATLAS_CANARY_TIMEZONE || 'America/New_York');
  const rawRecords = opportunities.slice(0, 3);
  const guarded = rawRecords.map((record, index) => {
    const eligibility = dry.evaluateEligibility(record, { allRecords: rawRecords });
    const normalized = dry.normalizeOpportunity(record);
    const planned = plan.selectedRecords.find(item => item.opportunityId === normalized.opportunityId);
    return {
      ...(planned || {}),
      number: index + 1,
      opportunityId: normalized.opportunityId,
      contactId: normalized.contactId,
      maskedContact: dry.maskContact(normalized.contactId),
      contactRole: eligibility.contactRole,
      propertyAddress: normalized.propertyAddress,
      currentStage: eligibility.currentStage,
      kaylaRule: eligibility.sourceCitation || 'docs/atlas-kayla-course-parity-spec.md#course-rules',
      nextRequiredAction: eligibility.nextCourseApprovedAction || eligibility.reason,
      shortcutName: eligibility.requiredScriptOrShortcut,
      renderedPreview: eligibility.renderedPreview,
      senderNumber: plan.senderNumberLock,
      status: eligibility.safe && eligibility.due ? 'AVAILABLE' : 'BLOCKED',
      eligibility,
      ghlGuard: ghlGuards.evaluateGhlCanaryRecord(record, { records: rawRecords, now, timeZone, workflowIsolationProven: false }),
    };
  });
  const guardedPlan = { ...plan, selectedRecords: guarded, dryRunMode: true, canaryPreviewMode: true };
  const session = dry.createSession({ chatId: ctx.chatId || ctx.sourceTopicId || 'default', telegramUserId: ctx.telegramUserId, mode: 'INITIAL_CONTACT', requestedCount: intent.count || 3, requestedRoleFilter: intent.roleFilter || 'all', plan: guardedPlan }, options);
  session.canaryGuardSchema = 'atlas-ghl-telegram-canary-guard-v1';
  dry.saveSession(session, options);
  return { reply: formatCanaryPreview(session), session };
}

function handleKaylaOutreachCommand(ctx, text, options = {}) {
  try {
    const intent = dry.parseIntent(text);
    if (intent.intent === 'CLARIFY') return { reply: intent.question };
    if (intent.intent === 'PAUSE_OUTREACH') {
      const state = dry.setKillSwitch('PAUSED', ctx, options);
      return { reply: `Outreach paused. State: ${state.state}. Live sends remain 0.` };
    }
    if (intent.intent === 'RESUME_OUTREACH') {
      const state = dry.setKillSwitch('DRY_RUN_ONLY', ctx, options);
      return { reply: `Dry run resumed. State: ${state.state}. Live mode is unavailable.` };
    }
    if (intent.intent === 'SHOW_SESSION_STATUS') {
      const state = dry.getKillSwitch(options);
      const session = latest(ctx, options);
      return { reply: `Outreach state: ${state.state}\nSession: ${session ? `${session.sessionId} (${session.state})` : 'none'}\nLive sends: 0\nProduction writes: 0` };
    }
    if (['SHOW_UNTOUCHED_LEADS', 'SHOW_AGENTS_DUE', 'SHOW_OWNERS_DUE', 'SHOW_TEXTS_DUE', 'SHOW_CALLS_DUE', 'SHOW_FOLLOW_UPS_DUE', 'SHOW_TODAYS_KAYLA_WORK'].includes(intent.intent)) return planForIntent(intent, ctx, options);
    if (intent.intent === 'PREVIEW_CANARY') return canaryPreviewForIntent(intent, ctx, options);
    if (intent.intent === 'PREVIEW_PLAN') {
      const session = requireSession(ctx, options);
      session.state = 'PREVIEWED';
      dry.saveSession(session, options);
      return { reply: dry.formatPlan(session, intent.count || 5) };
    }
    if (intent.intent === 'HOLD_PLAN_ITEM') return { reply: dry.formatPlan(dry.updateNumbers(requireSession(ctx, options), intent.numbers, 'HELD', options)) };
    if (intent.intent === 'SKIP_PLAN_ITEM') return { reply: dry.formatPlan(dry.updateNumbers(requireSession(ctx, options), intent.numbers, 'SKIPPED', options)) };
    if (intent.intent === 'RESTORE_PLAN_ITEM') return { reply: dry.formatPlan(dry.updateNumbers(requireSession(ctx, options), intent.numbers, 'AVAILABLE', options)) };
    if (intent.intent === 'SELECT_PLAN_ITEMS') return { reply: dry.formatPlan(dry.selectNumbers(requireSession(ctx, options), intent.numbers, options)) };
    if (intent.intent === 'SHOW_COURSE_RULE') {
      const session = requireSession(ctx, options);
      const number = intent.numbers[0];
      const item = session.selectedRecords.find(record => record.number === number);
      return { reply: item ? `Number ${number} is due because ${item.eligibility.reason}\nRule: ${item.kaylaRule}` : 'That plan number is not available.' };
    }
    if (intent.intent === 'SHOW_EXACT_SCRIPT') {
      const session = requireSession(ctx, options);
      const number = intent.numbers[0] || 1;
      const item = session.selectedRecords.find(record => record.number === number);
      return { reply: item ? `Shortcut ${item.shortcutName}:\n${item.renderedPreview}` : 'That plan number is not available.' };
    }
    if (intent.intent === 'SHOW_EXPECTED_STAGE_MOVES') {
      const session = requireSession(ctx, options);
      const lines = ['Expected dry-run stage results:'];
      for (const item of session.selectedRecords) lines.push(`${item.number}. ${item.currentStage} -> ${item.expectedStageResult.proposed || 'no stage move'} | ${item.expectedStageResult.risk}`);
      return { reply: lines.join('\n') };
    }
    if (intent.intent === 'CANCEL_PLAN') {
      const session = requireSession(ctx, options);
      session.state = 'CANCELED';
      dry.saveSession(session, options);
      return { reply: `Plan canceled: ${session.sessionId}` };
    }
    if (intent.intent === 'APPROVE_DRY_RUN') {
      const session = dry.approveDryRun(requireSession(ctx, options), ctx, options);
      const result = dry.executeDryRun(session, ctx, options);
      return { reply: [`Dry-run simulation complete.`, `Session: ${result.sessionId}`, `Plan hash: ${result.planHash}`, `Simulated actions: ${result.actions.length}`, `Live sends: ${result.liveSends}`, `Production writes: ${result.productionWrites}`, `Stage movements: ${result.stageMovements}`].join('\n') };
    }
    if (intent.intent === 'SHOW_TODAYS_SIMULATED_ACTIVITY') {
      const session = latest(ctx, options);
      return { reply: session ? `Today simulated activity for ${session.sessionId}: ${session.simulatedActionIds.length} action(s). Live sends: 0. Production writes: 0.` : 'No simulated activity in the current session.' };
    }
    return { reply: 'That dry-run outreach command is recognized but not available in this context.' };
  } catch (error) {
    if (error.code === 'ACCESS_DENIED') return { reply: 'Access denied.' };
    return { reply: `Dry-run outreach is blocked: ${escapeMd(error.message)}` };
  }
}

module.exports = { handleKaylaOutreachCommand, canaryPreviewForIntent, formatCanaryPreview };
