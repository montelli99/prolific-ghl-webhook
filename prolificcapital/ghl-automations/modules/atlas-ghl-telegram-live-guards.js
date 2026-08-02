'use strict';

const crypto = require('crypto');
const { LEAD_ENTERED_STAGE_ID, CONTACT_MADE_STAGE_ID } = require('./kayla-course-spec');
const { evaluateEligibility, normalizeOpportunity, maskContact } = require('./telegram-outreach-dry-run');
const { getCourseRule, getProductionScript } = require('./kayla-course-evidence');
const { classifyRole, roleCanReceiveProductionScript } = require('./kayla-role-classifier');
const { derivePropertyTimezone } = require('./property-timezone');

const TARGET = Object.freeze({
  locationId: '61XPzSqRy7UKMwW9DeB8',
  pipelineId: 'nSf3NXYVkt8X4PgW9aZ3',
  leadEnteredStageId: LEAD_ENTERED_STAGE_ID,
  contactMadeStageId: CONTACT_MADE_STAGE_ID,
  ownerId: 'PGfXxlXCRXs3hXN3Gq7R',
});

const LIVE_KILL_SWITCH_STATES = Object.freeze(['PAUSED', 'DRY_RUN_ONLY', 'CANARY_ALLOWED']);
const TELEGRAM_OUTREACH_SOURCE = 'TELEGRAM_ATLAS_OUTREACH';
const STAGE_MOVEMENT_PENDING = 'STAGE_MOVEMENT_DISABLED_COURSE_CONFLICT_UNRESOLVED';
const MAX_CANARY_COUNT = 3;
const SAFE_ID = /^[A-Za-z0-9_-]{8,80}$/;
const SYNTHETIC_ID = /^(opp|contact|sim|synthetic|test|fake|dry)[_-]|synthetic|fixture|example/i;

const COMPLIANCE_STATES = Object.freeze(['CLEAR', 'BLOCKED', 'UNKNOWN']);

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20)}`;
}

function hasRealGhlId(value) {
  const text = String(value || '').trim();
  return SAFE_ID.test(text) && !SYNTHETIC_ID.test(text);
}

function validateRealGhlIdentity(record) {
  const normalized = normalizeOpportunity(record);
  const errors = [];
  if (!hasRealGhlId(normalized.opportunityId)) errors.push('LIVE_PLAN_CONTAINS_SYNTHETIC_OR_INVALID_OPPORTUNITY_ID');
  if (!hasRealGhlId(normalized.contactId)) errors.push('LIVE_PLAN_CONTAINS_SYNTHETIC_OR_INVALID_CONTACT_ID');
  return { ok: errors.length === 0, errors, opportunityId: normalized.opportunityId, contactId: normalized.contactId };
}

function tagText(record) {
  const normalized = normalizeOpportunity(record);
  return (normalized.tags || []).join(' ').toLowerCase();
}

function evaluateGhlComplianceLocks(record) {
  const normalized = normalizeOpportunity(record);
  const tags = tagText(record);

  const dncTag = /\bdnc\b|do not call|do-not-contact/.test(tags);
  const optOutTag = /unsubscribe|opt[ -]?out|\bstop\b/.test(tags);
  const wrongNumberTag = /wrong[ -]?number|bad[ -]?phone/.test(tags);
  const pendingReplyTag = /pending[ -]?reply|awaiting[ -]?reply/.test(tags);
  const activeHumanWorkTag = /human[ -]?owned|manual[ -]?review|active[ -]?human/.test(tags);

  const dnc = normalized.dnc || dncTag ? 'BLOCKED' : 'UNKNOWN';
  const optOut = optOutTag ? 'BLOCKED' : 'UNKNOWN';
  const wrongNumber = normalized.wrongNumber || wrongNumberTag ? 'BLOCKED' : 'UNKNOWN';
  const pendingReply = normalized.pendingReply || pendingReplyTag ? 'BLOCKED' : 'UNKNOWN';
  const activeHumanWork = normalized.activeHumanWork || activeHumanWorkTag ? 'BLOCKED' : 'UNKNOWN';

  const checks = { dnc, optOut, wrongNumber, pendingReply, activeHumanWork };
  const errors = [];
  if (checks.dnc !== 'CLEAR') errors.push('CONTACT_COMPLIANCE_LOCK');
  if (checks.optOut !== 'CLEAR') errors.push('CONTACT_COMPLIANCE_LOCK');
  if (checks.wrongNumber !== 'CLEAR') errors.push('WRONG_NUMBER_LOCK');
  if (checks.pendingReply !== 'CLEAR') errors.push('CONVERSATION_CONTEXT_LOCK');
  if (checks.activeHumanWork !== 'CLEAR') errors.push('TEAM_OWNERSHIP_LOCK');

  return { ok: errors.length === 0, errors, checks, maskedContact: maskContact(normalized.contactId) };
}

function localHour(parts) {
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  return hour === 24 ? 0 : hour;
}

function evaluateCanaryWindow({ now = new Date(), timeZone }) {
  if (!timeZone) return { ok: false, reason: 'UNKNOWN_TIMEZONE_BLOCKS_CANARY' };
  try {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(now);
    if (day === 'Sat' || day === 'Sun') return { ok: false, reason: 'WEEKEND_BLOCKS_CANARY', day };
    const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(now);
    const hour = localHour(parts);
    const minute = Number(parts.find(part => part.type === 'minute')?.value) || 0;
    if (hour < 12 || (hour === 17 && minute > 59) || hour >= 18) return { ok: false, reason: 'OUTSIDE_LOCAL_CANARY_WINDOW', hour, minute };
    return { ok: true, reason: 'CANARY_WINDOW_OPEN', day, hour, minute };
  } catch (error) {
    return { ok: false, reason: 'INVALID_TIMEZONE_BLOCKS_CANARY' };
  }
}

function evaluateGhlCanaryRecord(record, context = {}) {
  const records = context.records || [record];
  const normalized = normalizeOpportunity(record);
  const identity = validateRealGhlIdentity(record);
  const compliance = evaluateGhlComplianceLocks(record);
  const eligibility = evaluateEligibility(record, { allRecords: records });
  const roleEvidence = classifyRole(record);
  const script = getProductionScript('INT');
  const roleScript = roleCanReceiveProductionScript(roleEvidence, script);
  const timezone = derivePropertyTimezone(record, { now: context.now || new Date() });
  const sameContactCount = records.filter(item => normalizeOpportunity(item).contactId === normalized.contactId).length;
  const samePropertyCount = records.filter(item => normalizeOpportunity(item).propertyAddress === normalized.propertyAddress).length;
  const window = evaluateCanaryWindow({ now: context.now || new Date(), timeZone: timezone.timeZone });
  const locationOk = !normalized.raw?.locationId || normalized.raw.locationId === TARGET.locationId;
  const pipelineOk = !normalized.raw?.pipelineId || normalized.raw.pipelineId === TARGET.pipelineId;
  const stageOk = normalized.currentStageId === TARGET.leadEnteredStageId;
  const propertyFingerprintOk = Boolean(normalized.propertyAddress || normalized.raw?.propertyFingerprint || normalized.raw?.atlas_property_fingerprint);
  const phoneOk = Boolean(normalized.phone);
  const errors = [...identity.errors, ...compliance.errors];
  if (!locationOk) errors.push('WRONG_LOCATION');
  if (!pipelineOk) errors.push('WRONG_PIPELINE');
  if (!stageOk) errors.push('NOT_LEAD_ENTERED_STAGE');
  if (!propertyFingerprintOk) errors.push('MISSING_PROPERTY_FINGERPRINT');
  if (!phoneOk) errors.push('MISSING_PHONE_ROUTE');
  if (sameContactCount > 1) errors.push('CANARY_REQUIRES_DISTINCT_CONTACTS');
  if (samePropertyCount > 1) errors.push('CANARY_REQUIRES_DISTINCT_PROPERTIES');
  if (!roleScript.ok) errors.push(roleScript.reason);
  if (!eligibility.safe || !eligibility.due) errors.push(eligibility.resultClass || 'NOT_DUE');
  if (!timezone.ok) errors.push(timezone.reason);
  else if (!window.ok) errors.push(window.reason);
  const stageConflict = getCourseRule('STAGE1_EXIT_AFTER_INT');
  return {
    schema: 'atlas-ghl-telegram-canary-guard-v2',
    passed: errors.length === 0,
    blockedReasons: errors,
    opportunityIdValidation: { passed: identity.errors.every(error => !error.includes('OPPORTUNITY')), opportunityId: normalized.opportunityId },
    contactIdValidation: { passed: identity.errors.every(error => !error.includes('CONTACT')), contactId: normalized.contactId },
    locationValidation: { passed: locationOk, expected: TARGET.locationId, actual: normalized.raw?.locationId || TARGET.locationId },
    pipelineValidation: { passed: pipelineOk, expected: TARGET.pipelineId, actual: normalized.raw?.pipelineId || TARGET.pipelineId },
    stageValidation: { passed: stageOk, expected: TARGET.leadEnteredStageId, actual: normalized.currentStageId },
    distinctContactValidation: { passed: sameContactCount === 1, count: sameContactCount },
    distinctPropertyValidation: { passed: samePropertyCount === 1, count: samePropertyCount },
    dncStatus: { state: compliance.checks.dnc, passed: compliance.checks.dnc === 'CLEAR' },
    optOutStatus: { state: compliance.checks.optOut, passed: compliance.checks.optOut === 'CLEAR' },
    wrongNumberStatus: { state: compliance.checks.wrongNumber, passed: compliance.checks.wrongNumber === 'CLEAR' },
    pendingReplyStatus: { state: compliance.checks.pendingReply, passed: compliance.checks.pendingReply === 'CLEAR' },
    activeHumanWorkStatus: { state: compliance.checks.activeHumanWork, passed: compliance.checks.activeHumanWork === 'CLEAR' },
    propertyFingerprintStatus: { passed: propertyFingerprintOk },
    phoneRouteStatus: { passed: phoneOk },
    roleEvidence,
    scriptSelection: { passed: roleScript.ok, shortcutName: script?.shortcutName || 'INT', sourceFile: script?.sourceFile || null, sourceLines: script?.sourceLines || null, courseClassification: script?.courseClassification || 'COURSE_MISSING', reason: roleScript.reason },
    ruleTaxonomy: {
      courseRules: ['INT_BEFORE_CALL'].map(ruleId => getCourseRule(ruleId)),
      technicalSafetyPolicies: ['MAX_THREE_CANARY', 'DISTINCT_CONTACTS', 'DISTINCT_PROPERTIES', 'PROPERTY_LOCAL_TIME_WINDOW', 'SYNTHETIC_IDS_PROHIBITED'],
      legalOrComplianceRules: ['DNC', 'OPT_OUT', 'WRONG_NUMBER'],
      courseConflicts: [stageConflict],
    },
    timezoneDerivation: timezone,
    timezoneStatus: { passed: timezone.ok, timeZone: timezone.timeZone || null, classification: 'TECHNICAL_SAFETY_POLICY' },
    weekdayStatus: { passed: window.ok || !/WEEKEND/.test(window.reason), day: window.day || null },
    localTimeWindowStatus: { passed: window.ok, reason: window.reason, hour: window.hour ?? null, minute: window.minute ?? null },
    kaylaEligibilityStatus: { passed: Boolean(eligibility.safe && eligibility.due), resultClass: eligibility.resultClass, reason: eligibility.reason },
    stageMovementCapability: { passed: false, status: STAGE_MOVEMENT_PENDING, classification: 'COURSE_CONFLICT', courseRule: stageConflict },
    workflowIsolationStatus: { passed: Boolean(context.workflowIsolationProven), status: context.workflowIsolationProven ? 'WEBHOOK_ISOLATION_READY' : 'WEBHOOK_ISOLATION_READY_NOT_AUTHORITY_FOR_STAGE_MOVEMENT' },
    conflictDisclosure: 'Sending this SMS does not establish that the opportunity has satisfied Kayla\'s Contact Made definition. No automatic stage movement will occur.',
    currentSendability: errors.length === 0 ? 'SENDABLE_NOW' : window.ok ? 'BLOCKED_GHL_GUARD' : 'BLOCKED_TIME_WINDOW',
    liveSends: 0,
    productionWrites: 0,
    stageMovements: 0,
  };
}

function validateGhlCanaryPlan({ records = [], count = records.length, timeZone, now = new Date(), killSwitchState = 'PAUSED', allowStageMove = false }) {
  const errors = [];
  if (!LIVE_KILL_SWITCH_STATES.includes(killSwitchState)) errors.push('INVALID_LIVE_KILL_SWITCH_STATE');
  if (killSwitchState !== 'CANARY_ALLOWED') errors.push('CANARY_REQUIRES_CANARY_ALLOWED_STATE');
  if (count < 1 || count > MAX_CANARY_COUNT || records.length > MAX_CANARY_COUNT) errors.push('CANARY_COUNT_EXCEEDS_THREE');
  const window = evaluateCanaryWindow({ now, timeZone });
  if (!window.ok) errors.push(window.reason);

  const contactIds = new Set();
  const propertyContexts = new Set();
  const itemResults = [];
  for (const record of records) {
    const normalized = normalizeOpportunity(record);
    const identity = validateRealGhlIdentity(record);
    const compliance = evaluateGhlComplianceLocks(record);
    const eligibility = evaluateEligibility(record, { allRecords: records });
    const itemErrors = [...identity.errors, ...compliance.errors];
    if (!eligibility.safe || !eligibility.due) itemErrors.push(eligibility.resultClass || 'NOT_DUE');
    if (contactIds.has(normalized.contactId)) itemErrors.push('CANARY_REQUIRES_DISTINCT_CONTACTS');
    if (propertyContexts.has(normalized.propertyAddress)) itemErrors.push('CANARY_REQUIRES_DISTINCT_PROPERTIES');
    if (allowStageMove) itemErrors.push('STAGE_MOVE_DISABLED_UNTIL_WORKFLOW_ISOLATION_PROVEN');
    contactIds.add(normalized.contactId);
    propertyContexts.add(normalized.propertyAddress);
    itemResults.push({ opportunityId: normalized.opportunityId, contactId: normalized.contactId, propertyAddress: normalized.propertyAddress, ok: itemErrors.length === 0, errors: itemErrors, guard: evaluateGhlCanaryRecord(record, { records, timeZone, now, workflowIsolationProven: false }) });
    errors.push(...itemErrors.map(error => `${normalized.opportunityId || 'unknown'}:${error}`));
  }

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'ATLAS_TELEGRAM_KAYLA_CANARY_READY_AWAITING_TELEGRAM_APPROVAL' : 'ATLAS_TELEGRAM_KAYLA_CANARY_FAILED_SAFELY_PAUSED',
    errors,
    window,
    itemResults,
    liveSends: 0,
    productionWrites: 0,
    stageMovements: 0,
  };
}

function buildTelegramOutreachMarker({ sessionId, planHash, actionId, itemNumber, opportunityId, contactId, transitionAt = new Date().toISOString() }) {
  const transitionId = stableId('transition', { sessionId, planHash, actionId, itemNumber, opportunityId, contactId, from: TARGET.leadEnteredStageId, to: TARGET.contactMadeStageId });
  const idempotencyKey = stableId('tgoutreach', { sessionId, planHash, actionId, transitionId, itemNumber });
  return { source: TELEGRAM_OUTREACH_SOURCE, sessionId, planHash, actionId, transitionId, itemNumber, opportunityId, contactId, idempotencyKey, fromStageId: TARGET.leadEnteredStageId, toStageId: TARGET.contactMadeStageId, transitionAt };
}

module.exports = {
  TARGET,
  LIVE_KILL_SWITCH_STATES,
  TELEGRAM_OUTREACH_SOURCE,
  STAGE_MOVEMENT_PENDING,
  MAX_CANARY_COUNT,
  COMPLIANCE_STATES,
  hasRealGhlId,
  validateRealGhlIdentity,
  evaluateGhlComplianceLocks,
  evaluateCanaryWindow,
  evaluateGhlCanaryRecord,
  validateGhlCanaryPlan,
  buildTelegramOutreachMarker,
};
