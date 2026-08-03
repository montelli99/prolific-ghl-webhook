'use strict';

const STRATEGIES = Object.freeze({
  CASH: 'cash',
  F50: 'f50',
  F10: 'f10',
  STACK_PRINCIPAL: 'stack_principal',
  INTEREST_ONLY_STACK: 'interest_only_stack',
  ZERO_DOWN: 'zero_down',
  SUBJECT_TO: 'subject_to',
  NOVATION: 'novation',
  RENTAL: 'rental',
  MID_TERM: 'mid_term',
});

const STAGES = Object.freeze({
  COMP: 'comp',
  OFFER: 'offer',
  NEGOTIATION: 'negotiation',
  LOI: 'loi',
  CONTRACT: 'contract',
  CLOSER: 'closer',
  TRANSACTION: 'transaction',
});

const SOURCE = Object.freeze({
  COURSE_UNIVERSAL: 'COURSE_UNIVERSAL',
  COURSE_PATH_SPECIFIC: 'COURSE_PATH_SPECIFIC',
  SPREADSHEET_EXAMPLE: 'SPREADSHEET_EXAMPLE',
  OWNER_MODIFICATION: 'OWNER_MODIFICATION',
  TECHNICAL_ESTIMATE: 'TECHNICAL_ESTIMATE',
  ADVISORY_ESTIMATE: 'ADVISORY_ESTIMATE',
  MISSING_EVIDENCE: 'MISSING_EVIDENCE',
});

const PROFILES = {
  [STRATEGIES.CASH]: {
    strategy: STRATEGIES.CASH,
    label: 'Cash / Wholesale',
    stages: [STAGES.COMP, STAGES.OFFER],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_UNIVERSAL,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL },
    dscr: { applies: false },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: ['deed_in_lieu'],
    wholesaleFee: { applies: true, course: 10000, owner: 20000, active: 20000, source: SOURCE.OWNER_MODIFICATION },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: 'ARV × 0.70 − repairs − wholesale_fee',
    requiredEvidence: ['aru', 'tier', 'sqft'],
    optionalEvidence: ['address'],
    implemented: true,
  },

  [STRATEGIES.F50]: {
    strategy: STRATEGIES.F50,
    label: 'F50 (Stack 50%)',
    stages: [STAGES.OFFER, STAGES.NEGOTIATION],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_PATH_SPECIFIC,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL },
    dscr: { applies: false },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: ['deed_in_lieu', 'balloon_72mo'],
    wholesaleFee: { applies: true, course: 10000, owner: 20000, active: 20000, source: SOURCE.OWNER_MODIFICATION },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: '(ARV × 0.70 − repairs) split 50/50, 72mo balloon',
    requiredEvidence: ['aru', 'tier', 'sqft'],
    optionalEvidence: ['address'],
    implemented: true,
  },

  [STRATEGIES.F10]: {
    strategy: STRATEGIES.F10,
    label: 'F10 (Stack 10%)',
    stages: [STAGES.OFFER, STAGES.NEGOTIATION],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_PATH_SPECIFIC,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL },
    dscr: { applies: false },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: ['deed_in_lieu', 'balloon_24mo'],
    wholesaleFee: { applies: true, course: 10000, owner: 20000, active: 20000, source: SOURCE.OWNER_MODIFICATION },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: '(ARV × 0.70 − repairs) split 10/90, 24mo lump sum',
    requiredEvidence: ['aru', 'tier', 'sqft'],
    optionalEvidence: ['address'],
    implemented: true,
  },

  [STRATEGIES.SUBJECT_TO]: {
    strategy: STRATEGIES.SUBJECT_TO,
    label: 'Subject To',
    stages: [STAGES.OFFER, STAGES.NEGOTIATION, STAGES.LOI],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_PATH_SPECIFIC,
    interestRate: { value: 0.03, source: SOURCE.SPREADSHEET_EXAMPLE, note: 'Deal-specific LOI example; configurable per deal' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL },
    dscr: { applies: false },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: ['deed_in_lieu', 'automated_payments', 'escrow_held_deed'],
    wholesaleFee: { applies: true, course: 10000, owner: 20000, active: 20000, source: SOURCE.OWNER_MODIFICATION },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: 'Purchase price − DP − EMD − payoff = seller equity. Monthly cash flow = rent − PITI.',
    requiredEvidence: ['purchasePrice', 'downPayment', 'emd', 'payoff', 'existingLoan', 'existingRate', 'monthlyRent', 'propertyTaxes', 'insurance'],
    optionalEvidence: ['address', 'aru', 'tier', 'sqft'],
    implemented: true,
    note: 'SubTo uses purchase price, DP, EMD, payoff, seller equity, and monthly cash flow — not ARV − repairs − loan.',
  },

  [STRATEGIES.RENTAL]: {
    strategy: STRATEGIES.RENTAL,
    label: 'General Rental (Long-Term)',
    stages: [STAGES.COMP, STAGES.OFFER],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_UNIVERSAL,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL, note: 'Failed 1% → pivot to MTR' },
    dscr: { applies: true, threshold: 1.25, source: SOURCE.COURSE_UNIVERSAL },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: [],
    wholesaleFee: { applies: false },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: 'Monthly cash flow = rent − PITI − vacancy − maintenance − management. Must exceed cashFlowThreshold.',
    requiredEvidence: ['monthlyRent', 'purchasePrice', 'propertyTaxes', 'insurance'],
    optionalEvidence: ['vacancy', 'maintenance', 'management'],
    implemented: true,
  },

  [STRATEGIES.MID_TERM]: {
    strategy: STRATEGIES.MID_TERM,
    label: 'Mid-Term Rental (Furnished Finder)',
    stages: [STAGES.COMP, STAGES.OFFER],
    cashFlowThreshold: 250,
    source: SOURCE.COURSE_PATH_SPECIFIC,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'PIVOT_TRIGGER', source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Failed long-term 1% triggers MTR pivot' },
    dscr: { applies: true, threshold: 1.25, source: SOURCE.COURSE_UNIVERSAL },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: [],
    wholesaleFee: { applies: false },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: 'Actual Furnished Finder per-room rate × bedrooms. Existing multipliers are ADVISORY_ONLY.',
    requiredEvidence: ['furnishedFinderRate', 'bedrooms', 'purchasePrice'],
    optionalEvidence: ['monthlyRent', 'propertyTaxes', 'insurance'],
    implemented: true,
    note: 'Requires actual Furnished Finder data. ARV × 1.2% is ADVISORY_ONLY fallback.',
  },

  [STRATEGIES.STACK_PRINCIPAL]: {
    strategy: STRATEGIES.STACK_PRINCIPAL,
    label: 'Stack Principal',
    stages: [STAGES.OFFER, STAGES.NEGOTIATION],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_PATH_SPECIFIC,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL },
    dscr: { applies: false },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: ['deed_in_lieu'],
    wholesaleFee: { course: 10000, owner: 20000, active: 20000, source: SOURCE.OWNER_MODIFICATION },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: 'Principal + interest stack. Monthly payments to seller.',
    requiredEvidence: ['aru', 'tier', 'sqft', 'purchasePrice'],
    optionalEvidence: ['address'],
    implemented: false,
    note: 'NOT_IMPLEMENTED — outside current production launch scope.',
  },

  [STRATEGIES.INTEREST_ONLY_STACK]: {
    strategy: STRATEGIES.INTEREST_ONLY_STACK,
    label: 'Interest Only Stack',
    stages: [STAGES.OFFER, STAGES.NEGOTIATION],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_PATH_SPECIFIC,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL },
    dscr: { applies: false },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: ['deed_in_lieu'],
    wholesaleFee: { course: 10000, owner: 20000, active: 20000, source: SOURCE.OWNER_MODIFICATION },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: 'Interest-only payments to seller. Balloon at term.',
    requiredEvidence: ['aru', 'tier', 'sqft', 'purchasePrice'],
    optionalEvidence: ['address'],
    implemented: false,
    note: 'NOT_IMPLEMENTED — outside current production launch scope.',
  },

  [STRATEGIES.ZERO_DOWN]: {
    strategy: STRATEGIES.ZERO_DOWN,
    label: 'Zero Down',
    stages: [STAGES.OFFER, STAGES.NEGOTIATION],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_PATH_SPECIFIC,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL },
    dscr: { applies: false },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: ['deed_in_lieu'],
    wholesaleFee: { course: 10000, owner: 20000, active: 20000, source: SOURCE.OWNER_MODIFICATION },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: 'Rental AND owned free/clear. No down payment.',
    requiredEvidence: ['aru', 'tier', 'sqft', 'isOwnedFree'],
    optionalEvidence: ['address'],
    implemented: false,
    note: 'NOT_IMPLEMENTED — outside current production launch scope.',
  },

  [STRATEGIES.NOVATION]: {
    strategy: STRATEGIES.NOVATION,
    label: 'Novation',
    stages: [STAGES.OFFER, STAGES.NEGOTIATION],
    cashFlowThreshold: 200,
    source: SOURCE.COURSE_PATH_SPECIFIC,
    interestRate: { value: 0.07, source: SOURCE.COURSE_PATH_SPECIFIC, note: 'Course example; configurable' },
    onePercentRule: { applies: true, action: 'SCREEN_ONLY', source: SOURCE.COURSE_UNIVERSAL },
    dscr: { applies: false },
    repairMethod: { type: 'TIER_X_SQFT', source: SOURCE.COURSE_UNIVERSAL },
    sellerProtections: [],
    wholesaleFee: { course: 10000, owner: 20000, active: 20000, source: SOURCE.OWNER_MODIFICATION },
    arvMultiplier: { value: 0.70, source: SOURCE.COURSE_UNIVERSAL },
    formula: 'Move-in ready, low motivation. Transfer contract position.',
    requiredEvidence: ['aru', 'tier', 'sqft', 'moveInReady', 'motivation'],
    optionalEvidence: ['address'],
    implemented: false,
    note: 'NOT_IMPLEMENTED — outside current production launch scope.',
  },
};

function getProfile(strategy) {
  const profile = PROFILES[strategy];
  if (!profile) throw new Error(`Unknown strategy: ${strategy}. Valid: ${Object.values(STRATEGIES).join(', ')}`);
  return profile;
}

function cashFlowThreshold(strategy) {
  return getProfile(strategy).cashFlowThreshold;
}

function interestRate(strategy, override) {
  if (typeof override === 'number' && override > 0) return override;
  return getProfile(strategy).interestRate.value;
}

function onePercentRule(strategy) {
  return getProfile(strategy).onePercentRule;
}

function dscrConfig(strategy) {
  return getProfile(strategy).dscr;
}

function repairMethod(strategy) {
  return getProfile(strategy).repairMethod;
}

function sellerProtections(strategy) {
  return getProfile(strategy).sellerProtections;
}

function wholesaleFee(strategy) {
  const p = getProfile(strategy);
  if (!p.wholesaleFee || !p.wholesaleFee.applies) return { applies: false, course: null, owner: null, active: null };
  return p.wholesaleFee;
}

function arvMultiplier(strategy) {
  return getProfile(strategy).arvMultiplier.value;
}

function requiredEvidence(strategy) {
  return getProfile(strategy).requiredEvidence;
}

function isImplemented(strategy) {
  return getProfile(strategy).implemented;
}

function getApplicableRules(strategy, stage) {
  const profile = getProfile(strategy);
  const rules = [];
  if (profile.cashFlowThreshold) rules.push({ rule: 'cashFlowThreshold', value: profile.cashFlowThreshold, source: profile.source, stage });
  if (profile.onePercentRule.applies) rules.push({ rule: 'onePercentRule', action: profile.onePercentRule.action, source: profile.onePercentRule.source, stage });
  if (profile.dscr.applies) rules.push({ rule: 'dscr', threshold: profile.dscr.threshold, source: profile.dscr.source, stage });
  if (profile.wholesaleFee.applies) rules.push({ rule: 'wholesaleFee', course: profile.wholesaleFee.course, owner: profile.wholesaleFee.owner, active: profile.wholesaleFee.active, source: profile.wholesaleFee.source, stage });
  rules.push({ rule: 'arvMultiplier', value: profile.arvMultiplier.value, source: profile.arvMultiplier.source, stage });
  rules.push({ rule: 'repairMethod', type: profile.repairMethod.type, source: profile.repairMethod.source, stage });
  if (profile.sellerProtections.length > 0) rules.push({ rule: 'sellerProtections', protections: profile.sellerProtections, source: profile.source, stage });
  rules.push({ rule: 'interestRate', value: profile.interestRate.value, source: profile.interestRate.source, note: profile.interestRate.note, stage });
  return rules;
}

function getRequiredApprovals(strategy) {
  const profile = getProfile(strategy);
  const approvals = [];
  if (profile.wholesaleFee.applies && profile.wholesaleFee.owner !== profile.wholesaleFee.course) {
    approvals.push({ type: 'OWNER_OVERRIDE', field: 'wholesaleFee', course: profile.wholesaleFee.course, owner: profile.wholesaleFee.owner });
  }
  if (profile.strategy === STRATEGIES.SUBJECT_TO) {
    approvals.push({ type: 'OWNER_APPROVAL', field: 'subToTerms', note: 'Verify purchase price, DP, EMD, payoff, seller equity, monthly cash flow with owner' });
  }
  if (profile.strategy === STRATEGIES.MID_TERM) {
    approvals.push({ type: 'EVIDENCE_REQUIRED', field: 'furnishedFinderRate', note: 'Actual Furnished Finder data required; ARV × 1.2% is advisory only' });
  }
  return approvals;
}

function getRequiredDisclosures(strategy) {
  const profile = getProfile(strategy);
  const disclosures = [];
  for (const [key, value] of Object.entries(profile)) {
    if (value && typeof value === 'object' && value.source) {
      if (value.source === SOURCE.OWNER_MODIFICATION) {
        disclosures.push({ field: key, source: value.source, note: `Owner override from course default` });
      }
      if (value.source === SOURCE.ADVISORY_ESTIMATE) {
        disclosures.push({ field: key, source: value.source, note: `Advisory estimate — not verified` });
      }
      if (value.source === SOURCE.SPREADSHEET_EXAMPLE) {
        disclosures.push({ field: key, source: value.source, note: `Spreadsheet example — deal-specific, not universal` });
      }
    }
  }
  return disclosures;
}

module.exports = {
  STRATEGIES,
  STAGES,
  SOURCE,
  PROFILES,
  getProfile,
  cashFlowThreshold,
  interestRate,
  onePercentRule,
  dscrConfig,
  repairMethod,
  sellerProtections,
  wholesaleFee,
  arvMultiplier,
  requiredEvidence,
  isImplemented,
  getApplicableRules,
  getRequiredApprovals,
  getRequiredDisclosures,
};
