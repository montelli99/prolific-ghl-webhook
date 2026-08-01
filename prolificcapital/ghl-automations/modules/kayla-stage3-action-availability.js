'use strict';

const contract = require('./kayla-stage3-contract');
const tx = require('./kayla-stage3-transaction');

const STAGE3_ACTIONS = Object.freeze({
  START_REVIEW: 'START_REVIEW',
  SHOW_HANDOFF: 'SHOW_HANDOFF',
  REVIEW_HANDOFF: 'REVIEW_HANDOFF',
  RECORD_UNDERWRITING: 'RECORD_UNDERWRITING',
  REVIEW_UNDERWRITING: 'REVIEW_UNDERWRITING',
  SELECT_OFFER_TYPE: 'SELECT_OFFER_TYPE',
  SHOW_CALCULATIONS: 'SHOW_CALCULATIONS',
  REVIEW_CALCULATIONS: 'REVIEW_CALCULATIONS',
  SHOW_LOI_STATUS: 'SHOW_LOI_STATUS',
  REVIEW_LOI: 'REVIEW_LOI',
  SIMULATE_OFFER_GENERATION: 'SIMULATE_OFFER_GENERATION',
  SIMULATE_OFFER_APPROVAL: 'SIMULATE_OFFER_APPROVAL',
  CONFIRM_OFFER_DELIVERY: 'CONFIRM_OFFER_DELIVERY',
  SHOW_GCJ: 'SHOW_GCJ',
  MARK_STAGE3_COMPLETE: 'MARK_STAGE3_COMPLETE',
  SIMULATE_OFFER_SENT_EXIT: 'SIMULATE_OFFER_SENT_EXIT',
  SELECT_ALTERNATE_OUTCOME: 'SELECT_ALTERNATE_OUTCOME',
});

function unavailable(action, session, blockingReason, requiredPriorStates = [], ruleIds = []) {
  return {
    action, available: false, blockingReason, requiredPriorStates,
    currentState: session.state, nextCourseStep: session.nextExactCourseStep,
    canonicalRuleIds: ruleIds, decisionIds: ruleIds.map(r => contract.RESOLVED_RULES[r]?.decisionId).filter(Boolean),
    sideEffectsPermitted: [], sideEffectsProhibited: ['state_mutation', 'production_write', 'production_send'],
  };
}

function available(action, session, requiredPriorStates = [], ruleIds = []) {
  return {
    action, available: true, blockingReason: '', requiredPriorStates,
    currentState: session.state, nextCourseStep: session.nextExactCourseStep,
    canonicalRuleIds: ruleIds, decisionIds: ruleIds.map(r => contract.RESOLVED_RULES[r]?.decisionId).filter(Boolean),
    sideEffectsPermitted: ['state_mutation', 'journal_append'], sideEffectsProhibited: ['production_write', 'production_send'],
  };
}

function evaluateActionAvailability(session, action) {
  if (action === STAGE3_ACTIONS.START_REVIEW) return available(action, session, [], ['S3_ENTRY_001']);
  if (action === STAGE3_ACTIONS.SHOW_HANDOFF) return available(action, session, [], ['S3_RESP_001']);
  if (action === STAGE3_ACTIONS.REVIEW_HANDOFF) return available(action, session, [], ['S3_RESP_001']);
  if (action === STAGE3_ACTIONS.RECORD_UNDERWRITING) return available(action, session, [], ['S3_DATA_001']);
  if (action === STAGE3_ACTIONS.REVIEW_UNDERWRITING) {
    const missing = tx.missingUnderwritingData(session);
    if (missing.length) return unavailable(action, session, `UNDERWRITING_DATA_INCOMPLETE: ${missing.join(', ')}`, [], ['S3_DATA_001']);
    return available(action, session, [], ['S3_DATA_001']);
  }
  if (action === STAGE3_ACTIONS.SELECT_OFFER_TYPE) return available(action, session, [], ['S3_TYPE_001']);
  if (action === STAGE3_ACTIONS.SHOW_CALCULATIONS) {
    if (!session.offerType) return unavailable(action, session, 'OFFER_TYPE_NOT_SELECTED', [], ['S3_CALC_001']);
    return available(action, session, [], ['S3_CALC_001']);
  }
  if (action === STAGE3_ACTIONS.REVIEW_CALCULATIONS) {
    if (!session.offerType) return unavailable(action, session, 'OFFER_TYPE_NOT_SELECTED', [], ['S3_CALC_001']);
    return available(action, session, [], ['S3_CALC_001']);
  }
  if (action === STAGE3_ACTIONS.SHOW_LOI_STATUS) return available(action, session, [], ['S3_LOI_001']);
  if (action === STAGE3_ACTIONS.REVIEW_LOI) return available(action, session, [], ['S3_LOI_001']);
  if (action === STAGE3_ACTIONS.SIMULATE_OFFER_GENERATION) {
    if (!session.loiReviewed) return unavailable(action, session, 'LOI_NOT_REVIEWED', [], ['S3_RESP_001']);
    return available(action, session, [], ['S3_RESP_001']);
  }
  if (action === STAGE3_ACTIONS.SIMULATE_OFFER_APPROVAL) {
    if (session.offerStatus !== contract.OFFER_STATUS.OFFER_GENERATED) return unavailable(action, session, 'OFFER_NOT_GENERATED', [], ['S3_RESP_001']);
    return available(action, session, [], ['S3_RESP_001']);
  }
  if (action === STAGE3_ACTIONS.CONFIRM_OFFER_DELIVERY) {
    if (session.offerStatus !== contract.OFFER_STATUS.OFFER_APPROVED) return unavailable(action, session, 'OFFER_NOT_APPROVED', [], ['S3_EXIT_001']);
    return available(action, session, [], ['S3_EXIT_001']);
  }
  if (action === STAGE3_ACTIONS.SHOW_GCJ) {
    if (!session.gcjAvailable) return unavailable(action, session, 'GCJ_BLOCKED_NO_TRIGGER', [], ['S3_GCJ_001']);
    return available(action, session, [], ['S3_GCJ_001']);
  }
  if (action === STAGE3_ACTIONS.MARK_STAGE3_COMPLETE) {
    const missing = tx.missingRequirements(session);
    if (missing.length) return unavailable(action, session, `REQUIRED_ACTIONS_UNRESOLVED: ${missing.join(', ')}`, [], ['S3_EXIT_001']);
    return available(action, session, [], ['S3_EXIT_001']);
  }
  if (action === STAGE3_ACTIONS.SIMULATE_OFFER_SENT_EXIT) {
    const missing = tx.missingRequirements(session);
    if (missing.length) return unavailable(action, session, `EXIT_BLOCKED: ${missing.join(', ')}`, [], ['S3_EXIT_001']);
    return available(action, session, [], ['S3_EXIT_001']);
  }
  if (action === STAGE3_ACTIONS.SELECT_ALTERNATE_OUTCOME) {
    return unavailable(action, session, 'S3_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN', [], ['S3_ALT_001']);
  }
  return available(action, session);
}

module.exports = { STAGE3_ACTIONS, evaluateActionAvailability };
