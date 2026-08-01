'use strict';

const crypto = require('crypto');
const contract = require('./kayla-stage2-contract');
const { CONTACT_PATHS } = require('./kayla-stage1-contact-path');

function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function nowIso(now = new Date()) { return now instanceof Date ? now.toISOString() : new Date(now).toISOString(); }

function createStage2Session(stage1Session, options = {}) {
  const path = stage1Session.selectedContactPath;
  const propertyAddress = stage1Session.property?.address || '';
  return {
    schema: 'kayla-stage2-transaction-v1',
    transactionId: options.transactionId || `stage2_${stableHash({ opportunityId: stage1Session.opportunityId, propertyAddress }).slice(0, 16)}`,
    sessionId: options.sessionId || `stage2_session_${stableHash({ operatorId: options.operatorId || 'operator', propertyAddress, at: options.createdAt || nowIso() }).slice(0, 16)}`,
    opportunityId: stage1Session.opportunityId || '',
    property: { address: propertyAddress, fingerprint: stage1Session.property?.fingerprint || stableHash(propertyAddress.toLowerCase()).slice(0, 16) },
    currentPipelineStage: 'Contact Made',
    contactPath: path,
    stage1SessionRef: {
      sessionId: stage1Session.sessionId,
      transactionId: stage1Session.transactionId,
      state: stage1Session.state,
      callOutcome: stage1Session.callOutcome,
      intStatus: stage1Session.intStatus,
      cccStatus: stage1Session.cccStatus,
      contactCardStatus: stage1Session.contactCardStatus,
      notesStatus: stage1Session.notesStatus,
      selectedContactPath: stage1Session.selectedContactPath,
      selectedContactRelationship: stage1Session.selectedContactRelationship,
      collectedFields: stage1Session.collectedFields || {},
      fieldDispositions: stage1Session.fieldDispositions || {},
      attemptHistory: stage1Session.attemptHistory || [],
    },
    importedFacts: importStage1Facts(stage1Session),
    cccConfirmed: stage1Session.cccStatus === 'CONFIRMED_SENT',
    contactCardConfirmed: stage1Session.contactCardStatus === 'CONFIRMED_SENT',
    notesRecorded: stage1Session.notesStatus === 'CONFIRMED_RECORDED',
    callCompleted: stage1Session.callOutcome === 'COMPLETED',
    fieldDispositions: { ...(stage1Session.fieldDispositions || {}) },
    dealType: '',
    compsEvidence: '',
    rentViability: '',
    rehabEvidence: '',
    f50Eligible: false,
    f10Eligible: false,
    handoffDestination: contract.handoffDestination(path) || '',
    handoffDraft: '',
    handoffSubmitted: false,
    gcjTrigger: contract.GCJ_TRIGGERS.BLOCKED,
    gcjAvailable: false,
    completionStatus: '',
    exitEligible: false,
    operatorConfirmations: {},
    unresolvedRequirements: [],
    nextExactCourseStep: 'Review Stage 1 call facts and confirm Contact Made entry.',
    state: contract.STAGE2_STATES.STAGE2_ENTRY_REVIEW_REQUIRED,
    journal: [],
    counters: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 },
    blockedCapabilities: [contract.S2_ALT_OUTCOME_STATUS],
    canonicalRuleRefs: Object.keys(contract.RESOLVED_RULES).filter(k => contract.RESOLVED_RULES[k].classification !== 'COURSE_UNKNOWN'),
    unresolvedRuleRefs: Object.keys(contract.RESOLVED_RULES).filter(k => contract.RESOLVED_RULES[k].classification === 'COURSE_UNKNOWN'),
  };
}

function importStage1Facts(stage1Session) {
  const facts = [];
  const fields = stage1Session.collectedFields || {};
  const dispositions = stage1Session.fieldDispositions || {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'fieldDispositions' || key === 'fieldDispositionReasons') continue;
    facts.push({
      field: key,
      value: String(value || ''),
      disposition: dispositions[key] || 'RECORDED',
      source: 'STAGE1_SESSION',
      operatorId: stage1Session.operatorId || 'operator',
      timestamp: stage1Session.journal?.slice(-1)[0]?.timestamp || nowIso(),
      editable: true,
    });
  }
  return facts;
}

function evaluateEntry(session) {
  if (!session.contactPath || session.contactPath === CONTACT_PATHS.RESEARCH_REQUIRED) {
    return { allowed: false, reason: 'ENTRY_BLOCKED_RESEARCH_REQUIRED', detail: 'Contact path is not established.' };
  }
  if (!session.callCompleted) {
    return { allowed: false, reason: 'ENTRY_BLOCKED_NO_COMPLETED_CONVERSATION', detail: 'No completed call is recorded.' };
  }
  if (!session.cccConfirmed) {
    return { allowed: false, reason: 'ENTRY_BLOCKED_CCC_UNCONFIRMED', detail: 'CCC has not been confirmed sent.' };
  }
  if (!session.contactCardConfirmed) {
    return { allowed: false, reason: 'ENTRY_BLOCKED_CONTACT_CARD_UNCONFIRMED', detail: 'Contact card has not been confirmed sent.' };
  }
  if (!session.notesRecorded) {
    return { allowed: false, reason: 'ENTRY_BLOCKED_NOTES_MISSING', detail: 'Call notes have not been recorded.' };
  }
  return { allowed: true, reason: 'ENTRY_ALLOWED', detail: 'All entry prerequisites are satisfied.' };
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
    canonicalRuleIds: ruleIdsForEvent(type),
    source: 'kayla-stage2-transaction',
    payloadHash: stableHash(payload),
    idempotencyKey,
    mode: 'SIMULATION',
  };
  session.journal.push(event);
  return { session, event, duplicate: false };
}

function applyEvent(session, type, payload) {
  if (type === 'STAGE2_SESSION_STARTED') {
    session.state = contract.STAGE2_STATES.STAGE2_ENTRY_REVIEW_REQUIRED;
  } else if (type === 'STAGE1_HANDOFF_LOADED') {
    session.operatorConfirmations.stage1Loaded = true;
  } else if (type === 'STAGE2_ENTRY_VERIFIED') {
    const entry = evaluateEntry(session);
    if (!entry.allowed) return block(session, entry.reason);
    session.operatorConfirmations.entryVerified = true;
    session.state = contract.STAGE2_STATES.CONTACT_FACTS_REVIEW_REQUIRED;
  } else if (type === 'FIELD_REVIEWED') {
    session.operatorConfirmations.factsReviewed = true;
    refreshFactsState(session);
  } else if (type === 'FIELD_VALUE_RECORDED') {
    updateFact(session, payload.fieldId, payload.value, 'RECORDED');
    refreshFactsState(session);
  } else if (type === 'FIELD_MARKED_UNKNOWN') {
    updateFact(session, payload.fieldId, payload.value || 'unknown', contract.FIELD_DISPOSITIONS.UNKNOWN_NOT_PROVIDED);
    refreshFactsState(session);
  } else if (type === 'FIELD_MARKED_NOT_APPLICABLE') {
    updateFact(session, payload.fieldId, payload.value || 'n/a', contract.FIELD_DISPOSITIONS.NOT_APPLICABLE);
    refreshFactsState(session);
  } else if (type === 'FIELD_MARKED_DEFERRED') {
    updateFact(session, payload.fieldId, payload.value || 'deferred', contract.FIELD_DISPOSITIONS.DEFERRED_COURSE_ALLOWED);
    refreshFactsState(session);
  } else if (type === 'CCC_CONFIRMED') {
    session.cccConfirmed = true;
    session.state = session.contactCardConfirmed ? contract.STAGE2_STATES.CONTACT_FACTS_REVIEW_REQUIRED : contract.STAGE2_STATES.CONTACT_CARD_CONFIRMATION_REQUIRED;
  } else if (type === 'CONTACT_CARD_CONFIRMED') {
    session.contactCardConfirmed = true;
    session.state = session.cccConfirmed ? contract.STAGE2_STATES.CONTACT_FACTS_REVIEW_REQUIRED : contract.STAGE2_STATES.CCC_CONFIRMATION_REQUIRED;
  } else if (type === 'DEAL_TYPE_CLASSIFIED') {
    session.dealType = payload.dealType;
    if (payload.dealType === contract.DEAL_TYPES.TURNKEY) {
      session.state = contract.STAGE2_STATES.COMPS_OR_RENT_REVIEW_REQUIRED;
      session.f50Eligible = true;
      session.f10Eligible = false;
    } else if (payload.dealType === contract.DEAL_TYPES.RENOVATION) {
      session.state = contract.STAGE2_STATES.REHAB_EVIDENCE_REQUIRED;
      session.f10Eligible = true;
      session.f50Eligible = false;
    }
  } else if (type === 'COMPS_REVIEWED') {
    session.compsEvidence = payload.evidence || 'reviewed';
    session.state = contract.STAGE2_STATES.EVALUATION_COMPLETE;
  } else if (type === 'RENT_VIABILITY_RECORDED') {
    session.rentViability = payload.evidence || 'recorded';
  } else if (type === 'REHAB_EVIDENCE_RECORDED') {
    session.rehabEvidence = payload.evidence || 'recorded';
    session.state = contract.STAGE2_STATES.EVALUATION_COMPLETE;
  } else if (type === 'F50_REVIEWED') {
    if (!session.f50Eligible) return block(session, 'F50_BLOCKED_WRONG_DEAL_TYPE');
    session.operatorConfirmations.f50Reviewed = true;
  } else if (type === 'F10_REVIEWED') {
    if (!session.f10Eligible) return block(session, 'F10_BLOCKED_WRONG_DEAL_TYPE');
    session.operatorConfirmations.f10Reviewed = true;
  } else if (type === 'HANDOFF_DRAFT_CREATED') {
    session.handoffDraft = payload.draft || '';
    session.state = contract.STAGE2_STATES.HANDOFF_DRAFT_READY;
  } else if (type === 'HANDOFF_DRAFT_REVIEWED') {
    session.operatorConfirmations.handoffReviewed = true;
  } else if (type === 'HANDOFF_SUBMISSION_SIMULATED') {
    session.handoffSubmitted = true;
    session.state = contract.STAGE2_STATES.HANDOFF_SUBMITTED_CONFIRMED;
  } else if (type === 'GCJ_REVIEWED') {
    if (!session.gcjAvailable) return block(session, 'GCJ_BLOCKED_NO_TRIGGER');
    session.operatorConfirmations.gcjReviewed = true;
  } else if (type === 'STAGE2_OPERATOR_WORK_COMPLETE') {
    const missing = missingRequirements(session);
    if (missing.length) return block(session, `REQUIRED_ACTIONS_UNRESOLVED: ${missing.join(', ')}`);
    session.completionStatus = 'COMPLETE';
    session.state = contract.STAGE2_STATES.STAGE2_OPERATOR_WORK_COMPLETE;
  } else if (type === 'OFFER_READY_MOVE_SIMULATED') {
    const missing = missingRequirements(session);
    if (missing.length) return block(session, `EXIT_BLOCKED: ${missing.join(', ')}`);
    session.exitEligible = true;
    session.state = contract.STAGE2_STATES.OFFER_READY_EXIT_ELIGIBLE;
  } else if (type === 'ALTERNATE_OUTCOME_BLOCKED') {
    session.state = contract.STAGE2_STATES.S2_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN;
  } else if (type === 'SESSION_CANCELED') {
    session.state = contract.STAGE2_STATES.SESSION_CANCELED;
  }
  refreshNext(session);
}

function updateFact(session, fieldId, value, disposition) {
  const existing = session.importedFacts.find(f => f.field === fieldId);
  if (existing) {
    existing.value = String(value || '');
    existing.disposition = disposition;
    existing.editable = true;
  } else {
    session.importedFacts.push({
      field: fieldId,
      value: String(value || ''),
      disposition,
      source: 'STAGE2_OPERATOR',
      operatorId: 'operator',
      timestamp: nowIso(),
      editable: true,
    });
  }
  session.fieldDispositions[fieldId] = disposition;
}

function refreshFactsState(session) {
  const missing = missingRequiredFacts(session);
  session.state = missing.length ? contract.STAGE2_STATES.CONTACT_FACTS_INCOMPLETE : contract.STAGE2_STATES.CONTACT_FACTS_RESOLVED;
}

function missingRequiredFacts(session) {
  const path = session.contactPath;
  const matrix = contract.RESOLVED_RULES.S2_DATA_001.fieldMatrix[path];
  if (!matrix) return [];
  const missing = [];
  for (const [fieldId, requirement] of Object.entries(matrix)) {
    if (requirement === contract.FIELD_REQUIREMENT.NOT_REQUIRED || requirement === contract.FIELD_REQUIREMENT.OPTIONAL) continue;
    const fact = session.importedFacts.find(f => f.field === fieldId);
    const disposition = fact?.disposition || session.fieldDispositions[fieldId];
    if (requirement === contract.FIELD_REQUIREMENT.MANDATORY && disposition !== contract.FIELD_DISPOSITIONS.RECORDED) {
      missing.push(fieldId);
    } else if (requirement === contract.FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED) {
      if (!disposition || disposition === contract.FIELD_DISPOSITIONS.UNRESOLVED_REQUIRED) missing.push(fieldId);
    } else if (requirement === contract.FIELD_REQUIREMENT.CONDITIONAL) {
      if (conditionApplies(session, fieldId) && (!disposition || disposition === contract.FIELD_DISPOSITIONS.UNRESOLVED_REQUIRED)) missing.push(fieldId);
    }
  }
  return missing;
}

function conditionApplies(session, fieldId) {
  if (fieldId === 'monthlyRent' || fieldId === 'leaseTerms') {
    const occupancy = session.importedFacts.find(f => f.field === 'occupancy');
    return occupancy?.value === 'occupied';
  }
  return true;
}

function missingRequirements(session) {
  const items = [];
  if (!session.cccConfirmed) items.push('CCC_CONFIRMATION');
  if (!session.contactCardConfirmed) items.push('CONTACT_CARD_CONFIRMATION');
  const missingFacts = missingRequiredFacts(session);
  if (missingFacts.length) items.push(...missingFacts.map(f => `FIELD:${f}`));
  if (!session.dealType) items.push('DEAL_TYPE_EVALUATION');
  if (session.dealType === contract.DEAL_TYPES.TURNKEY && !session.compsEvidence) items.push('COMPS_REVIEW');
  if (session.dealType === contract.DEAL_TYPES.RENOVATION && !session.rehabEvidence) items.push('REHAB_EVIDENCE');
  if (!session.handoffSubmitted) items.push('HANDOFF_SUBMISSION');
  return items;
}

function block(session, reason) {
  session.lastBlockedReason = reason;
}

function ruleIdsForEvent(type) {
  if (/ENTRY|HANDOFF_LOADED/.test(type)) return ['S2-ENTRY-001'];
  if (/FIELD|FACT/.test(type)) return ['S2-DATA-001'];
  if (/CCC|CONTACT_CARD/.test(type)) return ['S2-CCC-001'];
  if (/DEAL_TYPE|COMPS|RENT_VIABILITY|REHAB/.test(type)) return ['S2-EVAL-001'];
  if (/F50/.test(type)) return ['S2-F50-001'];
  if (/F10/.test(type)) return ['S2-F50-001'];
  if (/HANDOFF/.test(type)) return ['S2-HANDOFF-001'];
  if (/GCJ/.test(type)) return ['S2-GCJ-001'];
  if (/OFFER_READY|STAGE2_OPERATOR_WORK/.test(type)) return ['S2-EXIT-001'];
  if (/ALTERNATE/.test(type)) return ['S2-ALT-001'];
  return ['STAGE2_OPERATOR_TRANSACTION'];
}

function refreshNext(session) {
  const state = session.state;
  const map = {
    [contract.STAGE2_STATES.STAGE2_ENTRY_REVIEW_REQUIRED]: 'Review Stage 1 call facts and confirm Contact Made entry.',
    [contract.STAGE2_STATES.STAGE2_ENTRY_BLOCKED_STAGE1_INCOMPLETE]: 'Stage 1 work is incomplete. Complete Stage 1 before entering Contact Made.',
    [contract.STAGE2_STATES.CONTACT_FACTS_REVIEW_REQUIRED]: 'Review contact facts and resolve missing required information.',
    [contract.STAGE2_STATES.CONTACT_FACTS_INCOMPLETE]: 'Required information is unresolved. Record answers or mark unknown/not-provided where allowed.',
    [contract.STAGE2_STATES.CONTACT_FACTS_RESOLVED]: 'Contact facts are resolved. Proceed to deal type evaluation.',
    [contract.STAGE2_STATES.CCC_CONFIRMATION_REQUIRED]: 'Confirm CCC was sent after the completed call.',
    [contract.STAGE2_STATES.CONTACT_CARD_CONFIRMATION_REQUIRED]: 'Confirm contact card was sent after the completed call.',
    [contract.STAGE2_STATES.DEAL_TYPE_EVALUATION_REQUIRED]: 'Classify the property as turnkey/good condition or renovation/older.',
    [contract.STAGE2_STATES.TURNKEY_EVALUATION]: 'Turnkey selected. Review rental comps and rent viability.',
    [contract.STAGE2_STATES.RENOVATION_EVALUATION]: 'Renovation selected. Record rehab estimate and market rent.',
    [contract.STAGE2_STATES.COMPS_OR_RENT_REVIEW_REQUIRED]: 'Review rental comps and rent viability for this turnkey property.',
    [contract.STAGE2_STATES.REHAB_EVIDENCE_REQUIRED]: 'Record rehab estimate and market rent for this renovation property.',
    [contract.STAGE2_STATES.EVALUATION_COMPLETE]: 'Evaluation complete. Prepare handoff to closer team.',
    [contract.STAGE2_STATES.HANDOFF_PREPARATION_REQUIRED]: 'Prepare the information package for handoff.',
    [contract.STAGE2_STATES.HANDOFF_DRAFT_READY]: 'Handoff draft is ready. Review and confirm submission.',
    [contract.STAGE2_STATES.HANDOFF_SUBMITTED_CONFIRMED]: 'Handoff submitted. Stage 2 work is complete. Confirm movement to Offer Ready.',
    [contract.STAGE2_STATES.OFFER_READY_EXIT_ELIGIBLE]: 'Course requirements for moving Contact Made to Offer Ready are satisfied in this simulated session. No production stage movement occurred.',
    [contract.STAGE2_STATES.STAGE2_OPERATOR_WORK_COMPLETE]: 'Stage 2 operator work is complete.',
    [contract.STAGE2_STATES.S2_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN]: 'The course corpus does not define the standardized Stage 2 alternate outcome for this situation. The record remains under operator review; no stage or follow-up action was created.',
    [contract.STAGE2_STATES.SESSION_CANCELED]: 'Stage 2 session canceled.',
  };
  session.unresolvedRequirements = missingRequirements(session);
  session.nextExactCourseStep = map[state] || 'Continue the course-defined Stage 2 sequence.';
}

function buildStage2Note(session, operatorNotes = '') {
  const facts = {};
  for (const f of session.importedFacts) facts[f.field] = f;
  return [
    'KAYLA STAGE 2 CONTACT MADE REVIEW',
    '',
    `Property: ${session.property.address || '(missing)'}`,
    `Contact path: ${session.contactPath || '(not established)'}`,
    `Primary contact: ${(facts.contactName || {}).value || '(not confirmed)'}`,
    `Completed contact evidence: ${session.callCompleted ? 'yes' : 'not confirmed'}`,
    `CCC/contact card: ${session.cccConfirmed && session.contactCardConfirmed ? 'confirmed' : 'not confirmed'}`,
    `Stage 1 facts reviewed: ${session.operatorConfirmations.factsReviewed ? 'yes' : 'no'}`,
    `Occupancy: ${(facts.occupancy || {}).value || '(not recorded)'}`,
    `Roof: ${(facts.roofAge || {}).value || '(not recorded)'} [${(facts.roofAge || {}).disposition || 'UNRESOLVED'}]`,
    `HVAC: ${(facts.hvacAge || {}).value || '(not recorded)'} [${(facts.hvacAge || {}).disposition || 'UNRESOLVED'}]`,
    `Rent: ${(facts.monthlyRent || {}).value || '(not recorded)'}`,
    `Lease: ${(facts.leaseTerms || {}).value || '(not recorded)'}`,
    `Utilities: ${(facts.utilityResponsibility || {}).value || '(not recorded)'}`,
    `Feedback: ${(facts.listingFeedback || facts.buyerFeedback || {}).value || '(not recorded)'}`,
    `Motivation: ${(facts.sellerMotivation || {}).value || '(not recorded)'}`,
    `Timeline: ${(facts.sellerTimeline || {}).value || '(not recorded)'}`,
    `Asking/net price: ${(facts.askingPrice || facts.netPrice || {}).value || '(not recorded)'}`,
    `Condition: ${(facts.propertyCondition || {}).value || '(not recorded)'}`,
    `Repairs: ${(facts.repairEstimate || {}).value || '(not recorded)'}`,
    `Photos: ${(facts.photos || {}).value || '(not recorded)'}`,
    `Comps/rent evidence: ${session.compsEvidence || '(not recorded)'}`,
    `Deal classification: ${session.dealType || '(not evaluated)'}`,
    `F50 eligibility: ${session.f50Eligible ? 'available' : 'not available'}`,
    `F10 eligibility: ${session.f10Eligible ? 'available' : 'not available'}`,
    `Handoff destination: ${session.handoffDestination || '(not set)'}`,
    `Handoff status: ${session.handoffSubmitted ? 'submitted' : 'not submitted'}`,
    `GCJ status: ${session.gcjAvailable ? 'available' : 'not available'}`,
    `Unresolved facts: ${missingRequiredFacts(session).join(', ') || 'none'}`,
    `Alternate outcome status: ${contract.S2_ALT_OUTCOME_STATUS}`,
    `Offer Ready eligibility: ${session.exitEligible ? 'eligible' : 'not eligible'}`,
    `Operator notes: ${operatorNotes || '(none)'}`,
    `Next course step: ${session.nextExactCourseStep}`,
    `Canonical rule references: ${session.canonicalRuleRefs.join(', ')}`,
  ].join('\n');
}

module.exports = {
  createStage2Session,
  evaluateEntry,
  addEvent,
  buildStage2Note,
  missingRequiredFacts,
  missingRequirements,
};
