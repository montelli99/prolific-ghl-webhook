'use strict';

const contract = require('./kayla-stage2-contract');
const tx = require('./kayla-stage2-transaction');

const STAGE2_ACTIONS = Object.freeze({
  START_REVIEW: 'START_REVIEW',
  SHOW_FACTS: 'SHOW_FACTS',
  UPDATE_FIELD_DISPOSITION: 'UPDATE_FIELD_DISPOSITION',
  EVALUATE_DEAL: 'EVALUATE_DEAL',
  SHOW_F50: 'SHOW_F50',
  SHOW_F10: 'SHOW_F10',
  DRAFT_HANDOFF: 'DRAFT_HANDOFF',
  CONFIRM_HANDOFF: 'CONFIRM_HANDOFF',
  SHOW_GCJ: 'SHOW_GCJ',
  MARK_STAGE2_COMPLETE: 'MARK_STAGE2_COMPLETE',
  SIMULATE_OFFER_READY_EXIT: 'SIMULATE_OFFER_READY_EXIT',
  SELECT_ALTERNATE_OUTCOME: 'SELECT_ALTERNATE_OUTCOME',
});

function unavailable(action, session, blockingReason, requiredPriorStates = [], ruleIds = []) {
  return {
    action,
    available: false,
    blockingReason,
    requiredPriorStates,
    currentState: session.state,
    nextCourseStep: session.nextExactCourseStep,
    canonicalRuleIds: ruleIds,
    decisionIds: ruleIds.map(r => contract.RESOLVED_RULES[r]?.decisionId).filter(Boolean),
    sideEffectsPermitted: [],
    sideEffectsProhibited: ['state_mutation', 'production_write', 'production_send'],
  };
}

function available(action, session, requiredPriorStates = [], ruleIds = []) {
  return {
    action,
    available: true,
    blockingReason: '',
    requiredPriorStates,
    currentState: session.state,
    nextCourseStep: session.nextExactCourseStep,
    canonicalRuleIds: ruleIds,
    decisionIds: ruleIds.map(r => contract.RESOLVED_RULES[r]?.decisionId).filter(Boolean),
    sideEffectsPermitted: ['state_mutation', 'journal_append'],
    sideEffectsProhibited: ['production_write', 'production_send'],
  };
}

function evaluateActionAvailability(session, action) {
  if (action === STAGE2_ACTIONS.START_REVIEW) {
    return available(action, session, [], ['S2_ENTRY_001']);
  }
  if (action === STAGE2_ACTIONS.SHOW_FACTS) {
    return available(action, session, [], ['S2_DATA_001']);
  }
  if (action === STAGE2_ACTIONS.UPDATE_FIELD_DISPOSITION) {
    return available(action, session, [], ['S2_DATA_001']);
  }
  if (action === STAGE2_ACTIONS.EVALUATE_DEAL) {
    const missing = tx.missingRequiredFacts(session);
    if (missing.length) return unavailable(action, session, `REQUIRED_FACTS_UNRESOLVED: ${missing.join(', ')}`, ['CONTACT_FACTS_RESOLVED'], ['S2_EVAL_001']);
    return available(action, session, ['CONTACT_FACTS_RESOLVED'], ['S2_EVAL_001']);
  }
  if (action === STAGE2_ACTIONS.SHOW_F50) {
    if (session.state !== contract.STAGE2_STATES.COMPS_OR_RENT_REVIEW_REQUIRED && session.state !== contract.STAGE2_STATES.EVALUATION_COMPLETE && session.state !== contract.STAGE2_STATES.TURNKEY_EVALUATION) return unavailable(action, session, 'F50_BLOCKED_WRONG_DEAL_TYPE: F50 is available only for turnkey/good condition properties.', ['TURNKEY_EVALUATION'], ['S2_F50_001']);
    if (session.dealType && session.dealType !== contract.DEAL_TYPES.TURNKEY) return unavailable(action, session, 'F50_BLOCKED_WRONG_DEAL_TYPE: F50 is available only for turnkey/good condition properties.', ['TURNKEY_EVALUATION'], ['S2_F50_001']);
    return available(action, session, ['TURNKEY_EVALUATION'], ['S2_F50_001']);
  }
  if (action === STAGE2_ACTIONS.SHOW_F10) {
    if (session.state !== contract.STAGE2_STATES.REHAB_EVIDENCE_REQUIRED && session.state !== contract.STAGE2_STATES.EVALUATION_COMPLETE && session.state !== contract.STAGE2_STATES.RENOVATION_EVALUATION) return unavailable(action, session, 'F10_BLOCKED_WRONG_DEAL_TYPE: F10 is available only for renovation/older properties.', ['RENOVATION_EVALUATION'], ['S2_F50_001']);
    if (session.dealType && session.dealType !== contract.DEAL_TYPES.RENOVATION) return unavailable(action, session, 'F10_BLOCKED_WRONG_DEAL_TYPE: F10 is available only for renovation/older properties.', ['RENOVATION_EVALUATION'], ['S2_F50_001']);
    return available(action, session, ['RENOVATION_EVALUATION'], ['S2_F50_001']);
  }
  if (action === STAGE2_ACTIONS.DRAFT_HANDOFF) {
    if (session.state !== contract.STAGE2_STATES.EVALUATION_COMPLETE && session.state !== contract.STAGE2_STATES.COMPS_OR_RENT_REVIEW_REQUIRED && session.state !== contract.STAGE2_STATES.REHAB_EVIDENCE_REQUIRED && session.state !== contract.STAGE2_STATES.HANDOFF_PREPARATION_REQUIRED && session.state !== contract.STAGE2_STATES.HANDOFF_DRAFT_READY) return unavailable(action, session, 'DEAL_TYPE_NOT_EVALUATED: Classify the property before preparing handoff.', ['DEAL_TYPE_CLASSIFIED'], ['S2_HANDOFF_001']);
    return available(action, session, ['EVALUATION_COMPLETE'], ['S2_HANDOFF_001']);
  }
  if (action === STAGE2_ACTIONS.CONFIRM_HANDOFF) {
    if (!session.handoffDraft) return unavailable(action, session, 'HANDOFF_NOT_DRAFTED: Draft the handoff before confirming.', ['HANDOFF_DRAFT_READY'], ['S2_HANDOFF_001']);
    return available(action, session, ['HANDOFF_DRAFT_READY'], ['S2_HANDOFF_001']);
  }
  if (action === STAGE2_ACTIONS.SHOW_GCJ) {
    if (!session.gcjAvailable) return unavailable(action, session, 'GCJ_BLOCKED_NO_TRIGGER: No course-supported GCJ trigger is present for this transaction.', [], ['S2_GCJ_001']);
    return available(action, session, [], ['S2_GCJ_001']);
  }
  if (action === STAGE2_ACTIONS.MARK_STAGE2_COMPLETE) {
    const missing = tx.missingRequirements(session);
    if (missing.length) return unavailable(action, session, `REQUIRED_ACTIONS_UNRESOLVED: ${missing.join(', ')}`, ['ALL_REQUIREMENTS_RESOLVED'], ['S2_EXIT_001']);
    return available(action, session, ['ALL_REQUIREMENTS_RESOLVED'], ['S2_EXIT_001']);
  }
  if (action === STAGE2_ACTIONS.SIMULATE_OFFER_READY_EXIT) {
    const missing = tx.missingRequirements(session);
    if (missing.length) return unavailable(action, session, `EXIT_BLOCKED: ${missing.join(', ')}`, ['ALL_REQUIREMENTS_RESOLVED'], ['S2_EXIT_001']);
    return available(action, session, ['ALL_REQUIREMENTS_RESOLVED'], ['S2_EXIT_001']);
  }
  if (action === STAGE2_ACTIONS.SELECT_ALTERNATE_OUTCOME) {
    return unavailable(action, session, 'S2_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN: The course corpus does not define the standardized Stage 2 alternate outcome for this situation. The record remains under operator review; no stage or follow-up action was created.', [], ['S2_ALT_001']);
  }
  return available(action, session);
}

module.exports = { STAGE2_ACTIONS, evaluateActionAvailability };
