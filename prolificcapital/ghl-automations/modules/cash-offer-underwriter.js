// cash-offer-underwriter.js
// Pure math module — NO GHL dependency, fully unit-testable
// Course source: AI REI file 17A + 15-Office-Hours + Montelli 6/5 SOP
// Wholesale fee: $20,000 (OWNER_MODIFICATION, course said $10k)
//
// Strategy-aware underwriting via course-profile-engine.js.
// Every calculation resolves rules by strategy, not global constants.
//
// Returns ALL implemented strategies side-by-side.
// The closer (Montelli/Emily/Kayla) picks the strategy that matches seller intent.

'use strict';

const { getProfile, STRATEGIES, SOURCE } = require('./course-profile-engine');

const REPAIR_TIERS = {
  light: 30,
  mid:   45,
  full:  60,
};

function normalizeTier(tier) {
  if (typeof tier === 'number') {
    if (![30, 45, 60].includes(tier)) {
      throw new Error(`Invalid repair tier (${tier}) — must be 30, 45, or 60`);
    }
    return tier;
  }
  const map = { light: 30, mid: 45, mid_: 45, full: 60 };
  const key = String(tier || '').toLowerCase();
  if (!(key in map)) {
    throw new Error(`Invalid repair tier (${tier}) — must be 30, 45, 60, 'light', 'mid', or 'full'`);
  }
  return map[key];
}

function runAllStrategies(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('runAllStrategies requires an input object');
  }
  const { aru, tier, sqft } = input;
  if (typeof aru !== 'number' || aru <= 0) {
    throw new Error(`Invalid ARV (${aru}) — must be positive number`);
  }
  if (typeof sqft !== 'number' || sqft <= 0) {
    throw new Error(`Invalid sqft (${sqft}) — must be positive number`);
  }

  const tierRate = normalizeTier(tier);
  const repairs = tierRate * sqft;

  const result = {
    meta: {
      aru,
      tier: tierRate,
      sqft,
      repairs,
      address: input.address || null,
    },
  };

  // Cash
  const cashProfile = getProfile(STRATEGIES.CASH);
  const fee = (typeof input.fee === 'number' && input.fee >= 0) ? input.fee : cashProfile.wholesaleFee.active;
  result.meta.fee = fee;
  result.meta.feeSource = cashProfile.wholesaleFee.source;
  result.meta.feeCourse = cashProfile.wholesaleFee.course;
  result.meta.feeOwner = cashProfile.wholesaleFee.owner;
  result.cash = cashStrategy(aru, repairs, fee, input.address, cashProfile);

  // F50
  const f50Profile = getProfile(STRATEGIES.F50);
  result.f50 = f50Strategy(aru, repairs, fee, input.address, f50Profile);

  // F10
  const f10Profile = getProfile(STRATEGIES.F10);
  result.f10 = f10Strategy(aru, repairs, fee, input.address, f10Profile);

  // Subject To
  const subToProfile = getProfile(STRATEGIES.SUBJECT_TO);
  result.subTo = subToStrategy(input, subToProfile);

  // Mid-Term
  const mtProfile = getProfile(STRATEGIES.MID_TERM);
  result.midTerm = midTermStrategy(aru, input, mtProfile);

  // Rental
  const rentalProfile = getProfile(STRATEGIES.RENTAL);
  result.rental = rentalStrategy(input, rentalProfile);

  return result;
}

// ─── CASH (course file 17A) ────────────────────────────────────────────────
function cashStrategy(aru, repairs, fee, address, profile) {
  const arvMult = profile.arvMultiplier.value;
  const investorBuy = round2(aru * arvMult);
  const offer = round2(investorBuy - repairs - fee);
  return {
    offer,
    strategy: STRATEGIES.CASH,
    label: profile.label,
    source: profile.source,
    breakdown: {
      arv: aru,
      arvMultiplier: arvMult,
      investorBuy,
      repairs: -repairs,
      wholesaleFee: -fee,
      feeSource: profile.wholesaleFee.source,
      feeCourse: profile.wholesaleFee.course,
      feeOwner: profile.wholesaleFee.owner,
    },
    cashFlowThreshold: profile.cashFlowThreshold,
    sellerProtections: profile.sellerProtections,
    note: `Cash offer: $${aru.toLocaleString()} × ${arvMult.toFixed(2)} − $${repairs.toLocaleString()} repairs − $${fee.toLocaleString()} fee = $${offer.toLocaleString()}`,
  };
}

// ─── F50 (turnkey 50% down) ────────────────────────────────────────────────
function f50Strategy(aru, repairs, fee, address, profile) {
  const arvMult = profile.arvMultiplier.value;
  const investorBuy = round2(aru * arvMult);
  const totalToSeller = round2(investorBuy - repairs);
  const downPayment = round2(totalToSeller * 0.5);
  const carryback = round2(totalToSeller * 0.5);
  return {
    offer: totalToSeller,
    downPayment,
    carryback,
    strategy: STRATEGIES.F50,
    label: profile.label,
    source: profile.source,
    breakdown: {
      arv: aru,
      investorBuy,
      repairs: -repairs,
      structure: '50% down + 50% carryback, 72mo balloon, deed in lieu',
    },
    cashFlowThreshold: profile.cashFlowThreshold,
    sellerProtections: profile.sellerProtections,
    note: `F50: $${downPayment.toLocaleString()} now + $${carryback.toLocaleString()} in 72mo (deed in lieu)`,
  };
}

// ─── F10 (renovation 10% down) ─────────────────────────────────────────────
function f10Strategy(aru, repairs, fee, address, profile) {
  const arvMult = profile.arvMultiplier.value;
  const investorBuy = round2(aru * arvMult);
  const totalToSeller = round2(investorBuy - repairs);
  const downPayment = round2(totalToSeller * 0.1);
  const carryback = round2(totalToSeller * 0.9);
  return {
    offer: totalToSeller,
    downPayment,
    carryback,
    months: 24,
    strategy: STRATEGIES.F10,
    label: profile.label,
    source: profile.source,
    breakdown: {
      arv: aru,
      investorBuy,
      repairs: -repairs,
      structure: '10% down + 90% in 24mo lump sum',
    },
    cashFlowThreshold: profile.cashFlowThreshold,
    sellerProtections: profile.sellerProtections,
    note: `F10: $${downPayment.toLocaleString()} now + $${carryback.toLocaleString()} in 24mo`,
  };
}

// ─── SUBJECT TO ────────────────────────────────────────────────────────────
function subToStrategy(input, profile) {
  const purchasePrice = (typeof input.purchasePrice === 'number') ? input.purchasePrice : (input.aru || 0);
  const downPayment = (typeof input.downPayment === 'number') ? input.downPayment : 0;
  const emd = (typeof input.emd === 'number') ? input.emd : 0;
  const payoff = (typeof input.payoff === 'number') ? input.payoff : (input.existingLoan || 0);
  const existingRate = (typeof input.existingRate === 'number') ? input.existingRate : 0;
  const monthlyRent = (typeof input.monthlyRent === 'number') ? input.monthlyRent : 0;
  const propertyTaxes = (typeof input.propertyTaxes === 'number') ? input.propertyTaxes : 0;
  const insurance = (typeof input.insurance === 'number') ? input.insurance : 0;

  const sellerEquity = round2(purchasePrice - downPayment - emd - payoff);
  const monthlyPiti = round2((payoff * (existingRate || profile.interestRate.value) / 12) + (propertyTaxes / 12) + (insurance / 12));
  const monthlyCashFlow = round2(monthlyRent - monthlyPiti);

  return {
    offer: sellerEquity,
    purchasePrice,
    downPayment,
    emd,
    payoff,
    sellerEquity,
    monthlyCashFlow,
    monthlyPiti,
    assumedRate: existingRate || profile.interestRate.value,
    strategy: STRATEGIES.SUBJECT_TO,
    label: profile.label,
    source: profile.source,
    breakdown: {
      purchasePrice,
      downPayment: -downPayment,
      emd: -emd,
      payoff: -payoff,
      sellerEquity,
      monthlyRent,
      monthlyPiti: -monthlyPiti,
      monthlyCashFlow,
      structure: 'Subject to existing mortgage, deed in lieu at closing',
    },
    cashFlowThreshold: profile.cashFlowThreshold,
    sellerProtections: profile.sellerProtections,
    note: payoff > 0
      ? `SubTo: Purchase $${purchasePrice.toLocaleString()} − DP $${downPayment.toLocaleString()} − EMD $${emd.toLocaleString()} − Payoff $${payoff.toLocaleString()} = $${sellerEquity.toLocaleString()} equity. Cash flow: $${monthlyCashFlow.toLocaleString()}/mo.`
      : `SubTo: no existing loan on file — verify with seller before quoting`,
  };
}

// ─── MID-TERM / FURNISHED FINDER ───────────────────────────────────────────
function midTermStrategy(aru, input, profile) {
  const furnishedFinderRate = (typeof input.furnishedFinderRate === 'number') ? input.furnishedFinderRate : null;
  const bedrooms = (typeof input.bedrooms === 'number') ? input.bedrooms : null;

  let monthlyRent;
  let rentSource;

  if (furnishedFinderRate && bedrooms) {
    monthlyRent = round2(furnishedFinderRate * bedrooms);
    rentSource = SOURCE.COURSE_PATH_SPECIFIC;
  } else {
    monthlyRent = round2(aru * 0.012);
    rentSource = SOURCE.ADVISORY_ESTIMATE;
  }

  return {
    offer: aru,
    monthlyRent,
    annualRent: round2(monthlyRent * 12),
    rentSource,
    strategy: STRATEGIES.MID_TERM,
    label: profile.label,
    source: profile.source,
    breakdown: {
      arv: aru,
      rule: furnishedFinderRate ? `Furnished Finder: $${furnishedFinderRate}/room × ${bedrooms} beds` : '1.2% of ARV (ADVISORY — actual FF data required)',
      structure: 'Mid-term rental, fully furnished, FF-eligible',
    },
    cashFlowThreshold: profile.cashFlowThreshold,
    sellerProtections: profile.sellerProtections,
    note: furnishedFinderRate
      ? `Mid-term: $${monthlyRent.toLocaleString()}/mo (FF: $${furnishedFinderRate}/room × ${bedrooms} beds). Annual: $${(monthlyRent * 12).toLocaleString()}.`
      : `Mid-term (ADVISORY): $${monthlyRent.toLocaleString()}/mo (1.2% of ARV). Actual Furnished Finder data required for production. Annual: $${(monthlyRent * 12).toLocaleString()}.`,
  };
}

// ─── RENTAL (long-term) ────────────────────────────────────────────────────
function rentalStrategy(input, profile) {
  const monthlyRent = (typeof input.monthlyRent === 'number') ? input.monthlyRent : 0;
  const purchasePrice = (typeof input.purchasePrice === 'number') ? input.purchasePrice : (input.aru || 0);
  const propertyTaxes = (typeof input.propertyTaxes === 'number') ? input.propertyTaxes : 0;
  const insurance = (typeof input.insurance === 'number') ? input.insurance : 0;
  const vacancy = (typeof input.vacancy === 'number') ? input.vacancy : (monthlyRent * 0.05);
  const maintenance = (typeof input.maintenance === 'number') ? input.maintenance : (monthlyRent * 0.05);
  const management = (typeof input.management === 'number') ? input.management : (monthlyRent * 0.08);

  const monthlyPiti = round2((purchasePrice * profile.interestRate.value / 12) + (propertyTaxes / 12) + (insurance / 12));
  const monthlyCashFlow = round2(monthlyRent - monthlyPiti - vacancy - maintenance - management);
  const onePercentThreshold = round2(purchasePrice * 0.01);
  const onePercentPasses = monthlyRent >= onePercentThreshold;

  return {
    monthlyRent,
    monthlyPiti,
    monthlyCashFlow,
    onePercentThreshold,
    onePercentPasses,
    strategy: STRATEGIES.RENTAL,
    label: profile.label,
    source: profile.source,
    breakdown: {
      monthlyRent,
      monthlyPiti: -monthlyPiti,
      vacancy: -vacancy,
      maintenance: -maintenance,
      management: -management,
      monthlyCashFlow,
      onePercentRule: onePercentPasses ? 'PASS' : 'FAIL',
      onePercentThreshold,
    },
    cashFlowThreshold: profile.cashFlowThreshold,
    cashFlowPasses: monthlyCashFlow >= profile.cashFlowThreshold,
    dscr: profile.dscr.applies ? round2((monthlyRent * 0.75) / (monthlyPiti || 1)) : null,
    dscrThreshold: profile.dscr.applies ? profile.dscr.threshold : null,
    sellerProtections: profile.sellerProtections,
    note: onePercentPasses
      ? `Rental: $${monthlyRent.toLocaleString()}/mo passes 1% rule (≥ $${onePercentThreshold.toLocaleString()}). Cash flow: $${monthlyCashFlow.toLocaleString()}/mo.`
      : `Rental: $${monthlyRent.toLocaleString()}/mo FAILS 1% rule (< $${onePercentThreshold.toLocaleString()}). Pivot to MTR. Cash flow: $${monthlyCashFlow.toLocaleString()}/mo.`,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  runAllStrategies,
  REPAIR_TIERS,
  _internal: {
    cashStrategy,
    f50Strategy,
    f10Strategy,
    subToStrategy,
    midTermStrategy,
    rentalStrategy,
    normalizeTier,
    round2,
  },
};
