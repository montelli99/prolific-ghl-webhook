'use strict';

const CONTACT_PATHS = Object.freeze({
  LISTING_AGENT: 'LISTING_AGENT',
  BROKER: 'BROKER',
  DIRECT_SELLER: 'DIRECT_SELLER',
  FSBO_SELLER: 'FSBO_SELLER',
  PPC_SELLER: 'PPC_SELLER',
  RESEARCH_REQUIRED: 'RESEARCH_REQUIRED',
});

const FIELD_REQUIREMENT = Object.freeze({
  MANDATORY: 'MANDATORY',
  MANDATORY_UNKNOWN_ALLOWED: 'MANDATORY_UNKNOWN_ALLOWED',
  CONDITIONAL: 'CONDITIONAL',
  OPTIONAL: 'OPTIONAL',
  NOT_REQUIRED: 'NOT_REQUIRED',
});

const FIELD_DISPOSITIONS = Object.freeze({
  RECORDED: 'RECORDED',
  UNKNOWN_NOT_PROVIDED: 'UNKNOWN_NOT_PROVIDED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  DEFERRED_COURSE_ALLOWED: 'DEFERRED_COURSE_ALLOWED',
  UNRESOLVED_REQUIRED: 'UNRESOLVED_REQUIRED',
});

const DEAL_TYPES = Object.freeze({
  TURNKEY: 'TURNKEY_OR_GOOD_CONDITION',
  RENOVATION: 'RENOVATION_OR_OLDER',
  INSUFFICIENT: 'EVALUATION_INSUFFICIENT_INFORMATION',
});

const HANDOFF_DESTINATIONS = Object.freeze({
  SETH_LOI: 'SETH_LOI',
  KAYLA_JAXON_NEGOTIATION: 'KAYLA_JAXON_NEGOTIATION',
  KAYLA_PPC: 'KAYLA_PPC',
});

const GCJ_TRIGGERS = Object.freeze({
  PPC_PATH: 'GCJ_AVAILABLE_PPC_PATH',
  HOT_ENGAGED: 'GCJ_AVAILABLE_HOT_ENGAGED_LEAD',
  STANDARD_EVALUATION: 'GCJ_AVAILABLE_STANDARD_EVALUATION',
  BLOCKED: 'GCJ_BLOCKED_NO_TRIGGER',
});

const STAGE2_STATES = Object.freeze({
  STAGE2_ENTRY_REVIEW_REQUIRED: 'STAGE2_ENTRY_REVIEW_REQUIRED',
  STAGE2_ENTRY_BLOCKED_STAGE1_INCOMPLETE: 'STAGE2_ENTRY_BLOCKED_STAGE1_INCOMPLETE',
  CONTACT_FACTS_REVIEW_REQUIRED: 'CONTACT_FACTS_REVIEW_REQUIRED',
  CONTACT_FACTS_INCOMPLETE: 'CONTACT_FACTS_INCOMPLETE',
  CONTACT_FACTS_RESOLVED: 'CONTACT_FACTS_RESOLVED',
  CCC_CONFIRMATION_REQUIRED: 'CCC_CONFIRMATION_REQUIRED',
  CCC_CONFIRMED: 'CCC_CONFIRMED',
  CONTACT_CARD_CONFIRMATION_REQUIRED: 'CONTACT_CARD_CONFIRMATION_REQUIRED',
  CONTACT_CARD_CONFIRMED: 'CONTACT_CARD_CONFIRMED',
  DEAL_TYPE_EVALUATION_REQUIRED: 'DEAL_TYPE_EVALUATION_REQUIRED',
  TURNKEY_EVALUATION: 'TURNKEY_EVALUATION',
  RENOVATION_EVALUATION: 'RENOVATION_EVALUATION',
  COMPS_OR_RENT_REVIEW_REQUIRED: 'COMPS_OR_RENT_REVIEW_REQUIRED',
  REHAB_EVIDENCE_REQUIRED: 'REHAB_EVIDENCE_REQUIRED',
  EVALUATION_COMPLETE: 'EVALUATION_COMPLETE',
  F50_AVAILABLE: 'F50_AVAILABLE',
  F10_AVAILABLE: 'F10_AVAILABLE',
  F50_BLOCKED: 'F50_BLOCKED',
  F10_BLOCKED: 'F10_BLOCKED',
  HANDOFF_PREPARATION_REQUIRED: 'HANDOFF_PREPARATION_REQUIRED',
  HANDOFF_DRAFT_READY: 'HANDOFF_DRAFT_READY',
  HANDOFF_SUBMITTED_CONFIRMED: 'HANDOFF_SUBMITTED_CONFIRMED',
  GCJ_AVAILABLE: 'GCJ_AVAILABLE',
  GCJ_BLOCKED: 'GCJ_BLOCKED',
  OFFER_READY_EXIT_ELIGIBLE: 'OFFER_READY_EXIT_ELIGIBLE',
  STAGE2_OPERATOR_WORK_COMPLETE: 'STAGE2_OPERATOR_WORK_COMPLETE',
  S2_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN: 'S2_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN',
  SESSION_CANCELED: 'SESSION_CANCELED',
});

const S2_ALT_OUTCOME_STATUS = 'S2_ALT_OUTCOME_BLOCKED_COURSE_UNKNOWN';

const RESOLVED_RULES = {
  S2_ENTRY_001: {
    decisionId: 'S2-ENTRY-001',
    classification: 'COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES',
    rule: 'Contact Made entry requires: completed call, CCC sent, contact card sent, notes recorded. Operator confirms.',
    prerequisites: ['CONTACT_PATH_ESTABLISHED', 'COMPLETED_CALL', 'CCC_SENT', 'CONTACT_CARD_SENT', 'NOTES_RECORDED'],
    blockedBy: ['RESEARCH_REQUIRED', 'NO_COMPLETED_CALL', 'CCC_UNCONFIRMED', 'CONTACT_CARD_UNCONFIRMED', 'NOTES_MISSING'],
  },
  S2_DATA_001: {
    decisionId: 'S2-DATA-001',
    classification: 'COURSE_EXPLICIT_BY_WORKED_EXAMPLE',
    rule: 'Mandatory fields per path matrix. Roof/HVAC unknown allowed. Rent/lease conditional. Path-specific fields apply.',
    fieldMatrix: {
      [CONTACT_PATHS.LISTING_AGENT]: {
        contactName: FIELD_REQUIREMENT.MANDATORY,
        contactPhone: FIELD_REQUIREMENT.MANDATORY,
        contactEmail: FIELD_REQUIREMENT.MANDATORY,
        occupancy: FIELD_REQUIREMENT.MANDATORY,
        utilityResponsibility: FIELD_REQUIREMENT.MANDATORY,
        roofAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        hvacAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        monthlyRent: FIELD_REQUIREMENT.CONDITIONAL,
        leaseTerms: FIELD_REQUIREMENT.CONDITIONAL,
        listingFeedback: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        buyerFeedback: FIELD_REQUIREMENT.OPTIONAL,
        sellerFlexibility: FIELD_REQUIREMENT.OPTIONAL,
        otherProperties: FIELD_REQUIREMENT.OPTIONAL,
        sellerMotivation: FIELD_REQUIREMENT.OPTIONAL,
        sellerTimeline: FIELD_REQUIREMENT.OPTIONAL,
        askingPrice: FIELD_REQUIREMENT.NOT_REQUIRED,
        netPrice: FIELD_REQUIREMENT.NOT_REQUIRED,
        propertyCondition: FIELD_REQUIREMENT.NOT_REQUIRED,
        repairEstimate: FIELD_REQUIREMENT.NOT_REQUIRED,
        photos: FIELD_REQUIREMENT.NOT_REQUIRED,
      },
      [CONTACT_PATHS.BROKER]: {
        contactName: FIELD_REQUIREMENT.MANDATORY,
        contactPhone: FIELD_REQUIREMENT.MANDATORY,
        contactEmail: FIELD_REQUIREMENT.MANDATORY,
        occupancy: FIELD_REQUIREMENT.MANDATORY,
        utilityResponsibility: FIELD_REQUIREMENT.MANDATORY,
        roofAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        hvacAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        monthlyRent: FIELD_REQUIREMENT.CONDITIONAL,
        leaseTerms: FIELD_REQUIREMENT.CONDITIONAL,
        listingFeedback: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        buyerFeedback: FIELD_REQUIREMENT.OPTIONAL,
        sellerFlexibility: FIELD_REQUIREMENT.OPTIONAL,
        otherProperties: FIELD_REQUIREMENT.OPTIONAL,
        sellerMotivation: FIELD_REQUIREMENT.OPTIONAL,
        sellerTimeline: FIELD_REQUIREMENT.OPTIONAL,
        askingPrice: FIELD_REQUIREMENT.NOT_REQUIRED,
        netPrice: FIELD_REQUIREMENT.NOT_REQUIRED,
        propertyCondition: FIELD_REQUIREMENT.NOT_REQUIRED,
        repairEstimate: FIELD_REQUIREMENT.NOT_REQUIRED,
        photos: FIELD_REQUIREMENT.NOT_REQUIRED,
      },
      [CONTACT_PATHS.DIRECT_SELLER]: {
        contactName: FIELD_REQUIREMENT.MANDATORY,
        contactPhone: FIELD_REQUIREMENT.MANDATORY,
        contactEmail: FIELD_REQUIREMENT.MANDATORY,
        occupancy: FIELD_REQUIREMENT.MANDATORY,
        utilityResponsibility: FIELD_REQUIREMENT.MANDATORY,
        roofAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        hvacAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        monthlyRent: FIELD_REQUIREMENT.CONDITIONAL,
        leaseTerms: FIELD_REQUIREMENT.CONDITIONAL,
        askingPrice: FIELD_REQUIREMENT.MANDATORY,
        otherProperties: FIELD_REQUIREMENT.OPTIONAL,
        sellerMotivation: FIELD_REQUIREMENT.OPTIONAL,
        sellerTimeline: FIELD_REQUIREMENT.OPTIONAL,
        sellerFlexibility: FIELD_REQUIREMENT.OPTIONAL,
        propertyCondition: FIELD_REQUIREMENT.OPTIONAL,
        repairEstimate: FIELD_REQUIREMENT.OPTIONAL,
        listingFeedback: FIELD_REQUIREMENT.NOT_REQUIRED,
        buyerFeedback: FIELD_REQUIREMENT.NOT_REQUIRED,
        netPrice: FIELD_REQUIREMENT.NOT_REQUIRED,
        photos: FIELD_REQUIREMENT.NOT_REQUIRED,
      },
      [CONTACT_PATHS.FSBO_SELLER]: {
        contactName: FIELD_REQUIREMENT.MANDATORY,
        contactPhone: FIELD_REQUIREMENT.MANDATORY,
        contactEmail: FIELD_REQUIREMENT.MANDATORY,
        occupancy: FIELD_REQUIREMENT.MANDATORY,
        utilityResponsibility: FIELD_REQUIREMENT.MANDATORY,
        roofAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        hvacAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        monthlyRent: FIELD_REQUIREMENT.CONDITIONAL,
        leaseTerms: FIELD_REQUIREMENT.CONDITIONAL,
        askingPrice: FIELD_REQUIREMENT.MANDATORY,
        otherProperties: FIELD_REQUIREMENT.OPTIONAL,
        sellerMotivation: FIELD_REQUIREMENT.OPTIONAL,
        sellerTimeline: FIELD_REQUIREMENT.OPTIONAL,
        sellerFlexibility: FIELD_REQUIREMENT.OPTIONAL,
        propertyCondition: FIELD_REQUIREMENT.OPTIONAL,
        repairEstimate: FIELD_REQUIREMENT.OPTIONAL,
        listingFeedback: FIELD_REQUIREMENT.NOT_REQUIRED,
        buyerFeedback: FIELD_REQUIREMENT.NOT_REQUIRED,
        netPrice: FIELD_REQUIREMENT.NOT_REQUIRED,
        photos: FIELD_REQUIREMENT.NOT_REQUIRED,
      },
      [CONTACT_PATHS.PPC_SELLER]: {
        contactName: FIELD_REQUIREMENT.MANDATORY,
        contactPhone: FIELD_REQUIREMENT.MANDATORY,
        contactEmail: FIELD_REQUIREMENT.MANDATORY,
        occupancy: FIELD_REQUIREMENT.MANDATORY,
        utilityResponsibility: FIELD_REQUIREMENT.MANDATORY,
        roofAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        hvacAge: FIELD_REQUIREMENT.MANDATORY_UNKNOWN_ALLOWED,
        monthlyRent: FIELD_REQUIREMENT.CONDITIONAL,
        leaseTerms: FIELD_REQUIREMENT.CONDITIONAL,
        netPrice: FIELD_REQUIREMENT.MANDATORY,
        propertyCondition: FIELD_REQUIREMENT.MANDATORY,
        photos: FIELD_REQUIREMENT.MANDATORY,
        otherProperties: FIELD_REQUIREMENT.OPTIONAL,
        sellerMotivation: FIELD_REQUIREMENT.OPTIONAL,
        sellerTimeline: FIELD_REQUIREMENT.OPTIONAL,
        sellerFlexibility: FIELD_REQUIREMENT.OPTIONAL,
        repairEstimate: FIELD_REQUIREMENT.OPTIONAL,
        listingFeedback: FIELD_REQUIREMENT.NOT_REQUIRED,
        buyerFeedback: FIELD_REQUIREMENT.NOT_REQUIRED,
        askingPrice: FIELD_REQUIREMENT.NOT_REQUIRED,
      },
    },
  },
  S2_CCC_001: {
    decisionId: 'S2-CCC-001',
    classification: 'COURSE_EXPLICIT_BY_WORKED_EXAMPLE',
    rule: 'CCC and contact card are post-call actions confirmed at the Stage 1→Stage 2 boundary.',
  },
  S2_PPC_001: {
    decisionId: 'S2-PPC-001',
    classification: 'COURSE_PATH_SPECIFIC',
    rule: 'PPC is a distinct contact path with its own shortcuts and photo requirement. Enters Contact Made after PPC call.',
    shortcuts: ['PIN', 'PNOA', 'PCC', 'PC', 'PGC', 'PPH'],
  },
  S2_EVAL_001: {
    decisionId: 'S2-EVAL-001',
    classification: 'COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES',
    rule: 'Classify property as turnkey or renovation. Note rental comps (turnkey) or rehab estimate (renovation).',
  },
  S2_F50_001: {
    decisionId: 'S2-F50-001',
    classification: 'COURSE_PATH_SPECIFIC',
    rule: 'F50 available for turnkey. F10 available for renovation. Not universal Stage 2 actions.',
  },
  S2_HANDOFF_001: {
    decisionId: 'S2-HANDOFF-001',
    classification: 'COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES',
    rule: 'Submit information package to closer team. Seth for LOI. Kayla/Jaxon for negotiation. PPC to Kayla.',
    destinations: {
      [CONTACT_PATHS.LISTING_AGENT]: HANDOFF_DESTINATIONS.SETH_LOI,
      [CONTACT_PATHS.BROKER]: HANDOFF_DESTINATIONS.SETH_LOI,
      [CONTACT_PATHS.DIRECT_SELLER]: HANDOFF_DESTINATIONS.SETH_LOI,
      [CONTACT_PATHS.FSBO_SELLER]: HANDOFF_DESTINATIONS.SETH_LOI,
      [CONTACT_PATHS.PPC_SELLER]: HANDOFF_DESTINATIONS.KAYLA_PPC,
    },
  },
  S2_EXIT_001: {
    decisionId: 'S2-EXIT-001',
    classification: 'COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES',
    rule: 'Operator moves to Offer Ready after completing evaluation and submitting information package. Operator-confirmed.',
  },
  S2_GCJ_001: {
    decisionId: 'S2-GCJ-001',
    classification: 'COURSE_PATH_SPECIFIC',
    rule: 'GCJ has multiple path-specific triggers: PPC (end of call), hot lead (seller engaged), standard (after evaluation).',
  },
  S2_ALT_001: {
    decisionId: 'S2-ALT-001',
    classification: 'COURSE_UNKNOWN',
    status: 'UNRESOLVED',
    rule: 'No course source defines alternate Stage 2 exits.',
  },
  S2_TIMING: {
    decisionId: 'STAGE2_TIMING',
    classification: 'COURSE_EXPLICIT',
    rule: 'No course-defined timer exists for Contact Made. 48 hours applies after offer sent/receipt.',
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
    s2Alt001Unresolved: RESOLVED_RULES.S2_ALT_001.status === 'UNRESOLVED',
  };
}

function fieldRequirement(path, fieldId) {
  const matrix = RESOLVED_RULES.S2_DATA_001.fieldMatrix[path];
  if (!matrix) return FIELD_REQUIREMENT.NOT_REQUIRED;
  return matrix[fieldId] || FIELD_REQUIREMENT.NOT_REQUIRED;
}

function handoffDestination(path) {
  return RESOLVED_RULES.S2_HANDOFF_001.destinations[path] || null;
}

function isAgentPath(path) {
  return [CONTACT_PATHS.LISTING_AGENT, CONTACT_PATHS.BROKER].includes(path);
}

function isSellerPath(path) {
  return [CONTACT_PATHS.DIRECT_SELLER, CONTACT_PATHS.FSBO_SELLER].includes(path);
}

function isPpcPath(path) {
  return path === CONTACT_PATHS.PPC_SELLER;
}

module.exports = {
  CONTACT_PATHS,
  FIELD_REQUIREMENT,
  FIELD_DISPOSITIONS,
  DEAL_TYPES,
  HANDOFF_DESTINATIONS,
  GCJ_TRIGGERS,
  STAGE2_STATES,
  S2_ALT_OUTCOME_STATUS,
  RESOLVED_RULES,
  validateContract,
  fieldRequirement,
  handoffDestination,
  isAgentPath,
  isSellerPath,
  isPpcPath,
};
