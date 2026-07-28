'use strict';

const crypto = require('crypto');
const service = require('../services/pipeline-review-service');
const briefing = require('../services/pipeline-ai-briefing-service');

const callbackTokens = new Map();
const reviewStates = new Map();
const usedIdempotency = new Set();
const TTL_MS = 15 * 60 * 1000;
const QUEUE_PAGE_SIZE = 5;
const HISTORY_PAGE_SIZE = 5;
const FILTERS = ['All', 'Unreviewed', 'High Priority', 'Proposed Moves', 'Insufficient Data', 'Conflicts', 'Router Misses', 'Human Overrides', 'High Risk', 'Deferred'];

function escapeMd(text) {
  return String(text ?? '').replace(/[_*`\[]/g, '\\$&');
}

function keyboard(rows) {
  return { inline_keyboard: rows.map((row) => row.map((button) => ({ text: button.text, callback_data: button.callback_data || `pl:${button.token || tokenFor(button)}` }))) };
}

function tokenFor(context) {
  const callbackToken = crypto.randomBytes(18).toString('base64url');
  callbackTokens.set(callbackToken, { ...context, token: callbackToken, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, used: false });
  return callbackToken;
}

function consumeToken(token, { telegramUserId, chatId, singleUse = true } = {}) {
  const state = callbackTokens.get(token);
  if (!state) throw new Error('Invalid callback');
  if (Date.now() > state.expiresAt) { callbackTokens.delete(token); throw new Error('Expired callback'); }
  if (state.used) throw new Error('Callback already used');
  if (String(state.telegramUserId) !== String(telegramUserId)) throw new Error('Callback reviewer mismatch');
  if (String(state.chatId) !== String(chatId)) throw new Error('Callback chat mismatch');
  if (state.messageThreadId != null && String(state.messageThreadId) !== String(arguments[1]?.messageThreadId)) throw new Error('Callback topic mismatch');
  if (singleUse) state.used = true;
  return state;
}

function callbackCtx(ctx, context) {
  return { ...context, telegramUserId: ctx.telegramUserId, chatId: ctx.chatId, messageThreadId: ctx.messageThreadId };
}

function startReviewState({ telegramUserId, chatId, messageThreadId, decisionId, action, step = 'confirm' }) {
  const stateId = crypto.randomBytes(16).toString('base64url');
  reviewStates.set(stateId, { stateId, telegramUserId: String(telegramUserId), chatId: String(chatId), messageThreadId, decisionId, action, step, expiresAt: Date.now() + TTL_MS });
  return stateId;
}

function getReviewState(stateId, telegramUserId, chatId, messageThreadId) {
  const state = reviewStates.get(stateId);
  if (!state) throw new Error('Review state not found');
  if (Date.now() > state.expiresAt) { reviewStates.delete(stateId); throw new Error('Review state expired'); }
  if (state.telegramUserId !== String(telegramUserId) || state.chatId !== String(chatId)) throw new Error('Review state binding mismatch');
  if (state.messageThreadId != null && String(state.messageThreadId) !== String(messageThreadId)) throw new Error('Review state topic mismatch');
  return state;
}

function cancelReviewState(stateId) { reviewStates.delete(stateId); }

function authorize(ctx, role = 'reviewer') {
  return service.assertAuthorized(ctx.telegramUserId, role, ctx.env || process.env);
}

function safePayload(text, replyMarkup) {
  service.validateNoForbidden(text);
  return { reply: text.length > 3900 ? `${text.slice(0, 3800)}\n\n_truncated_` : text, replyMarkup };
}

function pipelineMenu(ctx) {
  authorize(ctx);
  service.appendAudit({ reviewerId: ctx.telegramUserId, action: 'pipeline_menu_opened', result: 'OK' });
  return safePayload('*Pipeline*\n\nRead-only shadow review center. No GHL writes are available.', keyboard([
    [{ text: 'Shadow Health', ...callbackCtx(ctx, { action: 'health' }) }, { text: 'Review Queue', ...callbackCtx(ctx, { action: 'queue' }) }],
    [{ text: 'Recent Decisions', ...callbackCtx(ctx, { action: 'recent' }) }, { text: 'Pending Outcomes', ...callbackCtx(ctx, { action: 'outcomes' }) }],
    [{ text: 'Pipeline Coverage', ...callbackCtx(ctx, { action: 'coverage' }) }, { text: 'Data Quality', ...callbackCtx(ctx, { action: 'quality' }) }],
    [{ text: 'Call Intelligence', ...callbackCtx(ctx, { action: 'calls' }) }, { text: 'Readiness', ...callbackCtx(ctx, { action: 'readiness' }) }],
    [{ text: 'Alerts', ...callbackCtx(ctx, { action: 'alerts' }) }, { text: 'Reports', ...callbackCtx(ctx, { action: 'reports' }) }],
    [{ text: 'Help', ...callbackCtx(ctx, { action: 'help' }) }, { text: 'Back', ...callbackCtx(ctx, { action: 'back' }) }],
  ]));
}

function healthView(ctx) {
  authorize(ctx);
  const h = service.getShadowHealth();
  const text = `*Pipeline Shadow Health*\n\nStatus: ${escapeMd(h.status)}\nLast successful cycle: ${escapeMd(h.lastSuccessfulCycleAt || 'none')}\nEvaluated: ${h.opportunitiesEvaluated || 0}\nNew decisions: ${h.decisionsAppended || 0}\nUnchanged: ${h.unchangedSkipped || 0}\nPending outcomes: ${h.pendingOutcomes || 0}\nLedger integrity: ${h.ledgerValid ? 'PASS' : 'FAIL'}\nGHL writes: ${h.ghlWrites || 0}\nAutomatic movement: ${escapeMd(h.automaticStageMovement || 'DISABLED')}`;
  return safePayload(text, keyboard([[{ text: 'Refresh', ...callbackCtx(ctx, { action: 'health' }) }, { text: 'Alerts', ...callbackCtx(ctx, { action: 'alerts' }) }, { text: 'Back', ...callbackCtx(ctx, { action: 'menu' }) }]]));
}

function queueView(ctx, filter = 'All', page = 1) {
  authorize(ctx);
  const safeFilter = FILTERS.includes(filter) ? filter : 'All';
  const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const q = service.getReviewQueue({ filter: safeFilter, page: safePage, pageSize: QUEUE_PAGE_SIZE });
  if (safePage > q.totalPages && q.total > 0) {
    return safePayload('*Pipeline Review Queue*\n\nThis queue page is no longer available. Refresh the queue.', keyboard([[{ text: 'Refresh', ...callbackCtx(ctx, { action: 'queue_page', filter: safeFilter, page: 1, refresh: true }) }, { text: 'Back', ...callbackCtx(ctx, { action: 'menu' }) }]]));
  }
  const lines = [`*Pipeline Review Queue*`, `Filter: ${escapeMd(safeFilter)} | Page ${q.page}/${q.totalPages} | Total ${q.total}`, ''];
  if (!q.items.length) lines.push('No decisions currently match this filter.', '');
  for (const item of q.items) {
    lines.push(`*${escapeMd(item.anonymousRef)}*`);
    lines.push(`Current Stage: ${escapeMd(item.currentStage)}`);
    lines.push(`Recommendation: ${escapeMd(item.recommendation)}`);
    lines.push(`Proposed Stage: ${escapeMd(item.proposedStage || 'none')}`);
    lines.push(`Confidence: ${escapeMd(item.confidence)}`);
    lines.push(`Evidence: Notes ${item.evidence.contactNotes || 0} | Messages ${item.evidence.conversationMessages || 0} | Calls ${item.evidence.calls || 0}`);
    lines.push(`Outcome: ${escapeMd(item.outcome)}`);
    lines.push(`Age: ${item.ageHours}h`);
    lines.push(`Reviewability: ${escapeMd(item.reviewabilityLabel)} - ${escapeMd(item.reviewabilityReason)}`);
    lines.push(`Priority: ${escapeMd(item.priority)}`, '');
  }
  const rows = q.items.map((item) => [{ text: `Open ${item.anonymousRef}`, ...callbackCtx(ctx, { action: 'open', decisionId: item.decisionId, queueFilter: safeFilter, queuePage: q.page, queueSnapshot: q.snapshotHash }) }, { text: 'Accept', ...callbackCtx(ctx, { action: 'accept', decisionId: item.decisionId }) }, { text: 'Needs Data', ...callbackCtx(ctx, { action: 'needs_data', decisionId: item.decisionId }) }]);
  const nav = [];
  if (q.page > 1) nav.push({ text: 'Previous', ...callbackCtx(ctx, { action: 'queue_page', filter: safeFilter, page: q.page - 1, snapshot: q.snapshotHash }) });
  nav.push({ text: 'Refresh', ...callbackCtx(ctx, { action: 'queue_page', filter: safeFilter, page: q.page, snapshot: q.snapshotHash, refresh: true }) });
  if (q.page < q.totalPages) nav.push({ text: 'Next', ...callbackCtx(ctx, { action: 'queue_page', filter: safeFilter, page: q.page + 1, snapshot: q.snapshotHash }) });
  if (nav.length) rows.push(nav);
  rows.push([{ text: 'Change Filter', ...callbackCtx(ctx, { action: 'filters' }) }, { text: 'Back', ...callbackCtx(ctx, { action: 'menu' }) }]);
  return safePayload(lines.join('\n'), keyboard(rows));
}

function filtersView(ctx) {
  authorize(ctx);
  const rows = [];
  for (let i = 0; i < FILTERS.length; i += 2) rows.push(FILTERS.slice(i, i + 2).map((filter) => ({ text: filter, ...callbackCtx(ctx, { action: 'queue_page', filter, page: 1 }) })));
  rows.push([{ text: 'Back', ...callbackCtx(ctx, { action: 'queue' }) }]);
  return safePayload('*Review Queue Filters*\n\nChoose a supported filter.', keyboard(rows));
}

function decisionDetailView(ctx, decisionId) {
  authorize(ctx);
  const b = briefing.briefingForDecision(decisionId);
  service.appendAudit({ reviewerId: ctx.telegramUserId, action: 'decision_opened', decisionId, result: 'OK' });
  return safePayload(briefing.renderBriefing(b), keyboard([[{ text: 'Explain More', ...callbackCtx(ctx, { action: 'explain_more', decisionId }) }, { text: 'Show Evidence', ...callbackCtx(ctx, { action: 'show_evidence', decisionId }) }], [{ text: 'Decision History', ...callbackCtx(ctx, { action: 'history', decisionId, page: 1 }) }, { text: 'Technical Details', ...callbackCtx(ctx, { action: 'technical_details', decisionId }) }], [{ text: 'What Do These Mean?', ...callbackCtx(ctx, { action: 'button_help', decisionId }) }, { text: 'Add Context', ...callbackCtx(ctx, { action: 'add_context', decisionId }) }], [{ text: 'Agree', ...callbackCtx(ctx, { action: 'accept', decisionId }) }, { text: 'Need More Information', ...callbackCtx(ctx, { action: 'needs_data', decisionId }) }], [{ text: 'Disagree', ...callbackCtx(ctx, { action: 'reject', decisionId }) }, { text: 'Change Recommendation', ...callbackCtx(ctx, { action: 'modify', decisionId }) }, { text: 'Review Later', ...callbackCtx(ctx, { action: 'defer', decisionId }) }], [{ text: 'Back to Queue', ...callbackCtx(ctx, { action: 'queue' }) }]]));
}

function explainMoreView(ctx, decisionId) { authorize(ctx); return safePayload(briefing.renderExplainMore(briefing.briefingForDecision(decisionId)), keyboard([[{ text: 'Back to Briefing', ...callbackCtx(ctx, { action: 'open', decisionId }) }, { text: 'Show Evidence', ...callbackCtx(ctx, { action: 'show_evidence', decisionId }) }]])); }
function showEvidenceView(ctx, decisionId) { authorize(ctx); return safePayload(briefing.renderEvidence(briefing.briefingForDecision(decisionId)), keyboard([[{ text: 'Back to Briefing', ...callbackCtx(ctx, { action: 'open', decisionId }) }, { text: 'Technical Details', ...callbackCtx(ctx, { action: 'technical_details', decisionId }) }]])); }
function technicalDetailsView(ctx, decisionId) { authorize(ctx); return safePayload(briefing.renderTechnicalDetails(briefing.briefingForDecision(decisionId)), keyboard([[{ text: 'Back to Briefing', ...callbackCtx(ctx, { action: 'open', decisionId }) }]])); }
function buttonHelpView(ctx, decisionId) { authorize(ctx); return safePayload(briefing.renderButtonHelp(), keyboard([[{ text: 'Back to Briefing', ...callbackCtx(ctx, { action: 'open', decisionId }) }]])); }
function addContextView(ctx, decisionId) {
  authorize(ctx);
  const b = briefing.briefingForDecision(decisionId);
  const primaryQuestion = b.questionsForUser[0] || { code: 'GENERAL', text: 'Do you have verified context that is not shown here?' };
  const questions = b.questionsForUser.map((q) => `- ${escapeMd(q.text)}`).join('\n') || '- No targeted questions are available for this case.';
  return safePayload(`*Add Context*\n\nAnswer only if you have real case context. Human-supplied context stays local, append-only, and does not change GHL.\n\nQuestions:\n${questions}`, keyboard([
    [{ text: 'Yes', ...callbackCtx(ctx, { action: 'context_answer', decisionId, questionCode: primaryQuestion.code, answerCode: 'YES', contextText: 'Reviewer answered yes to the guided context question.' }) }, { text: 'No', ...callbackCtx(ctx, { action: 'context_answer', decisionId, questionCode: primaryQuestion.code, answerCode: 'NO', contextText: 'Reviewer answered no to the guided context question.' }) }, { text: 'Not Sure', ...callbackCtx(ctx, { action: 'context_answer', decisionId, questionCode: primaryQuestion.code, answerCode: 'NOT_SURE', contextText: 'Reviewer is not sure.' }) }],
    [{ text: 'Add Context', ...callbackCtx(ctx, { action: 'custom_context', decisionId }) }, { text: 'Skip', ...callbackCtx(ctx, { action: 'open', decisionId }) }, { text: 'Back', ...callbackCtx(ctx, { action: 'open', decisionId }) }],
    [{ text: 'Cancel', ...callbackCtx(ctx, { action: 'open', decisionId }) }],
  ]));
}
function customContextView(ctx, decisionId) { authorize(ctx); return safePayload('*Add Context*\n\nFree-form production context is not captured by button tap alone. Provide real case context through the approved operator workflow, then save exactly one sanitized local context record. No GHL change was made.', keyboard([[{ text: 'Back', ...callbackCtx(ctx, { action: 'add_context', decisionId }) }, { text: 'Cancel', ...callbackCtx(ctx, { action: 'open', decisionId }) }]])); }
function contextAnswerView(ctx, state) {
  const auth = authorize(ctx);
  briefing.appendHumanContext({ decisionId: state.decisionId, questionCode: state.questionCode || 'GENERAL', answerCode: state.answerCode || 'OTHER', text: state.contextText || state.text || '' }, { telegramUserId: ctx.telegramUserId, alias: auth.reviewerRef });
  const regenerated = briefing.renderBriefing(briefing.briefingForDecision(state.decisionId));
  return safePayload(`Context saved locally. I did not change GHL, move the lead, or update the router decision.\n\n${regenerated}`, keyboard([[{ text: 'Back to Briefing', ...callbackCtx(ctx, { action: 'open', decisionId: state.decisionId }) }, { text: 'Show Evidence', ...callbackCtx(ctx, { action: 'show_evidence', decisionId: state.decisionId }) }]]));
}

function decisionHistoryView(ctx, decisionId, page = 1) {
  authorize(ctx);
  const history = service.getDecisionHistory(decisionId);
  const safePage = Math.max(1, Number(page || 1));
  const totalPages = Math.max(1, Math.ceil(history.entries.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(safePage, totalPages);
  const lines = ['*Decision History*', `Anonymous Ref: ${escapeMd(history.anonymousRef)}`, `Page ${currentPage}/${totalPages}`, ''];
  const entries = history.entries.slice((currentPage - 1) * HISTORY_PAGE_SIZE, currentPage * HISTORY_PAGE_SIZE);
  if (!entries.length) lines.push('No history entries are available.');
  entries.forEach((entry, index) => {
    lines.push(`${(currentPage - 1) * HISTORY_PAGE_SIZE + index + 1}. ${escapeMd(entry.timestamp)}`);
    if (entry.type === 'DECISION') lines.push(`   DECISION: ${escapeMd(entry.action)}`, `   Stage: ${escapeMd(entry.stage)}`, `   Confidence: ${escapeMd(entry.confidence)}`);
    else if (entry.type === 'OUTCOME') lines.push(`   OUTCOME: ${escapeMd(entry.outcome)}`);
    else if (entry.type === 'AUDIT') lines.push(`   AUDIT: ${escapeMd(entry.action)}`, `   Result: ${escapeMd(entry.result)}`);
    else if (entry.type === 'HUMAN_REVIEW' || entry.type === 'REVIEW_CORRECTION') lines.push(`   ${escapeMd(entry.type)}: ${escapeMd(entry.reviewStatus)}`, `   Reason: ${escapeMd(entry.reasonCode || 'none')}`, `   Reviewer: ${escapeMd(entry.reviewer || 'Reviewer')}`, `   Status: ${escapeMd(entry.status || 'Current')}`);
    else lines.push(`   INTEGRITY WARNING: ${escapeMd(entry.text || 'sanitized warning')}`);
    lines.push('');
  });
  const nav = [];
  if (currentPage > 1) nav.push({ text: 'Previous', ...callbackCtx(ctx, { action: 'history', decisionId, page: currentPage - 1 }) });
  nav.push({ text: 'Latest', ...callbackCtx(ctx, { action: 'history', decisionId, page: totalPages }) });
  if (currentPage < totalPages) nav.push({ text: 'Next', ...callbackCtx(ctx, { action: 'history', decisionId, page: currentPage + 1 }) });
  return safePayload(lines.join('\n'), keyboard([nav, [{ text: 'Back to Decision', ...callbackCtx(ctx, { action: 'open', decisionId }) }, { text: 'Back to Queue', ...callbackCtx(ctx, { action: 'queue' }) }]]));
}

function appendAnnotationFromAction(ctx, decisionId, reviewStatus, reasonCode = null, notes = '') {
  const auth = authorize(ctx);
  const idempotencyKey = crypto.createHash('sha256').update(JSON.stringify({ reviewer: ctx.telegramUserId, decisionId, reviewStatus, reasonCode, notes })).digest('hex');
  if (usedIdempotency.has(idempotencyKey)) return safePayload('Duplicate review callback suppressed. Annotation was not duplicated.');
  const result = service.appendReviewAnnotation({ decisionId, reviewStatus, reasonCode, notes, idempotencyKey }, { telegramUserId: ctx.telegramUserId, alias: auth.reviewerRef });
  usedIdempotency.add(idempotencyKey);
  return safePayload(`${result.duplicate ? 'Existing annotation reused' : 'Annotation appended'}: ${escapeMd(result.annotation.reviewStatus)}\nNo GHL action was executed.`);
}

function pendingOutcomesView(ctx) {
  authorize(ctx);
  const out = service.getPendingOutcomes();
  const lines = ['*Pending Outcomes*', `Total: ${out.total}`, ''];
  for (const item of out.items.slice(0, 5)) lines.push(`${escapeMd(item.anonymousRef)} | ${escapeMd(item.originalStage)} | ${escapeMd(item.recommendation)} | ${item.ageHours}h | ${escapeMd(item.outcome)}`);
  return safePayload(lines.join('\n'));
}

function coverageView(ctx) {
  authorize(ctx);
  const rows = service.getCoverageSummary();
  const lines = ['*Pipeline Coverage*', 'Synthetic != live shadow coverage.', ''];
  for (const row of rows) lines.push(`${escapeMd(row.stage)}: synthetic yes | live ${row.liveDecisions} | evidence-rich ${row.evidenceRichLiveDecisions} | reviewed ${row.reviewedDecisions} | outcomes ${row.observedOutcomes}`);
  return safePayload(lines.join('\n'));
}

function dataQualityView(ctx) { authorize(ctx); const q = service.getDataQualitySummary(); return safePayload(`*Data Quality*\n\nNo notes: ${q.noNotes}\nNo conversations: ${q.noConversations}\nNo calls: ${q.noCalls}\nNo transcripts: ${q.noTranscripts}\nNo dispositions: ${q.noDispositions}\nMissing timestamps: ${q.missingTimestamps}\nBottlenecks: ${escapeMd(q.probableBottlenecks.join(', '))}`); }
function callIntelligenceView(ctx) { authorize(ctx); const c = service.getCallIntelligenceSummary(); return safePayload(`*Call Intelligence*\n\nCalls observed: ${c.callsObserved}\nLC_PHONE_TWILIO: ${c.sources.LC_PHONE_TWILIO}\nJUSTCALL: ${c.sources.JUSTCALL}\nOTHER: ${c.sources.OTHER}\nUNKNOWN: ${c.sources.UNKNOWN}\nTranscript available: ${c.transcriptAvailable}\nDisposition available: ${c.dispositionAvailable}\nDecisions influenced by calls: ${c.decisionsInfluencedByCallEvidence}`); }
function readinessView(ctx) { authorize(ctx); const r = service.getReadinessSummary(); const lines = ['*Pipeline Readiness*', '', `Overall status: ${escapeMd(r.overallStatus)}`, 'Readiness does not authorize automation.', '']; for (const t of r.transitions.slice(0, 10)) lines.push(`${escapeMd(t.transitionKey)} | ${t.risk} | ${t.classification} | live ${t.distinctOpportunities} | reviewed ${t.reviewedDecisions} | outcomes ${t.observedOutcomes}`); return safePayload(lines.join('\n')); }
function alertsView(ctx) { authorize(ctx, 'admin'); const alerts = service.getAlerts(); const lines = ['*Pipeline Alerts*', `Active: ${alerts.length}`, '']; for (const a of alerts) lines.push(`${escapeMd(a.type)} | ${escapeMd(a.reason || 'none')}`); return safePayload(lines.join('\n') || 'No alerts.'); }
function reportsView(ctx) { authorize(ctx); const reports = service.getAvailableReports(); return safePayload(`*Pipeline Reports*\n\n${reports.map((r) => `- ${escapeMd(r.name)} (${r.type})`).join('\n') || 'No reports found.'}`); }
function helpView(ctx) { authorize(ctx); return safePayload('*Pipeline Help*\n\nUse the buttons to review read-only shadow decisions. Accept means reviewer agreement only; it never executes a stage move.'); }

function handlePipelineCommand(ctx, args = '') {
  try {
    if (!args || args === 'menu') return pipelineMenu(ctx);
    const [sub, value, pageValue] = args.split(/\s+/, 3);
    if (sub === 'health') return healthView(ctx);
    if (sub === 'queue') return queueView(ctx, value || 'All', pageValue || 1);
    if (sub === 'recent') return queueView(ctx, 'All');
    if (sub === 'open') return decisionDetailView(ctx, value);
    if (sub === 'history') return decisionHistoryView(ctx, value, pageValue || 1);
    if (sub === 'outcomes') return pendingOutcomesView(ctx);
    if (sub === 'coverage') return coverageView(ctx);
    if (sub === 'quality') return dataQualityView(ctx);
    if (sub === 'calls') return callIntelligenceView(ctx);
    if (sub === 'readiness') return readinessView(ctx);
    if (sub === 'alerts') return alertsView(ctx);
    if (sub === 'reports') return reportsView(ctx);
    if (sub === 'filters') return filtersView(ctx);
    return helpView(ctx);
  } catch (error) {
    if (error.code === 'ACCESS_DENIED') return { reply: 'Access denied.' };
    service.appendAudit({ reviewerId: ctx.telegramUserId, action: 'pipeline_command_failed', result: 'ERROR', reason: error.message });
    return { reply: 'Pipeline review is unavailable. Check local health logs.' };
  }
}

module.exports = { handlePipelineCommand, pipelineMenu, healthView, queueView, filtersView, decisionDetailView, explainMoreView, showEvidenceView, technicalDetailsView, buttonHelpView, addContextView, customContextView, contextAnswerView, decisionHistoryView, appendAnnotationFromAction, pendingOutcomesView, coverageView, dataQualityView, callIntelligenceView, readinessView, alertsView, reportsView, helpView, tokenFor, consumeToken, startReviewState, getReviewState, cancelReviewState, escapeMd, callbackTokens, reviewStates, FILTERS, QUEUE_PAGE_SIZE, HISTORY_PAGE_SIZE };
