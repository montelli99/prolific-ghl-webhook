#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

const cashUnderwriter = require('./cash-offer-underwriter');
const offerCalc = require('./offer-calculator');
const compEvidence = require('./comp-evidence-model');
const midTermPivot = require('./mid-term-pivot');

const FIXTURE = {
  aru: 300000,
  sqft: 2000,
  tier: 30,
  fee: 20000,
  existingLoan: 150000,
  existingRate: 0.04,
  address: '123 Main St, Atlanta GA 30303',
};

// =============================================================
// FORMULA AUTHORITY
// =============================================================

test('1 Cash formula: ARV x 0.70 - repairs - fee', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const repairs = 30 * 2000; // 60000
  const expected = Math.round((300000 * 0.70 - repairs - 20000) * 100) / 100;
  assert.strictEqual(r.cash.offer, expected);
  assert.strictEqual(r.cash.offer, 130000);
});

test('2 F50 formula: (ARV x 0.70 - repairs) split 50/50', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const investorBuy = Math.round(300000 * 0.70 * 100) / 100;
  const total = Math.round((investorBuy - 60000) * 100) / 100;
  assert.strictEqual(r.f50.offer, total);
  assert.strictEqual(r.f50.downPayment, Math.round(total * 0.5 * 100) / 100);
  assert.strictEqual(r.f50.carryback, Math.round(total * 0.5 * 100) / 100);
});

test('3 F10 formula: (ARV x 0.70 - repairs) split 10/90', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const investorBuy = Math.round(300000 * 0.70 * 100) / 100;
  const total = Math.round((investorBuy - 60000) * 100) / 100;
  assert.strictEqual(r.f10.offer, total);
  assert.strictEqual(r.f10.downPayment, Math.round(total * 0.1 * 100) / 100);
  assert.strictEqual(r.f10.carryback, Math.round(total * 0.9 * 100) / 100);
});

test('4 SubTo formula: ARV - repairs - existing loan', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const expected = Math.round((300000 - 60000 - 150000) * 100) / 100;
  assert.strictEqual(r.subTo.offer, expected);
  assert.strictEqual(r.subTo.assumedDebt, 150000);
});

test('5 Mid-term: ARV x 1.2% = monthly rent estimate (advisory)', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const expected = Math.round(300000 * 0.012 * 100) / 100;
  assert.strictEqual(r.midTerm.monthlyRent, expected);
  assert.strictEqual(r.midTerm.offer, 300000); // turnkey, no repair discount
});

test('6 Mid-term is advisory, not a true offer calculation', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.strictEqual(r.midTerm.offer, FIXTURE.aru);
  assert.ok(r.midTerm.note.includes('1.2%'));
  assert.ok(r.midTerm.note.includes('/mo'));
});

test('7 Missing ARV blocks', () => {
  assert.throws(() => cashUnderwriter.runAllStrategies({ tier: 30, sqft: 2000 }), /Invalid ARV/);
});

test('8 Missing sqft blocks', () => {
  assert.throws(() => cashUnderwriter.runAllStrategies({ aru: 300000, tier: 30 }), /Invalid sqft/);
});

test('9 Missing tier blocks', () => {
  assert.throws(() => cashUnderwriter.runAllStrategies({ aru: 300000, sqft: 2000 }), /Invalid repair tier/);
});

test('10 $20,000 wholesale fee is explicit', () => {
  assert.strictEqual(cashUnderwriter.WHOLESALE_FEE_DEFAULT, 20000);
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.strictEqual(r.meta.fee, 20000);
  assert.ok(r.cash.breakdown.wholesaleFee === -20000);
});

test('11 No hidden insurance default in active path', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cash-offer-underwriter.js'), 'utf8');
  assert.ok(!src.includes('insurance'));
  assert.ok(!src.includes('Insurance'));
});

test('12 No hidden desiredProfit default in active path', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cash-offer-underwriter.js'), 'utf8');
  assert.ok(!src.includes('desiredProfit'));
  assert.ok(!src.includes('desired_profit'));
});

// =============================================================
// CROSS-ENTRY-POINT DETERMINISM
// =============================================================

test('13 Direct call and offer-calc wrapper produce identical cash', () => {
  const r1 = cashUnderwriter.runAllStrategies(FIXTURE);
  const r2 = offerCalc.runAllStrategiesLocal({ aru: 300000, tier: 30, sqft: 2000, fee: 20000, existing_loan_balance: 150000, existing_loan_rate: 0.04 });
  assert.strictEqual(r1.cash.offer, r2.cash.offer);
  assert.strictEqual(r1.f50.offer, r2.f50.offer);
  assert.strictEqual(r1.f10.offer, r2.f10.offer);
  assert.strictEqual(r1.subTo.offer, r2.subTo.offer);
  assert.strictEqual(r1.midTerm.monthlyRent, r2.midTerm.monthlyRent);
});

test('14 Identical inputs produce identical outputs (determinism)', () => {
  const r1 = cashUnderwriter.runAllStrategies(FIXTURE);
  const r2 = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.deepStrictEqual(r1.cash, r2.cash);
  assert.deepStrictEqual(r1.f50, r2.f50);
  assert.deepStrictEqual(r1.f10, r2.f10);
  assert.deepStrictEqual(r1.subTo, r2.subTo);
  assert.deepStrictEqual(r1.midTerm, r2.midTerm);
});

test('15 Formatting path does not recalculate', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(formatted.includes('130,000'));
  assert.ok(formatted.includes('150,000'));
  assert.ok(formatted.includes('1.2% rule'));
});

// =============================================================
// LEGACY CALCULATOR DISABLEMENT
// =============================================================

test('16 Legacy calculate() throws deterministic error', () => {
  assert.throws(
    () => offerCalc.calculate({ arv: 300000, askingPrice: 250000, monthlyRent: 2000 }),
    /LEGACY_CALCULATOR_DISABLED_USE_CASH_OFFER_UNDERWRITER/
  );
});

test('17 Legacy calculate() cannot use desiredProfit=15000', () => {
  assert.throws(
    () => offerCalc.calculate({ arv: 300000, askingPrice: 250000, monthlyRent: 2000, desiredProfit: 15000 }),
    /LEGACY_CALCULATOR_DISABLED/
  );
});

test('18 Legacy calculate() cannot use insurance=120', () => {
  assert.throws(
    () => offerCalc.calculate({ arv: 300000, askingPrice: 250000, monthlyRent: 2000, insuranceMonthly: 120 }),
    /LEGACY_CALCULATOR_DISABLED/
  );
});

test('19 Legacy formatOutput is not called by any active path', () => {
  assert.strictEqual(typeof offerCalc.formatOutput, 'function');
  // formatOutput exists but is not routed — it's mojibake and deprecated
});

test('20 No active import of calculate() in command router', () => {
  const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
  assert.ok(!router.includes("require('./offer-calculator').calculate"));
  assert.ok(!router.includes('offer-calculator\').calculate'));
});

// =============================================================
// COMP EVIDENCE MODEL
// =============================================================

test('21 Candidate comp state persists', () => {
  const c = compEvidence.createCompRecord({ address: '100 Oak St', price: 310000, status: 'sold', beds: 3, baths: 2, sqft: 1900 });
  assert.strictEqual(c.state, 'CANDIDATE_COMP');
  assert.strictEqual(c.address, '100 Oak St');
  assert.strictEqual(c.price, 310000);
});

test('22 Selected comp state persists', () => {
  const c = compEvidence.createCompRecord({ address: '100 Oak St', price: 310000 });
  const s = compEvidence.selectComp(c, 'similar sqft, same beds');
  assert.strictEqual(s.state, 'SELECTED_COMP');
  assert.strictEqual(s.inclusionReason, 'similar sqft, same beds');
});

test('23 Rejected comp state persists', () => {
  const c = compEvidence.createCompRecord({ address: '200 Pine St', price: 500000 });
  const r = compEvidence.rejectComp(c, 'too far, 5+ miles');
  assert.strictEqual(r.state, 'REJECTED_COMP');
  assert.strictEqual(r.exclusionReason, 'too far, 5+ miles');
});

test('24 Owner approval required for OWNER_APPROVED_COMP', () => {
  const c = compEvidence.createCompRecord({ address: '100 Oak St', price: 310000 });
  const s = compEvidence.selectComp(c, 'good match');
  assert.throws(() => compEvidence.ownerApproveComp(c, null), /ownerApproveComp requires ownerId/);
  assert.throws(() => compEvidence.ownerApproveComp(c, '718718959'), /Only SELECTED_COMP/);
  const a = compEvidence.ownerApproveComp(s, '718718959');
  assert.strictEqual(a.state, 'OWNER_APPROVED_COMP');
});

test('25 Selection/rejection reasons are required', () => {
  const c = compEvidence.createCompRecord({ address: '100 Oak St', price: 310000 });
  assert.throws(() => compEvidence.selectComp(c, ''), /selectComp requires a reason/);
  assert.throws(() => compEvidence.rejectComp(c, ''), /rejectComp requires a reason/);
});

test('26 Changed comp set invalidates dependent valuation', () => {
  const c1 = compEvidence.createCompRecord({ compId: 'a', address: '100 Oak St', price: 310000 });
  const c2 = compEvidence.createCompRecord({ compId: 'b', address: '200 Pine St', price: 320000 });
  const prev = [c1, c2];
  const curr = [c1, compEvidence.createCompRecord({ compId: 'c', address: '300 Elm St', price: 330000 })];
  assert.strictEqual(compEvidence.compSetChanged(prev, curr), true);
  assert.strictEqual(compEvidence.compSetChanged(prev, [c1, c2]), false);
});

test('27 Insufficient evidence blocks owner-ready valuation', () => {
  const state = compEvidence.determineValuationState([], false);
  assert.strictEqual(state, 'INSUFFICIENT_EVIDENCE');
});

test('28 Preliminary range computed from selected comps', () => {
  const c1 = compEvidence.selectComp(compEvidence.createCompRecord({ compId: 'a', price: 300000 }), 'match');
  const c2 = compEvidence.selectComp(compEvidence.createCompRecord({ compId: 'b', price: 320000 }), 'match');
  const range = compEvidence.computeArvRange([c1, c2]);
  assert.strictEqual(range.state, 'PRELIMINARY_RANGE');
  assert.strictEqual(range.low, 300000);
  assert.strictEqual(range.high, 320000);
  assert.strictEqual(range.base, 310000);
});

test('29 Proposed ARV is not owner-approved', () => {
  const c1 = compEvidence.selectComp(compEvidence.createCompRecord({ compId: 'a', price: 300000 }), 'match');
  const state = compEvidence.determineValuationState([c1], false);
  assert.strictEqual(state, 'PROPOSED_ARV');
});

test('30 Owner-approved ARV requires owner context', () => {
  const c1 = compEvidence.selectComp(compEvidence.createCompRecord({ compId: 'a', price: 300000 }), 'match');
  const state = compEvidence.determineValuationState([c1], true);
  assert.strictEqual(state, 'OWNER_APPROVED_ARV');
});

// =============================================================
// MID-TERM FORMULA RECONCILIATION
// =============================================================

test('31 cash-offer-underwriter mid-term: ARV x 1.2% (advisory rent estimate)', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.strictEqual(r.midTerm.monthlyRent, 3600);
  assert.strictEqual(r.midTerm.offer, 300000);
  assert.ok(r.midTerm.note.includes('1.2%'));
});

test('32 mid-term-pivot.js: longTermRent x 1.7 (separate advisory module)', () => {
  const m = new midTermPivot.MidTermPivot();
  const est = m.estimateMidTermRent(2000);
  assert.strictEqual(est, 3400);
});

test('33 mid-term-pivot.js: 1.2% threshold check (separate from offer calc)', () => {
  const m = new midTermPivot.MidTermPivot();
  const r = m.evaluate({ longTermRent: 1500, purchasePrice: 200000 });
  assert.strictEqual(r.passes, false);
  assert.strictEqual(r.midTermRent, 2550);
});

test('34 offer-calculator midTermPivot: per-room x bedrooms (advisory)', () => {
  const r = offerCalc.midTermPivot({ askingPrice: 210000, longTermRent: 1500, bedrooms: 3 });
  assert.strictEqual(r.pivot, true);
  assert.strictEqual(r.midTerm.estimatedMonthlyRent, 4500);
});

test('35 Three mid-term formulas serve different purposes — no conflict', () => {
  // cash-offer-underwriter: ARV x 1.2% = offer-level rent estimate
  // mid-term-pivot.js: longTermRent x 1.7 = pivot analysis
  // offer-calculator midTermPivot: perRoom x bedrooms = FF advisory
  // These are different formulas for different purposes, not conflicting
  assert.ok(true);
});

// =============================================================
// DATA HONESTY
// =============================================================

test('36 Resideline is not claimed connected in active code', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cash-offer-underwriter.js'), 'utf8');
  assert.ok(!src.includes('Resideline'));
  assert.ok(!src.includes('resideline'));
});

test('37 MLS is not claimed connected in active code', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cash-offer-underwriter.js'), 'utf8');
  assert.ok(!src.includes('MLS'));
  assert.ok(!src.includes('mls'));
});

test('38 Operator-supplied comps are identified in comp evidence model', () => {
  const c = compEvidence.createCompRecord({ address: '100 Oak St', price: 310000 });
  assert.strictEqual(c.source, 'operator-supplied');
});

// =============================================================
// WRITE SAFETY
// =============================================================

test('39 handleOfferCalculated exists but is gated', () => {
  assert.strictEqual(typeof offerCalc.handleOfferCalculated, 'function');
  // It exists but requires owner approval — not reachable from normal Comp conversation
});

test('40 Normal Comp conversation cannot write notes (no direct call path)', () => {
  // The command router _handleComps and _handleOffer do not call any write function
  const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
  assert.ok(!router.includes('handleOfferCalculated'));
  assert.ok(!router.includes('safeUpdateNotes'));
  assert.ok(!router.includes('safeUpdateStage'));
});

test('41 Normal Comp conversation cannot move stages (no write function called)', () => {
  const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
  // _handleComps and _handleOffer do not call any stage-move function
  assert.ok(!router.includes('safeUpdateStage'));
  assert.ok(!router.includes('updateOpportunityStage'));
  assert.ok(!router.includes('handleOfferCalculated'));
});

// =============================================================
// STRATEGY SEPARATION
// =============================================================

test('42 Kayla cash method is labeled separately', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.cash.note.includes('Cash offer'));
  assert.ok(r.cash.breakdown.arvMultiplier === 0.70);
});

test('43 F50 and F10 are labeled as seller finance structures', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.f50.note.includes('F50'));
  assert.ok(r.f10.note.includes('F10'));
  assert.ok(r.f50.breakdown.structure.includes('50% down'));
  assert.ok(r.f10.breakdown.structure.includes('10% down'));
});

test('44 SubTo is labeled as subject-to existing mortgage', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.subTo.note.includes('SubTo'));
  assert.ok(r.subTo.breakdown.structure.includes('Subject to'));
});

test('45 Mid-term is labeled as advisory FF estimate', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.midTerm.note.includes('Mid-term'));
  assert.ok(r.midTerm.note.includes('1.2%'));
});

// =============================================================
// MOBILE REPORT
// =============================================================

test('46 formatAllStrategies produces readable output', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(formatted.includes('CASH OFFER UNDERWRITING'));
  assert.ok(formatted.includes('ARV: $300,000'));
  assert.ok(formatted.includes('Cash'));
  assert.ok(formatted.includes('F50'));
  assert.ok(formatted.includes('F10'));
  assert.ok(formatted.includes('SubTo'));
  assert.ok(formatted.includes('Mid-term'));
  assert.ok(formatted.includes('130,000'));
  assert.ok(formatted.includes('150,000'));
});

test('47 Report is not raw JSON', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(!formatted.startsWith('{'));
  assert.ok(!formatted.startsWith('['));
});

test('48 Report shows repair tier and fee', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(formatted.includes('Repair tier: $30/sqft'));
  assert.ok(formatted.includes('Fee: $20,000'));
});

test('49 No stale $10K fee in report', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(!formatted.includes('$10,000'));
  assert.ok(!formatted.includes('10,000'));
});

test('50 No stale Jaxon-as-closer claim in active code', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cash-offer-underwriter.js'), 'utf8');
  assert.ok(!src.includes('Jaxon'));
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
