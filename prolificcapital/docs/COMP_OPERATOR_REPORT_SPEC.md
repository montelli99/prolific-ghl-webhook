# Comp Operator Report Specification

**Version:** 1.0
**Date:** 2026-08-03

## Required Sections

### PROPERTY
- Address
- Source (operator-supplied / GHL / manual)
- Current Pipeline stage if known
- Known facts (beds, baths, sqft, year built, lot)
- Missing facts

### COMP EVIDENCE
For each comp:
- State (CANDIDATE / SELECTED / REJECTED / OWNER_APPROVED)
- Source
- Price, status, sale date
- Distance
- Similarity factors
- Adjustments
- Inclusion or rejection reason
- Confidence

### VALUATION
- Low / Base / High range
- Methodology
- Assumptions disclosed
- Valuation state (INSUFFICIENT_EVIDENCE / PRELIMINARY_RANGE / PROPOSED_ARV / OWNER_APPROVED_ARV)
- Owner approval status

### REPAIRS
- Tier (light=30 / mid=45 / full=60 $/sqft)
- Square footage
- Calculation: tier_rate x sqft
- Evidence source
- Confidence
- Missing facts

### STRATEGIES
Separate sections for each:
- Cash / Wholesale
- F50 (Stack 50%)
- F10 (Stack 10%)
- Subject-To
- Rental / Hold
- Mid-term advisory (if applicable)

For each strategy show:
- Required inputs
- Result
- Assumptions
- Risks
- Missing data
- Deterministic or advisory classification

### RECOMMENDATION
- Next human action
- Questions for agent/seller
- Exact owner approvals needed
- NOT a binding offer

### PRODUCTION EFFECTS
- Messages sent: 0
- GHL writes: 0
- Stage movements: 0
- Documents generated: 0

## Format Rules
- Mobile-friendly (Telegram-compatible)
- No raw JSON dumps
- Selected/rejected comps clearly shown
- Owner approvals explicitly listed
- Production effects always shown
- No stale Resideline/MLS claims
- No stale  fee
- No stale Jaxon-as-closer claim