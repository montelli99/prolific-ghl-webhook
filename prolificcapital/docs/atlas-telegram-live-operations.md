# Atlas Telegram Live Operations

This page covers only the Atlas/Montelli Kayla Telegram outreach system.

## Boundaries

- Telegram/OpenClaw owns operator planning, preview, approval state, and the eventual provider execution path.
- The GHL webhook is GHL-only. It validates and acknowledges Atlas Telegram stage-transition markers but does not send outreach or mutate GHL.
- The JustCall adapter remains separate from the GHL webhook and must only be used by the Telegram/OpenClaw execution layer after provider credentials and owner approval are ready.

## GHL Webhook Contract

Telegram-origin stage markers use source `TELEGRAM_ATLAS_OUTREACH` and must include real GHL opportunity/contact IDs, action ID, transition ID, idempotency key, from-stage ID, to-stage ID, and ISO transition timestamp.

Valid Lead Entered to Contact Made markers return `ATLAS_TELEGRAM_STAGE_TRANSITION_ACKNOWLEDGED_NO_OUTREACH`.

The webhook must not send SMS, call JustCall, send email, place calls, move opportunities, recursively mutate GHL, create outreach tasks, enroll campaigns, trigger offer/comps logic, or modify unrelated contacts.

## Rule Taxonomy

- `COURSE_EXPLICIT`: directly supported by cited Kayla-course source text.
- `COURSE_DERIVED`: mechanical implementation of an explicit course rule without changing business meaning.
- `COURSE_CONFLICT`: authoritative course sources conflict; production behavior must block.
- `COURSE_MISSING`: no authoritative source establishes the rule; production behavior must block.
- `TECHNICAL_SAFETY_POLICY`: launch/runtime guard that is not represented as Kayla-course procedure.
- `LEGAL_OR_COMPLIANCE_RULE`: DNC, opt-out, STOP, wrong-number, and channel-suppression handling.

## Canary Guard Rules

- Maximum initial canary: 3 records.
- Real GHL IDs only. Synthetic, fixture, placeholder, or dry-run IDs block.
- Candidates must be in location `61XPzSqRy7UKMwW9DeB8` and pipeline `nSf3NXYVkt8X4PgW9aZ3`.
- Current stage must be Lead Entered `7067148a-2ee8-4e5b-93c8-31e0253fea68`.
- Contacts and properties must be distinct.
- DNC, opt-out, wrong-number, pending-reply, active-human-work, missing phone route, missing property fingerprint, unknown property timezone, weekends, and local time outside 10:00 AM-6:00 PM block sendability.

The 10:00 AM-6:00 PM property-local window and no-weekend launch rule are `TECHNICAL_SAFETY_POLICY`, not Kayla-course procedure.

## Stage Movement

Stage movement after initial INT SMS is `COURSE_CONFLICT`.

Evidence A: `ghl-automations/TRACK_STUDENT.md` lines 19-49 says Stage 1 is `Lead Entered -> INT Send` and `[✓] INT Sent -> advance to Stage 2`.

Evidence B: `memory/REI_STAGE_BY_STAGE_GUIDE.md` lines 24-29 describes `INT`, call, collect information, `CCC`, notes, then move to Contact Made.

Evidence C: `memory/FULL_COURSE_AUDIT.md` lines 169-175 describes call, seller info, `INT`, `CCC`, notes, then move to Contact Made.

No production stage movement may occur after the SMS canary until the Stage 1 exit rule is authoritatively resolved. Telegram must display `STAGE_MOVEMENT_DISABLED_COURSE_CONFLICT_UNRESOLVED`.

The first SMS canary tests provider delivery only, uses the exact initial course script, does not redefine Contact Made, does not move stages, and does not claim stage retention is course-correct.

## Current Status

- `GHL_GUARD_READY`: yes for preview validation.
- `WEBHOOK_ISOLATION_READY`: tests pass locally; deployment verification required before live use.
- `PROVIDER_EXECUTION_READY`: no. Provider execution remains disabled for this task.
- Current production snapshot matched 206 Atlas-valid opportunities and 177 unique contacts.
- Current no-send canary review preview is blocked by unknown timezone and role uncertainty.

## Safety Counters

- GHL sends: 0
- Provider sends: 0
- Production writes: 0
- Stage movements: 0
