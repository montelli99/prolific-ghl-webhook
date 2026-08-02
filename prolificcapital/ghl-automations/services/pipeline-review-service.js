'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ledger = require('../tools/lib/pipeline-shadow-ledger');
const readiness = require('../tools/pipeline-readiness-evaluator');
const reasonConfig = require('../config/pipeline-review-reason-codes.json');
const authoritativeRead = require('./ghl-authoritative-pipeline-read-service');

const ROOT = path.resolve(__dirname, '..');
const HEALTH_PATH = path.join(ROOT, 'data', 'runtime', 'pipeline-shadow-health.json');
const ALERT_DIR = path.join(ROOT, 'data', 'runtime', 'alerts');
const AUDIT_PATH = path.join(ROOT, 'data', 'pipeline-review-audit.jsonl');
const REPORT_DIR = path.join(ROOT, 'reports', 'pipeline-shadow');
const EXPORT_DIR = path.join(ROOT, 'data', 'runtime', 'exports');
const NOTIFICATION_STATE_PATH = path.join(ROOT, 'data', 'runtime', 'pipeline-telegram-notification-state.json');

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function hashTelegramId(value) { return ledger.hashId(`telegram:${String(value)}`); }
function shortHash(value) { return hashTelegramId(value).slice(0, 12); }

function parseIdList(value) {
  return new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean));
}

function getReviewerRole(userId, env = process.env) {
  const id = String(userId || '');
  if (!id) return null;
  if (parseIdList(env.PIPELINE_TELEGRAM_ADMIN_IDS).has(id)) return 'admin';
  if (parseIdList(env.PIPELINE_TELEGRAM_REVIEWER_IDS).has(id)) return 'reviewer';
  return null;
}

function assertAuthorized(userId, requiredRole = 'reviewer', env = process.env) {
  const role = getReviewerRole(userId, env);
  const ok = requiredRole === 'reviewer' ? Boolean(role) : role === 'admin';
  if (!ok) {
    appendAudit({ reviewerId: userId, action: 'unauthorized_access_rejected', result: 'DENIED', reason: 'unauthorized pipeline access' });
    throw Object.assign(new Error('Access denied.'), { code: 'ACCESS_DENIED' });
  }
  return { role, reviewerRef: `Reviewer-${shortHash(userId)}` };
}

function sanitizeText(text) {
  const redacted = ledger.redact(text || '');
  validateNoForbidden(redacted);
  return redacted;
}

function validateNoForbidden(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const rawIds = [ledger.LOCATION_ID, ledger.PIPELINE_ID, ...Object.keys(ledger.STAGE_BY_ID)];
  if (rawIds.some((id) => text.includes(id))) throw Object.assign(new Error('Forbidden raw production ID detected'), { code: 'FAIL_PRIVACY' });
  if (/\b(?:Bearer|token|token-id|cookie|authorization)[\w-]*[\s:=]+[^\s,;]{8,}/i.test(text)) throw Object.assign(new Error('Forbidden auth material detected'), { code: 'FAIL_PRIVACY' });
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) throw Object.assign(new Error('Forbidden email detected'), { code: 'FAIL_PRIVACY' });
  if (/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(text)) throw Object.assign(new Error('Forbidden phone detected'), { code: 'FAIL_PRIVACY' });
  if (/\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Way|Cir|Circle)\b/i.test(text)) throw Object.assign(new Error('Forbidden address detected'), { code: 'FAIL_PRIVACY' });
  return true;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return fallback; }
}

function getFixtureDecisions() {
  if (process.env.PIPELINE_REVIEW_INCLUDE_TEST_FIXTURES !== '1') return [];
  const count = Math.max(1, Math.min(25, Number(process.env.PIPELINE_REVIEW_FIXTURE_COUNT || 1)));
  const recordedAt = new Date(0).toISOString();
  return Array.from({ length: count }, (_, index) => ({
    decisionId: 'TEST-FIXTURE-NON-PRODUCTION-PIPELINE-REVIEW',
    opportunityRef: index === 0 ? 'TEST-FIXTURE-NON-PRODUCTION' : `TEST-FIXTURE-NON-PRODUCTION-${String(index + 1).padStart(2, '0')}`,
    opportunityIdHash: index === 0 ? 'test-fixture-not-production' : `test-fixture-not-production-${index + 1}`,
    decisionId: index === 0 ? 'TEST-FIXTURE-NON-PRODUCTION-PIPELINE-REVIEW' : `TEST-FIXTURE-NON-PRODUCTION-PIPELINE-REVIEW-${String(index + 1).padStart(2, '0')}`,
    recordedAt,
    currentStageName: index % 2 === 0 ? 'TEST FIXTURE' : 'Lead Entered',
    recommendation: {
      action: 'KEEP_STAGE',
      proposedStageName: null,
      humanReviewRequired: true,
      reason: 'TEST FIXTURE ONLY. Non-production review validation record.',
      mustNotDo: ['No GHL write', 'No seller contact', 'No production stage movement'],
    },
    confidenceClassification: 'INSUFFICIENT_DATA',
    evidenceSources: { contactNotes: 0, conversationMessages: 0, calls: 0, transcripts: 0, dispositions: 0 },
    evidenceSummary: ['TEST FIXTURE ONLY. No seller data.'],
    detectedIntents: ['TEST_FIXTURE'],
    latestEvidenceAt: null,
    routerVersion: 'TEST-FIXTURE',
    decisionSpecVersion: 'TEST-FIXTURE',
    isTestFixture: true,
  }));
}

function getDecisions() { return [...ledger.readJsonl(ledger.LEDGER_PATH), ...getFixtureDecisions()]; }
function getOutcomes() { return ledger.readJsonl(ledger.OUTCOMES_PATH); }
function getRuns() { return ledger.readJsonl(ledger.RUNS_PATH); }
function annotationPath() { return process.env.PIPELINE_REVIEW_ANNOTATIONS_PATH || ledger.ANNOTATIONS_PATH; }
function auditPath() { return process.env.PIPELINE_REVIEW_AUDIT_PATH || AUDIT_PATH; }
function getAnnotations() { return ledger.readJsonl(annotationPath()).filter((item) => item.annotationVersion === 1 || item.reviewStatus); }

function latestAnnotationsByDecision() {
  const latest = new Map();
  for (const annotation of getAnnotations()) latest.set(annotation.decisionId, annotation);
  return latest;
}

function appendAudit({ reviewerId, action, decisionId = null, annotationId = null, result = 'OK', reason = null, callbackRef = null }) {
  const record = {
    auditId: uuid(),
    timestamp: now(),
    reviewer: reviewerId ? { source: 'TELEGRAM', telegramUserIdHash: hashTelegramId(reviewerId), reviewerRef: `Reviewer-${shortHash(reviewerId)}` } : null,
    source: 'TELEGRAM',
    action,
    decisionId,
    annotationId,
    result,
    reason: reason ? sanitizeText(reason) : null,
    callbackRef,
  };
  validateNoForbidden({ action, result, reason: record.reason, callbackRef });
  ledger.appendJsonl(auditPath(), record);
  return record;
}

function getShadowHealth() {
  const health = readJson(HEALTH_PATH, { status: 'UNKNOWN', writeCounters: {} });
  const alerts = getAlerts();
  const summary = { ...health, activeAlertCount: alerts.length, ghlWrites: Object.values(health.writeCounters || {}).reduce((sum, value) => sum + Number(value || 0), 0) };
  validateNoForbidden(summary);
  return summary;
}

function getPipelineSummary() {
  const decisions = getDecisions();
  const outcomes = getOutcomes();
  const runs = getRuns();
  return { decisions: decisions.length, outcomes: outcomes.length, runs: runs.length, health: getShadowHealth(), authoritativeInventoryAvailable: true };
}

async function getAuthoritativeInventory(profile = 'INVENTORY') {
  const { summary } = await authoritativeRead.getLiveInventory(profile);
  return {
    timestamp: summary.timestamp,
    total: summary.total,
    production: summary.byClassification.PRODUCTION || 0,
    nonProduction: Object.entries(summary.byClassification).filter(([k]) => k !== 'PRODUCTION').reduce((a, [k, v]) => a + v, 0),
    byClassification: summary.byClassification,
    apiCalls: summary.apiCalls,
    elapsedMs: summary.elapsedMs
  };
}

function outcomeByDecision() {
  const map = new Map();
  for (const outcome of getOutcomes()) map.set(outcome.decisionId, outcome);
  return map;
}

function priorityFor(decision, outcome, annotation) {
  if (outcome && ['HIGH', 'CRITICAL'].includes(outcome.severity)) return 'Critical/high-severity discrepancy';
  if (decision.recommendation?.proposedStageName && /Contract|Wire|Closing|JV|Under Contract/i.test(decision.recommendation.proposedStageName)) return 'Dangerous proposed transition';
  if (outcome?.comparison === 'ROUTER_MISS') return 'Router miss';
  if (decision.confidenceClassification === 'CONFLICTING_EVIDENCE') return 'Conflicting evidence';
  if (annotation?.reviewStatus === 'MODIFIED') return 'Recommendation changed';
  if (outcome?.comparison === 'POSSIBLE_HUMAN_OVERRIDE') return 'Human override';
  if (decision.confidenceClassification === 'AMBIGUOUS') return 'Ambiguous evidence';
  if (decision.confidenceClassification === 'INSUFFICIENT_DATA') return 'Insufficient data';
  if (annotation?.reviewStatus === 'DEFERRED') return 'Deferred review';
  return 'Ordinary pending review';
}

function priorityRank(reason) {
  return ['Critical/high-severity discrepancy', 'Dangerous proposed transition', 'Router miss', 'Conflicting evidence', 'Recommendation changed', 'Human override', 'Ambiguous evidence', 'Insufficient data', 'Ordinary pending review', 'Deferred review'].indexOf(reason);
}

function reviewabilityFor(decision, outcome, annotation) {
  if (!decision.decisionId || !decision.opportunityRef || !decision.currentStageName || !decision.recommendation?.action) {
    return { status: 'INTEGRITY_BLOCKED', label: 'Integrity Warning', rank: 3, reason: 'Missing required decision fields.' };
  }
  if (annotation?.reviewStatus === 'DEFERRED') return { status: 'DEFER', label: 'Deferred', rank: 2, reason: 'Reviewer deferred this decision.' };
  const evidence = decision.evidenceSources || {};
  const evidenceCount = Number(evidence.contactNotes || 0) + Number(evidence.conversationMessages || 0) + Number(evidence.calls || 0) + Number(evidence.transcripts || 0) + Number(evidence.dispositions || 0);
  if (decision.confidenceClassification === 'CLEAR' && evidenceCount > 0) return { status: 'REVIEWABLE_NOW', label: 'Ready for Review', rank: 0, reason: 'Clear recommendation with supporting evidence.' };
  if (['CONFLICTING_EVIDENCE', 'AMBIGUOUS'].includes(decision.confidenceClassification) && evidenceCount > 0) return { status: 'REVIEWABLE_NOW', label: 'Ready for Review', rank: 0, reason: 'Evidence exists and reviewer judgment is useful.' };
  if (evidenceCount > 0) return { status: 'NEEDS_MORE_DATA', label: 'Needs More Data', rank: 1, reason: 'Some evidence exists, but confidence remains insufficient.' };
  return { status: 'NEEDS_MORE_DATA', label: 'Needs More Data', rank: 4, reason: 'No supporting notes, conversations, calls, transcripts, or dispositions are available.' };
}

function ageHours(iso) { return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3600000)); }

function decisionCard(decision) {
  const outcomes = outcomeByDecision();
  const annotations = latestAnnotationsByDecision();
  const outcome = outcomes.get(decision.decisionId) || null;
  const annotation = annotations.get(decision.decisionId) || null;
  const priorityReason = priorityFor(decision, outcome, annotation);
  const reviewability = reviewabilityFor(decision, outcome, annotation);
  const card = {
    decisionId: decision.decisionId,
    anonymousRef: decision.opportunityRef,
    currentStage: decision.currentStageName,
    recommendation: decision.recommendation.action,
    proposedStage: decision.recommendation.proposedStageName || null,
    confidence: decision.confidenceClassification,
    evidence: decision.evidenceSources,
    outcome: outcome?.comparison || 'NONE',
    ageHours: ageHours(decision.recordedAt),
    priority: priorityReason,
    priorityRank: priorityRank(priorityReason),
    reviewabilityStatus: reviewability.status,
    reviewabilityLabel: reviewability.label,
    reviewabilityRank: reviewability.rank,
    reviewabilityReason: reviewability.reason,
    reviewStatus: annotation?.reviewStatus || 'UNREVIEWED',
  };
  validateNoForbidden({ anonymousRef: card.anonymousRef, currentStage: card.currentStage, recommendation: card.recommendation, proposedStage: card.proposedStage, confidence: card.confidence, outcome: card.outcome, priority: card.priority, reviewabilityLabel: card.reviewabilityLabel, reviewabilityReason: card.reviewabilityReason, reviewStatus: card.reviewStatus });
  return card;
}

function getReviewQueue(filters = {}) {
  const cards = getDecisions().map(decisionCard).filter((card) => {
    const filter = filters.filter || 'All';
    if (filter === 'Unreviewed') return card.reviewStatus === 'UNREVIEWED';
    if (filter === 'High Priority') return card.priorityRank >= 0 && card.priorityRank <= 3;
    if (filter === 'Proposed Moves') return Boolean(card.proposedStage);
    if (filter === 'Insufficient Data') return card.confidence === 'INSUFFICIENT_DATA';
    if (filter === 'Conflicts') return card.confidence === 'CONFLICTING_EVIDENCE';
    if (filter === 'Router Misses') return card.outcome === 'ROUTER_MISS';
    if (filter === 'Human Overrides') return card.outcome === 'POSSIBLE_HUMAN_OVERRIDE';
    if (filter === 'High Risk') return /Dangerous|Critical/.test(card.priority);
    if (filter === 'Deferred') return card.reviewStatus === 'DEFERRED';
    return true;
  }).sort((a, b) => {
    const aDecision = getDecisions().find((decision) => decision.decisionId === a.decisionId);
    const bDecision = getDecisions().find((decision) => decision.decisionId === b.decisionId);
    return a.reviewabilityRank - b.reviewabilityRank
      || a.priorityRank - b.priorityRank
      || Date.parse(bDecision?.recordedAt || 0) - Date.parse(aDecision?.recordedAt || 0)
      || String(a.anonymousRef).localeCompare(String(b.anonymousRef));
  });
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.min(5, Math.max(1, Number(filters.pageSize || 5)));
  const totalPages = Math.max(1, Math.ceil(cards.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const snapshotHash = crypto.createHash('sha256').update(cards.map((card) => `${card.decisionId}:${card.reviewStatus}`).join('|')).digest('hex').slice(0, 16);
  return { items: cards.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, pageSize, total: cards.length, totalPages, filter: filters.filter || 'All', snapshotHash };
}

function getRecentDecisions(filters = {}) {
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.min(5, Math.max(1, Number(filters.pageSize || 5)));
  const cards = getDecisions().slice().sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).map(decisionCard);
  return { items: cards.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: cards.length };
}

function getDecisionDetail(decisionId) {
  const decision = getDecisions().find((item) => item.decisionId === decisionId);
  if (!decision) throw new Error('Decision not found');
  const outcomes = outcomeByDecision();
  const annotations = getAnnotations().filter((item) => item.decisionId === decisionId);
  const history = getDecisions().filter((item) => item.opportunityIdHash === decision.opportunityIdHash).length;
  const detail = {
    decisionId: decision.decisionId,
    anonymousRef: decision.opportunityRef,
    decidedAt: decision.recordedAt,
    currentStage: decision.currentStageName,
    proposedStage: decision.recommendation.proposedStageName || null,
    recommendation: decision.recommendation.action,
    confidence: decision.confidenceClassification,
    reviewRequired: decision.recommendation.humanReviewRequired,
    reason: sanitizeText(decision.recommendation.reason || ''),
    guardrails: decision.recommendation.mustNotDo || [],
    evidenceCounts: decision.evidenceSources,
    evidenceSummary: (decision.evidenceSummary || []).map(sanitizeText),
    detectedIntents: decision.detectedIntents || [],
    latestEvidenceAt: decision.latestEvidenceAt,
    routerVersion: decision.routerVersion,
    decisionSpecVersion: decision.decisionSpecVersion,
    observedOutcome: outcomes.get(decisionId)?.comparison || 'NONE',
    previousDecisionCount: history,
    currentReviewStatus: annotations.at(-1)?.reviewStatus || 'UNREVIEWED',
    annotationHistoryCount: annotations.length,
  };
  validateNoForbidden({ anonymousRef: detail.anonymousRef, currentStage: detail.currentStage, proposedStage: detail.proposedStage, recommendation: detail.recommendation, confidence: detail.confidence, reason: detail.reason, evidenceSummary: detail.evidenceSummary, detectedIntents: detail.detectedIntents, observedOutcome: detail.observedOutcome, currentReviewStatus: detail.currentReviewStatus });
  return detail;
}

function getDecisionHistory(decisionId) {
  const detail = getDecisionDetail(decisionId);
  const source = getDecisions().find((item) => item.decisionId === decisionId);
  if (!source?.opportunityIdHash) throw new Error('Decision history association missing');
  const entries = [];
  for (const decision of getDecisions().filter((item) => item.opportunityIdHash === source.opportunityIdHash)) {
    if (!decision.recordedAt || Number.isNaN(Date.parse(decision.recordedAt))) entries.push({ type: 'INTEGRITY_WARNING', timestamp: now(), text: 'Invalid decision timestamp detected.' });
    else entries.push({ type: 'DECISION', timestamp: decision.recordedAt, decisionId: decision.decisionId, action: decision.recommendation?.action || 'UNKNOWN', stage: decision.currentStageName || 'unknown', confidence: decision.confidenceClassification || 'UNKNOWN' });
  }
  for (const outcome of getOutcomes().filter((item) => item.decisionId === decisionId)) {
    const timestamp = outcome.observedAt || outcome.recordedAt || outcome.timestamp;
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) entries.push({ type: 'INTEGRITY_WARNING', timestamp: now(), text: 'Invalid outcome timestamp detected.' });
    else entries.push({ type: 'OUTCOME', timestamp, outcome: outcome.comparison || 'UNKNOWN' });
  }
  const annotations = getAnnotations().filter((item) => item.decisionId === decisionId);
  const ids = new Set(annotations.map((item) => item.annotationId).filter(Boolean));
  const superseded = new Set(annotations.map((item) => item.supersedesAnnotationId).filter(Boolean));
  for (const annotation of annotations) {
    if (annotation.supersedesAnnotationId && !ids.has(annotation.supersedesAnnotationId)) entries.push({ type: 'INTEGRITY_WARNING', timestamp: annotation.reviewedAt || now(), text: 'Invalid supersedes reference detected.' });
    const timestamp = annotation.reviewedAt;
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) entries.push({ type: 'INTEGRITY_WARNING', timestamp: now(), text: 'Invalid review timestamp detected.' });
    else entries.push({ type: annotation.supersedesAnnotationId ? 'REVIEW_CORRECTION' : 'HUMAN_REVIEW', timestamp, reviewStatus: annotation.reviewStatus, reasonCode: annotation.reasonCode, reviewer: annotation.reviewer?.reviewerAlias || 'Reviewer', status: superseded.has(annotation.annotationId) ? 'Superseded' : 'Current' });
  }
  for (const audit of ledger.readJsonl(auditPath()).filter((item) => item.decisionId === decisionId)) {
    const timestamp = audit.timestamp;
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) entries.push({ type: 'INTEGRITY_WARNING', timestamp: now(), text: 'Invalid audit timestamp detected.' });
    else entries.push({ type: 'AUDIT', timestamp, action: sanitizeText(audit.action || 'audit_event'), result: sanitizeText(audit.result || 'UNKNOWN') });
  }
  const sanitized = entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).map((entry) => {
    validateNoForbidden({ type: entry.type, text: entry.text, action: entry.action, stage: entry.stage, confidence: entry.confidence, outcome: entry.outcome, reviewStatus: entry.reviewStatus, reasonCode: entry.reasonCode, reviewer: entry.reviewer, status: entry.status, result: entry.result });
    return entry;
  });
  return { anonymousRef: detail.anonymousRef, decisionId, entries: sanitized };
}

function readNotificationState() {
  const fallback = { version: 1, records: {} };
  return readJson(notificationStatePath(), fallback);
}

function writeNotificationState(state) {
  const statePath = notificationStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.tmp`;
  const text = JSON.stringify(state);
  if ([ledger.LOCATION_ID, ledger.PIPELINE_ID, ...Object.keys(ledger.STAGE_BY_ID)].some((id) => text.includes(id))) throw new Error('Forbidden raw production ID detected');
  if (/\b(?:Bearer|token|token-id|cookie|authorization)[\w-]*[\s:=]+[^\s,;]{8,}/i.test(text)) throw new Error('Forbidden auth material detected');
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) throw new Error('Forbidden email detected');
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, statePath);
}

function notificationStatePath() { return process.env.PIPELINE_TELEGRAM_NOTIFICATION_STATE_PATH || NOTIFICATION_STATE_PATH; }

function notificationKey(input) {
  const raw = [input.type, input.reference, input.window, input.destinationType, input.topic, input.state, input.version].map((v) => String(v || '')).join(':');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function beginNotification(input) {
  const state = readNotificationState();
  if (!state.records || typeof state.records !== 'object') throw new Error('Notification state corrupt');
  const key = notificationKey(input);
  const existing = state.records[key];
  if (existing?.status === 'SENT') return { key, shouldSend: false, status: 'DUPLICATE_SUPPRESSED', record: existing };
  if (existing?.status === 'PENDING') return { key, shouldSend: false, status: 'DELIVERY_UNCERTAIN', record: existing };
  const record = { key, type: input.type, destinationType: input.destinationType, topicMatch: input.topicMatch, createdAt: now(), attemptedAt: now(), deliveredAt: null, status: 'PENDING', retryCount: existing ? Number(existing.retryCount || 0) + 1 : 0, errorClass: null, retentionUntil: input.retentionUntil || new Date(Date.now() + 90 * 86400000).toISOString() };
  state.records[key] = record;
  writeNotificationState(state);
  return { key, shouldSend: true, status: 'PENDING', record };
}

function completeNotification(key, result, errorClass = null) {
  const state = readNotificationState();
  const record = state.records?.[key];
  if (!record) throw new Error('Notification record missing');
  record.status = result;
  record.deliveredAt = result === 'SENT' ? now() : null;
  record.errorClass = errorClass ? sanitizeText(errorClass) : null;
  writeNotificationState(state);
  return record;
}

function cleanupNotificationState(retainNow = Date.now()) {
  const state = readNotificationState();
  for (const [key, record] of Object.entries(state.records || {})) {
    if (record.retentionUntil && Date.parse(record.retentionUntil) < retainNow) delete state.records[key];
  }
  writeNotificationState(state);
  return state;
}

function getPendingOutcomes(filters = {}) {
  const decisions = new Map(getDecisions().map((decision) => [decision.decisionId, decision]));
  const items = getOutcomes().filter((outcome) => outcome.comparison === 'STILL_PENDING' || outcome.comparison === 'INSUFFICIENT_HISTORY').map((outcome) => {
    const decision = decisions.get(outcome.decisionId);
    return { decisionId: outcome.decisionId, anonymousRef: decision?.opportunityRef || 'unknown', originalStage: outcome.originalStage, recommendation: outcome.originalRecommendation, ageHours: Math.round(outcome.elapsedHours || 0), outcome: outcome.comparison, expectedNextObservation: 'next daily observer run' };
  });
  validateNoForbidden(items.map((item) => ({ anonymousRef: item.anonymousRef, originalStage: item.originalStage, recommendation: item.recommendation, outcome: item.outcome, expectedNextObservation: item.expectedNextObservation })));
  return { items, total: items.length, filter: filters.filter || 'All' };
}

function getCoverageSummary() {
  const decisions = getDecisions();
  const annotations = latestAnnotationsByDecision();
  const outcomes = outcomeByDecision();
  return Object.values(ledger.STAGE_BY_ID).map((stage) => {
    const stageDecisions = decisions.filter((decision) => decision.currentStageName === stage.name);
    const reviewed = stageDecisions.filter((decision) => annotations.has(decision.decisionId));
    const observed = stageDecisions.filter((decision) => outcomes.has(decision.decisionId));
    return { stage: stage.name, syntheticCoverage: true, liveDecisions: stageDecisions.length, evidenceRichLiveDecisions: stageDecisions.filter((decision) => Object.values(decision.evidenceSources || {}).some((value) => Number(value) > 0)).length, reviewedDecisions: reviewed.length, observedOutcomes: observed.length };
  });
}

function getDataQualitySummary() {
  const decisions = getDecisions();
  const count = (fn) => decisions.filter(fn).length;
  return {
    noNotes: count((d) => !d.evidenceSources?.contactNotes),
    noConversations: count((d) => !d.evidenceSources?.conversationMessages),
    noCalls: count((d) => !d.evidenceSources?.calls),
    noTranscripts: count((d) => !d.evidenceSources?.transcripts),
    noDispositions: count((d) => !d.evidenceSources?.dispositions),
    staleEvidence: count((d) => ageHours(d.latestEvidenceAt || d.recordedAt) > 168),
    missingTimestamps: count((d) => !d.latestEvidenceAt),
    unknownCallSource: count((d) => !d.evidenceSources?.calls),
    unmappedStage: count((d) => d.normalizedStage == null),
    missingOpportunityHistory: count((d) => !d.previousDecisionCount),
    unobservableOutcome: getOutcomes().filter((o) => o.comparison === 'INSUFFICIENT_HISTORY').length,
    conflictingCrmArtifacts: count((d) => d.confidenceClassification === 'CONFLICTING_EVIDENCE'),
    probableBottlenecks: ['CRM usage', 'call integration', 'workflow logging', 'human documentation', 'unavailable API data'],
  };
}

function getCallIntelligenceSummary() {
  const decisions = getDecisions();
  return { callsObserved: 0, inbound: 0, outbound: 0, answered: 0, noAnswer: 0, voicemail: 0, transcriptAvailable: decisions.filter((d) => d.evidenceSources?.transcripts > 0).length, dispositionAvailable: decisions.filter((d) => d.evidenceSources?.dispositions > 0).length, linkedDecisions: decisions.filter((d) => d.evidenceSources?.calls > 0).length, decisionsInfluencedByCallEvidence: decisions.filter((d) => d.evidenceSources?.calls > 0).length, notesOnlyIngestionWouldHaveMissed: 0, sources: { LC_PHONE_TWILIO: 0, JUSTCALL: 0, OTHER: 0, UNKNOWN: 0 } };
}

function getReadinessSummary() { return readiness.evaluateReadiness({ activeAlerts: getAlerts().map((alert) => alert.type) }); }
function getTransitionReadiness(transitionKey) { return getReadinessSummary().transitions.find((item) => item.transitionKey === transitionKey) || null; }

function getAlerts() {
  if (!fs.existsSync(ALERT_DIR)) return [];
  return fs.readdirSync(ALERT_DIR).filter((file) => file.endsWith('.json')).map((file) => readJson(path.join(ALERT_DIR, file), null)).filter(Boolean).map((alert) => ({ type: alert.type, createdAt: alert.createdAt, lastObservedAt: alert.lastObservedAt, reason: sanitizeText(alert.reason || ''), recommendedOperatorAction: sanitizeText(alert.recommendedOperatorAction || '') }));
}

function getAvailableReports() {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|csv|json)$/.test(entry.name)) files.push(full);
    }
  }
  walk(REPORT_DIR);
  return files.map((file) => ({ name: path.basename(file), path: file, type: path.extname(file).slice(1).toUpperCase() }));
}

function normalizeReviewStatus(status) {
  const value = String(status || '').toUpperCase();
  if (!['ACCEPTED', 'REJECTED', 'MODIFIED', 'NEEDS_MORE_DATA', 'DEFERRED'].includes(value)) throw new Error('Invalid review status');
  return value;
}

function appendReviewAnnotation(input, reviewer) {
  const decision = getDecisions().find((item) => item.decisionId === input.decisionId);
  if (!decision) throw new Error('Decision not found');
  const reviewStatus = normalizeReviewStatus(input.reviewStatus);
  const reasonCode = input.reasonCode || (reviewStatus === 'ACCEPTED' ? 'RECOMMENDATION_CORRECT' : 'OTHER');
  if (!reasonConfig.codes.includes(reasonCode)) throw new Error('Invalid reason code');
  const rawNotes = String(input.notes || '');
  if (rawNotes.length > reasonConfig.maxNoteLength) throw new Error('Review note too long');
  validateNoForbidden(rawNotes);
  const notes = sanitizeText(rawNotes);
  if (reasonConfig.requiresNotes.includes(reasonCode) && !notes) throw new Error('Notes required for reason code');
  if (input.humanChosenStage && !Object.values(ledger.STAGE_BY_ID).some((stage) => stage.name === input.humanChosenStage)) throw new Error('Invalid chosen stage');
  const existing = getAnnotations().find((annotation) => annotation.idempotencyKey && annotation.idempotencyKey === input.idempotencyKey);
  if (existing) return { annotation: existing, duplicate: true };
  const annotation = {
    annotationVersion: 1,
    annotationId: uuid(),
    decisionId: input.decisionId,
    reviewedAt: now(),
    reviewer: { source: 'TELEGRAM', telegramUserIdHash: hashTelegramId(reviewer.telegramUserId), reviewerAlias: reviewer.alias || `Reviewer-${shortHash(reviewer.telegramUserId)}` },
    reviewStatus,
    acceptedRecommendation: reviewStatus === 'ACCEPTED',
    humanChosenAction: input.humanChosenAction || null,
    humanChosenStage: input.humanChosenStage || null,
    reasonCode,
    notes,
    courseRuleReference: input.courseRuleReference || null,
    requiresRouterChange: Boolean(input.requiresRouterChange),
    requiresWorkflowChange: Boolean(input.requiresWorkflowChange),
    requiresDataFix: Boolean(input.requiresDataFix),
    requiresUserDecision: Boolean(input.requiresUserDecision),
    severity: input.severity || 'NONE',
    supersedesAnnotationId: input.supersedesAnnotationId || null,
    idempotencyKey: input.idempotencyKey || crypto.createHash('sha256').update(JSON.stringify({ decisionId: input.decisionId, reviewStatus, reasonCode, notes, reviewer: reviewer.telegramUserId })).digest('hex'),
  };
  validateNoForbidden({ reviewStatus, humanChosenAction: annotation.humanChosenAction, humanChosenStage: annotation.humanChosenStage, reasonCode, notes, courseRuleReference: annotation.courseRuleReference, severity: annotation.severity });
  ledger.appendJsonl(annotationPath(), annotation);
  appendAudit({ reviewerId: reviewer.telegramUserId, action: annotation.supersedesAnnotationId ? 'annotation_superseded' : 'annotation_appended', decisionId: input.decisionId, annotationId: annotation.annotationId, result: 'OK' });
  return { annotation, duplicate: false };
}

function acknowledgeAlert(input, reviewer) {
  if (['FAIL_PRIVACY', 'FAIL_SAFETY'].includes(input.type)) throw new Error('Safety/privacy alerts require manual filesystem review');
  const file = path.join(ALERT_DIR, `${input.type}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  appendAudit({ reviewerId: reviewer.telegramUserId, action: 'alert_acknowledged', result: 'OK', reason: input.type });
  return { acknowledged: true, type: input.type };
}

function runLedgerValidation() {
  const { spawnSync } = require('child_process');
  const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'validate-pipeline-ledger.js')], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  return { ok: res.status === 0, output: sanitizeText(res.stdout || res.stderr || '') };
}

function regenerateReadinessReport() { return { reportPath: readiness.writeReadinessReport(), summary: getReadinessSummary() }; }

function createSanitizedExport(name, rows) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const safeName = name.replace(/[^a-z0-9_.-]/gi, '-');
  const file = path.join(EXPORT_DIR, safeName);
  const content = rows.map((row) => Object.values(row).map((value) => `"${sanitizeText(String(value ?? '')).replace(/"/g, '""')}"`).join(',')).join('\n');
  fs.writeFileSync(file, `${content}\n`);
  validateNoForbidden(fs.readFileSync(file, 'utf8'));
  return file;
}

module.exports = { AUDIT_PATH, EXPORT_DIR, notificationStatePath, annotationPath, auditPath, getReviewerRole, assertAuthorized, validateNoForbidden, sanitizeText, appendAudit, getPipelineSummary, getShadowHealth, getReviewQueue, getRecentDecisions, getDecisionDetail, getDecisionHistory, readNotificationState, writeNotificationState, notificationKey, beginNotification, completeNotification, cleanupNotificationState, getPendingOutcomes, getCoverageSummary, getDataQualitySummary, getCallIntelligenceSummary, getReadinessSummary, getTransitionReadiness, getAlerts, getAvailableReports, appendReviewAnnotation, acknowledgeAlert, runLedgerValidation, regenerateReadinessReport, createSanitizedExport, priorityFor, decisionCard, reasonConfig, getAuthoritativeInventory };
