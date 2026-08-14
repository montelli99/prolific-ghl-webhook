'use strict';

const { buildRecommendedQuestions } = require('./recommended-questions');

function recommend(facts, qualificationState, missing, stageContext = {}) {
  const recommendedQuestions = buildRecommendedQuestions(qualificationState, stageContext);
  if (facts.dnc) return { state: 'DNC', recommendedAction: 'dnc', recommendedStage: null, reason: 'Explicit do-not-call request detected.', confidence: 'high', ownerApprovalRequired: false, nextCallObjective: 'Stop outreach immediately.', recommendedQuestions: [] };
  if (facts.wrongNumber) return { state: 'WRONG_NUMBER', recommendedAction: 'wrong_number_remediation', recommendedStage: null, reason: 'Wrong-number language detected.', confidence: 'high', ownerApprovalRequired: false, nextCallObjective: 'Remove the bad number and identify a valid seller contact path.', recommendedQuestions: [] };
  if (missing.conflicts.length) return { state: 'DATA_CONFLICT', recommendedAction: 'follow_up', recommendedStage: null, reason: `Resolve conflicting fields: ${missing.conflicts.join(', ')}`, confidence: 'medium', ownerApprovalRequired: true, nextCallObjective: 'Resolve the conflicting seller facts before progressing the deal.', recommendedQuestions };
  if (facts.callbackRequested) return { state: 'CALLBACK_SCHEDULED', recommendedAction: 'callback', recommendedStage: null, reason: 'Seller requested a callback.', confidence: 'high', ownerApprovalRequired: true, nextCallObjective: `Honor the callback request${facts.preferredCallbackTime ? ` (${facts.preferredCallbackTime})` : ''}.`, recommendedQuestions };
  if (!missing.missingCritical.length && !missing.missingBeforeOffer.length) return { state: 'QUALIFIED', recommendedAction: 'prepare_underwriting', recommendedStage: null, reason: 'Critical and before-offer information is sufficiently covered.', confidence: 'medium', ownerApprovalRequired: true, nextCallObjective: 'Advance toward underwriting or offer preparation.', recommendedQuestions };
  if (stageContext.stageName === 'Awaiting Photos') return { state: 'AWAITING_PHOTOS', recommendedAction: 'request_photos', recommendedStage: null, reason: 'Photos and visual condition context are still needed.', confidence: 'medium', ownerApprovalRequired: true, nextCallObjective: 'Get promised photos and confirm current condition.', recommendedQuestions };
  return { state: 'NEEDS_MORE_INFO', recommendedAction: 'continue_qualification', recommendedStage: null, reason: [...missing.missingCritical.map((field) => `Missing critical: ${field}`), ...missing.missingBeforeOffer.map((field) => `Missing before offer: ${field}`)].join('; ') || 'Continue qualification.', confidence: 'medium', ownerApprovalRequired: true, nextCallObjective: `Clarify ${missing.missingCritical.concat(missing.missingBeforeOffer).join(', ') || 'the remaining critical seller facts'}.`, recommendedQuestions };
}

module.exports = { recommend };
