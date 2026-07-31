'use strict';

const crypto = require('crypto');
const { CONTACT_PATHS, selectContactPath, scriptForContactPath } = require('./kayla-stage1-contact-path');
const { getStage1Script, renderStage1Script } = require('./kayla-stage1-scripts');
const { FIELD_DISPOSITIONS, fieldsForPath, missingRequiredFields, normalizeFieldDispositions, applyFieldDisposition } = require('./kayla-stage1-information');

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

const ACTIONS = Object.freeze({
  SHOW_INT: 'SHOW_INT',
  SHOW_AGENT_SCRIPT: 'SHOW_AGENT_SCRIPT',
  SHOW_SELLER_SCRIPT: 'SHOW_SELLER_SCRIPT',
  SHOW_NOA: 'SHOW_NOA',
  SHOW_VOICE_MEMO: 'SHOW_VOICE_MEMO',
  SHOW_CCC: 'SHOW_CCC',
  SHOW_CONTACT_CARD: 'SHOW_CONTACT_CARD',
  MARK_OPERATOR_WORK_COMPLETE: 'MARK_OPERATOR_WORK_COMPLETE',
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
  const collectedFields = initialCollectedFields(selected.selectedContact, path);
  collectedFields.fieldDispositions = normalizeFieldDispositions(path, collectedFields);
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
    collectedFields,
    fieldDispositions: normalizeFieldDispositions(path, collectedFields),
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

function initialCollectedFields(contact = {}, path) {
  if (!path || path === CONTACT_PATHS.RESEARCH_REQUIRED) return {};
  return {
    ...(contact.name || contact.contactName ? { contactName: contact.name || contact.contactName } : {}),
    ...(contact.phone || contact.phoneNumber ? { contactPhone: contact.phone || contact.phoneNumber } : {}),
    ...(contact.email ? { contactEmail: contact.email } : {}),
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
    session.fieldDispositions = normalizeFieldDispositions(session.selectedContactPath, session.collectedFields, { ...session.fieldDispositions, ...(payload.answers?.fieldDispositions || {}) });
    session.collectedFields.fieldDispositions = session.fieldDispositions;
    const missing = missingRequiredFields(session.selectedContactPath, session.collectedFields);
    session.state = missing.length ? STATES.REQUIRED_FIELDS_INCOMPLETE : STATES.CCC_REQUIRED;
    session.cccStatus = missing.length ? 'BLOCKED_UNTIL_REQUIRED_FIELDS_RECORDED' : 'REQUIRED';
  } else if (type === 'FIELD_DISPOSITION_RECORDED') {
    session.collectedFields = applyFieldDisposition(session.collectedFields, payload.fieldId, payload.disposition, payload.reason);
    session.fieldDispositions = normalizeFieldDispositions(session.selectedContactPath, session.collectedFields, session.collectedFields.fieldDispositions || session.fieldDispositions);
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
    const availability = evaluateActionAvailability(session, ACTIONS.MARK_OPERATOR_WORK_COMPLETE);
    if (!availability.available) return block(session, availability.blockingReason);
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

function sourceForRule(ruleId) {
  return sessionlessCourseEvidence().find(item => item.ruleId === ruleId)?.source || 'ghl-automations/modules/kayla-stage1-transaction.js';
}

function sessionlessCourseEvidence() { return courseEvidence(); }

function unavailable(action, session, blockingReason, requiredPriorStates = [], courseRuleId = 'STAGE1_ACTION_ELIGIBILITY') {
  return { action, available: false, blockingReason, requiredPriorStates, currentState: session.state, nextCourseStep: session.nextExactCourseStep, courseRuleId, sourceReference: sourceForRule(courseRuleId) };
}

function available(action, session, requiredPriorStates = [], courseRuleId = 'STAGE1_ACTION_ELIGIBILITY') {
  return { action, available: true, blockingReason: '', requiredPriorStates, currentState: session.state, nextCourseStep: session.nextExactCourseStep, courseRuleId, sourceReference: sourceForRule(courseRuleId) };
}

function noAnswerCount(session) { return (session.attemptHistory || []).filter(item => item.outcome === 'NO_ANSWER').length; }
function completedCall(session) { return session.callOutcome === 'COMPLETED' || (session.attemptHistory || []).some(item => item.outcome === 'COMPLETED'); }
function selectedPathMissing(session) { return !session.selectedContactPath; }

function evaluateActionAvailability(session, action) {
  if (selectedPathMissing(session)) {
    return unavailable(action, session, 'CONTACT_PATH_REQUIRED: Kayla\'s agent or seller procedure cannot be selected yet. Review the lead source and listing information, then identify whether this is a listing-agent, direct-seller, FSBO, or PPC path.', ['CONTACT_PATH_SELECTED'], 'STAGE1_CONTACT_PATH_SELECTION');
  }
  if (action === ACTIONS.SHOW_INT) return available(action, session, ['CONTACT_PATH_SELECTED'], 'INT_BEFORE_CALL');
  if (action === ACTIONS.SHOW_AGENT_SCRIPT) {
    if (![CONTACT_PATHS.LISTING_AGENT, CONTACT_PATHS.BROKER].includes(session.selectedContactPath)) return unavailable(action, session, 'SCRIPT_CONTACT_PATH_MISMATCH: Agent script is available only for listing-agent or broker paths.', ['LISTING_AGENT_OR_BROKER_PATH'], 'AGENT_INITIAL_SCRIPT');
    if (session.intStatus !== 'CONFIRMED_SENT') return unavailable(action, session, 'INT_REQUIRED: Send INT before showing the call script.', ['INT_CONFIRMED_SENT'], 'INT_BEFORE_CALL');
    return available(action, session, ['CONTACT_PATH_SELECTED', 'INT_CONFIRMED_SENT'], 'AGENT_INITIAL_SCRIPT');
  }
  if (action === ACTIONS.SHOW_SELLER_SCRIPT) {
    if (![CONTACT_PATHS.DIRECT_SELLER, CONTACT_PATHS.FSBO_SELLER, CONTACT_PATHS.PPC_SELLER].includes(session.selectedContactPath)) return unavailable(action, session, 'SCRIPT_CONTACT_PATH_MISMATCH: Seller script is available only for direct-seller, FSBO, or PPC paths.', ['SELLER_PATH'], 'SELLER_INITIAL_SCRIPT');
    if (session.intStatus !== 'CONFIRMED_SENT') return unavailable(action, session, 'INT_REQUIRED: Send INT before showing the call script.', ['INT_CONFIRMED_SENT'], 'INT_BEFORE_CALL');
    return available(action, session, ['CONTACT_PATH_SELECTED', 'INT_CONFIRMED_SENT'], 'SELLER_INITIAL_SCRIPT');
  }
  if (action === ACTIONS.SHOW_NOA || action === ACTIONS.SHOW_VOICE_MEMO) {
    if (noAnswerCount(session) < 2) return unavailable(action, session, 'SECOND_CALL_REQUIRED_BEFORE_NO_ANSWER_SEQUENCE: Kayla\'s process requires a second call attempt before the voice memo and NOA sequence. Record the second call result first.', ['CALL_2_NO_ANSWER'], 'TWO_CALLS_BEFORE_NOA');
    return available(action, session, ['CALL_NO_ANSWER_RECORDED twice'], 'TWO_CALLS_BEFORE_NOA');
  }
  if (action === ACTIONS.SHOW_CCC || action === ACTIONS.SHOW_CONTACT_CARD) {
    if (!completedCall(session)) return unavailable(action, session, 'CALL_COMPLETED_REQUIRED_BEFORE_CCC: CCC follows a completed call. This lead is currently on Kayla\'s no-answer sequence.', ['CALL_COMPLETED_RECORDED'], 'CCC_AFTER_CALL');
    const missing = missingRequiredFields(session.selectedContactPath, session.collectedFields);
    if (missing.length) return unavailable(action, session, `REQUIRED_FIELDS_UNRESOLVED: Stage 1 operator work is not complete. Required information still unresolved: ${missing.join(', ')}. Record an answer or mark it unknown/not provided where allowed.`, ['CALL_INFORMATION_RECORDED'], 'STAGE1_NOTES_REQUIRED');
    return available(action, session, ['CALL_COMPLETED_RECORDED', 'REQUIRED_FIELDS_RESOLVED'], 'CCC_AFTER_CALL');
  }
  if (action === ACTIONS.MARK_OPERATOR_WORK_COMPLETE) {
    const blocking = unresolved(session).filter(item => item !== STAGE_MOVEMENT_STATUS && item !== 'NOTES_REQUIRED');
    if (blocking.length) return unavailable(action, session, `REQUIRED_ACTIONS_UNRESOLVED: Stage 1 operator work is not complete. Required information still unresolved: ${blocking.join(', ')}. Record an answer or mark it unknown/not provided where allowed.`, ['ALL_BRANCH_REQUIREMENTS_RESOLVED'], 'STAGE1_NOTES_REQUIRED');
    return available(action, session, ['NOTES_CONFIRMED_RECORDED'], 'STAGE1_NOTES_REQUIRED');
  }
  return available(action, session);
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

module.exports = { STATES, ACTIONS, STAGE_MOVEMENT_STATUS, FIELD_DISPOSITIONS, createStage1Session, addEvent, currentScript, buildStage1Note, propertyFingerprint, evaluateActionAvailability };
