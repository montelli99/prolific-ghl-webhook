# Comp Channel Current State

**Version:** 1.3
**Date:** 2026-08-03
**Status:** COMP_FORMATTER_SCHEMA_VERIFIED_AND_STATE_PRESERVED

## Module Classifications

| Module | Classification |
|---|---|
| cash-offer-underwriter.js | AUTHORITATIVE_ACTIVE |
| comps.js | ACTIVE_ADVISORY |
| offer-calculator.js (runAllStrategies) | ROUTE_TO_AUTHORITATIVE_ENGINE |
| offer-calculator.js (runAllStrategiesLocal) | ROUTE_TO_AUTHORITATIVE_ENGINE |
| offer-calculator.js (formatAllStrategies) | KEEP_FORMATTING |
| offer-calculator.js (fetchOpportunity) | KEEP_READ_ONLY |
| offer-calculator.js (calculate) | DEPRECATED |
| offer-calculator.js (formatOutput) | DEPRECATED |
| offer-calculator.js (handleOfferCalculated) | OWNER_APPROVAL_REQUIRED_WRITE |
| comp-evidence-model.js | ACTIVE_ADVISORY |
| course-profile-engine.js | ACTIVE_ADVISORY |

## Formula Authority

| Formula | Engine | Classification |
|---|---|---|
| Cash: ARV x 0.70 - repairs - fee | cash-offer-underwriter.js | OWNER_APPROVED |
| F50: 50% down + 50% carryback 72mo | cash-offer-underwriter.js | COURSE_ALIGNED |
| F10: 10% down + 90% in 24mo | cash-offer-underwriter.js | COURSE_ALIGNED |
| SubTo: Purchase - DP - EMD - Payoff = equity | cash-offer-underwriter.js | COURSE_ALIGNED |
| Mid-term: ARV x 1.2% | cash-offer-underwriter.js | COURSE_ALIGNED |
| Repair: tier_rate x sqft | cash-offer-underwriter.js | COURSE_ALIGNED |

## Formatter Schema Verification

No formatter defect was found. `formatAllStrategies()` already consumed the
authoritative rental result schema returned by `cash-offer-underwriter.js`.
No production formatter mapping or underwriting calculation change was
required. Regression coverage locks this contract against legacy field names.

| Formatter Field | Engine Field | Status |
|---|---|---|
| r.monthlyCashFlow | rental.monthlyCashFlow | ALIGNED |
| r.dscr | rental.dscr (number) | ALIGNED |
| r.dscrThreshold | rental.dscrThreshold (number) | ALIGNED |
| r.cashFlowThreshold | rental.cashFlowThreshold | ALIGNED |
| r.onePercentPasses | rental.onePercentPasses | ALIGNED |
| r.source | rental.source | ALIGNED |
| r.monthlyRent | rental.monthlyRent | ALIGNED |

## Deterministic Verification

Identical inputs produce identical outputs through:
- Direct module call (cash-offer-underwriter.js)
- GHL wrapper (offer-calculator.js runAllStrategiesLocal)
- All 5 strategies verified cross-module
- Formatter consumes authoritative engine result schema correctly
- No undefined values in rendered output
- No stale field names in rendered output

## Test Results

| Suite | Tests | Passed | Status |
|---|---|---|---|
| Complete Comp verification | 67 | 67 | ALL_PASS |
| Formatter regression | Included as test 67 | PASS | ALL_PASS |
| Topic-733 routing | 1 | 1 | READ_ONLY_VERIFIED |

## Deprecated

- calculate() in offer-calculator.js: throws LEGACY_CALCULATOR_DISABLED
- formatOutput() in offer-calculator.js: mojibake, not routed
- desiredProfit=15000: UNSOURCED, removed from active path
- insurance=120/mo: UNSOURCED, removed from active path

## Live Data

| Provider | Status |
|---|---|
| Resideline | NOT_CONNECTED |
| MLS | NOT_CONNECTED |
| Zillow | NOT_CONNECTED |
| Redfin | NOT_CONNECTED |
| Propwire | NOT_CONNECTED |

## GHL Write Safety

| Function | Reachable from topic 733 | Gate |
|---|---|---|
| Note write | No | Owner approval required |
| Field write | No | NOT_CONNECTED |
| Stage movement | No | Owner approval required |
| Offer/LOI send | No | Owner approval required |

## Limitations

- No live MLS/Resideline/Zillow provider connected
- Operator must supply comp evidence
- No autonomous GHL writes
- No autonomous stage movements
- No autonomous offer sending
- Custom-field mapping pending owner approval
- Mid-term analysis advisory without live FF data

## Kill Switch

- State: PAUSED
- Provider sends: 0
- GHL writes: 0
- Stage movements: 0
