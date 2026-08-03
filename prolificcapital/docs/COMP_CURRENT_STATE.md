# Comp Channel Current State

**Version:** 1.0
**Date:** 2026-08-03
**Status:** COMP_CHANNEL_READY_ADVISORY_ONLY

## Channel Routing

| Item | Value |
|---|---|
| Group | -1003975794600 |
| Topic | 733 |
| Topic name | Comps |
| Agent | app-prolific-eng |
| Workspace | C:\Users\mscott\AI_Workspace\prolificcapital |

## Module Classifications

| Module | Classification |
|---|---|
| cash-offer-underwriter.js | AUTHORITATIVE_ACTIVE |
| comps.js | ACTIVE_ADVISORY |
| offer-calculator.js (runAllStrategies) | ACTIVE (delegates to cash-offer-underwriter) |
| offer-calculator.js (calculate) | DEPRECATED |
| offer-calculator.js (formatOutput) | DEPRECATED |
| offer-calculator.js (handleOfferCalculated) | OWNER_APPROVAL_REQUIRED_WRITE |
| comp-evidence-model.js | ACTIVE_ADVISORY |

## Formula Authority

| Formula | Source | Classification |
|---|---|---|
| Cash: ARV × 0.70 − repairs − $20K fee | cash-offer-underwriter.js | OWNER_APPROVED |
| F50: 50% down + 50% carryback 72mo | cash-offer-underwriter.js | COURSE_ALIGNED |
| F10: 10% down + 90% in 24mo | cash-offer-underwriter.js | COURSE_ALIGNED |
| SubTo: ARV − repairs − existing loan | cash-offer-underwriter.js | COURSE_ALIGNED |
| Mid-term: ARV × 1.2% rule | cash-offer-underwriter.js | COURSE_ALIGNED |
| Repair tiers: 30/45/60 $/sqft | cash-offer-underwriter.js | COURSE_ALIGNED |

## Live Data Providers

| Provider | Status |
|---|---|
| Resideline | NOT_CONNECTED |
| Zillow | NOT_CONNECTED |
| MLS sold data | NOT_CONNECTED |
| Propwire | NOT_CONNECTED |
| Redfin | NOT_CONNECTED |
| Rent estimate | NOT_CONNECTED |
| Tax provider | NOT_CONNECTED |

## GHL Write Safety

| Function | Reachable from topic 733 | Requires owner approval | Currently enabled |
|---|---|---|---|
| Note write | No (gated) | Yes | No |
| Custom-field write | No | Yes | No |
| Stage movement | No (gated) | Yes | No |
| Offer/LOI send | No | Yes | No |

## Limitations

- No live MLS/Resideline provider
- Operator must supply comp evidence
- No autonomous GHL writes
- No autonomous stage movements
- No autonomous offer sending
- Custom-field mapping pending owner approval
