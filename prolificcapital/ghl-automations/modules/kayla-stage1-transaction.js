'use strict';

const crypto = require('crypto');
const { CONTACT_PATHS, selectContactPath, scriptForContactPath } = require('./kayla-stage1-contact-path');
const { getStage1Script, renderStage1Script } = require('./kayla-stage1-scripts');
const { fieldsForPath, missingRequiredFields } = require('./kayla-stage1-information');

const STAGE_MOVEMENT_STATUS = 'STAGE_MOVEMENT_DISABLED_COURSE_CONFLICT_UNRESOLVED';

const STATES = Object.freeze({
  LEAD_REVIEW_REQUIRED: 'LEAD_REVIEW_REQUIRED',
  CONTACT_PATH_REQUIRED: 'CONTACT_PATH_REQUIRED',
  CONTACT_PATH_SELECTED: 'CONTACT_PATH_SELECTED',
  INT_REQUIRED: 'INT_REQUIRED',
  INT_CONFIRMED_SENT: 'INT_CONFIRMED_SENT',
  CALL_1_REQUIRED: 'CALL_1_REQUIRED',
  CALL_1_NO_ANSWER: 'CALL_1_NO_ANSWER',
  CALL_1_COMPLETED: 'CALL_1_COMPLETED',
  CALL_2_REQUIRED: 'CALL_2_REQUIRED',
  CALL_2_NO_ANSWER: 'CALL_2_NO_ANSWER',
  CALL_2_COMPLETED: 'CALL_2_COMPLETED',
  NO_ANSWER_SEQUENCE_REQUIRED: 'NO_ANSWER_SEQUENCE_REQUIRED',
  VOICE_MEMO_REQUIRED: 'VOICE_MEMO_REQUIRED',
  VOICE_MEMO_CONFIRMED_SENT: 'VOICE_MEMO_CONFIRMED_SENT',
  NOA_REQUIRED: 'NOA_REQUIRED',
  NOA_CONFIRMED_SENT: 'NOA_CONFIRMED_SENT',
  CCC_REQUIRED: 'CCC_REQUIRED',
  CCC_CONFIRMED_SENT: 'CCC_CONFIRMED_SENT',
  CONTACT_CARD_REQUIRED: 'CONTACT_CARD_REQUIRED',
  CONTACT_CARD_CONFIRMED_SENT: 'CONTACT_CARD_CONFIRMED_SENT',
  NOTES_REQUIRED: 'NOTES_REQUIRED',
  NOTES_CONFIRMED_RECORDED: 'NOTES_CONFIRMED_RECORDED',
  REQUIRED_FIELDS_INCOMPLETE: 'REQUIRED_FIELDS_INCOMPLETE',
  STAGE_DECISION_BLOCKED_COURSE_CONFLICT: 'STAGE_DECISION_BLOCKED_COURSE_CONFLICT',
  STAGE_1_OPERATOR_WORK_COMPLETE: 'STAGE_1_OPERATOR_WORK_COMPLETE',
});

function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function propertyFingerprint(value) { return stableHash(String(value || '').toLowerCase()).slice(0, 16); }
function nowIso(now = new Date()) { return now instanceof Date ? now.toISOString() : new Date(now).toISOString(); }

function createStage1Session(record = {}, options = {}) {
  const propertyAddress = record.propertyAddress || record.address || record.name || record.opportunityName || '';
  const selected = selectContactPath(record, options);
  const path = selected.path;
  const scriptId = scriptForContactPath(path, options);
  const state = path === CONTACT_PATHS.RESEARCH_REQUIRED ? STATES.CONTACT_PATH_REQUIRED : STATES.LEAD_REVIEW_REQUIRED;
  return {
    schema: 'kayla-stage1-transaction-v1',
    transactionId: options.transactionId || `stage1_${stableHash({ opportunityId: record.opportunityId || record.id, propertyAddress }).slice(0, 16)}`,
    sessionId: options.sessionId || `stage1_session_${stableHash({ operatorId: options.operatorId || 'operator', propertyAddress, at: options.createdAt || nowIso() }).slice(0, 16)}`,
    opportunityId: record.opportunityId || record.id || '',
    property: { address: propertyAddress, fingerprint: propertyFingerprint(propertyAddress) },
    currentPipelineStage: record.stageName || record.currentStage || 'Lead Entered',
    leadSourceType: record.leadSource || record.source || record.raw?.leadSource || record.raw?.source || '',
    availableContactPaths: buildAvailableContactPaths(record),
    selectedContactPath: path === CONTACT_PATHS.RESEARCH_REQUIRED ? null : path,
    selectedContactId: selected.selectedContact?.id || record.contactId || '',
    selectedContactRelationship: path,
    courseScript: scriptId,
    courseShortcut: 'INT',
    requiredQuestions: path === CONTACT_PATHS.RESEARCH_REQUIRED ? [] : fieldsForPath(path),
    attemptHistory: [],
    intStatus: 'NOT_CONFIRMED',
    callAttemptStatus: 'NOT_STARTED',
    callOutcome: '',
    voiceMemoStatus: 'NOT_REQUIRED',
    noaStatus: 'NOT_REQUIRED',
    cccStatus: 'NOT_REQUIRED',
    contactCardStatus: 'NOT_REQUIRED',
    notesStatus: 'NOT_RECORDED',
    collectedFields: {},
    unresolvedRequirements: path === CONTACT_PATHS.RESEARCH_REQUIRED ? ['CONTACT_PATH_REQUIRED'] : ['LEAD_REVIEW_REQUIRED', 'INT_REQUIRED'],
    nextExactCourseStep: path === CONTACT_PATHS.RESEARCH_REQUIRED ? 'Review lead source and listing information to identify whether Kayla agent or seller procedure applies.' : 'Review the lead, then send INT before calling.',
    courseEvidence: courseEvidence(),
    stageDecisionStatus: STAGE_MOVEMENT_STATUS,
    operatorConfirmations: {},
    state,
    journal: [],
    counters: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 },
  };
}

function buildAvailableContactPaths(record = {}) {
  const paths = [];
  const raw = record.raw || {};
  if (record.listingAgent || raw.listingAgent || raw.agentName || record.agentContact) paths.push(CONTACT_PATHS.LISTING_AGENT);
  if (record.brokerName || raw.brokerName) paths.push(CONTACT_PATHS.BROKER);
  if (record.sellerContact || record.sellerName || raw.sellerName || raw.ownerName || record.explicitSeller || raw.explicitSeller) paths.push(CONTACT_PATHS.DIRECT_SELLER);
  if (/fsbo/i.test(`${record.leadSource || record.source || raw.leadSource || raw.source || ''}`)) paths.push(CONTACT_PATHS.FSBO_SELLER);
  if (/ppc|inbound/i.test(`${record.leadSource || record.source || raw.leadSource || raw.source || ''}`)) paths.push(CONTACT_PATHS.PPC_SELLER);
  if (!paths.length) paths.push(CONTACT_PATHS.RESEARCH_REQUIRED);
  return [...new Set(paths)];
}

function courseEvidence() {
  return [
    { ruleId: 'STAGE1_REVIEW_AND_PREP', classification: 'COURSE_EXPLICIT', source: 'lead-tracking/AIREI_SYSTEM_PLAYBOOK_v2.md:72-77' },
    { ruleId: 'INT_BEFORE_CALL', classification: 'COURSE_EXPLICIT', source: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md:10,235-237' },
    { ruleId: 'AGENT_INITIAL_SCRIPT', classification: 'COURSE_EXPLICIT', source: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md:25-51' },
    { ruleId: 'SELLER_INITIAL_SCRIPT', classification: 'COURSE_EXPLICIT', source: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md:55-81' },
    { ruleId: 'TWO_CALLS_BEFORE_NOA', classification: 'COURSE_EXPLICIT', source: 'ghl-automations/TRACK_STUDENT.md:45-66' },
    { ruleId: 'CCC_AFTER_CALL', classification: 'COURSE_EXPLICIT', source: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md:13,235-237' },
    { ruleId: 'STAGE1_EXIT', classification: 'COURSE_CONFLICT', source: 'ghl-automations/TRACK_STUDENT.md:49; memory/FULL_COURSE_AUDIT.md:169-175' },
  ];
}

function addEvent(session, type, payload = {}, options = {}) {
  const priorState = session.state;
  const idempotencyKey = options.idempotencyKey || stableHash({ sessionId: session.sessionId, type, priorState, eventIndex: session.journal.length, payload });
  const existing = session.journal.find(event => event.idempotencyKey === idempotencyKey);
  if (existing) return { session, event: existing, duplicate: true };
  applyEvent(session, type, payload);
  const event = {
    eventId: `evt_${stableHash({ idempotencyKey, type }).slice(0, 16)}`,
    sessionId: session.sessionId,
    opportunityId: session.opportunityId,
    propertyFingerprint: session.property.fingerprint,
    operatorId: options.operatorId || payload.operatorId || 'operator',
    timestamp: nowIso(options.now || new Date()),
    priorState,
    newState: session.state,
    eventType: type,
    courseRuleId: ruleForEvent(type),
    source: 'kayla-stage1-transaction',
    payloadHash: stableHash(payload),
    idempotencyKey,
  };
  session.journal.push(event);
  return { session, event, duplicate: false };
}

function applyEvent(session, type, payload) {
  if (type === 'LEAD_REVIEWED') {
    session.operatorConfirmations.leadReviewed = true;
    session.state = session.selectedContactPath ? STATES.INT_REQUIRED : STATES.CONTACT_PATH_REQUIRED;
  } else if (type === 'CONTACT_PATH_SELECTED') {
    session.selectedContactPath = payload.path;
    session.selectedContactRelationship = payload.path;
    session.courseScript = scriptForContactPath(payload.path, { rehab: payload.rehab }) || session.courseScript;
    session.requiredQuestions = fieldsForPath(payload.path);
    session.state = STATES.INT_REQUIRED;
  } else if (type === 'SESSION_CANCELED') {
    session.state = 'SESSION_CANCELED';
  } else if (type === 'INT_CONFIRMED_SENT') {
    if (!session.selectedContactPath) return block(session, 'CONTACT_PATH_REQUIRED');
    session.intStatus = 'CONFIRMED_SENT';
    session.operatorConfirmations.intSent = true;
    session.state = STATES.CALL_1_REQUIRED;
  } else if (type === 'CALL_ATTEMPT_STARTED') {
    if (session.intStatus !== 'CONFIRMED_SENT') return block(session, 'INT_REQUIRED');
    session.callAttemptStatus = `ATTEMPT_${session.attemptHistory.length + 1}_STARTED`;
  } else if (type === 'CALL_NO_ANSWER_RECORDED') {
    if (session.intStatus !== 'CONFIRMED_SENT') return block(session, 'INT_REQUIRED');
    const attempt = session.attemptHistory.length + 1;
    session.attemptHistory.push({ attempt, outcome: 'NO_ANSWER', at: payload.at || nowIso() });
    session.callOutcome = 'NO_ANSWER';
    session.collectedFields.callOutcome = 'NO_ANSWER';
    session.collectedFields.attemptCount = attempt;
    if (attempt === 1) session.state = STATES.CALL_2_REQUIRED;
    else {
      session.state = STATES.VOICE_MEMO_REQUIRED;
      session.voiceMemoStatus = 'REQUIRED';
      session.noaStatus = 'REQUIRED_AFTER_VOICE_MEMO';
    }
  } else if (type === 'CALL_COMPLETED_RECORDED') {
    if (session.intStatus !== 'CONFIRMED_SENT') return block(session, 'INT_REQUIRED');
    const attempt = session.attemptHistory.length + 1;
    session.attemptHistory.push({ attempt, outcome: 'COMPLETED', at: payload.at || nowIso() });
    session.callOutcome = 'COMPLETED';
    session.collectedFields.callOutcome = 'COMPLETED';
    session.collectedFields.attemptCount = attempt;
    session.callAttemptStatus = 'COMPLETED';
    session.state = STATES.REQUIRED_FIELDS_INCOMPLETE;
    session.cccStatus = 'BLOCKED_UNTIL_REQUIRED_FIELDS_RECORDED';
  } else if (type === 'CALL_INFORMATION_RECORDED') {
    session.collectedFields = { ...session.collectedFields, ...(payload.answers || {}) };
    const missing = missingRequiredFields(session.selectedContactPath, session.collectedFields);
    session.state = missing.length ? STATES.REQUIRED_FIELDS_INCOMPLETE : STATES.CCC_REQUIRED;
    session.cccStatus = missing.length ? 'BLOCKED_UNTIL_REQUIRED_FIELDS_RECORDED' : 'REQUIRED';
  } else if (type === 'VOICE_MEMO_CONFIRMED_SENT') {
    if (session.attemptHistory.filter(item => item.outcome === 'NO_ANSWER').length < 2) return block(session, 'SECOND_CALL_REQUIRED_BEFORE_NO_ANSWER_SEQUENCE');
    session.voiceMemoStatus = 'CONFIRMED_SENT';
    session.state = STATES.NOA_REQUIRED;
    session.noaStatus = 'REQUIRED';
  } else if (type === 'NOA_CONFIRMED_SENT') {
    if (session.voiceMemoStatus !== 'CONFIRMED_SENT') return block(session, 'VOICE_MEMO_REQUIRED');
    session.noaStatus = 'CONFIRMED_SENT';
    session.state = STATES.NOTES_REQUIRED;
  } else if (type === 'CCC_CONFIRMED_SENT') {
    if (session.callOutcome !== 'COMPLETED') return block(session, 'CALL_COMPLETED_REQUIRED_BEFORE_CCC');
    session.cccStatus = 'CONFIRMED_SENT';
    session.state = STATES.CONTACT_CARD_REQUIRED;
    session.contactCardStatus = 'REQUIRED';
  } else if (type === 'CONTACT_CARD_CONFIRMED_SENT') {
    if (session.cccStatus !== 'CONFIRMED_SENT') return block(session, 'CCC_REQUIRED');
    session.contactCardStatus = 'CONFIRMED_SENT';
    session.state = STATES.NOTES_REQUIRED;
  } else if (type === 'NOTES_CONFIRMED_RECORDED') {
    session.notesStatus = 'CONFIRMED_RECORDED';
    session.state = STATES.STAGE_1_OPERATOR_WORK_COMPLETE;
  } else if (type === 'STAGE_1_WORK_REVIEWED') {
    session.state = STATES.STAGE_DECISION_BLOCKED_COURSE_CONFLICT;
  }
  refreshNext(session);
}

function block(session, reason) {
  session.lastBlockedReason = reason;
}

function ruleForEvent(type) {
  if (/INT/.test(type)) return 'INT_BEFORE_CALL';
  if (/CALL_NO_ANSWER|VOICE_MEMO|NOA/.test(type)) return 'TWO_CALLS_BEFORE_NOA';
  if (/CCC|CONTACT_CARD/.test(type)) return 'CCC_AFTER_CALL';
  if (/CONTACT_PATH/.test(type)) return 'STAGE1_CONTACT_PATH_SELECTION';
  if (/NOTES/.test(type)) return 'STAGE1_NOTES_REQUIRED';
  return 'STAGE1_OPERATOR_TRANSACTION';
}

function refreshNext(session) {
  const state = session.state;
  const map = {
    [STATES.LEAD_REVIEW_REQUIRED]: 'Review/prep the lead before contact.',
    [STATES.CONTACT_PATH_REQUIRED]: 'Review lead source and listing information to identify agent or seller procedure.',
    [STATES.INT_REQUIRED]: 'Send INT before calling.',
    [STATES.CALL_1_REQUIRED]: 'Start first call attempt using the selected path script.',
    [STATES.CALL_2_REQUIRED]: 'Course requires a second call before no-answer handling.',
    [STATES.VOICE_MEMO_REQUIRED]: 'Send the documented no-answer voice memo.',
    [STATES.NOA_REQUIRED]: 'Send NOA after the documented no-answer condition.',
    [STATES.REQUIRED_FIELDS_INCOMPLETE]: 'Record the course-required call information.',
    [STATES.CCC_REQUIRED]: 'Send CCC after the completed call.',
    [STATES.CONTACT_CARD_REQUIRED]: 'Send the contact card after the completed call.',
    [STATES.NOTES_REQUIRED]: 'Record structured Stage 1 notes in GHL.',
    [STATES.STAGE_1_OPERATOR_WORK_COMPLETE]: 'Stage 1 operator work is complete; stage movement remains blocked by course conflict.',
    [STATES.STAGE_DECISION_BLOCKED_COURSE_CONFLICT]: 'No automatic stage movement until authoritative Stage 1 exit rule is confirmed.',
  };
  session.unresolvedRequirements = unresolved(session);
  session.nextExactCourseStep = map[state] || 'Continue the course-defined Stage 1 sequence.';
}

function unresolved(session) {
  const items = [];
  if (!session.selectedContactPath) items.push('CONTACT_PATH_REQUIRED');
  if (session.intStatus !== 'CONFIRMED_SENT') items.push('INT_REQUIRED');
  if (!session.callOutcome) items.push('CALL_REQUIRED');
  if (session.callOutcome === 'COMPLETED') {
    items.push(...missingRequiredFields(session.selectedContactPath, session.collectedFields).map(field => `FIELD_REQUIRED:${field}`));
    if (session.cccStatus !== 'CONFIRMED_SENT') items.push('CCC_REQUIRED');
    if (session.contactCardStatus !== 'CONFIRMED_SENT') items.push('CONTACT_CARD_REQUIRED');
  }
  if (session.callOutcome === 'NO_ANSWER' && session.attemptHistory.length >= 2) {
    if (session.voiceMemoStatus !== 'CONFIRMED_SENT') items.push('VOICE_MEMO_REQUIRED');
    if (session.noaStatus !== 'CONFIRMED_SENT') items.push('NOA_REQUIRED');
  }
  if (session.notesStatus !== 'CONFIRMED_RECORDED') items.push('NOTES_REQUIRED');
  items.push(STAGE_MOVEMENT_STATUS);
  return [...new Set(items)];
}

function currentScript(session, context = {}) {
  const scriptId = session.state === STATES.NOA_REQUIRED ? 'NOA'
    : session.state === STATES.VOICE_MEMO_REQUIRED ? 'NO_ANSWER_VOICE_MEMO'
      : session.state === STATES.CCC_REQUIRED || session.state === STATES.CONTACT_CARD_REQUIRED ? 'CCC'
        : session.courseScript || scriptForContactPath(session.selectedContactPath) || 'INT';
  if (session.state === STATES.INT_REQUIRED || session.state === STATES.LEAD_REVIEW_REQUIRED) return renderStage1Script('INT', contextFor(session, context));
  return renderStage1Script(scriptId, contextFor(session, context));
}

function contextFor(session, context = {}) {
  return { propertyAddress: session.property.address, contactName: context.contactName || context.name || 'Client', operatorName: context.operatorName || 'Montelli', day: context.day || '[day]' };
}

function buildStage1Note(session, operatorNotes = '') {
  const fields = session.collectedFields || {};
  return [
    'KAYLA STAGE 1 CONTACT RECORD',
    '',
    `Property: ${session.property.address || '(missing)'}`,
    `Lead source: ${session.leadSourceType || '(unknown)'}`,
    `Contact path: ${session.selectedContactPath || 'RESEARCH_REQUIRED'}`,
    `Contact person: ${fields.contactName || '(not confirmed)'}`,
    `Contact relationship: ${session.selectedContactRelationship || '(not confirmed)'}`,
    `INT sent: ${session.intStatus === 'CONFIRMED_SENT' ? 'yes' : 'not confirmed'}`,
    `Call attempt 1: ${session.attemptHistory[0]?.outcome || 'not recorded'}`,
    `Call attempt 2: ${session.attemptHistory[1]?.outcome || 'not recorded'}`,
    `Call outcome: ${session.callOutcome || 'not recorded'}`,
    `Agent/seller details: ${fields.sellerName || fields.contactName || '(not recorded)'}`,
    `Roof age: ${fields.roofAge || '(not recorded)'}`,
    `HVAC age: ${fields.hvacAge || '(not recorded)'}`,
    `Occupancy: ${fields.occupancy || '(not recorded)'}`,
    `Rent: ${fields.monthlyRent || '(not recorded)'}`,
    `Lease terms: ${fields.leaseTerms || '(not recorded)'}`,
    `Utilities: ${fields.utilityResponsibility || '(not recorded)'}`,
    `Listing/buyer feedback: ${fields.listingFeedback || fields.buyerFeedback || '(not recorded)'}`,
    `Seller flexibility: ${fields.sellerFlexibility || '(not recorded)'}`,
    `Other properties: ${fields.otherProperties || '(not recorded)'}`,
    `CCC sent: ${session.cccStatus === 'CONFIRMED_SENT' ? 'yes' : 'not confirmed'}`,
    `Contact card sent: ${session.contactCardStatus === 'CONFIRMED_SENT' ? 'yes' : 'not confirmed'}`,
    `Voice memo sent: ${session.voiceMemoStatus === 'CONFIRMED_SENT' ? 'yes' : 'not confirmed'}`,
    `NOA sent: ${session.noaStatus === 'CONFIRMED_SENT' ? 'yes' : 'not confirmed'}`,
    `Operator notes: ${operatorNotes || '(none)'}`,
    `Next course step: ${session.nextExactCourseStep}`,
    `Stage decision: ${session.stageDecisionStatus}`,
    'Course conflict: Kayla documents conflict on the exact event that moves this lead to Contact Made. No automatic stage movement will occur.',
  ].join('\n');
}

module.exports = { STATES, STAGE_MOVEMENT_STATUS, createStage1Session, addEvent, currentScript, buildStage1Note, propertyFingerprint };
