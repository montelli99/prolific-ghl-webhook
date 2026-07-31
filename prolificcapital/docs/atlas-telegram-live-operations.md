# Atlas Telegram Live Operations

This page covers the Atlas/Montelli Kayla Telegram outreach system only. Divinity CRM locations, workflows, contacts, opportunities, pipelines, credentials, deployments, and documentation are out of scope.

## Boundaries

- Telegram/OpenClaw owns operator planning, preview, approval state, and the eventual provider execution path.
- The GHL webhook is GHL-only. It validates and acknowledges Atlas Telegram stage-transition markers but does not send outreach or mutate GHL.
- The JustCall adapter remains separate from the GHL webhook and must only be used by the Telegram/OpenClaw execution layer after provider credentials and owner approval are ready.

## GHL Webhook Contract

Telegram-origin stage markers use source `TELEGRAM_ATLAS_OUTREACH` and must include real GHL opportunity/contact IDs, action ID, transition ID, idempotency key, from-stage ID, to-stage ID, and ISO transition timestamp.

Valid Lead Entered to Contact Made markers return `ATLAS_TELEGRAM_STAGE_TRANSITION_ACKNOWLEDGED_NO_OUTREACH`.

The webhook must not send SMS, call JustCall, send email, place calls, move opportunities, recursively mutate GHL, create outreach tasks, enroll campaigns, trigger offer/comps logic, modify unrelated contacts, or process Divinity records.

## Canary Guard Rules

- Maximum initial canary: 3 records.
- Real GHL IDs only. Synthetic, fixture, placeholder, or dry-run IDs block.
- Candidates must be in location `61XPzSqRy7UKMwW9DeB8` and pipeline `nSf3NXYVkt8X4PgW9aZ3`.
- Current stage must be Lead Entered `7067148a-2ee8-4e5b-93c8-31e0253fea68`.
- Contacts and properties must be distinct.
- DNC, opt-out, wrong-number, pending-reply, active-human-work, missing phone route, missing property fingerprint, unknown timezone, weekends, and local time outside 10:00 AM-6:00 PM block sendability.

## Stage Movement

Stage movement remains disabled and must display `STAGE_MOVEMENT_DISABLED_WORKFLOW_ISOLATION_PENDING` until the full marker path is proven with deterministic tests and deployed webhook verification.

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
