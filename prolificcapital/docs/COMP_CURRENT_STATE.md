# Comp Channel Current State

**Version:** 1.1
**Date:** 2026-08-03
**Status:** COMP_CHANNEL_CURRENT_AND_READY_READ_ONLY

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

## Formula Authority

| Formula | Engine | Classification |
|---|---|---|
| Cash: ARV x 0.70 - repairs -  fee | cash-offer-underwriter.js | OWNER_APPROVED |
| F50: 50% down + 50% carryback 72mo | cash-offer-underwriter.js | COURSE_ALIGNED |
| F10: 10% down + 90% in 24mo | cash-offer-underwriter.js | COURSE_ALIGNED |
| SubTo: ARV - repairs - existing loan | cash-offer-underwriter.js | COURSE_ALIGNED |
| Mid-term: ARV x 1.2% rule | cash-offer-underwriter.js | COURSE_ALIGNED |
| Repair: tier_rate x sqft | cash-offer-underwriter.js | COURSE_ALIGNED |

## Deterministic Verification

Identical inputs produce identical outputs through:
- Direct module call (cash-offer-underwriter.js)
- GHL wrapper (offer-calculator.js runAllStrategiesLocal)
- All 5 strategies verified cross-module

## Deprecated

- calculate() in offer-calculator.js: throws LEGACY_CALCULATOR_DISABLED
- formatOutput() in offer-calculator.js: mojibake, not routed
- desiredProfit=,000: UNSOURCED, removed from active path
- insurance=/mo: UNSOURCED, removed from active path

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