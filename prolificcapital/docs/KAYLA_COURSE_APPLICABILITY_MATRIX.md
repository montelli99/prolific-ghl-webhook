# Kayla Course Applicability Matrix

**Version:** 1.0
**Date:** 2026-08-03
**Source:** Course transcripts, spreadsheets, SOPs, LOIs, written processes

## Deal Structures

### Cash / Wholesale

| Field | Value |
|---|---|
| Strategy ID | cash |
| Implemented | Yes |
| Stages | comp, offer |
| Source | COURSE_UNIVERSAL |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | N/A |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | COURSE: $10000, OWNER: $20000 (OWNER_MODIFICATION) |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | deed_in_lieu |
| Formula | ARV × 0.70 − repairs − wholesale_fee |
| Required Evidence | aru, tier, sqft |

### F50 (Stack 50%)

| Field | Value |
|---|---|
| Strategy ID | f50 |
| Implemented | Yes |
| Stages | offer, negotiation |
| Source | COURSE_PATH_SPECIFIC |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | N/A |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | COURSE: $10000, OWNER: $20000 (OWNER_MODIFICATION) |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | deed_in_lieu, balloon_72mo |
| Formula | (ARV × 0.70 − repairs) split 50/50, 72mo balloon |
| Required Evidence | aru, tier, sqft |

### F10 (Stack 10%)

| Field | Value |
|---|---|
| Strategy ID | f10 |
| Implemented | Yes |
| Stages | offer, negotiation |
| Source | COURSE_PATH_SPECIFIC |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | N/A |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | COURSE: $10000, OWNER: $20000 (OWNER_MODIFICATION) |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | deed_in_lieu, balloon_24mo |
| Formula | (ARV × 0.70 − repairs) split 10/90, 24mo lump sum |
| Required Evidence | aru, tier, sqft |

### Stack Principal

| Field | Value |
|---|---|
| Strategy ID | stack_principal |
| Implemented | NOT_IMPLEMENTED |
| Stages | offer, negotiation |
| Source | COURSE_PATH_SPECIFIC |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | N/A |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | N/A |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | deed_in_lieu |
| Formula | Principal + interest stack. Monthly payments to seller. |
| Required Evidence | aru, tier, sqft, purchasePrice |
| Note | NOT_IMPLEMENTED — outside current production launch scope. |

### Interest Only Stack

| Field | Value |
|---|---|
| Strategy ID | interest_only_stack |
| Implemented | NOT_IMPLEMENTED |
| Stages | offer, negotiation |
| Source | COURSE_PATH_SPECIFIC |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | N/A |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | N/A |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | deed_in_lieu |
| Formula | Interest-only payments to seller. Balloon at term. |
| Required Evidence | aru, tier, sqft, purchasePrice |
| Note | NOT_IMPLEMENTED — outside current production launch scope. |

### Zero Down

| Field | Value |
|---|---|
| Strategy ID | zero_down |
| Implemented | NOT_IMPLEMENTED |
| Stages | offer, negotiation |
| Source | COURSE_PATH_SPECIFIC |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | N/A |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | N/A |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | deed_in_lieu |
| Formula | Rental AND owned free/clear. No down payment. |
| Required Evidence | aru, tier, sqft, isOwnedFree |
| Note | NOT_IMPLEMENTED — outside current production launch scope. |

### Subject To

| Field | Value |
|---|---|
| Strategy ID | subject_to |
| Implemented | Yes |
| Stages | offer, negotiation, loi |
| Source | COURSE_PATH_SPECIFIC |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 3% (SPREADSHEET_EXAMPLE) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | N/A |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | COURSE: $10000, OWNER: $20000 (OWNER_MODIFICATION) |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | deed_in_lieu, automated_payments, escrow_held_deed |
| Formula | Purchase price − DP − EMD − payoff = seller equity. Monthly cash flow = rent − PITI. |
| Required Evidence | purchasePrice, downPayment, emd, payoff, existingLoan, existingRate, monthlyRent, propertyTaxes, insurance |
| Note | SubTo uses purchase price, DP, EMD, payoff, seller equity, and monthly cash flow — not ARV − repairs − loan. |

### Novation

| Field | Value |
|---|---|
| Strategy ID | novation |
| Implemented | NOT_IMPLEMENTED |
| Stages | offer, negotiation |
| Source | COURSE_PATH_SPECIFIC |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | N/A |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | N/A |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | None |
| Formula | Move-in ready, low motivation. Transfer contract position. |
| Required Evidence | aru, tier, sqft, moveInReady, motivation |
| Note | NOT_IMPLEMENTED — outside current production launch scope. |

### General Rental (Long-Term)

| Field | Value |
|---|---|
| Strategy ID | rental |
| Implemented | Yes |
| Stages | comp, offer |
| Source | COURSE_UNIVERSAL |
| Cash Flow Threshold | $200/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | SCREEN_ONLY (COURSE_UNIVERSAL) |
| DSCR | 1.25x (COURSE_UNIVERSAL) |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | N/A |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | None |
| Formula | Monthly cash flow = rent − PITI − vacancy − maintenance − management. Must exceed cashFlowThreshold. |
| Required Evidence | monthlyRent, purchasePrice, propertyTaxes, insurance |

### Mid-Term Rental (Furnished Finder)

| Field | Value |
|---|---|
| Strategy ID | mid_term |
| Implemented | Yes |
| Stages | comp, offer |
| Source | COURSE_PATH_SPECIFIC |
| Cash Flow Threshold | $250/mo |
| Interest Rate | 7% (COURSE_PATH_SPECIFIC) |
| 1% Rule | PIVOT_TRIGGER (COURSE_PATH_SPECIFIC) |
| DSCR | 1.25x (COURSE_UNIVERSAL) |
| Repair Method | TIER_X_SQFT (COURSE_UNIVERSAL) |
| Wholesale Fee | N/A |
| ARV Multiplier | 0.70 (COURSE_UNIVERSAL) |
| Seller Protections | None |
| Formula | Actual Furnished Finder per-room rate × bedrooms. Existing multipliers are ADVISORY_ONLY. |
| Required Evidence | furnishedFinderRate, bedrooms, purchasePrice |
| Note | Requires actual Furnished Finder data. ARV × 1.2% is ADVISORY_ONLY fallback. |
