# KAYLA CANONICAL OPERATING SYSTEM — REVIEW

**Version:** 1.0
**Created:** 2026-07-31
**Purpose:** Audit trail of every unsupported statement removed from the
canonical operating system document.

---

## Removed Statements

### 1. 48-Hour Nurture Timer at Stage 2

**Removed Statement:** A 48-hour nurture timer should be set when a lead enters
Contact Made.

**Source of Removed Statement:** `ghl-automations/GHL_WORKFLOWS_SPEC.md:49`,
`ghl-automations/HANDBOOK_AND_SOP.md:113`

**Reason for Removal:** Course evidence ties 48 hours to post-offer follow-up
(`airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:1-50`,
`lead-tracking/AIREI_SCRIPTS_REFERENCE.md:141-157`), not to Contact Made. The
workflow documents are implementation design, not course evidence.

**Disposition:** Listed as `COURSE_CONFLICT` in Section 14.2 of the canonical
document.

---

### 2. Automatic Stage Advancement on CCC Sent

**Removed Statement:** Sending CCC authorizes automatic advancement from Contact
Made to Offer Ready.

**Source of Removed Statement:** `ghl-automations/TRACK_STUDENT.md:101`

**Reason for Removal:** Other course sources describe deal evaluation, comps,
and closer handoff as the process before Offer Ready
(`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100`,
`memory/REI_STAGE_BY_STAGE_GUIDE.md:40-46`). CCC alone is not sufficient.

**Disposition:** Listed as `COURSE_CONFLICT` in Section 14.5 of the canonical
document.

---

### 3. Automatic Stage Advancement on INT Sent

**Removed Statement:** Sending INT authorizes automatic advancement from Lead
Entered to Contact Made.

**Source of Removed Statement:** `ghl-automations/TRACK_STUDENT.md:49`

**Reason for Removal:** Course transcripts and coaching references describe
completed calls, data collection, and CCC as the contact process
(`lead-tracking/KAYLA_COACHING_REFERENCE.md:15-31`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:76-88`). INT alone is a pre-call
step, not completed contact.

**Disposition:** Listed as `COURSE_CONFLICT` in Section 14.1 of the canonical
document.

---

### 4. GCJ as a Stage 2 Action

**Removed Statement:** GCJ (group chat with Jaxon) should be sent during Stage 2
(Contact Made).

**Source of Removed Statement:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:106-108`
(ambiguous placement as Step 8 in a linear process).

**Reason for Removal:** Multiple sources place GCJ at different stages: Stage 4
(`GHL_WORKFLOWS_SPEC.md:90-91`), Stage 5
(`memory/REI_STAGE_BY_STAGE_GUIDE.md:92`), or only on hot leads
(`memory/MONTELLI_OBJECTION_HANDLING.md:96-117`). The exact trigger is
unresolved.

**Disposition:** Listed as `COURSE_CONFLICT` in Section 14.3 of the canonical
document.

---

### 5. F50/F10 as Automatic Stage 2 Pipeline Actions

**Removed Statement:** F50 and F10 should be automatically offered as Stage 2
pipeline actions after deal evaluation.

**Source of Removed Statement:** `ghl-automations/TRACK_STUDENT.md:84-99`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-94`

**Reason for Removal:** F50 and F10 are presented in the scripts reference as
Facebook Marketplace prospecting shortcuts
(`lead-tracking/AIREI_SCRIPTS_REFERENCE.md:18-19,204-219`). It is unresolved
whether they are pipeline actions, prospecting tools, or both.

**Disposition:** Listed as `COURSE_CONFLICT` in Section 14.4 of the canonical
document.

---

### 6. Automated Offer Generation

**Removed Statement:** Software should automatically generate and send offers
when a lead reaches Offer Ready.

**Source of Removed Statement:** `ghl-automations/GHL_WORKFLOWS_SPEC.md:53-80`,
`ghl-automations/HANDBOOK_AND_SOP.md:117-126`

**Reason for Removal:** Offer generation is explicitly a closer-team
responsibility (`ghl-automations/TRACK_STUDENT.md:122-149`). The operator does
not generate offers. Automation of offer generation contradicts the course
separation of operator and closer roles.

**Disposition:** Listed as a prohibition in Section 17.9 of the canonical
document.

---

### 7. Automated Negotiation or Counter-Offers

**Removed Statement:** Software should automatically re-run underwriting and
generate counter-offers during Active Negotiation.

**Source of Removed Statement:** `ghl-automations/GHL_WORKFLOWS_SPEC.md:136-140`

**Reason for Removal:** Negotiation is explicitly human-only. The operator never
negotiates (`memory/MONTELLI_OBJECTION_HANDLING.md:20-25`). The closer team
handles all negotiation. Automated counter-offers contradict the course.

**Disposition:** Listed as a prohibition in Section 17.4 of the canonical
document.

---

### 8. Automated Calendar Reminders and Timers

**Removed Statement:** Software should automatically set calendar reminders,
48-hour timers, 30-day revisits, and DOM-181 circle-back dates.

**Source of Removed Statement:** `ghl-automations/GHL_WORKFLOWS_SPEC.md:49,87,132-133`,
`ghl-automations/HANDBOOK_AND_SOP.md:113,132-133`

**Reason for Removal:** Timing is a business guideline, not an automatic
software action. The operator decides when to act. The course does not teach
automatic timers.

**Disposition:** Listed as a prohibition in Section 17.5 of the canonical
document.

---

### 9. Developer Workflow Documents as Business Authority

**Removed Statement:** `GHL_WORKFLOWS_SPEC.md` and `HANDBOOK_AND_SOP.md` define
the authoritative business process.

**Reason for Removal:** These documents are implementation design specifications
created by developers, not course materials created by Kayla. They may reflect
automation proposals that were never approved or implemented. Business rules
must come from course evidence.

**Disposition:** These documents are not cited as business authority in the
canonical document. Their rules are included only when independently confirmed
by course sources.

---

### 10. Generic Wholesaling Advice

**Removed Statement:** Standard wholesaling formulas, industry best practices,
and generic real estate investing advice.

**Reason for Removal:** The canonical document must reflect only what Kayla
teaches. Generic industry practices are not Kayla course evidence.

**Disposition:** Not included in the canonical document.

---

### 11. LLM-Inferred or ChatGPT-Generated Rules

**Removed Statement:** Business rules inferred by AI analysis without explicit
course source confirmation.

**Reason for Removal:** Every business rule must have an explicit, verifiable
course source. AI inference is not course evidence.

**Disposition:** Not included in the canonical document. Every rule has an
explicit source citation.

---

### 12. Divinity CRM Implementation Details

**Removed Statement:** References to `divinitycrm/backend/src/services/`,
`stage-automations.js`, `script-prompts.js`, `sms-service.js`, and other
software implementation files.

**Reason for Removal:** The canonical document describes business behavior, not
software architecture. Implementation details belong in software documentation,
not the business operating system.

**Disposition:** Not included in the canonical document. Software behavior is
confined to Section 16 (Implementation Mapping).

---

### 13. Atlas Import Implementation Details

**Removed Statement:** References to Atlas import manifests, reconciliation,
ledger records, preflight validation, and import-specific business rules.

**Reason for Removal:** Import mechanics are implementation, not business rules.
The canonical document describes what the operator does with a lead after it
exists in the system, not how the lead arrived.

**Disposition:** Not included in the canonical document.

---

### 14. Pipeline Stage IDs and GHL Configuration

**Removed Statement:** Specific GHL stage IDs (`7067148a-...`,
`934c4c52-...`), pipeline IDs, location IDs, and workflow names.

**Reason for Removal:** Stage identifiers are implementation details that may
change. The canonical document describes stages by their business meaning (Lead
Entered, Contact Made, Offer Ready), not by their software identifiers.

**Disposition:** Not included in the canonical document.

---

### 15. Software Module Names, Function Names, and API References

**Removed Statement:** References to `kayla-stage1-transaction.js`,
`evaluateActionAvailability()`, `handleStage1Command()`, webhook endpoints, and
other software implementation details.

**Reason for Removal:** The canonical document describes what the operator does,
not how the software is built. Function names and API references are
implementation details.

**Disposition:** Not included in the canonical document.

---

### 16. COURSE_DERIVED Classification

**Removed Statement:** The COURSE_DERIVED classification for rules that are
"mechanical software implementations that do not change the business meaning."

**Reason for Removal:** Per the specification, only four classifications are
permitted: COURSE_EXPLICIT, IMPLEMENTATION_DERIVED, COURSE_CONFLICT, and
COURSE_UNKNOWN. COURSE_DERIVED is removed to prevent implementation thinking
from leaking into business rules.

**Disposition:** Former COURSE_DERIVED rules are reclassified as:
- COURSE_EXPLICIT if the business meaning is directly stated in a course source.
- IMPLEMENTATION_DERIVED if the rule is pure software translation (confined to
  Section 16).

---

### 17. Automatic Stage Movement (General)

**Removed Statement:** Any rule implying that software may automatically advance
a lead through pipeline stages without human confirmation.

**Reason for Removal:** The course teaches operator-confirmed stage movement.
The student model (`TRACK_STUDENT.md`) requires manual stage advancement.
Automation contradicts the course philosophy.

**Disposition:** Listed as a prohibition in Section 17.2 of the canonical
document.

---

### 18. Autonomous Message Sending

**Removed Statement:** Any rule implying that software may send text messages,
emails, or communications without operator confirmation.

**Reason for Removal:** The course teaches operator-controlled communication.
The student manually copies and sends messages. Automation contradicts the
course philosophy.

**Disposition:** Listed as a prohibition in Section 17.6 of the canonical
document.

---

## Summary

| Category | Count |
|---|---|
| Statements removed due to course conflict | 5 |
| Statements removed due to missing course evidence | 3 |
| Statements removed as implementation design, not business rules | 7 |
| Statements removed as generic/non-Kayla advice | 1 |
| Statements removed as AI inference | 1 |
| Classification removed (COURSE_DERIVED) | 1 |
| **Total statements removed** | **18** |

---

---

## Stage 3 Transcript Validation Corrections (2026-08-01)

**Validation Reference:** `docs/KAYLA_STAGE3_TRANSCRIPT_VALIDATION.md` v1.0
**Validated By:** Transcript-level audit against original course materials
**Effective Date:** 2026-08-01

### Correction 1: 65% Equity — Downgrade from Hard Requirement to Preferred Threshold

**Old Wording:** "Minimum equity required: 65% (so seller nets after your down payment)" and "Requires 65%+ equity and no mortgage."

**New Wording:** "Minimum 50% equity (hard floor). Preferred 65%+ equity (seller profitability threshold)."

**Reason:** Jaxon teaches two thresholds: "must have a minimum of 50% equity" (hard floor) and "we like the equity to be at least 65%" (preferred). The Master Playbook collapsed this to "Minimum equity required: 65%" which overstates the source material.

**Transcript:** `airei-course-notes/03-STEP3-Pt1-Deal-Structure-Cash-Stack-SubTo.txt:63-67`

**Classification:** `COURSE_EXPLICIT` (corrected precision)

---

### Correction 2: 72 Months — Downgrade from Hard Requirement to Typical Maximum

**Old Wording:** "72+ months" and "Typically 72+ months to pay off."

**New Wording:** "Typically 72 months maximum balloon term (negotiable)."

**Reason:** Jaxon teaches "typically 72 months or more." Kayla negotiates 60 months in a live call (`12-STEP3-Pt2-Jaxon-PPC-Subject-To-Close.txt:176-177`). 72 months is the typical maximum, not a fixed requirement.

**Transcript:** `airei-course-notes/03-STEP3-Pt1-Deal-Structure-Cash-Stack-SubTo.txt:95-98`, `airei-course-notes/12-STEP3-Pt2-Jaxon-PPC-Subject-To-Close.txt:176-177`

**Classification:** `COURSE_EXPLICIT` (corrected precision)

---

### Correction 3: 1% Rule — Downgrade from Mandatory to Screening Guidance

**Old Wording:** "Rule: rent must be ~1% of purchase price" and "Rent should be approximately 1% of purchase price."

**New Wording:** "Screening guidance: we like to see rent approximately 1% of purchase price. This is not a mandatory requirement."

**Reason:** Kayla says "we like to see" (preference language). Jaxon says the 1% rule is "not really the golden rule anymore" for fix and flips. The Master Playbook's "must" language overstates the source material.

**Transcript:** `airei-course-notes/13-STEP3-Pt3-How-to-Find-Rental-Comps.txt:8-9`, `airei-course-notes/03-STEP3-Pt1-Deal-Structure-Cash-Stack-SubTo.txt:21-25`

**Classification:** `COURSE_EXPLICIT` (corrected precision)

---

### Correction 4: GCJ Timing — Clarify Path-Specific, Not Stage-Specific

**Old Wording:** "In Stage 3: sent when offer is ready, lead is hot, or per PPC path."

**New Wording:** "GCJ triggers are path-specific, not stage-specific. Multiple triggers exist: Stage 2 evaluation, PPC initial call, hot lead, offer ready. Operator steps back after GCJ."

**Reason:** GCJ appears at multiple pipeline points (Stage 2 evaluation, PPC initial call, hot lead, offer ready). "Stage 3" timing is an implementation assumption. The course does not assign GCJ to a single stage.

**Transcript:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:106-108`, `memory/MONTELLI_OBJECTION_HANDLING.md:96-117`, `ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt`

**Classification:** `COURSE_PATH_SPECIFIC` (no change; clarification only)

---

### Correction 5: SubTo Pain Point — Add Missing Requirement

**Old Wording:** "Subject-To (Sub2): Take over existing debt. For low-equity situations."

**New Wording:** "Subject-To (Sub2): Take over existing debt. Requires low equity AND a pain point (missing payments, foreclosure risk, cannot sell traditionally)."

**Reason:** Jaxon explicitly teaches that SubTo requires both low equity AND a pain point: "nobody's just going to sub two just because it's low equity. There's got to be a pain point." The implementation contract omitted the pain point requirement.

**Transcript:** `airei-course-notes/03-STEP3-Pt1-Deal-Structure-Cash-Stack-SubTo.txt:138-141`

**Classification:** `COURSE_EXPLICIT` (corrected completeness)

---

### Correction 6: Offer Delivery — Correct Who Sends the Offer

**Old Wording:** "Offer has been sent to the seller (by operator or closer team)."

**New Wording:** "Offer has been sent to the seller (by closer team or AI system). Operator confirms delivery."

**Reason:** Kayla teaches "send out the offers on your behalf using AI" and "Once I send out the offer using AI you're going to get the leads back." The operator does not send offers; the closer team or AI system sends them. The operator confirms delivery.

**Transcript:** `airei-course-notes/01-STEP3-Pt1-Intro-Warm-Dials-Kayla-Teaches-Outreach.txt:1053-1107`, `airei-course-notes/02-STEP3-Pt1-Leads-to-CRM-AI-Offer-System.txt:1-65`

**Classification:** `COURSE_EXPLICIT` (corrected accuracy)

---

## Summary

| Category | Count |
|---|---|
| Statements removed due to course conflict | 5 |
| Statements removed due to missing course evidence | 3 |
| Statements removed as implementation design, not business rules | 7 |
| Statements removed as generic/non-Kayla advice | 1 |
| Statements removed as AI inference | 1 |
| Classification removed (COURSE_DERIVED) | 1 |
| **Total statements removed** | **18** |
| **Stage 3 transcript validation corrections** | **6** |

---

*End of Review*
