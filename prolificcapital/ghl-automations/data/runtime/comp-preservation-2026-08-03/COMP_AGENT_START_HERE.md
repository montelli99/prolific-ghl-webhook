# Comp Agent Start Here

**Context Version:** 1.3
**Date:** 2026-08-03
**Status:** COMP_FORMATTER_SCHEMA_VERIFIED_AND_STATE_PRESERVED

## Quick Start

1. Read `comp-capabilities.json` for the full capability registry.
2. Read `docs/COMP_CURRENT_STATE.md` for current state.
3. Read `docs/COMP_ENGINE_AUTHORITY.md` for engine authority.
4. Read `docs/COMP_OPERATOR_REPORT_SPEC.md` for report format spec.
5. Run `node ghl-automations/modules/_test_comp_verification.js` to verify 67/67 tests pass.

## Authoritative Modules

| Module | Role |
|---|---|
| `ghl-automations/modules/cash-offer-underwriter.js` | AUTHORITATIVE_ACTIVE — all underwriting calculations |
| `ghl-automations/modules/offer-calculator.js` | ROUTE_TO_AUTHORITATIVE_ENGINE + KEEP_FORMATTING |
| `ghl-automations/modules/comp-evidence-model.js` | ACTIVE_ADVISORY — comp evidence states |
| `ghl-automations/modules/course-profile-engine.js` | ACTIVE_ADVISORY — strategy profiles |
| `ghl-automations/modules/comps.js` | ACTIVE_ADVISORY — comp report generation |
| `ghl-automations/modules/mid-term-pivot.js` | ACTIVE_ADVISORY — MTR pivot logic |

## Formatter-Engine Schema

The formatter (`formatAllStrategies` in `offer-calculator.js`) consumes the engine result schema from `cash-offer-underwriter.js`:

| Formatter Access | Engine Field | Type |
|---|---|---|
| `r.monthlyCashFlow` | `rental.monthlyCashFlow` | number |
| `r.dscr` | `rental.dscr` | number |
| `r.dscrThreshold` | `rental.dscrThreshold` | number |
| `r.cashFlowThreshold` | `rental.cashFlowThreshold` | number |
| `r.onePercentPasses` | `rental.onePercentPasses` | boolean |
| `r.source` | `rental.source` | string |
| `r.monthlyRent` | `rental.monthlyRent` | number |

No calculation logic in the formatter. All values are read-only from the engine result.
The formatter already used this schema before the verification commit; no
production formatter or underwriting code changed.

## Kill Switch

- State: PAUSED
- Provider sends: 0
- GHL writes: 0
- Stage movements: 0

## Restoration

To restore Comp context:
1. Unzip `comp-preservation-2026-08-03.zip`
2. Verify SHA-256 manifest against `comp-manifest.sha256`
3. Read `COMP_AGENT_START_HERE.md`
4. Run `node ghl-automations/modules/_test_comp_verification.js`
5. Confirm 67/67 tests pass
