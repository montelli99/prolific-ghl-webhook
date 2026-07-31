'use strict';

const fs = require('fs');
const path = require('path');
const dry = require('./telegram-outreach-dry-run');
const { loadAtlasDryRunOpportunities } = require('./kayla-production-data-loader');
const ghlGuards = require('./atlas-ghl-telegram-live-guards');
const stage1 = require('./kayla-stage1-transaction');
const { CONTACT_PATHS } = require('./kayla-stage1-contact-path');

function stage1Dir(options = {}) { return options.stage1DataDir || path.resolve(__dirname, '..', 'data', 'kayla-stage1'); }
function stage1File(ctx = {}, options = {}) { return path.join(stage1Dir(options), `${ctx.chatId || ctx.sourceTopicId || 'default'}-${ctx.telegramUserId || 'operator'}.json`); }
function readStage1Session(ctx, options = {}) { try { return JSON.parse(fs.readFileSync(stage1File(ctx, options), 'utf8')); } catch (_) { return null; } }
function saveStage1Session(ctx, session, options = {}) { fs.mkdirSync(stage1Dir(options), { recursive: true }); fs.writeFileSync(stage1File(ctx, options), `${JSON.stringify(session, null, 2)}\n`); }

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
    lines.push(`Role evidence: ${guard.roleEvidence?.level || 'UNKNOWN'} | ${guard.roleEvidence?.reasons?.join('; ') || 'no source-backed role evidence'}`);
    lines.push(`Kayla course step: ${item.nextRequiredAction || 'INT before call'} | Rule: INT_BEFORE_CALL`);
    lines.push(`Source: ${guard.scriptSelection?.sourceFile || item.kaylaRule} ${guard.scriptSelection?.sourceLines || ''}`);
    lines.push(`Shortcut: ${item.shortcutName || 'INT'} | Audience: ${(guard.scriptSelection?.shortcutName && guard.roleEvidence?.role) || item.contactRole.role}`);
    lines.push(`Message: ${item.renderedPreview || '(manual action; no SMS preview)'}`);
    lines.push(`Sender: ${item.senderNumber}`);
    lines.push(`Property timezone: ${guard.timezoneDerivation?.timeZone || 'unknown'} | ${guard.timezoneDerivation?.currentWeekday || 'unknown'} ${guard.timezoneDerivation?.currentLocalTime || 'unknown'} | ${guard.timezoneDerivation?.confidence || 'UNKNOWN'}`);
    lines.push(`GHL guard: ${guard.passed ? 'PASSED' : 'BLOCKED'}${guard.blockedReasons?.length ? ` (${guard.blockedReasons.join(', ')})` : ''}`);
    lines.push(`Course eligibility: ${guard.kaylaEligibilityStatus?.passed ? 'passed' : 'blocked'} | Script: ${guard.scriptSelection?.courseClassification || 'COURSE_MISSING'}`);
    lines.push(`Technical safety: max 3, distinct contact/property, real IDs, property-local time window`);
    lines.push(`Compliance: DNC ${guard.dncStatus?.passed ? 'clear' : 'blocked'} | opt-out ${guard.optOutStatus?.passed ? 'clear' : 'blocked'} | wrong-number ${guard.wrongNumberStatus?.passed ? 'clear' : 'blocked'}`);
    lines.push(`Operational holds: pending-reply ${guard.pendingReplyStatus?.passed ? 'clear' : 'blocked'} | human-work ${guard.activeHumanWorkStatus?.passed ? 'clear' : 'blocked'}`);
    lines.push(`Workflow isolation: ${guard.workflowIsolationStatus?.status || 'WEBHOOK_ISOLATION_PENDING'}`);
    lines.push(`Stage movement: ${ghlGuards.STAGE_MOVEMENT_PENDING}`);
    lines.push(guard.conflictDisclosure || 'Sending this SMS does not establish that the opportunity has satisfied Kayla\'s Contact Made definition. No automatic stage movement will occur.');
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

function parseStage1Intent(text) {
  const t = String(text || '').toLowerCase();
  if (/show.*stage 1.*leads|stage 1 work/.test(t)) return { intent: 'SHOW_STAGE_1_WORK' };
  if (/start.*(first lead|stage 1|lead)/.test(t)) return { intent: 'START_STAGE_1_REVIEW' };
  if (/who.*contact|contact paths/.test(t)) return { intent: 'SHOW_CONTACT_PATHS' };
  if (/listing agent|this is the agent/.test(t)) return { intent: 'SELECT_CONTACT_PATH', path: CONTACT_PATHS.LISTING_AGENT };
  if (/direct seller|this is.*seller|seller path/.test(t)) return { intent: 'SELECT_CONTACT_PATH', path: CONTACT_PATHS.DIRECT_SELLER };
  if (/research.*contact|need to research|who the contact is/.test(t)) return { intent: 'MARK_RESEARCH_REQUIRED' };
  if (/show.*int|int shortcut/.test(t)) return { intent: 'SHOW_INT' };
  if (/sent.*int|int sent/.test(t)) return { intent: 'CONFIRM_INT_SENT' };
  if (/show.*agent.*script/.test(t)) return { intent: 'SHOW_CALL_SCRIPT', action: stage1.ACTIONS.SHOW_AGENT_SCRIPT };
  if (/show.*seller.*script/.test(t)) return { intent: 'SHOW_CALL_SCRIPT', action: stage1.ACTIONS.SHOW_SELLER_SCRIPT };
  if (/call script/.test(t)) return { intent: 'SHOW_CALL_SCRIPT' };
  if (/start.*call|calling now/.test(t)) return { intent: 'START_CALL_ATTEMPT' };
  if (/no answer|did not answer|didn't answer/.test(t)) return { intent: 'RECORD_CALL_NO_ANSWER' };
  if (/they answered|call completed|answered/.test(t)) return { intent: 'RECORD_CALL_COMPLETED' };
  if (/what.*ask|show.*questions|required questions/.test(t)) return { intent: 'SHOW_REQUIRED_QUESTIONS' };
  if (/roof|hvac|rent|lease|utilities|occupied|vacant/.test(t)) return { intent: 'RECORD_CALL_ANSWERS', answers: parseAnswers(text) };
  if (/voice memo/.test(t) && /show/.test(t)) return { intent: 'SHOW_NO_ANSWER_SEQUENCE', action: stage1.ACTIONS.SHOW_VOICE_MEMO };
  if (/noa/.test(t) && /show/.test(t)) return { intent: 'SHOW_NO_ANSWER_SEQUENCE', action: stage1.ACTIONS.SHOW_NOA };
  if (/sent.*voice memo.*noa|sent.*noa.*voice memo/.test(t)) return { intent: 'CONFIRM_VOICE_MEMO_AND_NOA' };
  if (/sent.*voice memo/.test(t)) return { intent: 'CONFIRM_VOICE_MEMO_SENT' };
  if (/sent.*noa/.test(t)) return { intent: 'CONFIRM_NOA_SENT' };
  if (/show.*ccc/.test(t)) return { intent: 'SHOW_CCC' };
  if (/sent.*ccc.*contact card|sent.*contact card.*ccc/.test(t)) return { intent: 'CONFIRM_CCC_AND_CONTACT_CARD' };
  if (/sent.*ccc/.test(t)) return { intent: 'CONFIRM_CCC_SENT' };
  if (/sent.*contact card/.test(t)) return { intent: 'CONFIRM_CONTACT_CARD_SENT' };
  if (/show.*notes|show.*note/.test(t)) return { intent: 'SHOW_STAGE_1_NOTE' };
  if (/entered.*notes|notes recorded|recorded.*notes/.test(t)) return { intent: 'CONFIRM_NOTES_RECORDED' };
  if (/what.*next|next course step/.test(t)) return { intent: 'SHOW_NEXT_COURSE_STEP' };
  if (/stage.*conflict|contact made/.test(t)) return { intent: 'SHOW_STAGE_DECISION_CONFLICT' };
  if (/cancel.*stage 1/.test(t)) return { intent: 'CANCEL_STAGE_1_SESSION' };
  return null;
}

function parseAnswers(text) {
  const value = String(text || '');
  const answers = { operatorNotes: value };
  const roof = value.match(/roof\s*(?:is|:)?\s*(unknown|not provided|new|\d+\s*(?:years?|yrs?)?(?:\s*old)?)/i);
  const hvac = value.match(/hvac\s*(?:is|:)?\s*(unknown|not provided|new|\d+\s*(?:years?|yrs?)?(?:\s*old)?)/i);
  const phone = value.match(/\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/);
  const rent = value.match(/rent\D+\$?([0-9,]+)/i);
  if (roof) answers.roofAge = roof[1];
  if (hvac) answers.hvacAge = hvac[1];
  if (/roof\D+(unknown|not provided)/i.test(value)) answers.fieldDispositions = { ...(answers.fieldDispositions || {}), roofAge: stage1.FIELD_DISPOSITIONS.UNKNOWN_NOT_PROVIDED };
  if (/hvac\D+(unknown|not provided)/i.test(value)) answers.fieldDispositions = { ...(answers.fieldDispositions || {}), hvacAge: stage1.FIELD_DISPOSITIONS.UNKNOWN_NOT_PROVIDED };
  if (phone) answers.contactPhone = phone[0];
  if (rent) answers.monthlyRent = rent[1];
  if (/occupied/i.test(value)) answers.occupancy = 'occupied';
  if (/vacant/i.test(value)) answers.occupancy = 'vacant';
  if (/utilities.*on/i.test(value)) answers.utilityResponsibility = 'utilities on';
  if (/lease/i.test(value)) answers.leaseTerms = value;
  if (/email/i.test(value)) answers.contactEmail = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || answers.contactEmail;
  const name = value.match(/(?:contact|seller|agent) name\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/i);
  if (name) answers.contactName = name[1];
  if (/other propert/i.test(value)) answers.otherProperties = value;
  return answers;
}

function formatBlocked(session, availability) {
  return formatStage1(session, `Blocked: ${availability.blockingReason}`);
}

function scriptActionForSession(session, intent) {
  if (intent.action) return intent.action;
  if ([CONTACT_PATHS.LISTING_AGENT, CONTACT_PATHS.BROKER].includes(session.selectedContactPath)) return stage1.ACTIONS.SHOW_AGENT_SCRIPT;
  return stage1.ACTIONS.SHOW_SELLER_SCRIPT;
}

function firstStage1Opportunity(options = {}) {
  return (options.stage1Opportunities || options.opportunities || [])[0] || { opportunityId: 'stage1DemoOpp123', contactId: 'stage1DemoContact123', propertyAddress: '123 Main St Dallas TX 75201', stageName: 'Lead Entered' };
}

function formatStage1(session, detail = '') {
  const missing = session.unresolvedRequirements.filter(item => item !== stage1.STAGE_MOVEMENT_STATUS).join(', ') || 'none';
  return [
    '*Kayla Stage 1 Operator Console*',
    `Property: ${escapeMd(session.property.address || '(missing)')}`,
    `Contact path: ${session.selectedContactPath || 'RESEARCH_REQUIRED'}`,
    `Current state: ${session.state}`,
    `Instruction: ${escapeMd(session.nextExactCourseStep)}`,
    detail,
    `Missing actions: ${escapeMd(missing)}`,
    `Stage decision: ${stage1.STAGE_MOVEMENT_STATUS}`,
    'Production sends: 0 | Calls: 0 | GHL writes: 0 | Stage movements: 0',
  ].filter(Boolean).join('\n');
}

function handleStage1Command(ctx, text, options = {}) {
  const intent = parseStage1Intent(text);
  if (!intent) return null;
  let session = readStage1Session(ctx, options);
  if (intent.intent === 'SHOW_STAGE_1_WORK') return { reply: 'Stage 1 work: Lead review, contact-path selection, INT, calls, questions, CCC/contact card or no-answer sequence, notes. Production sends/calls/writes/stage movements: 0.' };
  if (intent.intent === 'START_STAGE_1_REVIEW' || !session) {
    session = stage1.createStage1Session(firstStage1Opportunity(options), { operatorId: ctx.telegramUserId });
    stage1.addEvent(session, 'LEAD_REVIEWED', {}, { operatorId: ctx.telegramUserId });
    saveStage1Session(ctx, session, options);
    return { reply: formatStage1(session) };
  }
  if (intent.intent === 'SHOW_CONTACT_PATHS') return { reply: formatStage1(session, `Available paths: ${session.availableContactPaths.join(', ')}`) };
  if (intent.intent === 'SELECT_CONTACT_PATH') stage1.addEvent(session, 'CONTACT_PATH_SELECTED', { path: intent.path }, { operatorId: ctx.telegramUserId });
  else if (intent.intent === 'MARK_RESEARCH_REQUIRED') { session.selectedContactPath = null; session.state = 'CONTACT_PATH_REQUIRED'; session.nextExactCourseStep = 'Contact path is not established for this property. Review the lead source and listing information to identify whether Kayla agent or seller procedure applies.'; }
  else if (intent.intent === 'SHOW_INT') {
    const availability = stage1.evaluateActionAvailability(session, stage1.ACTIONS.SHOW_INT);
    return { reply: availability.available ? formatStage1(session, stage1.currentScript({ ...session, state: 'INT_REQUIRED' }, options).body) : formatBlocked(session, availability) };
  }
  else if (intent.intent === 'CONFIRM_INT_SENT') stage1.addEvent(session, 'INT_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId });
  else if (intent.intent === 'SHOW_CALL_SCRIPT') {
    const action = scriptActionForSession(session, intent);
    const availability = stage1.evaluateActionAvailability(session, action);
    return { reply: availability.available ? formatStage1(session, stage1.currentScript(session, options).body) : formatBlocked(session, availability) };
  }
  else if (intent.intent === 'START_CALL_ATTEMPT') stage1.addEvent(session, 'CALL_ATTEMPT_STARTED', {}, { operatorId: ctx.telegramUserId });
  else if (intent.intent === 'RECORD_CALL_NO_ANSWER') stage1.addEvent(session, 'CALL_NO_ANSWER_RECORDED', {}, { operatorId: ctx.telegramUserId });
  else if (intent.intent === 'RECORD_CALL_COMPLETED') stage1.addEvent(session, 'CALL_COMPLETED_RECORDED', {}, { operatorId: ctx.telegramUserId });
  else if (intent.intent === 'SHOW_REQUIRED_QUESTIONS') return { reply: formatStage1(session, session.requiredQuestions.map(q => `- ${q.question}`).join('\n')) };
  else if (intent.intent === 'RECORD_CALL_ANSWERS') stage1.addEvent(session, 'CALL_INFORMATION_RECORDED', { answers: intent.answers }, { operatorId: ctx.telegramUserId });
  else if (intent.intent === 'SHOW_NO_ANSWER_SEQUENCE') {
    const availability = stage1.evaluateActionAvailability(session, intent.action || stage1.ACTIONS.SHOW_NOA);
    return { reply: availability.available ? formatStage1(session, stage1.currentScript({ ...session, state: 'VOICE_MEMO_REQUIRED' }, options).body + '\n\nNOA: ' + stage1.currentScript({ ...session, state: 'NOA_REQUIRED' }, options).body) : formatBlocked(session, availability) };
  }
  else if (intent.intent === 'CONFIRM_VOICE_MEMO_AND_NOA') { stage1.addEvent(session, 'VOICE_MEMO_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId }); stage1.addEvent(session, 'NOA_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId }); }
  else if (intent.intent === 'CONFIRM_VOICE_MEMO_SENT') stage1.addEvent(session, 'VOICE_MEMO_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId });
  else if (intent.intent === 'CONFIRM_NOA_SENT') stage1.addEvent(session, 'NOA_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId });
  else if (intent.intent === 'SHOW_CCC') {
    const availability = stage1.evaluateActionAvailability(session, stage1.ACTIONS.SHOW_CCC);
    return { reply: availability.available ? formatStage1(session, stage1.currentScript({ ...session, state: 'CCC_REQUIRED' }, options).body) : formatBlocked(session, availability) };
  }
  else if (intent.intent === 'CONFIRM_CCC_AND_CONTACT_CARD') {
    const availability = stage1.evaluateActionAvailability(session, stage1.ACTIONS.SHOW_CCC);
    if (!availability.available) return { reply: formatBlocked(session, availability) };
    stage1.addEvent(session, 'CCC_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId }); stage1.addEvent(session, 'CONTACT_CARD_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId });
  }
  else if (intent.intent === 'CONFIRM_CCC_SENT') {
    const availability = stage1.evaluateActionAvailability(session, stage1.ACTIONS.SHOW_CCC);
    if (!availability.available) return { reply: formatBlocked(session, availability) };
    stage1.addEvent(session, 'CCC_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId });
  }
  else if (intent.intent === 'CONFIRM_CONTACT_CARD_SENT') {
    const availability = stage1.evaluateActionAvailability(session, stage1.ACTIONS.SHOW_CONTACT_CARD);
    if (!availability.available) return { reply: formatBlocked(session, availability) };
    stage1.addEvent(session, 'CONTACT_CARD_CONFIRMED_SENT', {}, { operatorId: ctx.telegramUserId });
  }
  else if (intent.intent === 'SHOW_STAGE_1_NOTE') return { reply: '```\n' + stage1.buildStage1Note(session) + '\n```' };
  else if (intent.intent === 'CONFIRM_NOTES_RECORDED') {
    const availability = stage1.evaluateActionAvailability(session, stage1.ACTIONS.MARK_OPERATOR_WORK_COMPLETE);
    if (!availability.available) return { reply: formatBlocked(session, availability) };
    stage1.addEvent(session, 'NOTES_CONFIRMED_RECORDED', {}, { operatorId: ctx.telegramUserId });
  }
  else if (intent.intent === 'SHOW_NEXT_COURSE_STEP') return { reply: formatStage1(session) };
  else if (intent.intent === 'SHOW_STAGE_DECISION_CONFLICT') return { reply: 'Kayla available course documents conflict on the exact event that moves this lead to Contact Made. Your Stage 1 actions can be recorded, but no automatic stage movement will occur until the authoritative rule is confirmed.' };
  else if (intent.intent === 'CANCEL_STAGE_1_SESSION') stage1.addEvent(session, 'SESSION_CANCELED', {}, { operatorId: ctx.telegramUserId });
  saveStage1Session(ctx, session, options);
  return { reply: formatStage1(session, session.lastBlockedReason ? `Blocked: ${session.lastBlockedReason}` : '') };
}

function handleKaylaOutreachCommand(ctx, text, options = {}) {
  try {
    const stage1Result = handleStage1Command(ctx, text, options);
    if (stage1Result) return stage1Result;
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

module.exports = { handleKaylaOutreachCommand, canaryPreviewForIntent, formatCanaryPreview, parseStage1Intent, handleStage1Command };
