# KAYLA MONTELLI STAGE 2 ACCEPTANCE SPECIFICATION

**Version:** 1.0
**Created:** 2026-07-31
**Canonical Authority:** `docs/KAYLA_CANONICAL_OPERATING_SYSTEM.md` v1.0
**Implementation Contract:** `docs/KAYLA_MONTELLI_STAGE2_IMPLEMENTATION_CONTRACT.md`

---

## PURPOSE

Every acceptance assertion must cite a canonical rule ID from the implementation
contract. Only resolved behaviors are tested. Unresolved behaviors are excluded.

---

## PRODUCTION SAFETY (ALL SCENARIOS)

- SMS sends: 0
- calls placed: 0
- GHL writes: 0
- notes created: 0
- stage movements: 0
- workflow modifications: 0

---

## SCENARIO 1: LISTING-AGENT COMPLETED-CONTACT PATH

**Canonical Rule IDs:** S2-ENTRY-001, S2-DATA-001, S2-CCC-001, S2-EVAL-001,
S2-F50-001, S2-HANDOFF-001, S2-EXIT-001

**Fixture:** Listing agent lead, call completed, CCC sent, contact card sent,
notes recorded with agent name, phone, email, occupancy (occupied), utilities
(on), roof (unknown), HVAC (unknown), rent ($1,400), lease (1 year), feedback
(price feedback), other properties (asked).

**Assertions:**
1. Stage 2 entry available when all prerequisites confirmed.
2. Stage 2 entry blocked when CCC not confirmed.
3. Stage 2 entry blocked when notes not recorded.
4. Contact name, phone, email displayed as mandatory.
5. Roof age displayed as unknown/not-provided (allowed).
6. HVAC age displayed as unknown/not-provided (allowed).
7. Occupancy displayed as mandatory and resolved.
8. Utilities displayed as mandatory and resolved.
9. Rent displayed as conditional (occupied) and resolved.
10. Lease displayed as conditional (rented) and resolved.
11. Listing feedback displayed as unknown-allowed.
12. Other properties displayed as optional.
13. CCC verification prompt displayed.
14. Evaluation prompt: turnkey or renovation.
15. Turnkey selected: rental comps note prompt displayed.
16. F50 displayed as available for turnkey.
17. F50 not sent without operator confirmation.
18. Handoff draft displayed (Seth email).
19. Handoff not sent without operator confirmation.
20. Stage 2 exit to Offer Ready available when evaluation and handoff complete.
21. Stage 2 exit blocked when evaluation incomplete.
22. No stage movement occurs without operator confirmation.
23. Production safety counters remain zero.

---

## SCENARIO 2: DIRECT-SELLER COMPLETED-CONTACT PATH

**Canonical Rule IDs:** S2-ENTRY-001, S2-DATA-001, S2-CCC-001, S2-EVAL-001,
S2-F50-001, S2-HANDOFF-001, S2-EXIT-001

**Fixture:** Direct seller lead, call completed, CCC sent, contact card sent,
notes recorded with seller name, phone, email, occupancy (vacant), utilities
(on), roof (10 years), HVAC (6 years), asking price ($250,000), other
properties (none).

**Assertions:**
1. Stage 2 entry available.
2. Asking price displayed as mandatory (seller path).
3. Listing feedback not displayed (not applicable to seller path).
4. Evaluation prompt displayed.
5. Renovation selected: rehab estimate prompt displayed.
6. F10 displayed as available for renovation.
7. F10 not sent without operator confirmation.
8. Handoff draft displayed.
9. Stage 2 exit available when complete.
10. Production safety counters remain zero.

---

## SCENARIO 3: MISSING-INFORMATION PATH

**Canonical Rule IDs:** S2-DATA-001

**Fixture:** Call completed but occupancy and utilities not recorded.

**Assertions:**
1. Occupancy displayed as UNRESOLVED_REQUIRED.
2. Utilities displayed as UNRESOLVED_REQUIRED.
3. Stage 2 evaluation blocked while mandatory fields unresolved.
4. Operator may mark roof/HVAC as unknown/not-provided.
5. Operator may not mark occupancy as unknown/not-provided (mandatory, not
   unknown-allowed).
6. Stage 2 exit blocked while mandatory fields unresolved.
7. Production safety counters remain zero.

---

## SCENARIO 4: UNKNOWN/NOT-PROVIDED HANDLING

**Canonical Rule IDs:** S2-DATA-001

**Fixture:** Call completed, all mandatory fields resolved, roof marked unknown,
HVAC marked not provided, feedback marked unknown.

**Assertions:**
1. Roof displayed as UNKNOWN_NOT_PROVIDED (not blocking).
2. HVAC displayed as UNKNOWN_NOT_PROVIDED (not blocking).
3. Feedback displayed as UNKNOWN_NOT_PROVIDED (not blocking).
4. Evaluation available (mandatory fields resolved).
5. Notes preview reflects unknown/not-provided dispositions.
6. Production safety counters remain zero.

---

## SCENARIO 5: CCC VERIFICATION

**Canonical Rule IDs:** S2-CCC-001

**Fixture:** Call completed, CCC not yet confirmed.

**Assertions:**
1. Stage 2 entry blocked without CCC confirmation.
2. CCC verification prompt displayed.
3. After CCC confirmed, entry available.
4. Production safety counters remain zero.

---

## SCENARIO 6: STAGE 2 EVALUATION

**Canonical Rule IDs:** S2-EVAL-001

**Fixture:** Information reviewed, CCC verified.

**Assertions:**
1. Turnkey/renovation classification prompt displayed.
2. Turnkey selected: rental comps note prompt displayed.
3. Renovation selected: rehab estimate + market rent prompt displayed.
4. Evaluation complete status recorded.
5. Production safety counters remain zero.

---

## SCENARIO 7: F50/F10 AVAILABILITY

**Canonical Rule IDs:** S2-F50-001

**Fixture A:** Turnkey classified.
**Assertions A:**
1. F50 displayed as available.
2. F10 not displayed (not applicable to turnkey).

**Fixture B:** Renovation classified.
**Assertions B:**
1. F10 displayed as available.
2. F50 not displayed (not applicable to renovation).

**Fixture C:** Deal type not yet classified.
**Assertions C:**
1. Neither F50 nor F10 displayed.

**All fixtures:**
- F50/F10 not sent without operator confirmation.
- Production safety counters remain zero.

---

## SCENARIO 8: HANDOFF

**Canonical Rule IDs:** S2-HANDOFF-001

**Fixture:** Evaluation complete, standard listing-agent path.

**Assertions:**
1. Handoff draft displayed with property address, contact details, property
   facts, deal type, comps/rehab notes.
2. Handoff not sent without operator confirmation.
3. After handoff confirmed, Stage 2 exit available.
4. Production safety counters remain zero.

---

## SCENARIO 9: STAGE 2 EXIT

**Canonical Rule IDs:** S2-EXIT-001

**Fixture:** All Stage 2 prerequisites met.

**Assertions:**
1. Exit to Offer Ready available.
2. Exit blocked when evaluation incomplete.
3. Exit blocked when handoff not submitted.
4. Exit requires operator confirmation.
5. No automatic stage movement.
6. Production safety counters remain zero.

---

## SCENARIO 10: GCJ AVAILABILITY

**Canonical Rule IDs:** S2-GCJ-001

**Fixture A:** Standard path, evaluation complete.
**Assertions A:**
1. GCJ displayed as available.

**Fixture B:** PPC path, initial call complete.
**Assertions B:**
1. GCJ (PGC) displayed as available.

**Fixture C:** No trigger condition met.
**Assertions C:**
1. GCJ not displayed.

**All fixtures:**
- GCJ not sent without operator confirmation.
- Production safety counters remain zero.

---

## SCENARIO 11: UNSUPPORTED SKIP-AHEAD

**Canonical Rule IDs:** S2-ENTRY-001, S2-EXIT-001

**Assertions:**
1. Stage 2 entry blocked when no completed call recorded.
2. Stage 2 exit blocked when evaluation incomplete.
3. Stage 2 exit blocked when handoff not submitted.
4. F50/F10 blocked when deal type not classified.
5. GCJ blocked when no trigger condition met.
6. No state mutation on blocked actions.
7. Production safety counters remain zero.

---

## SCENARIO 12: ALTERNATE OUTCOMES (BLOCKED)

**Canonical Rule IDs:** S2-ALT-001

**Status:** BLOCKED_COURSE_UNKNOWN

**Assertions:**
1. No alternate Stage 2 exit offered.
2. No automatic nurture timer.
3. No automatic disqualification.
4. Operator may remain in Contact Made.
5. Production safety counters remain zero.

---

## SCENARIO 13: REAL GHL READ-ONLY RECORDS

**Canonical Rule IDs:** All resolved.

**Assertions:**
1. Three real Lead Entered opportunities loaded in read-only mode.
2. Current stage is Lead Entered.
3. Property address and contact data displayed (masked).
4. Contact path returned (RESEARCH_REQUIRED if insufficient data).
5. No production action occurs.
6. Production safety counters remain zero.

---

## SCENARIO 14: PPC PATH

**Canonical Rule IDs:** S2-PPC-001

**Fixture:** PPC seller lead, PPC call completed, PCC sent, photos requested.

**Assertions:**
1. PPC-specific fields displayed (condition rating, net price, photos).
2. PPC shortcuts available (PIN, PNOA, PCC, PC, PGC, PPH).
3. Standard shortcuts not substituted for PPC shortcuts.
4. Photo requirement displayed.
5. PGC (group chat) available per PPC trigger.
6. Production safety counters remain zero.

---

*End of Stage 2 Acceptance Specification v1.0*
