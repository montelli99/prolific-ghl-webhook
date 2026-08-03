# Comp Channel — Topic 733

**Last updated:** 2026-08-03
**Status:** COMP_CHANNEL_CURRENT_AND_READY_READ_ONLY

## Routing
- Group: -1003975794600
- Topic: 733
- Agent: app-prolific-eng
- Session: agent:app-prolific-eng:telegram:group:-1003975794600:topic:733

## Authoritative Underwriting Engine
cash-offer-underwriter.js — single source of truth for all offer calculations.
- Wholesale fee: ,000 (owner-approved)
- ARV multiplier: 0.70
- Repair tiers: light=30, mid=45, full=60 ($/sqft)
- Strategies: Cash, F50, F10, SubTo, Mid-term
- No hidden defaults. Missing inputs block calculation.
- Identical inputs produce identical outputs through all entry points.

## Module Classifications
- cash-offer-underwriter.js: AUTHORITATIVE_ACTIVE
- comps.js: ACTIVE_ADVISORY
- offer-calculator.js runAllStrategies/runAllStrategiesLocal: ROUTE_TO_AUTHORITATIVE_ENGINE
- offer-calculator.js formatAllStrategies: KEEP_FORMATTING
- offer-calculator.js fetchOpportunity/fetchContactNotes: KEEP_READ_ONLY
- offer-calculator.js calculate(): DEPRECATED (throws error)
- offer-calculator.js formatOutput(): DEPRECATED (mojibake)
- offer-calculator.js handleOfferCalculated(): OWNER_APPROVAL_REQUIRED_WRITE
- comp-evidence-model.js: ACTIVE_ADVISORY

## Comp Evidence States
- CANDIDATE_COMP -> SELECTED_COMP -> OWNER_APPROVED_COMP
- CANDIDATE_COMP -> REJECTED_COMP
- Only owner can create OWNER_APPROVED_COMP
- Changing comp set invalidates dependent ARV

## Valuation States
- INSUFFICIENT_EVIDENCE -> PRELIMINARY_RANGE -> PROPOSED_ARV -> OWNER_APPROVED_ARV

## Live Data Capability
- No live MLS, Resideline, Zillow, or sold-comps provider is connected.
- The channel is advisory and processes operator-supplied evidence.
- Do not claim instant Resideline analysis or automatic GHL field sync.

## GHL Write Safety
- Comp channel is READ_ONLY_ADVISORY
- No GHL writes from normal Comp conversation
- handleOfferCalculated() gated behind owner approval
- Custom-field mapping: NOT_CONNECTED_INTENTIONALLY_PENDING_OWNER_APPROVAL

## Superseded Claims
- Instant Resideline analysis — SUPERSEDED (no live provider)
- Automatic GHL field sync — SUPERSEDED (not connected)
- ,000 wholesale fee — SUPERSEDED (,000 owner-approved)
- Jaxon as current closer — SUPERSEDED (Kayla is current closer)
- Live MLS comps — SUPERSEDED (not connected)
- Legacy calculate() authority — SUPERSEDED (deprecated)
- Hidden insurance= default — SUPERSEDED (removed)
- Hidden desiredProfit=,000 — SUPERSEDED (removed)