# KAYLA MONTELLI STAGE 2 IMPLEMENTATION CONTRACT

**Version:** 1.0
**Created:** 2026-07-31
**Canonical Authority:** `docs/KAYLA_CANONICAL_OPERATING_SYSTEM.md` v1.0
**Evidence Index:** `docs/KAYLA_STAGE2_COURSE_EVIDENCE_INDEX.md`
**Decision Register:** `docs/kayla-stage2-decision-register.json`

---

## PURPOSE

This contract defines every Stage 2 behavior that is resolved and ready for
implementation. Only behaviors with `COURSE_EXPLICIT`,
`COURSE_EXPLICIT_BY_WORKED_EXAMPLE`,
`COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES`, or `COURSE_PATH_SPECIFIC`
classification are included. Unresolved behaviors are explicitly marked as
blocked.

---

## STAGE 2 IDENTITY

- **Stage:** Contact Made
- **Stage ID:** `934c4c52-4b22-457a-8d10-55ab6600fdee`
- **Next Stage:** Offer Ready to be Sent to Seller (`3da698e7-aba8-4d4a-b14b-7742f7b44ac7`)
- **Responsible Person:** Operator (Montelli)

---

## RESOLVED BEHAVIORS

### B1: Stage 2 Entry

**Canonical Rule ID:** S2-ENTRY-001
**Classification:** `COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES`

**Entry Requirements:**
1. Contact path is established.
2. A completed two-way conversation has occurred.
3. CCC text shortcut has been sent.
4. Contact card has been sent.
5. Call notes have been recorded.

**Operator Action:** Confirm all entry requirements are met. Confirm entry into
Contact Made.

**Blocked Entry Conditions:**
- Contact path is RESEARCH_REQUIRED.
- No completed call is recorded.
- CCC is not confirmed sent.
- Contact card is not confirmed sent.
- Notes are not recorded.

**Telegram Prompt:** "Contact Made entry requires: completed call, CCC sent,
contact card sent, notes recorded. Confirm entry?"

**Human Confirmation:** Required.

**GHL Recording:** Stage movement to Contact Made (operator-confirmed only).

**JustCall Behavior:** None (read-only).

**Acceptance Assertion:** Entry blocked when any prerequisite is missing. Entry
available when all prerequisites are confirmed.

---

### B2: Information Review

**Canonical Rule ID:** S2-DATA-001
**Classification:** `COURSE_EXPLICIT_BY_WORKED_EXAMPLE`

**Field Requirements by Path:**

| Field | Agent/Broker | Direct Seller | FSBO | PPC |
|---|---|---|---|---|
| Contact name | MANDATORY | MANDATORY | MANDATORY | MANDATORY |
| Contact phone | MANDATORY | MANDATORY | MANDATORY | MANDATORY |
| Contact email | MANDATORY | MANDATORY | MANDATORY | MANDATORY |
| Occupancy | MANDATORY | MANDATORY | MANDATORY | MANDATORY |
| Utilities | MANDATORY | MANDATORY | MANDATORY | MANDATORY |
| Roof age | UNKNOWN_ALLOWED | UNKNOWN_ALLOWED | UNKNOWN_ALLOWED | UNKNOWN_ALLOWED |
| HVAC age | UNKNOWN_ALLOWED | UNKNOWN_ALLOWED | UNKNOWN_ALLOWED | UNKNOWN_ALLOWED |
| Rent amount | CONDITIONAL | CONDITIONAL | CONDITIONAL | CONDITIONAL |
| Lease terms | CONDITIONAL | CONDITIONAL | CONDITIONAL | CONDITIONAL |
| Listing feedback | UNKNOWN_ALLOWED | N/A | N/A | N/A |
| Asking price | N/A | MANDATORY | MANDATORY | N/A |
| Net price | N/A | N/A | N/A | MANDATORY |
| Property condition | N/A | N/A | N/A | MANDATORY |
| Photos | N/A | N/A | N/A | MANDATORY |
| Other properties | OPTIONAL | OPTIONAL | OPTIONAL | OPTIONAL |
| Seller motivation | OPTIONAL | OPTIONAL | OPTIONAL | OPTIONAL |
| Seller timeline | OPTIONAL | OPTIONAL | OPTIONAL | OPTIONAL |

**Allowed Field Dispositions:**
- `RECORDED` — Answer provided.
- `UNKNOWN_NOT_PROVIDED` — Contact could not answer. Allowed for roof, HVAC,
  feedback.
- `NOT_APPLICABLE` — Field does not apply to this path.
- `UNRESOLVED_REQUIRED` — Mandatory field not yet resolved. Blocks completion.

**Operator Action:** Review each field. Mark unknown/not-provided where contact
could not answer. Resolve mandatory fields.

**Blocked Conditions:** Any mandatory field in `UNRESOLVED_REQUIRED` status.

**Telegram Prompt:** Display field status. Allow marking unknown/not-provided.
Show blocking fields.

**Human Confirmation:** Required for field dispositions.

**Acceptance Assertion:** Mandatory fields block completion when unresolved.
Unknown/not-provided allowed for roof, HVAC, feedback. Conditional fields block
only when condition applies. Optional fields never block.

---

### B3: CCC Verification

**Canonical Rule ID:** S2-CCC-001
**Classification:** `COURSE_EXPLICIT_BY_WORKED_EXAMPLE`

**Rule:** CCC and contact card are post-call actions sent immediately after
every completed call. Their completion is confirmed as part of the Contact Made
entry gate.

**Operator Action:** Confirm CCC and contact card were sent after the call.

**Blocked Conditions:** CCC or contact card not confirmed sent.

**Telegram Prompt:** "CCC and contact card sent after the call? Confirm."

**Human Confirmation:** Required.

**Acceptance Assertion:** CCC verification available. Entry blocked without CCC
confirmation.

---

### B4: Stage 2 Evaluation

**Canonical Rule ID:** S2-EVAL-001
**Classification:** `COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES`

**Rule:** The operator classifies the property as turnkey/good condition or
needs renovation. For turnkey: note rental comps and rent viability. For
renovation: note rehab estimate and market rent.

**Operator Action:**
1. Classify property type: turnkey or renovation.
2. If turnkey: note rental comps and rent viability.
3. If renovation: note rehab estimate and market rent.

**Blocked Conditions:** Property type not classified.

**Telegram Prompt:** "Classify property: turnkey/good condition or needs
renovation? Note rental comps (turnkey) or rehab estimate (renovation)."

**Human Confirmation:** Required.

**Acceptance Assertion:** Evaluation options displayed. Classification required.
Comps/rehab notes recorded per branch.

---

### B5: F50 and F10

**Canonical Rule ID:** S2-F50-001
**Classification:** `COURSE_PATH_SPECIFIC`

**Rule:** F50 and F10 are creative financing proposal shortcuts available as
Stage 2 evaluation options when the deal type supports them. F50 for turnkey.
F10 for renovation/older. They are not universal Stage 2 actions.

**Operator Action:** Display F50 or F10 as evaluation option when deal type
supports. Operator decides whether to send.

**Blocked Conditions:** F50/F10 not applicable to this deal type.

**Telegram Prompt:** "F50 available (turnkey): [wording]. F10 available
(renovation): [wording]. Send?"

**Human Confirmation:** Required before sending.

**Acceptance Assertion:** F50 available for turnkey. F10 available for
renovation. Neither available when deal type not classified. Neither sent
without operator confirmation.

---

### B6: Handoff

**Canonical Rule ID:** S2-HANDOFF-001
**Classification:** `COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES`

**Rule:** The operator submits the information package to the closer team.
Standard path: email Seth for LOI. PPC path: group chat with Kayla. The
package includes property address, contact details, property facts, deal type,
and relevant comps/rehab notes.

**Operator Action:** Submit information package. Standard: draft Seth email.
PPC: confirm group chat.

**Blocked Conditions:** Information package incomplete.

**Telegram Prompt:** "Handoff ready. Standard: email Seth. PPC: group chat with
Kayla. Confirm submission?"

**Human Confirmation:** Required. Software drafts; operator confirms send.

**Acceptance Assertion:** Handoff draft displayed. Not sent without
confirmation. Package includes required information.

---

### B7: Stage 2 Exit

**Canonical Rule ID:** S2-EXIT-001
**Classification:** `COURSE_SYNTHESIZED_FROM_MULTIPLE_EXPLICIT_SOURCES`

**Rule:** The operator moves the lead to Offer Ready after completing Stage 2
evaluation and submitting the information package to the closer team. The
transition is operator-confirmed.

**Operator Action:** Confirm movement to Offer Ready.

**Blocked Conditions:** Evaluation incomplete. Handoff not submitted.

**Telegram Prompt:** "Stage 2 complete. Move to Offer Ready?"

**Human Confirmation:** Required.

**GHL Recording:** Stage movement to Offer Ready (operator-confirmed only).

**Acceptance Assertion:** Exit blocked when evaluation or handoff incomplete.
Exit available when all prerequisites met. No automatic movement.

---

### B8: GCJ

**Canonical Rule ID:** S2-GCJ-001
**Classification:** `COURSE_PATH_SPECIFIC`

**Rule:** GCJ has multiple path-specific triggers:
- PPC path: end of initial PPC call.
- Hot lead: seller engaged, countering, or deal confirmed real.
- Standard path: after Stage 2 evaluation, as part of handoff.

**Operator Action:** Send GCJ when trigger condition is met.

**Blocked Conditions:** Trigger condition not met.

**Telegram Prompt:** Per path: "GCJ available. Send group chat intro?"

**Human Confirmation:** Required.

**Acceptance Assertion:** GCJ available per path-specific trigger. Not sent
without confirmation.

---

## BLOCKED BEHAVIORS

### B9: Alternate Stage 2 Outcomes

**Canonical Rule ID:** S2-ALT-001
**Status:** `COURSE_UNKNOWN`
**Blocked:** Yes.

No course source defines valid alternate exits from Stage 2. The operator may
keep the lead in Contact Made for follow-up, but no automated alternate exit is
authorized.

**Temporary Behavior:** Operator may remain in Contact Made. No automatic
movement to any other stage. No nurture timer. No automatic disqualification.

---

## STAGE 2 TIMING

**Status:** `COURSE_EXPLICIT`
**Rule:** No course-defined timer exists for Contact Made. The 48-hour rule
applies after an offer is sent or offer receipt is confirmed, not during
Contact Made. Follow-up is event-driven.

**Implementation:** No automatic timer. Operator decides when to follow up.

---

## STAGE 2 STATE MACHINE

```
LEAD_ENTERED (Stage 1 complete)
    │
    ▼
[Entry Gate: call completed? CCC sent? contact card sent? notes recorded?]
    │ YES
    ▼
CONTACT_MADE_ENTRY_CONFIRMED
    │
    ▼
[Information Review: mandatory fields resolved? unknowns marked?]
    │ YES
    ▼
INFORMATION_REVIEWED
    │
    ▼
[CCC Verification: CCC and contact card confirmed sent?]
    │ YES
    ▼
CCC_VERIFIED
    │
    ▼
[Evaluation: turnkey or renovation? comps/rehab noted?]
    │ YES
    ▼
EVALUATION_COMPLETE
    │
    ▼
[F50/F10: applicable? operator decision?]
    │
    ▼
[HANDOFF: information package submitted?]
    │ YES
    ▼
HANDOFF_SUBMITTED
    │
    ▼
[Exit Gate: operator confirms movement to Offer Ready?]
    │ YES
    ▼
OFFER_READY (Stage 3)
```

---

## IMPLEMENTATION NOTES

- All stage movements require operator confirmation.
- No automatic sends, calls, or writes.
- No automatic timers.
- CCC, F50, F10, GCJ display requires operator confirmation before sending.
- Handoff drafts are preview-only until operator confirms.
- Alternate Stage 2 outcomes remain blocked.
- PPC path uses PPC-specific shortcuts (PIN, PNOA, PCC, PC, PGC, PPH).
- FSBO follows standard direct-seller path.

---

*End of Stage 2 Implementation Contract v1.0*
