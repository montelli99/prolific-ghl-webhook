'use strict';

const crypto = require('crypto');
const contract = require('./kayla-stage3-contract');
const { CONTACT_PATHS } = require('./kayla-stage1-contact-path');

function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function nowIso(now = new Date()) { return now instanceof Date ? now.toISOString() : new Date(now).toISOString(); }

function createStage3Session(stage2Session, options = {}) {
  const path = stage2Session.contactPath;
  const propertyAddress = stage2Session.property?.address || '';
  return {
    schema: 'kayla-stage3-transaction-v1',
    transactionId: options.transactionId || `stage3_${stableHash({ opportunityId: stage2Session.opportunityId, propertyAddress }).slice(0, 16)}`,
    sessionId: options.sessionId || `stage3_session_${stableHash({ operatorId: options.operatorId || 'operator', propertyAddress, at: options.createdAt || nowIso() }).slice(0, 16)}`,
    opportunityId: stage2Session.opportunityId || '',
    property: { address: propertyAddress, fingerprint: stage2Session.property?.fingerprint || stableHash(propertyAddress.toLowerCase()).slice(0, 16) },
    currentPipelineStage: 'Offer Ready to be Sent to Seller',
    contactPath: path,
    stage2SessionRef: {
      sessionId: stage2Session.sessionId,
      transactionId: stage2Session.transactionId,
      state: stage2Session.state,
      dealType: stage2Session.dealType,
      handoffDestination: stage2Session.handoffDestination,
      handoffSubmitted: stage2Session.handoffSubmitted,
      exitEligible: stage2Session.exitEligible,
    },
    importedFacts: importStage2Facts(stage2Session),
    handoffReviewed: false,
    underwritingData: {},
    offerType: '',
    offerStatus: contract.OFFER_STATUS.NOT_STARTED,
    calculationsDisplayed: false,
    loiReviewed: false,
    offerDeliveryConfirmed: false,
    offerSentDate: '',
    gcjAvailable: false,
    gcjTrigger: '',
    completionStatus: '',
    exitEligible: false,
    operatorConfirmations: {},
    unresolvedRequirements: [],
    nextExactCourseStep: 'Review Stage 2 handoff and confirm Offer Ready entry.',
    state: contract.STAGE3_STATES.STAGE3_ENTRY_REVIEW_REQUIRED,
    journal: [],
    counters: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 },
    blockedCapabilities: [contract.S3_ALT_OUTCOME_STATUS],
    canonicalRuleRefs: Object.keys(contract.RESOLVED_RULES).filter(k => contract.RESOLVED_RULES[k].classification !== 'COURSE_UNKNOWN'),
    unresolvedRuleRefs: Object.keys(contract.RESOLVED_RULES).filter(k => contract.RESOLVED_RULES[k].classification === 'COURSE_UNKNOWN'),
  };
}

function importStage2Facts(stage2Session) {
  const facts = [];
  const imported = stage2Session.importedFacts || [];
  for (const f of imported) {
    facts.push({ ...f, source: 'STAGE2_SESSION' });
  }
  return facts;
}

function evaluateEntry(session) {
  const s2 = session.stage2SessionRef || {};
  if (!s2.exitEligible && s2.state !== 'OFFER_READY_EXIT_ELIGIBLE' && s2.state !== 'STAGE2_OPERATOR_WORK_COMPLETE') {
    return { allowed: false, reason: 'ENTRY_BLOCKED_STAGE2_INCOMPLETE', detail: 'Stage 2 work is not complete. Complete Stage 2 before entering Offer Ready.' };
  }
  if (!s2.handoffSubmitted) {
    return { allowed: false, reason: 'ENTRY_BLOCKED_HANDOFF_NOT_SUBMITTED', detail: 'Handoff has not been submitted to the closer team.' };
  }
  return { allowed: true, reason: 'ENTRY_ALLOWED', detail: 'Stage 2 complete. Handoff submitted. Ready for Offer Ready.' };
}

function addEvent(session, type, payload = {}, options = {}) {
  const priorState = session.state;
  const idempotencyKey = options.idempotencyKey || stableHash({ sessionId: session.sessionId, type, priorState, payload });
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
    source: 'kayla-stage3-transaction',
    payloadHash: stableHash(payload),
    idempotencyKey,
    mode: 'SIMULATION',
  };
  session.journal.push(event);
  return { session, event, duplicate: false };
}

function applyEvent(session, type, payload) {
  if (type === 'STAGE3_SESSION_STARTED') {
    session.state = contract.STAGE3_STATES.STAGE3_ENTRY_REVIEW_REQUIRED;
  } else if (type === 'STAGE2_HANDOFF_LOADED') {
    session.operatorConfirmations.handoffLoaded = true;
  } else if (type === 'STAGE3_ENTRY_VERIFIED') {
    const entry = evaluateEntry(session);
    if (!entry.allowed) return block(session, entry.reason);
    session.operatorConfirmations.entryVerified = true;
    session.state = contract.STAGE3_STATES.HANDOFF_REVIEW_REQUIRED;
  } else if (type === 'HANDOFF_REVIEWED') {
    session.handoffReviewed = true;
    session.state = contract.STAGE3_STATES.UNDERWRITING_DATA_REVIEW_REQUIRED;
  } else if (type === 'UNDERWRITING_DATA_RECORDED') {
    Object.assign(session.underwritingData, payload.data || {});
    refreshUnderwritingState(session);
  } else if (type === 'UNDERWRITING_DATA_REVIEWED') {
    session.operatorConfirmations.underwritingReviewed = true;
    session.state = contract.STAGE3_STATES.OFFER_TYPE_SELECTION_REQUIRED;
  } else if (type === 'OFFER_TYPE_SELECTED') {
    session.offerType = payload.offerType;
    session.state = contract.STAGE3_STATES.CALCULATIONS_DISPLAYED;
  } else if (type === 'CALCULATIONS_REVIEWED') {
    session.calculationsDisplayed = true;
    session.operatorConfirmations.calculationsReviewed = true;
    session.state = contract.STAGE3_STATES.LOI_STATUS_REVIEWED;
  } else if (type === 'LOI_STATUS_REVIEWED') {
    session.loiReviewed = true;
    session.offerStatus = contract.OFFER_STATUS.LOI_GENERATED;
    session.state = contract.STAGE3_STATES.OFFER_GENERATION_AWAITED;
  } else if (type === 'OFFER_GENERATION_SIMULATED') {
    session.offerStatus = contract.OFFER_STATUS.OFFER_GENERATED;
    session.state = contract.STAGE3_STATES.OFFER_APPROVAL_AWAITED;
  } else if (type === 'OFFER_APPROVAL_SIMULATED') {
    session.offerStatus = contract.OFFER_STATUS.OFFER_APPROVED;
    session.state = contract.STAGE3_STATES.OFFER_DELIVERY_CONFIRMATION_REQUIRED;
  } else if (type === 'OFFER_DELIVERY_CONFIRMED') {
    session.offerDeliveryConfirmed = true;
    session.offerSentDate = payload.sentDate || nowIso();
    session.offerStatus = contract.OFFER_STATUS.OFFER_SENT;
    session.state = contract.STAGE3_STATES.OFFER_DELIVERY_CONFIRMED;
  } else if (type === 'GCJ_REVIEWED') {
    if (!session.gcjAvailable) return block(session, 'GCJ_BLOCKED_NO_TRIGGER');
    session.operatorConfirmations.gcjReviewed = true;
  } else if (type === 'STAGE3_OPERATOR_WORK_COMPLETE') {
    const missing = missingRequirements(session);
    if (missing.length) return block(session, `REQUIRED_ACTIONS_UNRESOLVED: ${missing.join(', ')}`);
    session.completionStatus = 'COMPLETE';
    session.state = contract.STAGE3_STATES.STAGE3_OPERATOR_WORK_COMPLETE;
  } else if (type === 'OFFER_SENT_EXIT_SIMULATED') {
    const missing = missingRequirements(session);
    if (missing.length) return block(session, `EXIT_BLOCKED: ${missing.join(', ')}`);
    session.exitEligible = true;
    session.state = contract.STAGE3_STATES.STAGE3_EXIT_ELIGIBLE;
  } else if (type === 'ALTERNATE_OUTCOME_BLOCKED') {
    session.state = contract.STAGE3_STATES.S3_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN;
  } else if (type === 'SESSION_CANCELED') {
    session.state = contract.STAGE3_STATES.SESSION_CANCELED;
  }
  refreshNext(session);
}

function refreshUnderwritingState(session) {
  const missing = missingUnderwritingData(session);
  session.state = missing.length ? contract.STAGE3_STATES.UNDERWRITING_DATA_INCOMPLETE : contract.STAGE3_STATES.UNDERWRITING_DATA_RESOLVED;
}

function missingUnderwritingData(session) {
  const missing = [];
  const data = session.underwritingData || {};
  for (const field of contract.RESOLVED_RULES.S3_DATA_001.requiredForAll) {
    if (!data[field]) missing.push(field);
  }
  if (session.offerType === contract.OFFER_TYPES.STACK_50 || session.offerType === contract.OFFER_TYPES.DOWN_10) {
    for (const field of contract.RESOLVED_RULES.S3_DATA_001.requiredForSellerFinance) {
      if (!data[field]) missing.push(field);
    }
  }
  if (session.offerType === contract.OFFER_TYPES.SUBTO) {
    for (const field of contract.RESOLVED_RULES.S3_DATA_001.requiredForSubTo) {
      if (!data[field]) missing.push(field);
    }
  }
  return missing;
}

function missingRequirements(session) {
  const items = [];
  if (!session.handoffReviewed) items.push('HANDOFF_REVIEW');
  const missingData = missingUnderwritingData(session);
  if (missingData.length) items.push(...missingData.map(f => `UNDERWRITING:${f}`));
  if (!session.offerType) items.push('OFFER_TYPE_SELECTION');
  if (!session.calculationsDisplayed) items.push('CALCULATIONS_REVIEW');
  if (!session.loiReviewed) items.push('LOI_STATUS_REVIEW');
  if (session.offerStatus === contract.OFFER_STATUS.NOT_STARTED) items.push('OFFER_GENERATION');
  if (!session.offerDeliveryConfirmed) items.push('OFFER_DELIVERY_CONFIRMATION');
  return items;
}

function block(session, reason) {
  session.lastBlockedReason = reason;
}

function ruleIdsForEvent(type) {
  if (/ENTRY|HANDOFF_LOADED/.test(type)) return ['S3-ENTRY-001'];
  if (/HANDOFF_REVIEWED/.test(type)) return ['S3-RESP-001'];
  if (/UNDERWRITING/.test(type)) return ['S3-DATA-001'];
  if (/OFFER_TYPE/.test(type)) return ['S3-TYPE-001'];
  if (/CALCULATION/.test(type)) return ['S3-CALC-001'];
  if (/LOI/.test(type)) return ['S3-LOI-001'];
  if (/OFFER_GENERATION|OFFER_APPROVAL/.test(type)) return ['S3-RESP-001'];
  if (/OFFER_DELIVERY|OFFER_SENT/.test(type)) return ['S3-EXIT-001'];
  if (/GCJ/.test(type)) return ['S3-GCJ-001'];
  if (/ALTERNATE/.test(type)) return ['S3-ALT-001'];
  return ['STAGE3_OPERATOR_TRANSACTION'];
}

function refreshNext(session) {
  const state = session.state;
  const map = {
    [contract.STAGE3_STATES.STAGE3_ENTRY_REVIEW_REQUIRED]: 'Review Stage 2 handoff and confirm Offer Ready entry.',
    [contract.STAGE3_STATES.STAGE3_ENTRY_BLOCKED_STAGE2_INCOMPLETE]: 'Stage 2 work is incomplete. Complete Stage 2 before entering Offer Ready.',
    [contract.STAGE3_STATES.STAGE3_ENTRY_VERIFIED]: 'Entry verified. Review the handoff package from Stage 2.',
    [contract.STAGE3_STATES.HANDOFF_REVIEW_REQUIRED]: 'Review the Stage 2 handoff package. Confirm all information is present.',
    [contract.STAGE3_STATES.HANDOFF_REVIEWED]: 'Handoff reviewed. Review underwriting data requirements.',
    [contract.STAGE3_STATES.UNDERWRITING_DATA_REVIEW_REQUIRED]: 'Review underwriting data: ARV, purchase price, repair estimate, market rent.',
    [contract.STAGE3_STATES.UNDERWRITING_DATA_INCOMPLETE]: 'Underwriting data is incomplete. Record missing values.',
    [contract.STAGE3_STATES.UNDERWRITING_DATA_RESOLVED]: 'Underwriting data resolved. Select offer type.',
    [contract.STAGE3_STATES.OFFER_TYPE_SELECTION_REQUIRED]: 'Select offer type: Cash, 50% Stack, 10% Down, or Subject-To.',
    [contract.STAGE3_STATES.OFFER_TYPE_SELECTED]: 'Offer type selected. Review calculations.',
    [contract.STAGE3_STATES.CALCULATIONS_DISPLAYED]: 'Calculations displayed. Review LOI status.',
    [contract.STAGE3_STATES.LOI_STATUS_REVIEWED]: 'LOI status reviewed. Awaiting offer generation by closer team.',
    [contract.STAGE3_STATES.OFFER_GENERATION_AWAITED]: 'Offer generation in progress (closer team). Monitor status.',
    [contract.STAGE3_STATES.OFFER_APPROVAL_AWAITED]: 'Offer awaiting approval (closer team). Monitor status.',
    [contract.STAGE3_STATES.OFFER_DELIVERY_CONFIRMATION_REQUIRED]: 'Confirm offer has been sent to seller (by closer team or AI system).',
    [contract.STAGE3_STATES.OFFER_DELIVERY_CONFIRMED]: 'Offer sent to seller. 48-hour feedback clock started. Confirm exit to Offer Sent.',
    [contract.STAGE3_STATES.STAGE3_EXIT_ELIGIBLE]: 'Course requirements for moving Offer Ready to Offer Sent are satisfied in this simulated session. No production stage movement occurred.',
    [contract.STAGE3_STATES.STAGE3_OPERATOR_WORK_COMPLETE]: 'Stage 3 operator work is complete.',
    [contract.STAGE3_STATES.S3_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN]: 'The course corpus does not define alternate Stage 3 exits. The record remains under operator review.',
    [contract.STAGE3_STATES.SESSION_CANCELED]: 'Stage 3 session canceled.',
  };
  session.unresolvedRequirements = missingRequirements(session);
  session.nextExactCourseStep = map[state] || 'Continue the course-defined Stage 3 sequence.';
}

function buildStage3Note(session, operatorNotes = '') {
  const facts = {};
  for (const f of session.importedFacts) facts[f.field] = f;
  const data = session.underwritingData || {};
  return [
    'KAYLA STAGE 3 OFFER READY REVIEW',
    '',
    `Property: ${session.property.address || '(missing)'}`,
    `Contact path: ${session.contactPath || '(not established)'}`,
    `Stage 2 handoff: ${session.handoffReviewed ? 'reviewed' : 'not reviewed'}`,
    `Deal type: ${session.stage2SessionRef?.dealType || '(not set)'}`,
    `ARV: ${data.arv || '(not recorded)'}`,
    `Purchase price: ${data.purchasePrice || '(not recorded)'}`,
    `Repair estimate: ${data.repairEstimate || '(not recorded)'}`,
    `Market rent: ${data.marketRent || '(not recorded)'}`,
    `Equity: ${data.equityPercentage || '(not recorded)'}`,
    `Mortgage balance: ${data.mortgageBalance || '(not recorded)'}`,
    `Offer type: ${session.offerType || '(not selected)'}`,
    `Offer status: ${session.offerStatus}`,
    `LOI reviewed: ${session.loiReviewed ? 'yes' : 'no'}`,
    `Offer delivery: ${session.offerDeliveryConfirmed ? 'confirmed' : 'not confirmed'}`,
    `Offer sent date: ${session.offerSentDate || '(not recorded)'}`,
    `GCJ: ${session.gcjAvailable ? 'available' : 'not available'}`,
    `Exit eligibility: ${session.exitEligible ? 'eligible' : 'not eligible'}`,
    `Unresolved: ${(session.unresolvedRequirements || []).join(', ') || 'none'}`,
    `Alternate outcome: ${contract.S3_ALT_OUTCOME_STATUS}`,
    `Operator notes: ${operatorNotes || '(none)'}`,
    `Next course step: ${session.nextExactCourseStep}`,
    `Canonical rule references: ${session.canonicalRuleRefs.join(', ')}`,
  ].join('\n');
}

module.exports = {
  createStage3Session,
  evaluateEntry,
  addEvent,
  buildStage3Note,
  missingUnderwritingData,
  missingRequirements,
};
