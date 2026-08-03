// cash-offer-underwriter.js
// Pure math module — NO GHL dependency, fully unit-testable
// Course source: AI REI file 17A + 15-Office-Hours + Montelli 6/5 SOP
// Wholesale fee: $20,000 (current operating standard, course said $10k — superseded)
//
// Returns ALL 5 strategies side-by-side per Montelli's "less manual" preference.
// The closer (Montelli/Emily/Kayla) picks the strategy that matches seller intent.

'use strict';

const WHOLESALE_FEE_DEFAULT = 20000;
const ARV_MULTIPLIER = 0.70;

// Repair tiers in $/sqft
const REPAIR_TIERS = {
  light: 30,  // floors + paint
  mid:   45,  // + bathrooms + kitchens
  full:  60,  // + roof + HVAC
};

// Mid-term / Furnished Finder 1.2% rule (vs long-term 1%)
const MIDTERM_RULE = 0.012;

/**
 * Run all 5 strategies against a single property.
 * @param {Object} input
 * @param {number} input.aru - Lowest ARV comp pulled from RedFin
 * @param {number|string} input.tier - Repair tier: 30, 45, 60, or 'light'/'mid'/'full'
 * @param {number} input.sqft - Subject property sqft
 * @param {number} [input.fee=20000] - Wholesale fee (default $20k)
 * @param {number} [input.existingLoan=0] - For SubTo calc, existing mortgage balance
 * @param {number} [input.existingRate=0] - For SubTo, existing rate (e.g. 0.04 for 4%)
 * @param {string} [input.address] - Property address (for logging)
 * @returns {Object} All 5 strategies with offer + breakdown
 */
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

  const fee = (typeof input.fee === 'number' && input.fee >= 0) ? input.fee : WHOLESALE_FEE_DEFAULT;
  const tierRate = normalizeTier(tier);
  const repairs = tierRate * sqft;

  return {
    cash:   cashStrategy(aru, repairs, fee, input.address),
    f50:    f50Strategy(aru, repairs, fee, input.address),
    f10:    f10Strategy(aru, repairs, fee, input.address),
    subTo:  subToStrategy(aru, repairs, input, input.address),
    midTerm: midTermStrategy(aru, repairs, input, input.address),
    meta: {
      aru,
      tier: tierRate,
      sqft,
      repairs,
      fee,
      address: input.address || null,
    },
  };
}

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

// ─── STRATEGY 1: CASH (course file 17A) ───────────────────────────────────
function cashStrategy(aru, repairs, fee, address) {
  const investorBuy = round2(aru * ARV_MULTIPLIER);
  const offer = round2(investorBuy - repairs - fee);
  return {
    offer,
    breakdown: {
      arv: aru,
      arvMultiplier: ARV_MULTIPLIER,
      investorBuy,
      repairs: -repairs,
      wholesaleFee: -fee,
    },
    note: `Cash offer: $${aru.toLocaleString()} × 0.70 − $${repairs.toLocaleString()} repairs − $${fee.toLocaleString()} fee = $${offer.toLocaleString()}`,
  };
}

// ─── STRATEGY 2: F50 (turnkey 50% down) ──────────────────────────────────
function f50Strategy(aru, repairs, fee, address) {
  // Stack method: 50% down, 50% carryback, no monthly, 72mo balloon
  // Cash-equivalent offer = same as cash but structured as 50/50
  const investorBuy = round2(aru * ARV_MULTIPLIER);
  const totalToSeller = round2(investorBuy - repairs);
  const downPayment = round2(totalToSeller * 0.5);
  const carryback = round2(totalToSeller * 0.5);
  return {
    offer: totalToSeller,
    downPayment,
    carryback,
    breakdown: {
      arv: aru,
      investorBuy,
      repairs: -repairs,
      structure: '50% down + 50% carryback, 72mo balloon, deed in lieu',
    },
    note: `F50: $${downPayment.toLocaleString()} now + $${carryback.toLocaleString()} in 72mo (deed in lieu)`,
  };
}

// ─── STRATEGY 3: F10 (renovation 10% down) ────────────────────────────────
function f10Strategy(aru, repairs, fee, address) {
  const investorBuy = round2(aru * ARV_MULTIPLIER);
  const totalToSeller = round2(investorBuy - repairs);
  const downPayment = round2(totalToSeller * 0.1);
  const carryback = round2(totalToSeller * 0.9);
  return {
    offer: totalToSeller,
    downPayment,
    carryback,
    months: 24,
    breakdown: {
      arv: aru,
      investorBuy,
      repairs: -repairs,
      structure: '10% down + 90% in 24mo lump sum',
    },
    note: `F10: $${downPayment.toLocaleString()} now + $${carryback.toLocaleString()} in 24mo`,
  };
}

// ─── STRATEGY 4: SUBJECT TO ──────────────────────────────────────────────
function subToStrategy(aru, repairs, input, address) {
  const existingLoan = (typeof input.existingLoan === 'number') ? input.existingLoan : 0;
  const existingRate = (typeof input.existingRate === 'number') ? input.existingRate : 0;
  // SubTo: we take over existing payments. Seller's "net" = ARV - repairs - existing loan balance.
  // The "offer" is what we structure as the take-over amount.
  const sellerNet = round2(aru - repairs - existingLoan);
  return {
    offer: sellerNet,
    assumedDebt: existingLoan,
    assumedRate: existingRate,
    breakdown: {
      arv: aru,
      repairs: -repairs,
      existingLoan: -existingLoan,
      structure: 'Subject to existing mortgage, deed in lieu at closing',
    },
    note: existingLoan > 0
      ? `SubTo: take over $${existingLoan.toLocaleString()} mortgage at ${(existingRate * 100).toFixed(2)}%. Seller walks with $${sellerNet.toLocaleString()}.`
      : `SubTo: no existing loan on file — verify with seller before quoting`,
  };
}

// ─── STRATEGY 5: MID-TERM / FURNISHED FINDER ─────────────────────────────
function midTermStrategy(aru, repairs, input, address) {
  // 1.2% rule (vs long-term 1%) — accounts for FF overhead
  const monthlyRent = round2(aru * MIDTERM_RULE);
  return {
    offer: aru, // mid-term is typically turnkey, no repair discount
    monthlyRent,
    annualRent: round2(monthlyRent * 12),
    breakdown: {
      arv: aru,
      rule: '1.2% (Furnished Finder)',
      structure: 'Mid-term rental, fully furnished, FF-eligible',
    },
    note: `Mid-term: $${monthlyRent.toLocaleString()}/mo (1.2% of ARV). Annual: $${(monthlyRent * 12).toLocaleString()}.`,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  runAllStrategies,
  WHOLESALE_FEE_DEFAULT,
  ARV_MULTIPLIER,
  REPAIR_TIERS,
  MIDTERM_RULE,
  // Exposed for unit tests
  _internal: {
    cashStrategy,
    f50Strategy,
    f10Strategy,
    subToStrategy,
    midTermStrategy,
    normalizeTier,
    round2,
  },
};
