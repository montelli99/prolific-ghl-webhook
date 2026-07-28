'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const review = require('./pipeline-review-service');
const ledger = require('../tools/lib/pipeline-shadow-ledger');

const ROOT = path.resolve(__dirname, '..');
const CONTEXT_PATH = path.join(ROOT, 'data', 'pipeline-human-context.jsonl');
function contextPath() { return process.env.PIPELINE_HUMAN_CONTEXT_PATH || CONTEXT_PATH; }

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function hashReviewer(value) { return ledger.hashId(`telegram:${String(value)}`); }

function humanRecommendation(action, currentStage, proposedStage) {
  if (action === 'KEEP_STAGE') return `Keep this lead in ${currentStage} for now.`;
  if (action === 'RECOMMEND_MOVE' && proposedStage) return `Consider moving this lead to ${proposedStage}, after human review.`;
  if (action === 'FOLLOW_UP') return 'Follow up before changing the Pipeline stage.';
  if (action === 'HUMAN_REVIEW') return 'Have a human review this before changing anything.';
  return 'Do not change the Pipeline stage yet.';
}

function humanConfidence(code) {
  if (code === 'CLEAR') return 'The information I found points consistently toward this recommendation, but human verification still depends on the evidence shown.';
  if (code === 'INSUFFICIENT_DATA') return 'I do not have enough supporting activity to make this recommendation with high confidence.';
  if (code === 'CONFLICTING_EVIDENCE') return 'The available evidence points in more than one direction.';
  if (code === 'AMBIGUOUS') return 'The evidence is ambiguous and needs human judgment.';
  return 'The confidence level needs human review.';
}

function humanReason(reason) {
  if (/RUN_BUY_BOX_CHECK/i.test(reason || '')) return 'The available information suggests this lead still needs to be checked against your buying criteria before it moves forward.';
  if (/INSUFFICIENT_DATA/i.test(reason || '')) return 'The record does not contain enough supporting activity to verify a move.';
  return review.sanitizeText(reason || 'No specific reason was recorded.');
}

function humanOutcome(code) {
  if (code === 'STILL_PENDING') return 'The real-world outcome has not been determined yet.';
  if (code === 'MATCH') return 'The later observed outcome matched the recommendation.';
  if (code === 'PLAUSIBLE_DIFFERENCE') return 'The later outcome differed, but the difference may be reasonable.';
  if (code === 'ROUTER_MISS') return 'The later outcome suggests the system may have missed something.';
  if (code === 'POSSIBLE_HUMAN_OVERRIDE') return 'A human may have intentionally handled this differently.';
  if (code === 'UNOBSERVABLE') return 'The outcome could not be safely observed.';
  return 'No outcome is available yet.';
}

function evidenceFound(evidence) {
  const found = [];
  if (Number(evidence.contactNotes || 0) > 0) found.push(`${evidence.contactNotes} contact note${Number(evidence.contactNotes) === 1 ? '' : 's'}`);
  if (Number(evidence.conversationMessages || 0) > 0) found.push(`${evidence.conversationMessages} conversation message${Number(evidence.conversationMessages) === 1 ? '' : 's'}`);
  if (Number(evidence.calls || 0) > 0) found.push(`${evidence.calls} phone call record${Number(evidence.calls) === 1 ? '' : 's'}`);
  if (Number(evidence.transcripts || 0) > 0) found.push(`${evidence.transcripts} transcript${Number(evidence.transcripts) === 1 ? '' : 's'}`);
  if (Number(evidence.dispositions || 0) > 0) found.push(`${evidence.dispositions} call disposition${Number(evidence.dispositions) === 1 ? '' : 's'}`);
  return found;
}

function evidenceMissing(evidence) {
  const names = { contactNotes: 'Contact notes', conversationMessages: 'Conversations', calls: 'Phone calls', transcripts: 'Transcripts', dispositions: 'Dispositions' };
  return Object.entries(names).filter(([key]) => Number(evidence[key] || 0) === 0).map(([, label]) => label);
}

function questionsFor(detail) {
  const missing = evidenceMissing(detail.evidenceCounts || {});
  const questions = [];
  if (missing.includes('Conversations')) questions.push({ code: 'OUTSIDE_CONVERSATION', text: 'Did you speak with this seller outside GHL?' });
  if (missing.includes('Phone calls')) questions.push({ code: 'CALL_OCCURRED', text: 'Was there a phone call that is not reflected in GHL?' });
  if (/Lead Entered|Offer Ready/i.test(detail.currentStage)) questions.push({ code: 'BUY_BOX_CHECKED', text: 'Has this lead been checked against your buying criteria?' });
  if (/Offer/i.test(detail.currentStage)) questions.push({ code: 'OFFER_MADE', text: 'Was an offer made verbally or outside GHL?' });
  return questions.slice(0, 4);
}

function humanVerifiability(detail) {
  const found = evidenceFound(detail.evidenceCounts || {});
  if (found.length >= 2) return { level: 'Moderate', explanation: 'There are multiple supporting evidence types available for review.' };
  if (found.length === 1) return { level: 'Not yet', explanation: 'There is one supporting evidence type, but communication or call context is missing.' };
  return { level: 'No', explanation: 'There is no supporting activity available in the sanitized review view.' };
}

function suggestedAction(detail) {
  const verifiability = humanVerifiability(detail);
  if (verifiability.level === 'Not yet' || verifiability.level === 'No') return 'Need More Information';
  if (detail.currentReviewStatus === 'NEEDS_MORE_DATA') return 'Continue observation until the missing evidence is available.';
  return 'Review the evidence and decide whether you agree with keeping the lead in its current stage.';
}

function briefingForDecision(decisionId) {
  const detail = review.getDecisionDetail(decisionId);
  const history = review.getDecisionHistory(decisionId);
  const found = evidenceFound(detail.evidenceCounts || {});
  const missing = evidenceMissing(detail.evidenceCounts || {});
  const verifiability = humanVerifiability(detail);
  const briefing = {
    headline: `Pipeline Review: ${detail.anonymousRef}`,
    situationSummary: `This lead is currently in ${detail.currentStage}.`,
    recommendation: humanRecommendation(detail.recommendation, detail.currentStage, detail.proposedStage),
    reasoning: [humanReason(detail.reason), humanOutcome(detail.observedOutcome)],
    evidenceFound: found.length ? found : ['No supporting activity is available in the sanitized review view.'],
    evidenceMissing: missing,
    alternativesConsidered: detail.proposedStage ? [`Current stage ${detail.currentStage}`, `Proposed stage ${detail.proposedStage}`] : [`No later-stage move is supported by the current evidence.`],
    questionsForUser: questionsFor(detail),
    suggestedReviewAction: suggestedAction(detail),
    reviewActionExplanation: 'Review buttons record your judgment only. They do not change GHL, move the lead, or message the seller.',
    riskWarnings: detail.proposedStage ? ['Any stage movement remains disabled and requires separate approval.'] : [],
    plainLanguageConfidence: humanConfidence(detail.confidence),
    humanVerifiability: verifiability,
    noActionReason: detail.currentReviewStatus === 'NEEDS_MORE_DATA' ? 'This case has already been reviewed as needing more information. Keep it under observation until missing evidence is available.' : null,
    history,
    detail,
    internalMetadata: { decisionId, recommendationCode: detail.recommendation, confidenceCode: detail.confidence, outcomeCode: detail.observedOutcome, routerVersion: detail.routerVersion, decisionSpecVersion: detail.decisionSpecVersion },
  };
  review.validateNoForbidden(JSON.stringify({ headline: briefing.headline, situationSummary: briefing.situationSummary, recommendation: briefing.recommendation, reasoning: briefing.reasoning, evidenceFound: briefing.evidenceFound, evidenceMissing: briefing.evidenceMissing, questionsForUser: briefing.questionsForUser, suggestedReviewAction: briefing.suggestedReviewAction, humanVerifiability: briefing.humanVerifiability, noActionReason: briefing.noActionReason }));
  return briefing;
}

function renderBriefing(briefing) {
  const lines = [briefing.headline, '', 'What happened', briefing.situationSummary, '', 'My recommendation', briefing.recommendation, '', 'Why', ...briefing.reasoning.map((item) => `- ${item}`), '', 'What I found', ...briefing.evidenceFound.map((item) => `- ${item}`)];
  if (briefing.evidenceMissing.length) lines.push('', 'What I could not verify', ...briefing.evidenceMissing.map((item) => `- ${item}`));
  lines.push('', 'My recommendation confidence', briefing.plainLanguageConfidence, '', 'Can a human independently verify it from the evidence shown?', `${briefing.humanVerifiability.level}. ${briefing.humanVerifiability.explanation}`, '', 'Suggested next step', briefing.suggestedReviewAction, '', briefing.reviewActionExplanation);
  if (briefing.noActionReason) lines.push('', 'Current review status', briefing.noActionReason);
  return lines.join('\n');
}

function renderExplainMore(briefing) {
  const lines = ['Why I think this', '', 'Signals supporting the recommendation:', ...briefing.evidenceFound.map((item) => `- ${item}`), '', 'Signals opposing or limiting the recommendation:', ...(briefing.evidenceMissing.length ? briefing.evidenceMissing.map((item) => `- Missing ${item}`) : ['- No major missing evidence category was identified.']), '', 'Alternatives considered:', ...briefing.alternativesConsidered.map((item) => `- ${item}`), '', `Outcome status: ${humanOutcome(briefing.detail.observedOutcome)}`, '', 'Transition risk', briefing.detail.proposedStage ? 'A stage move would require human review and remains disabled.' : 'No stage move is recommended.'];
  return lines.join('\n');
}

function renderEvidence(briefing) {
  const summary = (briefing.detail.evidenceSummary || []).slice(-3).map(review.sanitizeText);
  const lines = ['Evidence summary', '', 'Evidence available:', ...briefing.evidenceFound.map((item) => `- ${item}`), '', 'Sanitized activity summary:', ...(summary.length ? summary.map((item) => `- ${item}`) : ['- A contact note exists, but its content is not available in the sanitized review view.'])];
  if (briefing.evidenceMissing.length) lines.push('', 'Evidence unavailable:', ...briefing.evidenceMissing.map((item) => `- ${item}`));
  return lines.join('\n');
}

function renderButtonHelp() {
  return ['What the review buttons mean', '', 'Agree: Records that the recommendation appears correct based on the evidence shown. It does not move the lead.', '', 'Need More Information: Records that the available evidence is not enough to judge the recommendation. It does not mean the AI is necessarily wrong.', '', 'Disagree: Records that the recommendation appears incorrect. It does not automatically change the stage.', '', 'Change Recommendation: Records that a different stage or next step should be considered. It does not change GHL.', '', 'Review Later: Keeps the case pending until more evidence or an expected event becomes available.', '', 'Review buttons record your judgment only. They do not make changes in GHL.'].join('\n');
}

function renderTechnicalDetails(briefing) {
  const m = briefing.internalMetadata;
  return ['Technical Details', '', `Anonymous ref: ${briefing.detail.anonymousRef}`, `Recommendation code: ${m.recommendationCode}`, `Confidence code: ${m.confidenceCode}`, `Outcome code: ${m.outcomeCode}`, `Router version: ${m.routerVersion}`, `Decision spec version: ${m.decisionSpecVersion}`, `Evidence counts: ${JSON.stringify(briefing.detail.evidenceCounts)}`].join('\n');
}

function appendHumanContext(input, reviewer) {
  const sanitizedText = review.sanitizeText(input.text || '');
  const detail = review.getDecisionDetail(input.decisionId);
  const record = { contextVersion: 1, contextId: uuid(), decisionRef: detail.anonymousRef, opportunityHash: detail.anonymousRef, reviewerHash: hashReviewer(reviewer.telegramUserId), source: 'TELEGRAM', questionCode: input.questionCode, answerCode: input.answerCode, sanitizedText, createdAt: now(), supersedesContextId: input.supersedesContextId || null, testFixture: Boolean(input.testFixture) };
  review.validateNoForbidden({ decisionRef: record.decisionRef, questionCode: record.questionCode, answerCode: record.answerCode, sanitizedText: record.sanitizedText, source: record.source });
  const filePath = contextPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
  review.appendAudit({ reviewerId: reviewer.telegramUserId, action: 'human_context_appended', decisionId: input.decisionId, result: 'OK', reason: input.questionCode });
  return record;
}

function dailyManagerBriefing(summary) {
  const lines = ['Pipeline Daily Briefing - Test', '', `I reviewed ${summary.decisions} current Pipeline decisions.`, '', `- ${summary.reviewed} has been reviewed.`, `- ${summary.needsMoreData} still need more information.`, `- ${summary.evidenceRich} contain contact-note evidence.`, `- No router misses were detected.`, `- No dangerous recommendations were detected.`, `- No GHL changes were made.`, '', 'My recommendation:', 'Continue observation and review only cases with enough evidence.'];
  const text = lines.join('\n');
  review.validateNoForbidden(text);
  return text;
}

module.exports = { CONTEXT_PATH, contextPath, briefingForDecision, renderBriefing, renderExplainMore, renderEvidence, renderButtonHelp, renderTechnicalDetails, appendHumanContext, dailyManagerBriefing, humanRecommendation, humanConfidence, humanOutcome, humanReason };
