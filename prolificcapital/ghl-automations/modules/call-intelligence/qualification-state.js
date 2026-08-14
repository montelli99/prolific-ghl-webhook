'use strict';

const PROPERTY_FIELDS = Object.freeze([
  'askingPrice', 'minimumPrice', 'timeline', 'occupancy', 'mortgageBalance', 'propertyType', 'bedrooms', 'bathrooms', 'squareFootage', 'yearBuilt', 'propertyCondition', 'marketStatus', 'creativeFinanceInterest',
]);

const CONTACT_FIELDS = Object.freeze([
  'decisionMakers',
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeFact(previous, next, callId, scope) {
  if (!next || next.status === 'UNKNOWN') return previous || { status: 'UNKNOWN', value: null, confidence: 'low', evidence: null, sourceCallId: callId || null, firstObservedAt: null, lastObservedAt: nowIso(), lastConfirmedAt: null, scope };
  if (!previous || previous.status === 'UNKNOWN') {
    return { ...next, sourceCallId: callId, firstObservedAt: nowIso(), lastObservedAt: nowIso(), lastConfirmedAt: ['KNOWN', 'PARTIAL', 'NEEDS_CONFIRMATION', 'NOT_APPLICABLE'].includes(next.status) ? nowIso() : null, scope };
  }
  if (previous.value !== undefined && next.value !== undefined && previous.value !== null && next.value !== null && JSON.stringify(previous.value) !== JSON.stringify(next.value)) {
    return {
      status: 'CONFLICTING',
      value: previous.value,
      conflictingValue: next.value,
      confidence: 'medium',
      evidence: next.evidence || previous.evidence || null,
      sourceCallId: previous.sourceCallId || null,
      firstObservedAt: previous.firstObservedAt || nowIso(),
      lastObservedAt: nowIso(),
      lastConfirmedAt: previous.lastConfirmedAt || null,
      priorCallId: previous.sourceCallId || null,
      newCallId: callId,
      scope,
    };
  }
  return {
    ...previous,
    ...next,
    sourceCallId: callId,
    firstObservedAt: previous.firstObservedAt || nowIso(),
    lastObservedAt: nowIso(),
    lastConfirmedAt: next.status === 'KNOWN' ? nowIso() : previous.lastConfirmedAt || null,
    scope,
  };
}

function mergeQualification(previous = {}, facts = {}, context = {}) {
  const qualification = previous.qualification || {};
  const merged = {};
  for (const field of PROPERTY_FIELDS) merged[field] = normalizeFact(qualification[field], facts[field], context.callId, 'property');
  for (const field of CONTACT_FIELDS) merged[field] = normalizeFact(qualification[field], facts[field], context.callId, 'contact');
  merged.motivation = normalizeFact(qualification.motivation, facts.motivation, context.callId, 'property');
  merged.callback = normalizeFact(qualification.callback, facts.callbackRequested ? { status: 'KNOWN', value: facts.preferredCallbackTime || facts.callbackWindow?.raw || 'requested', confidence: facts.callbackWindow?.confidence || 'medium', evidence: facts.callbackWindow?.evidence || null } : { status: 'UNKNOWN', value: null, confidence: 'low', evidence: null }, context.callId, 'contact');
  merged.commitments = [
    ...(qualification.commitments || []),
    ...((facts.promises || []).map((promise, index) => ({
      id: `${context.callId}:${promise.party}:${promise.type}:${index}`,
      party: promise.party,
      type: promise.type,
      description: promise.description,
      sourceCallId: context.callId,
      dueAt: null,
      status: 'pending',
      createdAt: nowIso(),
      completedAt: null,
      evidence: promise.evidence || null,
    }))),
  ];
  return {
    propertyId: context.propertyId || previous.propertyId || null,
    contactId: context.contactId || previous.contactId || null,
    opportunityId: context.opportunityId || previous.opportunityId || null,
    qualification: merged,
  };
}

module.exports = { mergeQualification, PROPERTY_FIELDS, CONTACT_FIELDS };
