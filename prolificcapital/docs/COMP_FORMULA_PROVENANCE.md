# Comp Formula Provenance

**Version:** 1.0
**Date:** 2026-08-03

## Cash Offer

ARV x 0.70 - repairs - ,000 wholesale fee

- **Source:** cash-offer-underwriter.js cashStrategy()
- **Course:** AI REI file 17A
- **Owner policy:** ,000 wholesale fee (supersedes course )
- **Required inputs:** ARV, repair tier, square footage
- **Missing input behavior:** BLOCK

## F50 (Stack 50%)

(ARV x 0.70 - repairs) split 50/50

- **Source:** cash-offer-underwriter.js f50Strategy()
- **Structure:** 50% down + 50% carryback, 72mo balloon, deed in lieu

## F10 (Stack 10%)

(ARV x 0.70 - repairs) split 10/90

- **Source:** cash-offer-underwriter.js f10Strategy()
- **Structure:** 10% down + 90% in 24mo lump sum

## Subject-To

ARV - repairs - existing loan balance

- **Source:** cash-offer-underwriter.js subToStrategy()
- **Required inputs:** ARV, repair tier, sqft, existing loan balance, existing rate

## Mid-Term Rental

ARV x 1.2% = estimated monthly rent

- **Source:** cash-offer-underwriter.js midTermStrategy()
- **Course:** AI REI video 03 - Furnished Finder 1.2% rule
- **Note:** Advisory only without live Furnished Finder data

## Repair Estimate

	ier_rate x square_footage

- **Tiers:** light=30, mid=45, full=60 ($/sqft)
- **Source:** cash-offer-underwriter.js normalizeTier()

## Deprecated Formulas

- **Legacy calculate():** offer-calculator.js — throws LEGACY_CALCULATOR_DISABLED
- **desiredProfit=,000:** UNSOURCED — removed from active path
- **insurance=/mo:** UNSOURCED — removed from active path

## Owner-Approved Defaults

- Wholesale fee: ,000
- ARV multiplier: 0.70
- Repair tiers: 30/45/60 $/sqft