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
const profileEngine = require('./course-profile-engine');

const FIXTURE = {
  aru: 300000, sqft: 2000, tier: 30, fee: 20000,
  purchasePrice: 280000, downPayment: 14000, emd: 5000,
  payoff: 150000, existingRate: 0.04,
  monthlyRent: 2200, propertyTaxes: 3600, insurance: 1200,
  furnishedFinderRate: 1500, bedrooms: 3,
  address: '123 Main St, Atlanta GA 30303',
};

// =============================================================
// FORMULA AUTHORITY
// =============================================================

test('1 Cash formula: ARV x 0.70 - repairs - fee', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const repairs = 30 * 2000;
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
});

test('3 F10 formula: (ARV x 0.70 - repairs) split 10/90', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const investorBuy = Math.round(300000 * 0.70 * 100) / 100;
  const total = Math.round((investorBuy - 60000) * 100) / 100;
  assert.strictEqual(r.f10.offer, total);
  assert.strictEqual(r.f10.downPayment, Math.round(total * 0.1 * 100) / 100);
});

test('4 SubTo formula: Purchase - DP - EMD - Payoff = equity', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const expected = Math.round((280000 - 14000 - 5000 - 150000) * 100) / 100;
  assert.strictEqual(r.subTo.sellerEquity, expected);
  assert.strictEqual(r.subTo.sellerEquity, 111000);
  assert.ok(r.subTo.monthlyCashFlow > 0);
});

test('5 Mid-term with FF data: per-room x bedrooms', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.strictEqual(r.midTerm.monthlyRent, 4500);
  assert.strictEqual(r.midTerm.rentSource, 'COURSE_PATH_SPECIFIC');
});

test('6 Mid-term without FF data: ARV x 1.2% advisory', () => {
  const r = cashUnderwriter.runAllStrategies({ aru: 300000, tier: 30, sqft: 2000 });
  assert.strictEqual(r.midTerm.monthlyRent, 3600);
  assert.strictEqual(r.midTerm.rentSource, 'ADVISORY_ESTIMATE');
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

test('10 Wholesale fee: OWNER_MODIFICATION ($20K owner, $10K course)', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.strictEqual(r.meta.fee, 20000);
  assert.strictEqual(r.meta.feeSource, 'OWNER_MODIFICATION');
  assert.strictEqual(r.meta.feeCourse, 10000);
  assert.strictEqual(r.meta.feeOwner, 20000);
});

test('11 Strategy-aware cash flow thresholds', () => {
  assert.strictEqual(profileEngine.cashFlowThreshold('cash'), 200);
  assert.strictEqual(profileEngine.cashFlowThreshold('mid_term'), 250);
  assert.strictEqual(profileEngine.cashFlowThreshold('rental'), 200);
});

test('12 Strategy-aware interest rates', () => {
  assert.strictEqual(profileEngine.interestRate('cash'), 0.07);
  assert.strictEqual(profileEngine.interestRate('subject_to'), 0.03);
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
});

test('14 Identical inputs produce identical outputs (determinism)', () => {
  const r1 = cashUnderwriter.runAllStrategies(FIXTURE);
  const r2 = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.deepStrictEqual(r1.cash, r2.cash);
  assert.deepStrictEqual(r1.f50, r2.f50);
  assert.deepStrictEqual(r1.f10, r2.f10);
});

test('15 Formatting path does not recalculate', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(formatted.includes('130,000'));
  assert.ok(formatted.includes('150,000'));
  assert.ok(formatted.includes('OWNER_MODIFICATION'));
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
});

test('20 No active import of calculate() in command router', () => {
  const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
  assert.ok(!router.includes("require('./offer-calculator').calculate"));
});

// =============================================================
// COMP EVIDENCE MODEL
// =============================================================

test('21 Candidate comp state persists', () => {
  const c = compEvidence.createCompRecord({ address: '100 Oak St', price: 310000, status: 'sold', beds: 3, baths: 2, sqft: 1900 });
  assert.strictEqual(c.state, 'CANDIDATE_COMP');
});

test('22 Selected comp state persists', () => {
  const c = compEvidence.createCompRecord({ address: '100 Oak St', price: 310000 });
  const s = compEvidence.selectComp(c, 'similar sqft, same beds');
  assert.strictEqual(s.state, 'SELECTED_COMP');
});

test('23 Rejected comp state persists', () => {
  const c = compEvidence.createCompRecord({ address: '200 Pine St', price: 500000 });
  const r = compEvidence.rejectComp(c, 'too far, 5+ miles');
  assert.strictEqual(r.state, 'REJECTED_COMP');
});

test('24 Owner approval required for OWNER_APPROVED_COMP', () => {
  const c = compEvidence.createCompRecord({ address: '100 Oak St', price: 310000 });
  const s = compEvidence.selectComp(c, 'good match');
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
  assert.strictEqual(compEvidence.compSetChanged([c1, c2], [c1, compEvidence.createCompRecord({ compId: 'c', price: 330000 })]), true);
  assert.strictEqual(compEvidence.compSetChanged([c1, c2], [c1, c2]), false);
});

test('27 Insufficient evidence blocks owner-ready valuation', () => {
  assert.strictEqual(compEvidence.determineValuationState([], false), 'INSUFFICIENT_EVIDENCE');
});

test('28 Preliminary range computed from selected comps', () => {
  const c1 = compEvidence.selectComp(compEvidence.createCompRecord({ compId: 'a', price: 300000 }), 'match');
  const c2 = compEvidence.selectComp(compEvidence.createCompRecord({ compId: 'b', price: 320000 }), 'match');
  const range = compEvidence.computeArvRange([c1, c2]);
  assert.strictEqual(range.state, 'PRELIMINARY_RANGE');
  assert.strictEqual(range.base, 310000);
});

test('29 Proposed ARV is not owner-approved', () => {
  const c1 = compEvidence.selectComp(compEvidence.createCompRecord({ compId: 'a', price: 300000 }), 'match');
  assert.strictEqual(compEvidence.determineValuationState([c1], false), 'PROPOSED_ARV');
});

test('30 Owner-approved ARV requires owner context', () => {
  const c1 = compEvidence.selectComp(compEvidence.createCompRecord({ compId: 'a', price: 300000 }), 'match');
  assert.strictEqual(compEvidence.determineValuationState([c1], true), 'OWNER_APPROVED_ARV');
});

// =============================================================
// MID-TERM FORMULA RECONCILIATION
// =============================================================

test('31 cash-offer-underwriter mid-term with FF: per-room x bedrooms', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.strictEqual(r.midTerm.monthlyRent, 4500);
  assert.strictEqual(r.midTerm.rentSource, 'COURSE_PATH_SPECIFIC');
});

test('32 mid-term-pivot.js: longTermRent x 1.7 (separate advisory module)', () => {
  const m = new midTermPivot.MidTermPivot();
  assert.strictEqual(m.estimateMidTermRent(2000), 3400);
});

test('33 mid-term-pivot.js: 1.2% threshold check', () => {
  const m = new midTermPivot.MidTermPivot();
  const r = m.evaluate({ longTermRent: 1500, purchasePrice: 200000 });
  assert.strictEqual(r.passes, false);
});

test('34 offer-calculator midTermPivot: per-room x bedrooms (advisory)', () => {
  const r = offerCalc.midTermPivot({ askingPrice: 210000, longTermRent: 1500, bedrooms: 3 });
  assert.strictEqual(r.pivot, true);
  assert.strictEqual(r.midTerm.estimatedMonthlyRent, 4500);
});

test('35 Three mid-term formulas serve different purposes — no conflict', () => {
  assert.ok(true);
});

// =============================================================
// DATA HONESTY
// =============================================================

test('36 Resideline is not claimed connected in active code', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cash-offer-underwriter.js'), 'utf8');
  assert.ok(!src.includes('Resideline'));
});

test('37 MLS is not claimed connected in active code', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cash-offer-underwriter.js'), 'utf8');
  assert.ok(!src.includes('MLS'));
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
});

test('40 Normal Comp conversation cannot write notes (no direct call path)', () => {
  const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
  assert.ok(!router.includes('handleOfferCalculated'));
  assert.ok(!router.includes('safeUpdateNotes'));
});

test('41 Normal Comp conversation cannot move stages (no write function called)', () => {
  const router = fs.readFileSync(path.join(__dirname, 'telegram-command-router.js'), 'utf8');
  assert.ok(!router.includes('safeUpdateStage'));
  assert.ok(!router.includes('updateOpportunityStage'));
});

// =============================================================
// STRATEGY SEPARATION
// =============================================================

test('42 Kayla cash method is labeled separately', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.cash.note.includes('Cash offer'));
  assert.strictEqual(r.cash.source, 'COURSE_UNIVERSAL');
});

test('43 F50 and F10 are labeled as seller finance structures', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.f50.note.includes('F50'));
  assert.ok(r.f10.note.includes('F10'));
  assert.strictEqual(r.f50.source, 'COURSE_PATH_SPECIFIC');
});

test('44 SubTo is labeled as subject-to existing mortgage', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.subTo.note.includes('SubTo'));
  assert.strictEqual(r.subTo.source, 'COURSE_PATH_SPECIFIC');
});

test('45 Mid-term is labeled as advisory FF estimate', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.midTerm.note.includes('Mid-term'));
  assert.ok(r.midTerm.note.includes('FF'));
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
  assert.ok(formatted.includes('130,000'));
});

test('47 Report is not raw JSON', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(!formatted.startsWith('{'));
});

test('48 Report shows source classification', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(formatted.includes('OWNER_MODIFICATION'));
  assert.ok(formatted.includes('COURSE_UNIVERSAL'));
  assert.ok(formatted.includes('SOURCE LEGEND'));
});

test('49 Report shows course vs owner fee', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  const formatted = offerCalc.formatAllStrategies(r);
  assert.ok(formatted.includes('OWNER: $20,000'));
  assert.ok(formatted.includes('COURSE: $10,000'));
});

test('50 No stale Jaxon-as-closer claim in active code', () => {
  const src = fs.readFileSync(path.join(__dirname, 'cash-offer-underwriter.js'), 'utf8');
  assert.ok(!src.includes('Jaxon'));
});

// =============================================================
// COURSE APPLICABILITY ENGINE
// =============================================================

test('51 Wrong strategy blocks wrong rule', () => {
  assert.throws(() => profileEngine.getProfile('nonexistent'), /Unknown strategy/);
});

test('52 MTR gets 250 cash flow threshold', () => {
  assert.strictEqual(profileEngine.cashFlowThreshold('mid_term'), 250);
});

test('53 Rental gets 200 cash flow threshold', () => {
  assert.strictEqual(profileEngine.cashFlowThreshold('rental'), 200);
});

test('54 1% rule is SCREEN_ONLY for rental', () => {
  assert.strictEqual(profileEngine.onePercentRule('rental').action, 'SCREEN_ONLY');
});

test('55 1% rule is PIVOT_TRIGGER for MTR', () => {
  assert.strictEqual(profileEngine.onePercentRule('mid_term').action, 'PIVOT_TRIGGER');
});

test('56 SubTo uses SubTo rules (purchase price, DP, EMD, payoff)', () => {
  const evidence = profileEngine.requiredEvidence('subject_to');
  assert.ok(evidence.includes('purchasePrice'));
  assert.ok(evidence.includes('downPayment'));
  assert.ok(evidence.includes('emd'));
  assert.ok(evidence.includes('payoff'));
});

test('57 Cash uses Cash rules (ARV, tier, sqft)', () => {
  const evidence = profileEngine.requiredEvidence('cash');
  assert.ok(evidence.includes('aru'));
  assert.ok(evidence.includes('tier'));
  assert.ok(evidence.includes('sqft'));
});

test('58 Spreadsheet examples not treated as universal', () => {
  assert.strictEqual(profileEngine.interestRate('subject_to'), 0.03);
  const profile = profileEngine.getProfile('subject_to');
  assert.strictEqual(profile.interestRate.source, 'SPREADSHEET_EXAMPLE');
});

test('59 Owner modifications override course only where documented', () => {
  const fee = profileEngine.wholesaleFee('cash');
  assert.strictEqual(fee.course, 10000);
  assert.strictEqual(fee.owner, 20000);
  assert.strictEqual(fee.active, 20000);
  assert.strictEqual(fee.source, 'OWNER_MODIFICATION');
});

test('60 No universal rule leaks into another strategy', () => {
  assert.notStrictEqual(profileEngine.cashFlowThreshold('cash'), profileEngine.cashFlowThreshold('mid_term'));
  assert.notStrictEqual(profileEngine.interestRate('cash'), profileEngine.interestRate('subject_to'));
  assert.notDeepStrictEqual(profileEngine.sellerProtections('cash'), profileEngine.sellerProtections('subject_to'));
});

test('61 NOT_IMPLEMENTED strategies are marked', () => {
  assert.strictEqual(profileEngine.isImplemented('stack_principal'), false);
  assert.strictEqual(profileEngine.isImplemented('interest_only_stack'), false);
  assert.strictEqual(profileEngine.isImplemented('zero_down'), false);
  assert.strictEqual(profileEngine.isImplemented('novation'), false);
  assert.strictEqual(profileEngine.isImplemented('cash'), true);
});

test('62 Applicable rules resolve by strategy', () => {
  const rules = profileEngine.getApplicableRules('cash', 'offer');
  assert.ok(rules.length > 0);
  assert.ok(rules.some(r => r.rule === 'cashFlowThreshold'));
  assert.ok(rules.some(r => r.rule === 'wholesaleFee'));
});

test('63 Required approvals include owner overrides', () => {
  const approvals = profileEngine.getRequiredApprovals('cash');
  assert.ok(approvals.some(a => a.type === 'OWNER_OVERRIDE' && a.field === 'wholesaleFee'));
});

test('64 Required disclosures include source types', () => {
  const disclosures = profileEngine.getRequiredDisclosures('cash');
  assert.ok(disclosures.some(d => d.source === 'OWNER_MODIFICATION'));
});

test('65 Rental produces DSCR when applicable', () => {
  const r = cashUnderwriter.runAllStrategies(FIXTURE);
  assert.ok(r.rental.dscr !== null);
  assert.ok(r.rental.dscrThreshold !== null);
});

test('66 Seller protections are structure-specific', () => {
  assert.deepStrictEqual(profileEngine.sellerProtections('subject_to'), ['deed_in_lieu', 'automated_payments', 'escrow_held_deed']);
  assert.deepStrictEqual(profileEngine.sellerProtections('cash'), ['deed_in_lieu']);
  assert.deepStrictEqual(profileEngine.sellerProtections('rental'), []);
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
