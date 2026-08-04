# Memory Supersession Registry — app-prolific-eng

**Created:** 2026-08-01
**Purpose:** Deterministic registry for stale memory supersession.
**Usage:** Loaded by the agent's context retrieval mechanism. Any memory matching a superseded pattern must be treated as historical only and replaced by the current source.

---

## Superseded Memory Records

### SUPERSEDED-001: 149 Atlas-valid opportunities
- **Original source:** July 22, 2026 session (topic-389), CRM state files from June-July 2026
- **Original timestamp:** 2026-07-22
- **Stale fact:** "149 Atlas-valid opportunities imported"
- **Current fact:** 206 Atlas-valid opportunities (final import closeout 2026-07-30)
- **Current source:** `docs/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md`
- **Supersession reason:** Atlas import completed July 30 with final-55 resume batch
- **Evidence:** Commit `9cbebe0`, closeout artifact `atlas-production-import-closeout-20260730-b969c160bb0b.json`

### SUPERSEDED-002: Remaining import work
- **Original source:** July 22, 2026 session
- **Original timestamp:** 2026-07-22
- **Stale fact:** "Remaining import work exists" / "4 blocked rows"
- **Current fact:** 0 executable rows remaining; 3 permanently blocked rows (69, 217, 273)
- **Current source:** `docs/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md`
- **Supersession reason:** Final-55 import completed; all executable rows processed

### SUPERSEDED-003: JustCall entirely unwired
- **Original source:** July 22, 2026 session
- **Original timestamp:** 2026-07-22
- **Stale fact:** "JustCall not wired for live SMS" / "JUSTCALL_LIVE_SEND=false"
- **Current fact:** Provider integration exists, guarded canary executor implemented, 10DLC approved, sender locked, system PAUSED
- **Current source:** `docs/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md`
- **Supersession reason:** 10DLC approved, canary code built, but no production canary completed

### SUPERSEDED-004: Divinity/GHL production ambiguity
- **Original source:** July 22, 2026 session (Divinity CRM code audit)
- **Original timestamp:** 2026-07-22
- **Stale fact:** Divinity CRM discussed in Pipeline context
- **Current fact:** Divinity CRM is a separate project; excluded from Pipeline namespace
- **Current source:** `docs/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md`
- **Supersession reason:** Explicit project separation

### SUPERSEDED-005: All 21 stages fully implemented
- **Original source:** July 22, 2026 session
- **Original timestamp:** 2026-07-22
- **Stale fact:** "23 modules, 21 stage handlers, all tested" implying equal implementation
- **Current fact:** Stages 1–3 accepted; Stages 4–21 have shared/manual-assisted framework coverage
- **Current source:** `docs/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md`
- **Supersession reason:** Honest stage-by-stage assessment

### SUPERSEDED-006: Raw environment-toggle live activation
- **Original source:** July 22, 2026 session
- **Original timestamp:** 2026-07-22
- **Stale fact:** "JUSTCALL_LIVE_SEND=false" as the primary gate
- **Current fact:** Multi-gate controls required: owner approval, immutable plan, exact records, DNC/STOP, duplicate checks, sender lock, business-time validation, provider reconciliation, auto-PAUSED
- **Current source:** `docs/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md`
- **Supersession reason:** Safety architecture requires multiple gates

### SUPERSEDED-007: July 22 readiness as current state
- **Original source:** July 22, 2026 session
- **Original timestamp:** 2026-07-22
- **Stale fact:** July 22 readiness assessment treated as current
- **Current fact:** This document (2026-08-01) is the authoritative current state
- **Current source:** `docs/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md`
- **Supersession reason:** Import completed, stages accepted, runtime restored, canary code built

### SUPERSEDED-008: Stale contact-card identity (Prolific Capital / CEO)
- **Original source:** `BUSINESS_MEMORY.md` line 112, July 22 session, prior contact-card spec v1.0.0
- **Original timestamp:** 2026-07-22 through 2026-08-02
- **Stale fact:** "Montelli Scott - CEO & Co-Founder", "Prolific Capital", "Real Estate Investor | Multifamily"
- **Current fact:** Company is Divinity Aligned LLC, title is Property Outreach, card version 2.0.0
- **Current source:** `docs/montelli-contact-card.json`, `docs/MONTELLI_CONTACT_CARD_SPEC.md`
- **Supersession reason:** Owner-approved identity update 2026-08-03

### SUPERSEDED-009: Stale contact-card readiness (headshot/recent closings missing)
- **Original source:** Prior contact-card spec v1.0.0, July-August 2026 sessions
- **Original timestamp:** 2026-08-02
- **Stale fact:** "Missing headshot and recent closings (COURSE_EXPLICIT_REQUIRED)", "readyForProduction: false"
- **Current fact:** All fields owner-approved, readyForProduction: true, missingRequiredFields: [], blockedReason: null
- **Current source:** `docs/montelli-contact-card.json` v2.0.0
- **Supersession reason:** Owner explicitly excluded headshot, recent closings, address, logo, social links

### SUPERSEDED-010: Stale 10DLC/MMS blocked claims
- **Original source:** July 22 session, early JustCall integration tests
- **Original timestamp:** 2026-07-22
- **Stale fact:** "10DLC / live SMS remains unverified", "MMS not confirmed"
- **Current fact:** 10DLC verified, MMS enabled on both numbers, business approved, sender 2619 available
- **Current source:** Live JustCall API probe 2026-08-03, `docs/JUSTCALL_COMPLIANCE_INTEGRATION.md`
- **Supersession reason:** Live API verification confirmed MMS capability and 10DLC status

### SUPERSEDED-011: Contact-card self-test conflated with production canary
- **Original source:** July-August 2026 sessions, canary-runbook code
- **Original timestamp:** 2026-08-01 through 2026-08-02
- **Stale fact:** "Contact card test requires a production canary plan"
- **Current fact:** Contact-card self-test is a separate workflow (CONTACT_CARD_OWNER_SELF_TEST) with owner-controlled recipient only, no prospect, no GHL write, no stage movement
- **Current source:** `ghl-automations/modules/contact-card-self-test.js`
- **Supersession reason:** Owner-approved separation of self-test from production canary

### SUPERSEDED-012: JustCall transcript unavailable or UI-only
- **Original source:** Transcript certification attempts before the transcript-only query correction
- **Original timestamp:** 2026-08-04
- **Stale fact:** `JUSTCALL_TRANSCRIPT_FEATURE_NOT_ENABLED`, transcript not generated, transcript UI-only, or AI Review Assist required for transcript-only retrieval
- **Current fact:** Team generates the transcript; it is visible in the UI and retrievable through the official Calls AI API when transcription is enabled and summary, insights, action items, and smart chapters are explicitly disabled
- **Current source:** `memory/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md`
- **Supersession reason:** Exact read-only API probe returned HTTP 200 and provider transcript data for the owner-controlled call

---

## Retrieval Priority Rules

1. `docs/PROLIFICCLAWD_PIPELINE_CURRENT_STATE.md` — ALWAYS loaded first for Pipeline questions
2. Any memory matching a SUPERSEDED pattern — treated as historical, not current
3. CRM state files from before 2026-07-30 — historical only for Atlas import questions
4. July 22 session content — historical only; do not cite as current state
5. Divinity CRM content — excluded from Pipeline namespace
