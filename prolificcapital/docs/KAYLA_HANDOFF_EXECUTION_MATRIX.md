# Kayla Handoff Execution Matrix

**Policy:** OP-2026-08-02-v1
**Baseline:** pipeline-production-v1.0

## Stage Boundaries

### STAGE 1 — INT CANARY (Lead Entered)

| Action | Allowed | Status |
|--------|---------|--------|
| Render INT | Yes | READY |
| Send approved INT | Yes | READY |
| Reconcile provider result | Yes | READY |
| Remain at Lead Entered | Yes | READY |
| GHL write | No | BLOCKED |
| Call | No | BLOCKED |
| CCC text | No | BLOCKED |
| Contact card | No | BLOCKED |
| Group handoff | No | BLOCKED |
| Stage movement | No | BLOCKED |

### POST-CALL CCC STEP (after qualifying completed call)

| Action | Allowed | Status |
|--------|---------|--------|
| CCC text (shortcut) | Yes | READY |
| Contact card (VCF) | Yes | BLOCKED (missing owner info) |
| Advance to Stage 2 | Only after both CCC text + contact card | BLOCKED |

### GROUP HANDOFF (Stage 4 — Offer Sent)

| Action | Allowed | Status |
|--------|---------|--------|
| GCJ text (one-to-one) | Yes | READY |
| Create group in JustCall app | Yes (manual) | READY_MANUAL |
| Create group via API | No | NOT_SUPPORTED |
| Add Kayla to group | Yes (manual) | READY_MANUAL |
| Add Jaxon to group | Yes (manual, if Jaxon has JustCall) | UNKNOWN |
| Send opening message in group | Yes (manual) | READY_MANUAL |
| Kayla presents offer | Yes (manual) | READY_MANUAL |
| Montelli steps back | Yes | READY |
| Montelli stays warm | Yes | READY |

## Course Handoff Evidence

### GCJ Timing (COURSE_CONFLICT)

| Source | Stage | Classification |
|--------|-------|---------------|
| Master Playbook Step 8 | Stage 2 (after deal evaluation) | COURSE_EXPLICIT |
| TRACK_STUDENT | Stage 4 (after offer sent, seller confirms receipt) | COURSE_EXPLICIT |
| TRACK_MONTELLI | Stage 4 (offer sent) | COURSE_EXPLICIT |
| Hot Lead Protocol | Immediately on hot lead | COURSE_EXPLICIT |
| Canonical OS | Path-specific, not stage-specific | COURSE_CONFLICT |

### Required Participants

| Participant | Course Role | JustCall Status |
|------------|-------------|-----------------|
| Montelli Scott | Operator, creates group, sends GCJ, stays warm | User 508588, number 571-601-2619 |
| Kayla Mauser | Closer (Montelli's pipeline) | User 506515, number 904-447-2520 |
| Jaxon Deason | Closer (course original) | NOT a JustCall user |
| Seth | LOI drafter (email only, not in group) | N/A |
| Seller/Agent | External contact | Phone from GHL |

### Handoff Information Package

Before group creation, the operator must have collected and documented:
- Property address
- Contact details (agent + seller names, phones, emails)
- Property facts (roof/HVAC age, occupancy, rent, lease type, utilities)
- Deal type classification (turnkey vs. renovation)
- Rental comps or rehab estimate
- Seller feedback/motivation notes
- Counter-offer details (if applicable)

## False Claim Prevention

| False Claim | Correction |
|-------------|-----------|
| "Contact card sent" when only CCC text was sent | CCC text and contact card are separate. Both required. |
| "Group chat created" when only GCJ text was sent | GCJ text is one-to-one. Group creation is manual in JustCall app. |
| "Kayla added" without participant evidence | Must verify Kayla's JustCall user is in the group. |
| "Handoff complete" without real group or verified manual completion | Must have group thread ID or operator confirmation. |
| "10DLC blocked" | Both numbers are 10DLC Verified. |
| "Group SMS unavailable" | Owner reports it is enabled. API does not expose it. |
| "Production ready" for later stages | Each stage has independent readiness. INT canary does not imply full flow readiness. |
