'use strict';

const dry = require('./telegram-outreach-dry-run');
const { loadAtlasDryRunOpportunities } = require('./kayla-production-data-loader');

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

module.exports = { handleKaylaOutreachCommand };
