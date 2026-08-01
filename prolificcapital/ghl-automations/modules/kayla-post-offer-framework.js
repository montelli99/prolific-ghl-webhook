'use strict';

const crypto = require('crypto');
const { CONTACT_PATHS } = require('./kayla-stage1-contact-path');

function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function nowIso(now = new Date()) { return now instanceof Date ? now.toISOString() : new Date(now).toISOString(); }

const STAGE_SPECS = {
  4: {
    name: 'Offer Sent to Lead',
    stageId: 'eef16a9b-8ca9-43b7-9cad-fb9c352b560d',
    operatorRole: 'active',
    description: 'Offer has been sent. Wait 48 hours, call to confirm receipt, record confirmation.',
    entryRule: 'S4-ENTRY-001',
    exitRule: 'S4-EXIT-001',
    actions: ['WAIT_48HR', 'CALL_CONFIRM_RECEIPT', 'RECORD_CONFIRMATION', 'NO_ANSWER_ESCALATION'],
    scripts: ['POST_OFFER_48HR'],
    shortcuts: ['GCJ', 'LOI'],
    completionChecks: ['offerSentDate', 'confirmationCallMade', 'receiptConfirmed'],
    blockedBy: ['OFFER_SENT_DATE_NOT_RECORDED', '48HR_NOT_PASSED'],
  },
  5: {
    name: 'Offer Received',
    stageId: 'offer-received-stage-5',
    operatorRole: 'monitor',
    description: 'Seller confirmed receipt. Closer team handles response. Operator monitors.',
    entryRule: 'S5-ENTRY-001',
    exitRule: 'S5-EXIT-001',
    actions: ['MONITOR_STATUS'],
    scripts: [],
    shortcuts: ['GCJ'],
    completionChecks: ['sellerResponseRecorded'],
    blockedBy: ['SELLER_NOT_RESPONDED'],
  },
  6: {
    name: 'Offer Ready to Gain Feedback',
    stageId: 'offer-gain-feedback-stage-6',
    operatorRole: 'active',
    description: 'Call seller/agent to gain feedback. Record feedback. Relay to closer team.',
    entryRule: 'S6-ENTRY-001',
    exitRule: 'S6-EXIT-001',
    actions: ['CALL_GAIN_FEEDBACK', 'RECORD_FEEDBACK', 'RELAY_TO_CLOSER', 'NO_ANSWER_ESCALATION'],
    scripts: ['POST_OFFER_48HR', 'GAIN_FEEDBACK'],
    shortcuts: ['LOI'],
    completionChecks: ['feedbackCallMade', 'feedbackRecorded', 'feedbackRelayed'],
    blockedBy: ['FEEDBACK_CALL_NOT_MADE'],
  },
  7: {
    name: 'No Answer After Offer Ready to Gain Feedback',
    stageId: 'no-answer-feedback-stage-7',
    operatorRole: 'active',
    description: 'Seller did not answer feedback call. Escalate: voice memo, LOI2DAYS, SD, DOM tracking.',
    entryRule: 'S7-ENTRY-001',
    exitRule: 'S7-EXIT-001',
    actions: ['SEND_VOICE_MEMO', 'SEND_LOI2DAYS', 'SEND_SD', 'NOTE_DOM', 'CALCULATE_LISTING_EXPIRY'],
    scripts: [],
    shortcuts: ['LOI2DAYS', 'SD'],
    completionChecks: ['voiceMemoSent', 'loi2daysSent', 'sdSent', 'domNoted', 'listingExpiryCalculated'],
    blockedBy: ['NO_ANSWER_SEQUENCE_INCOMPLETE'],
  },
  8: {
    name: 'Seller Declined Offer',
    stageId: 'seller-declined-stage-8',
    operatorRole: 'active',
    description: 'Seller declined. Send SD, ask about other properties, note DOM, schedule 30-day revisit.',
    entryRule: 'S8-ENTRY-001',
    exitRule: 'S8-EXIT-001',
    actions: ['SEND_SD', 'ASK_OTHER_PROPERTIES', 'NOTE_DOM', 'SCHEDULE_30DAY_REVISIT'],
    scripts: [],
    shortcuts: ['SD'],
    completionChecks: ['sdSent', 'otherPropertiesAsked', 'domNoted', 'revisitScheduled'],
    blockedBy: ['NURTURE_STEPS_INCOMPLETE'],
  },
  9: {
    name: 'Active Negotiation',
    stageId: 'active-negotiation-stage-9',
    operatorRole: 'monitor',
    description: 'Seller countered or actively negotiating. Closer team handles all negotiation. Operator relays only.',
    entryRule: 'S9-ENTRY-001',
    exitRule: 'S9-EXIT-001',
    actions: ['MONITOR_STATUS', 'RELAY_ONLY'],
    scripts: [],
    shortcuts: [],
    completionChecks: ['negotiationOutcomeRecorded'],
    blockedBy: ['NEGOTIATION_ONGOING'],
  },
  10: {
    name: 'Terms Agreed',
    stageId: 'terms-agreed-stage-10',
    operatorRole: 'monitor',
    description: 'Terms agreed. Closer team drafts contract. Operator monitors, stays warm every 3-5 days.',
    entryRule: 'S10-ENTRY-001',
    exitRule: 'S10-EXIT-001',
    actions: ['MONITOR_STATUS', 'STAY_WARM'],
    scripts: [],
    shortcuts: [],
    completionChecks: ['contractDrafted', 'contractSent'],
    blockedBy: ['CONTRACT_NOT_DRAFTED'],
  },
};

const MONITOR_STAGES = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const MONITOR_STAGE_NAMES = {
  11: 'Contract Sent', 12: 'Contract Received', 13: 'Title Work',
  14: 'Inspection', 15: 'Appraisal', 16: 'Joint Venture Agreement',
  17: 'Wire Setup', 18: 'Closing Scheduled', 19: 'Closing Day',
  20: 'Funds Distributed', 21: 'Closed / Archived',
};

function createPostOfferSession(priorStageSession, stageNum, options = {}) {
  const spec = STAGE_SPECS[stageNum];
  const propertyAddress = priorStageSession.property?.address || '';
  return {
    schema: `kayla-stage${stageNum}-transaction-v1`,
    transactionId: options.transactionId || `stage${stageNum}_${stableHash({ opportunityId: priorStageSession.opportunityId, propertyAddress }).slice(0, 16)}`,
    sessionId: options.sessionId || `stage${stageNum}_session_${stableHash({ operatorId: options.operatorId || 'operator', propertyAddress, at: options.createdAt || nowIso() }).slice(0, 16)}`,
    opportunityId: priorStageSession.opportunityId || '',
    property: { address: propertyAddress, fingerprint: priorStageSession.property?.fingerprint || stableHash(propertyAddress.toLowerCase()).slice(0, 16) },
    currentPipelineStage: spec.name,
    stageNumber: stageNum,
    contactPath: priorStageSession.contactPath || '',
    priorSessionRef: {
      sessionId: priorStageSession.sessionId,
      transactionId: priorStageSession.transactionId,
      state: priorStageSession.state,
      stageNumber: priorStageSession.stageNumber || (stageNum - 1),
    },
    operatorRole: spec.operatorRole,
    importedFacts: importPriorFacts(priorStageSession),
    offerSentDate: priorStageSession.offerSentDate || '',
    confirmationCallMade: false,
    receiptConfirmed: false,
    feedbackCallMade: false,
    feedbackRecorded: false,
    feedbackRelayed: false,
    voiceMemoSent: false,
    loi2daysSent: false,
    sdSent: false,
    domNoted: false,
    listingExpiryCalculated: false,
    otherPropertiesAsked: false,
    revisitScheduled: false,
    negotiationOutcomeRecorded: false,
    contractDrafted: false,
    contractSent: false,
    sellerResponseRecorded: false,
    lastWarmContact: '',
    completionStatus: '',
    exitEligible: false,
    operatorConfirmations: {},
    unresolvedRequirements: [],
    nextExactCourseStep: `Review prior stage and confirm ${spec.name} entry.`,
    state: 'ENTRY_REVIEW_REQUIRED',
    journal: [],
    counters: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 },
    blockedCapabilities: [],
    canonicalRuleRefs: [spec.entryRule, spec.exitRule],
    unresolvedRuleRefs: [],
  };
}

function createMonitorSession(priorStageSession, stageNum, options = {}) {
  const name = MONITOR_STAGE_NAMES[stageNum] || `Stage ${stageNum}`;
  const propertyAddress = priorStageSession.property?.address || '';
  return {
    schema: `kayla-stage${stageNum}-monitor-v1`,
    transactionId: options.transactionId || `stage${stageNum}_${stableHash({ opportunityId: priorStageSession.opportunityId, propertyAddress }).slice(0, 16)}`,
    sessionId: options.sessionId || `stage${stageNum}_session_${stableHash({ operatorId: options.operatorId || 'operator', propertyAddress, at: options.createdAt || nowIso() }).slice(0, 16)}`,
    opportunityId: priorStageSession.opportunityId || '',
    property: { address: propertyAddress, fingerprint: priorStageSession.property?.fingerprint || stableHash(propertyAddress.toLowerCase()).slice(0, 16) },
    currentPipelineStage: name,
    stageNumber: stageNum,
    contactPath: priorStageSession.contactPath || '',
    priorSessionRef: {
      sessionId: priorStageSession.sessionId,
      transactionId: priorStageSession.transactionId,
      state: priorStageSession.state,
      stageNumber: priorStageSession.stageNumber || (stageNum - 1),
    },
    operatorRole: 'monitor',
    importedFacts: importPriorFacts(priorStageSession),
    lastWarmContact: '',
    warmContactDue: false,
    completionStatus: '',
    exitEligible: false,
    operatorConfirmations: {},
    unresolvedRequirements: [],
    nextExactCourseStep: `Monitor ${name}. Stay warm with seller every 3-5 days. Do not move stages. Do not negotiate. Do not sign.`,
    state: 'MONITORING',
    journal: [],
    counters: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 },
    blockedCapabilities: [],
    canonicalRuleRefs: ['STAGE_MONITOR_ONLY'],
    unresolvedRuleRefs: [],
  };
}

function importPriorFacts(priorSession) {
  const facts = [];
  const imported = priorSession.importedFacts || [];
  for (const f of imported) {
    facts.push({ ...f, source: `STAGE${priorSession.stageNumber || 'PRIOR'}_SESSION` });
  }
  return facts;
}

function addEvent(session, type, payload = {}, options = {}) {
  const priorState = session.state;
  const idempotencyKey = options.idempotencyKey || stableHash({ sessionId: session.sessionId, type, priorState, payload });
  const existing = session.journal.find(event => event.idempotencyKey === idempotencyKey);
  if (existing) return { session, event: existing, duplicate: true };
  applyPostOfferEvent(session, type, payload);
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
    canonicalRuleIds: [session.canonicalRuleRefs[0] || 'STAGE_OPERATOR_TRANSACTION'],
    source: `kayla-stage${session.stageNumber}-transaction`,
    payloadHash: stableHash(payload),
    idempotencyKey,
    mode: 'SIMULATION',
  };
  session.journal.push(event);
  return { session, event, duplicate: false };
}

function applyPostOfferEvent(session, type, payload) {
  if (type === 'SESSION_STARTED') {
    session.state = 'ENTRY_REVIEW_REQUIRED';
  } else if (type === 'ENTRY_VERIFIED') {
    session.operatorConfirmations.entryVerified = true;
    session.state = 'OPERATOR_WORK_REQUIRED';
  } else if (type === 'CONFIRMATION_CALL_MADE') {
    session.confirmationCallMade = true;
  } else if (type === 'RECEIPT_CONFIRMED') {
    session.receiptConfirmed = true;
    session.state = 'RECEIPT_CONFIRMED';
  } else if (type === 'FEEDBACK_CALL_MADE') {
    session.feedbackCallMade = true;
  } else if (type === 'FEEDBACK_RECORDED') {
    session.feedbackRecorded = true;
  } else if (type === 'FEEDBACK_RELAYED') {
    session.feedbackRelayed = true;
  } else if (type === 'VOICE_MEMO_SENT') {
    session.voiceMemoSent = true;
  } else if (type === 'LOI2DAYS_SENT') {
    session.loi2daysSent = true;
  } else if (type === 'SD_SENT') {
    session.sdSent = true;
  } else if (type === 'DOM_NOTED') {
    session.domNoted = true;
  } else if (type === 'LISTING_EXPIRY_CALCULATED') {
    session.listingExpiryCalculated = true;
  } else if (type === 'OTHER_PROPERTIES_ASKED') {
    session.otherPropertiesAsked = true;
  } else if (type === 'REVISIT_SCHEDULED') {
    session.revisitScheduled = true;
  } else if (type === 'NEGOTIATION_OUTCOME_RECORDED') {
    session.negotiationOutcomeRecorded = true;
  } else if (type === 'CONTRACT_DRAFTED') {
    session.contractDrafted = true;
  } else if (type === 'CONTRACT_SENT') {
    session.contractSent = true;
  } else if (type === 'SELLER_RESPONSE_RECORDED') {
    session.sellerResponseRecorded = true;
  } else if (type === 'STAY_WARM_CONTACT_MADE') {
    session.lastWarmContact = payload.date || nowIso();
    session.warmContactDue = false;
  } else if (type === 'OPERATOR_WORK_COMPLETE') {
    session.completionStatus = 'COMPLETE';
    session.state = 'OPERATOR_WORK_COMPLETE';
  } else if (type === 'EXIT_SIMULATED') {
    session.exitEligible = true;
    session.state = 'EXIT_ELIGIBLE';
  } else if (type === 'SESSION_CANCELED') {
    session.state = 'SESSION_CANCELED';
  }
  refreshPostOfferNext(session);
}

function refreshPostOfferNext(session) {
  const spec = STAGE_SPECS[session.stageNumber];
  if (!spec) {
    session.nextExactCourseStep = 'Monitor status. Stay warm with seller every 3-5 days.';
    return;
  }
  const map = {
    'ENTRY_REVIEW_REQUIRED': `Review prior stage and confirm ${spec.name} entry.`,
    'OPERATOR_WORK_REQUIRED': `Complete ${spec.name} operator work: ${spec.actions.join(', ')}.`,
    'RECEIPT_CONFIRMED': 'Receipt confirmed. Await seller response.',
    'OPERATOR_WORK_COMPLETE': `${spec.name} operator work is complete.`,
    'EXIT_ELIGIBLE': `Course requirements for ${spec.name} are satisfied in this simulated session. No production stage movement occurred.`,
    'SESSION_CANCELED': `Stage ${session.stageNumber} session canceled.`,
  };
  session.nextExactCourseStep = map[session.state] || `Continue the course-defined Stage ${session.stageNumber} sequence.`;
}

function buildPostOfferNote(session, operatorNotes = '') {
  const spec = STAGE_SPECS[session.stageNumber];
  const name = spec ? spec.name : (MONITOR_STAGE_NAMES[session.stageNumber] || `Stage ${session.stageNumber}`);
  return [
    `KAYLA STAGE ${session.stageNumber} ${name.toUpperCase()} REVIEW`,
    '',
    `Property: ${session.property.address || '(missing)'}`,
    `Contact path: ${session.contactPath || '(not established)'}`,
    `Operator role: ${session.operatorRole}`,
    `State: ${session.state}`,
    `Offer sent date: ${session.offerSentDate || '(not recorded)'}`,
    `Confirmation call: ${session.confirmationCallMade ? 'made' : 'not made'}`,
    `Receipt confirmed: ${session.receiptConfirmed ? 'yes' : 'no'}`,
    `Feedback call: ${session.feedbackCallMade ? 'made' : 'not made'}`,
    `Feedback recorded: ${session.feedbackRecorded ? 'yes' : 'no'}`,
    `Feedback relayed: ${session.feedbackRelayed ? 'yes' : 'no'}`,
    `Voice memo: ${session.voiceMemoSent ? 'sent' : 'not sent'}`,
    `LOI2DAYS: ${session.loi2daysSent ? 'sent' : 'not sent'}`,
    `SD: ${session.sdSent ? 'sent' : 'not sent'}`,
    `DOM noted: ${session.domNoted ? 'yes' : 'no'}`,
    `Other properties: ${session.otherPropertiesAsked ? 'asked' : 'not asked'}`,
    `Revisit scheduled: ${session.revisitScheduled ? 'yes' : 'no'}`,
    `Negotiation outcome: ${session.negotiationOutcomeRecorded ? 'recorded' : 'not recorded'}`,
    `Contract drafted: ${session.contractDrafted ? 'yes' : 'no'}`,
    `Contract sent: ${session.contractSent ? 'yes' : 'no'}`,
    `Last warm contact: ${session.lastWarmContact || '(none)'}`,
    `Exit eligibility: ${session.exitEligible ? 'eligible' : 'not eligible'}`,
    `Operator notes: ${operatorNotes || '(none)'}`,
    `Next course step: ${session.nextExactCourseStep}`,
  ].join('\n');
}

module.exports = {
  STAGE_SPECS,
  MONITOR_STAGES,
  MONITOR_STAGE_NAMES,
  createPostOfferSession,
  createMonitorSession,
  addEvent,
  buildPostOfferNote,
};
