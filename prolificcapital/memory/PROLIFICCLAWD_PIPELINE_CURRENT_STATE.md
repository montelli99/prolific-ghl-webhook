# ProlificClawd GHL Pipeline — Current State

**As-of:** 2026-08-03 12:00 UTC
**Authority level:** CURRENT (supersedes all prior Pipeline state summaries)
**Source:** Verified production artifacts, git commits, runtime state, kill-switch

---

## Project Scope

Kayla/Montelli GHL Pipeline automation for real estate investment operations.
Workspace: `C:\Users\mscott\AI_Workspace\prolificcapital`
GHL location: `61XPzSqRy7UKMwW9DeB8`
GHL pipeline: `nSf3NXYVkt8X4PgW9aZ3`

---

## Atlas Import — COMPLETE

- **Final terminal result:** `FINAL_FIFTY_FIVE_RESUME_PASSED_ATLAS_IMPORT_COMPLETE`
- **Atlas-valid opportunities:** 206
- **Physical target-pipeline opportunities:** 213
- **Remaining executable rows:** 0
- **Blocked rows:**
  - `import-ready:69` — SOURCE_DATA_CONFLICT (contact identity conflict)
  - `import-ready:217` — PERMANENT_IDENTITY_AMBIGUITY (shared phone, generic email)
  - `import-ready:273` — PERMANENT_IDENTITY_AMBIGUITY (multiple same-name candidates)
- **Final import commit:** `9cbebe0628f0a8de19c92eb63923abc57e2ae90c` (2026-07-30)
- **Closeout artifact:** `lead-tracking/atlas-deals/reconciliations/atlas-production-import-closeout-20260730-b969c160bb0b.json`
- **Reconciliation artifact:** `lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-passed-2e14a7cd6564.json`

---

## Pipeline Business Process

### Canonical Documentation (exists)
- Kayla operating system (course corpus)
- Responsibility matrix
- Underwriting reference

### Stage Status

| Stage | Status | Detail |
|-------|--------|--------|
| Stage 1 | ACCEPTED | Telegram/operator acceptance passed |
| Stage 2 | ACCEPTED | Core acceptance passed |
| Stage 3 | ACCEPTED | Course rules and canonical corrections completed |
| Stages 4–21 | SHARED/MANUAL | Framework coverage exists; not the same dedicated implementation standard as Stages 1–3 |

---

## Telegram / OpenClaw Runtime

- **Original conversational gateway:** Restored, running on port 18789
- **Launcher:** Task Scheduler `\OpenClaw Gateway` → `C:\Users\mscott\.openclaw\gateway.cmd`
- **Ai Rei group:** `-1003975794600`
- **Pipeline topic:** 389
- **Owner:** Telegram user `718718959` (`@ProlificInvestments`)
- **Session key:** `agent:app-prolific-eng:telegram:group:-1003975794600:topic:389`
- **New standalone `kayla-telegram-bot.js`:** QUARANTINED — must not consume Telegram updates
- **Exactly one Telegram update consumer:** OpenClaw gateway

---

## Contact Card

- **Status:** MONTELLI_DIVINITY_CONTACT_CARD_READY_FOR_SELF_TEST
- **Version:** 2.0.0
- **Card ID:** montelli-scott-divinity-aligned-v1
- **VCF path:** `ghl-automations/data/runtime/montelli-scott-divinity-aligned.vcf`
- **VCF SHA-256:** `77bbcbdab80a604d3161d0a898fd92e1832d258c7c91a41349a86a5d18f60065`
- **Spec SHA-256:** `da4d29b570bab1e455527b2478c710a92110fe95c8c400ff49a1b8233093a247`
- **Spec path:** `docs/montelli-contact-card.json`
- **Approved fields:**
  - FN: Montelli Scott
  - N: Scott;Montelli;;;
  - ORG: Divinity Aligned LLC
  - TITLE: Property Outreach
  - TEL: +15716012619
  - EMAIL: montelliscottrei@gmail.com
  - URL: https://www.divinityaligned.net/
- **readyForProduction:** true
- **missingRequiredFields:** []
- **blockedReason:** null
- **Owner-controlled test recipient:** ending 0891 (OWNER_CONTROLLED_TEST_RECIPIENT)
- **Self-test module:** `ghl-automations/modules/contact-card-self-test.js`
- **Self-test trigger:** "Test my Montelli contact card to my phone."
- **Self-test is separate from production canary.** No prospect, no GHL write, no stage movement.
- **Company is Divinity Aligned LLC, NOT Prolific Capital.**
- **Title is Property Outreach, NOT CEO, Co-Founder, or any executive title.**
- **10DLC verified, MMS enabled, business approved.**

---

## Supervised Canary INT — RUNBOOK V2 AUTHORITATIVE

- **Authoritative runbook ID:** `runbook_supervised_canary_v2`
- **Authoritative runbook path:** `ghl-automations/data/runtime/supervised-canary-runbook-v2.json`
- **Runbook hash contract:** `canonicalHash` covers all operational fields except `canonicalHash` itself; keys are sorted; serialized as compact JSON; SHA-256.
- **Runbook v2 canonical hash:** `9ac8c2f054ceff7527af8be72c1d47be50a3c794209b2c52db0081818391cf72`
- **Runbook v1 status:** `SUPERSEDED_NOT_EXECUTABLE` — retained for audit only; no fallback to v1.
- **Natural trigger:** "Begin the first supervised canary."
- **Policy version:** `OP-2026-08-02-v1`
- **Template ID:** `OWNER_APPROVED_PIPELINE_INT`
- **Max canary size:** 3
- **Stale plan disposition:** `plan_4986dcaa4139c38e` is now `SUPERSEDED_EXPIRED_UNTRUSTED_CONTEXT` (expired, missing owner/chat/topic/originating-message provenance, generated before corrected v2 binding).
- **Trusted preview provenance required for every plan:** plan ID, plan hash, runbook ID, runbook hash, policy version, template ID/version, owner ID `718718959`, chat ID `-1003975794600`, topic ID `389`, originating Telegram message ID, creation timestamp, expiration timestamp, current runtime revision, exact selected item IDs, exact rendered messages, sender, property-local timezone per item, compliance evidence snapshot, status `PREVIEW_PENDING_APPROVAL`, `executable: false`.
- **Sample timezone removed:** No `123 Main St Indianapolis IN 46227` gate. Each candidate is evaluated in its own property-local window.
- **Provider readiness:** Contact-card MMS proved Telegram/OpenClaw → JustCall → owner phone transport only. Prospect INT readiness is reported as `READY_WITH_MANUAL_FUNDING_CONFIRMATION`; execution requires owner session-scoped funding confirmation and exact item approval.
- **Approval invariant:** Requires owner, correct group/topic, active v2 runbook, matching runbook/plan hashes, exact item numbers, unexpired plan, unchanged policy/template, live guard revalidation, property-local window, provider readiness. Ambiguous phrases do not approve.

## JustCall / Outreach

- **10DLC:** Approved
- **Approved sender:** +15716012619 (ends 2619)
- **Provider integration:** `JustCallIntegration.sendSMS` exists
- **Guarded canary executor:** Implemented
- **Eligibility double-normalization bug:** Identified and repaired
- **Canary status:** No successful controlled production canary completed
- **Production send count:** 0
- **Required controls:** Owner approval, immutable plan, exact selected records, DNC/STOP, duplicate checks, sender lock, business-time validation, provider reconciliation, automatic PAUSED state

### JustCall transcript certification

- **Verified owner-controlled call:** Call ID `400683713`; outbound, answered, 32 seconds, recording present.
- **Transcript source:** `TRANSCRIPT_PROVIDER_API` from the official Calls AI endpoint.
- **Transcript-only query requirement:** `fetch_transcription=true`; `fetch_summary=false`; `fetch_ai_insights=false`; `fetch_action_items=false`; `fetch_smart_chapters=false`.
- **Team-plan behavior:** Transcript-only retrieval succeeds without AI Review Assist. Omitted paid-field flags default to enabled and caused the superseded `403` diagnosis.
- **GHL test-note state:** Exact owner-controlled preview is required before approval. No automatic note, contact, opportunity, stage, task, SMS, call, or workflow write is permitted.
- **GHL AI export:** Separately locked; it does not change provider transcript API availability.
- **Current effects:** Provider sends 0, automatic calls 0, SMS 0, GHL writes 0, production GHL writes 0, stage movements 0; `PAUSED`.

---

## Production Safety

- **Current state:** PAUSED
- **Kill switch:** `ghl-automations/data/telegram-outreach-dry-run/kill-switch.json` — state PAUSED, liveSends 0, productionWrites 0, stageMovements 0
- No automatic GHL writes
- No automatic stage movements
- No unattended outreach cron
- No automatic retries
- Pipeline Telegram topic is the operator console

---

## Explicit Exclusions

- **Divinity CRM** is a separate project — not part of this Pipeline context
- **149 Atlas-valid count** is STALE — current count is 206
- **Raw `JUSTCALL_LIVE_SEND` activation** is not sufficient for live sends
- **All 21 stages equally implemented** is FALSE — Stages 1–3 are accepted; 4–21 are shared/manual
- **Arbitrary test SMS to any number** is NOT available. The restored original OpenClaw agent does not have a proven direct-SMS tool. Production SMS requires: immutable canary plan → exact owner approval → deterministic guard → sequential executor → provider reconciliation → automatic PAUSED. No casual "send a test" path exists.
- **Blocked rows are not all identity conflicts.** Exact dispositions: 69=SOURCE_DATA_CONFLICT, 217=PERMANENT_IDENTITY_AMBIGUITY, 273=PERMANENT_IDENTITY_AMBIGUITY.

---

## Superseded Memories

The following prior claims are superseded by this document:

| Stale Claim | Superseded By | Reason |
|-------------|---------------|--------|
| 149 Atlas-valid opportunities | 206 Atlas-valid (closeout artifact) | Import completed July 30 |
| Remaining import work | 0 executable rows remaining | Final-55 import passed |
| JustCall entirely unwired | Provider integration exists, canary code exists, PAUSED | 10DLC approved, sender locked |
| Divinity/GHL production ambiguity | Divinity is separate project | Explicit exclusion |
| All 21 stages fully implemented | Stages 1–3 accepted, 4–21 shared/manual | Honest assessment |
| Raw env-toggle live activation | Multi-gate controls required | Safety architecture |
| July 22 readiness as current | This document (2026-08-01) | Import completed, stages accepted, runtime restored |
| `JUSTCALL_TRANSCRIPT_FEATURE_NOT_ENABLED` | Transcript-only official API succeeds on Team when all paid AI fields are explicitly disabled | Live read-only API verification on 2026-08-04 |
| Transcript not generated or UI-only | Provider transcript exists in UI and official transcript-only API | Exact call-ID and transcript-hash verification |
| AI Review Assist required for transcript-only retrieval | AI Review Assist is required only for the separately requested paid fields in this observed Team-plan response | Explicit false query flags returned HTTP 200 |
