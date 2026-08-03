# Comp Engine Authority

**Version:** 1.2
**Date:** 2026-08-03

## Authoritative Engines

| Domain | Module | Function | Classification |
|---|---|---|---|
| Comp evidence | comps.js | finalizeCompReport | ACTIVE_ADVISORY |
| Underwriting | cash-offer-underwriter.js | runAllStrategies | AUTHORITATIVE_ACTIVE |
| GHL read wrapper | offer-calculator.js | runAllStrategiesLocal | ROUTE_TO_AUTHORITATIVE_ENGINE |
| Formatting | offer-calculator.js | formatAllStrategies | KEEP_FORMATTING |
| GHL reads | offer-calculator.js | fetchOpportunity | KEEP_READ_ONLY |
| Recommendation | offer-calculator.js | recommendStrategy | ACTIVE_ADVISORY |
| Mid-term | offer-calculator.js | midTermPivot | ACTIVE_ADVISORY |
| Comp states | comp-evidence-model.js | createCompRecord | ACTIVE_ADVISORY |
| Course profiles | course-profile-engine.js | getProfile | ACTIVE_ADVISORY |

## Deprecated

| Module | Function | Status |
|---|---|---|
| offer-calculator.js | calculate() | Throws LEGACY_CALCULATOR_DISABLED |
| offer-calculator.js | formatOutput() | Mojibake, not routed |
| offer-calculator.js | handleOfferCalculated() | OWNER_APPROVAL_REQUIRED_WRITE |

## Formula Registry

| Formula | Expression | Source |
|---|---|---|
| Cash | ARV x 0.70 - repairs - fee | cash-offer-underwriter.js cashStrategy() |
| F50 | (ARV x 0.70 - repairs) split 50/50 | cash-offer-underwriter.js f50Strategy() |
| F10 | (ARV x 0.70 - repairs) split 10/90 | cash-offer-underwriter.js f10Strategy() |
| SubTo | Purchase - DP - EMD - Payoff = equity | cash-offer-underwriter.js subToStrategy() |
| Mid-term | ARV x 1.2% | cash-offer-underwriter.js midTermStrategy() |
| Repairs | tier_rate x sqft | cash-offer-underwriter.js normalizeTier() |

## Owner-Approved Defaults

| Default | Value | Classification |
|---|---|---|
| Wholesale fee | $20,000 | OWNER_APPROVED |
| ARV multiplier | 0.70 | COURSE_EXPLICIT |
| Repair tiers | 30/45/60 $/sqft | COURSE_EXPLICIT |
| Mid-term rule | 1.2% | COURSE_EXPLICIT |

## Formatter Schema Audit

No runtime formatter defect was found. The pre-existing formatter
(`formatAllStrategies`) consumes the authoritative engine result schema:

| Formatter Access | Engine Field | Type |
|---|---|---|
| r.monthlyCashFlow | rental.monthlyCashFlow | number |
| r.dscr | rental.dscr | number |
| r.dscrThreshold | rental.dscrThreshold | number |
| r.cashFlowThreshold | rental.cashFlowThreshold | number |
| r.onePercentPasses | rental.onePercentPasses | boolean |
| r.source | rental.source | string |
| r.monthlyRent | rental.monthlyRent | number |

No production formatter mapping changed in the verification commit. No
underwriting or calculation logic changed. All formatted values are read-only
from the engine result, and regression test 67 preserves that contract.

## Deterministic Guarantee

Identical inputs produce identical outputs through all supported entry points. Verified cross-module: cash-offer-underwriter.js direct call and offer-calculator.js runAllStrategiesLocal() produce identical results for all 5 strategies. Formatter consumes engine result schema without transformation.
