'use strict';

const { CONTACT_PATHS } = require('./kayla-stage1-contact-path');

const OFFER_TYPES = Object.freeze({
  CASH: 'CASH',
  STACK_50: 'STACK_50',
  DOWN_10: 'DOWN_10',
  SUBTO: 'SUBTO',
});

const OFFER_STATUS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  UNDERWRITING_IN_PROGRESS: 'UNDERWRITING_IN_PROGRESS',
  LOI_GENERATED: 'LOI_GENERATED',
  OFFER_GENERATED: 'OFFER_GENERATED',
  OFFER_APPROVED: 'OFFER_APPROVED',
  OFFER_SENT: 'OFFER_SENT',
});

const STAGE3_STATES = Object.freeze({
  STAGE3_ENTRY_REVIEW_REQUIRED: 'STAGE3_ENTRY_REVIEW_REQUIRED',
  STAGE3_ENTRY_BLOCKED_STAGE2_INCOMPLETE: 'STAGE3_ENTRY_BLOCKED_STAGE2_INCOMPLETE',
  STAGE3_ENTRY_VERIFIED: 'STAGE3_ENTRY_VERIFIED',
  HANDOFF_REVIEW_REQUIRED: 'HANDOFF_REVIEW_REQUIRED',
  HANDOFF_REVIEWED: 'HANDOFF_REVIEWED',
  UNDERWRITING_DATA_REVIEW_REQUIRED: 'UNDERWRITING_DATA_REVIEW_REQUIRED',
  UNDERWRITING_DATA_INCOMPLETE: 'UNDERWRITING_DATA_INCOMPLETE',
  UNDERWRITING_DATA_RESOLVED: 'UNDERWRITING_DATA_RESOLVED',
  OFFER_TYPE_SELECTION_REQUIRED: 'OFFER_TYPE_SELECTION_REQUIRED',
  OFFER_TYPE_SELECTED: 'OFFER_TYPE_SELECTED',
  CALCULATIONS_DISPLAYED: 'CALCULATIONS_DISPLAYED',
  LOI_STATUS_REVIEWED: 'LOI_STATUS_REVIEWED',
  OFFER_GENERATION_AWAITED: 'OFFER_GENERATION_AWAITED',
  OFFER_APPROVAL_AWAITED: 'OFFER_APPROVAL_AWAITED',
  OFFER_DELIVERY_CONFIRMATION_REQUIRED: 'OFFER_DELIVERY_CONFIRMATION_REQUIRED',
  OFFER_DELIVERY_CONFIRMED: 'OFFER_DELIVERY_CONFIRMED',
  GCJ_AVAILABLE: 'GCJ_AVAILABLE',
  GCJ_BLOCKED: 'GCJ_BLOCKED',
  STAGE3_EXIT_ELIGIBLE: 'STAGE3_EXIT_ELIGIBLE',
  STAGE3_OPERATOR_WORK_COMPLETE: 'STAGE3_OPERATOR_WORK_COMPLETE',
  S3_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN: 'S3_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN',
  SESSION_CANCELED: 'SESSION_CANCELED',
});

const S3_ALT_OUTCOME_STATUS = 'S3_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN';

const RESOLVED_RULES = {
  S3_ENTRY_001: {
    decisionId: 'S3-ENTRY-001',
    classification: 'COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES',
    rule: 'Stage 3 entry requires: Stage 2 evaluation complete, handoff submitted, operator confirms. Closer team generates offer.',
    prerequisites: ['STAGE2_COMPLETE', 'HANDOFF_SUBMITTED', 'OPERATOR_CONFIRMED'],
    blockedBy: ['STAGE2_INCOMPLETE', 'HANDOFF_NOT_SUBMITTED'],
  },
  S3_RESP_001: {
    decisionId: 'S3-RESP-001',
    classification: 'COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES',
    rule: 'Operator collects/submits. Seth underwrites/LOI. Kayla/Jaxon generate/negotiate/close. Operator never generates offers, negotiates, or signs.',
    responsibilities: {
      operator: ['collect_information', 'evaluate_deal', 'submit_handoff', 'confirm_delivery', 'stay_warm'],
      seth: ['underwrite', 'generate_loi'],
      kayla_jaxon: ['generate_offer', 'approve_offer', 'negotiate', 'close'],
      operator_never: ['generate_offers', 'negotiate', 'sign_contracts', 'deliver_counters'],
    },
  },
  S3_TYPE_001: {
    decisionId: 'S3-TYPE-001',
    classification: 'COURSE_EXPLICIT',
    rule: 'Four offer types: Cash (ARV×0.70−Repairs−Fee), 50% Stack (50% down, min 50% equity, pref 65%+, free/clear), 10% Down (10% down, free/clear), SubTo (low equity + pain point, 72mo max negotiable). F50/F10 are creative probes, not formal offer types.',
    offerTypes: {
      [OFFER_TYPES.CASH]: { formula: 'ARV × 0.70 − Repairs − Wholesale Fee', requirements: ['deep_discount'], classification: 'COURSE_EXPLICIT' },
      [OFFER_TYPES.STACK_50]: { formula: '50% down, seller holds 50%', requirements: ['min_50pct_equity', 'pref_65pct_equity', 'free_and_clear'], classification: 'COURSE_EXPLICIT' },
      [OFFER_TYPES.DOWN_10]: { formula: '10% down, seller carries balance', requirements: ['free_and_clear', 'down_covers_equity'], classification: 'COURSE_EXPLICIT' },
      [OFFER_TYPES.SUBTO]: { formula: 'Take over existing debt', requirements: ['low_equity', 'pain_point', 'good_interest_rate', '72mo_max_negotiable'], classification: 'COURSE_EXPLICIT' },
    },
  },
  S3_DATA_001: {
    decisionId: 'S3-DATA-001',
    classification: 'COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES',
    rule: 'Required for all: ARV, price, repairs, rent. Seller finance: equity, mortgage balance (must be zero). SubTo: mortgage balance, rate, payment. Team calculates.',
    requiredForAll: ['arv', 'purchasePrice', 'repairEstimate', 'marketRent'],
    requiredForSellerFinance: ['equityPercentage', 'mortgageBalance'],
    requiredForSubTo: ['existingMortgageBalance', 'interestRate', 'monthlyPayment', 'painPoint'],
  },
  S3_CALC_001: {
    decisionId: 'S3-CALC-001',
    classification: 'COURSE_EXPLICIT',
    rule: 'Cash: ARV×0.70−Repairs−Fee. Stack: 50% down, min 50% equity (pref 65%+), free/clear. 10% Down: 10% down, free/clear. SubTo: low equity + pain point, 72mo max (negotiable). 1% rule: screening guidance, not mandatory.',
    formulas: {
      cash: 'ARV × 0.70 − Repairs − Wholesale Fee = Max Offer',
      stack50: '50% down at closing, seller holds 50%. Min 50% equity (hard floor). Preferred 65%+ equity.',
      down10: '10% (0-15%) down, seller carries balance. Down payment must cover equity.',
      subto: 'Take over existing debt. Low equity + pain point. Typically 72 months max (negotiable).',
    },
    onePercentRule: { rule: 'Screening guidance: we like to see rent ≈ 1% of purchase price.', mandatory: false, classification: 'COURSE_EXPLICIT' },
  },
  S3_LOI_001: {
    decisionId: 'S3-LOI-001',
    classification: 'COURSE_EXPLICIT',
    rule: 'LOI generated by Seth after underwriting. Non-binding deal outline. Not the operator action. Precedes formal contract.',
  },
  S3_F50_001: {
    decisionId: 'S3-F50-001',
    classification: 'COURSE_PATH_SPECIFIC',
    rule: 'F50/F10 are creative probes used in Stage 2 evaluation. Not Stage 3 actions. Not formal offer types.',
  },
  S3_GCJ_001: {
    decisionId: 'S3-GCJ-001',
    classification: 'COURSE_PATH_SPECIFIC',
    rule: 'GCJ triggers are path-specific, not stage-specific. Multiple triggers: Stage 2 evaluation, PPC initial call, hot lead, offer ready. Operator steps back after GCJ.',
  },
  S3_EXIT_001: {
    decisionId: 'S3-EXIT-001',
    classification: 'COURSE_EXPLICIT',
    rule: 'Stage 3 exits when offer is sent to seller (by closer team or AI system). Operator confirms delivery. Offer sent date recorded. 48-hour feedback clock starts.',
  },
  S3_ALT_001: {
    decisionId: 'S3-ALT-001',
    classification: 'COURSE_UNKNOWN',
    status: 'UNRESOLVED',
    rule: 'No course source defines alternate Stage 3 exits.',
  },
};

function validateContract() {
  const resolved = Object.entries(RESOLVED_RULES).filter(([, v]) => v.classification !== 'COURSE_UNKNOWN');
  const unresolved = Object.entries(RESOLVED_RULES).filter(([, v]) => v.classification === 'COURSE_UNKNOWN');
  return {
    ok: resolved.length >= 9 && unresolved.length === 1,
    resolvedCount: resolved.length,
    unresolvedCount: unresolved.length,
    resolvedIds: resolved.map(([k]) => k),
    unresolvedIds: unresolved.map(([k]) => k),
    s3Alt001Unresolved: RESOLVED_RULES.S3_ALT_001.status === 'UNRESOLVED',
  };
}

module.exports = {
  OFFER_TYPES,
  OFFER_STATUS,
  STAGE3_STATES,
  S3_ALT_OUTCOME_STATUS,
  RESOLVED_RULES,
  validateContract,
};
