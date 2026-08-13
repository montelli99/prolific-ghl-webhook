# ProlificClawd GHL Pipeline — Current State

**As-of:** 2026-08-12 19:40 UTC
**Authority level:** CURRENT (supersedes all prior Pipeline state summaries)
**Source:** Verified production artifacts, git commits, runtime state, kill-switch

---

## Project Scope

Kayla/Montelli GHL Pipeline automation for real estate investment operations.
Workspace: `C:\Users\mscott\AI_Workspace\prolificcapital`

### ATLAS_OUTBOUND
GHL location: `61XPzSqRy7UKMwW9DeB8`
GHL pipeline: `nSf3NXYVkt8X4PgW9aZ3`

### PPC_EWA_BEACH
GHL location: `GDq92uruRngbi9mLGGrV`
GHL pipeline: `ril84XHGQleRgE0W0FKU`
Pipeline name: Inbound PPC
Stages: 26 (21 populated)
Profile: `profiles/ppc-ewa-beach/`

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

| Stage       | Status        | Detail                                                                                  |
| ----------- | ------------- | --------------------------------------------------------------------------------------- |
| Stage 1     | ACCEPTED      | Telegram/operator acceptance passed                                                     |
| Stage 2     | ACCEPTED      | Core acceptance passed                                                                  |
| Stage 3     | ACCEPTED      | Course rules and canonical corrections completed                                        |
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

## JustCall / Outreach

- **10DLC:** Approved
- **Approved sender:** Ends 2619 (571 number)
- **Provider integration:** `JustCallIntegration.sendSMS` exists
- **Guarded canary executor:** Implemented
- **Eligibility double-normalization bug:** Identified and repaired
- **Canary status:** No successful controlled production canary completed
- **Production send count:** 0
- **Required controls:** Owner approval, immutable plan, exact selected records, DNC/STOP, duplicate checks, sender lock, business-time validation, provider reconciliation, automatic PAUSED state

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

## PPC Pipeline Control (2026-08-12)

### PPC_READ_CONTROL = CERTIFIED

- Profile-aware bridge: `pipeline-tool-bridge.js` supports both ATLAS_OUTBOUND and PPC_EWA_BEACH
- `pipeline_read_opportunity`: Read single PPC opportunity by ID with full metadata
- `pipeline_search_opportunities`: Search PPC opportunities by stage, contact, or query
- `pipeline_list_stages`: List all 26 PPC stages with IDs, names, categories, terminal status
- Profile resolution: explicit profileId required; unknown/ambiguous profiles blocked
- Cross-profile isolation: PPC reads use `GDq92uruRngbi9mLGGrV` / `ril84XHGQleRgE0W0FKU` only
- Stage authority loaded from `profiles/ppc-ewa-beach/stage-authority.json` (26 stages verified)

### PPC_OWNER_DIRECTED_STAGE_CONTROL = CANARY_REQUIRED

- `pipeline_move_stage`: Owner-directed stage movement for PPC opportunities
- Write gates: owner auth (718718959), group (-1003975794600), topic (389) required
- Pre-write verification: profile resolution, opportunity load, cross-profile check, stage authority validation
- Post-write readback: verifies only stage changed (contactId, name, status, monetaryValue, assignedTo unchanged)
- No automatic stage movement; no bulk moves; no retry on uncertain writes
- Stage move does NOT trigger SMS, calls, or assignment changes
- No safe test/canary record found for live write certification

### PPC_AUTOMATIC_FIRST_CONTACT_SMS = BLOCKED_CONSENT_UNVERIFIED

- CONSENT_NOT_VERIFIABLE blocks automated PIN/PPH script sends
- Consent policy is separate from owner-directed stage control
- Owner can move stages without consent verification
- Automatic outreach remains disabled pending consent resolution

---

## Superseded Memories

The following prior claims are superseded by this document:

| Stale Claim                       | Superseded By                                           | Reason                                              |
| --------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| 149 Atlas-valid opportunities     | 206 Atlas-valid (closeout artifact)                     | Import completed July 30                            |
| Remaining import work             | 0 executable rows remaining                             | Final-55 import passed                              |
| JustCall entirely unwired         | Provider integration exists, canary code exists, PAUSED | 10DLC approved, sender locked                       |
| Divinity/GHL production ambiguity | Divinity is separate project                            | Explicit exclusion                                  |
| All 21 stages fully implemented   | Stages 1–3 accepted, 4–21 shared/manual                 | Honest assessment                                   |
| Raw env-toggle live activation    | Multi-gate controls required                            | Safety architecture                                 |
| July 22 readiness as current      | This document (2026-08-01)                              | Import completed, stages accepted, runtime restored |
