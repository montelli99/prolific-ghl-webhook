# PPC team notes service

Production belongs to the existing `prolific-ghl-webhook` Render service and existing Neon database. Codex and OpenCode are development tools, not runtime dependencies. The old Windows `PPC Team Note Dialer Sync` task is disabled and must not run concurrently with this service.

## Scope

The service reads contact and note data from PPC location `GDq92uruRngbi9mLGGrV`. It updates the existing Sales Dialer contact field `1252710` (Seller Call Brief), after exact normalized phone verification. When readable notes exist, it also replaces only a recognized generic Fresh Lead instruction in `1252708` with a reminder to review team notes (or DO NOT CONTACT when suppressed). Specific objectives remain unchanged. Both fields are audited and verified by readback. It never creates, edits, or deletes source notes, places calls, sends messages, or changes campaigns, stages, or ownership.

The current rendering is two dated, attributed excerpts, capped at 450 characters. This is not full note history. Other existing dialer fields and campaign labels are not refreshed by this service. Native JustCall Notes and the in-call display are distinct from the contact custom-field screen.

## Operation

`PPC_NOTE_SERVICE_ENABLED=true` enables startup and webhook-driven processing. The existing `/webhook/ghl` receiver saves supported PPC events before acknowledgement. A single leased processor claims mapped contact jobs from `ppc_team_note_brief_jobs`. Latest events take priority; known contacts have six-hour fallback checks while the service is awake.

Neon stores the worker lease, rate-limit reservations and cooldowns, resumable source/readback checkpoints, and replacement audit. A restarted service can verify a completed PUT without repeating the write. The audit contains private note context and must not be exposed in public logs or endpoints.

Provider requests use a 25-second timeout. JustCall starts at no more than 20 requests/minute; remaining provider quota can slow it further. GHL starts at one request per 500ms. Limits coordinate these worker instances, not unrelated integrations.

Authentication and verification failures halt writes. Inspect `ppc_note_service_control.last_error`, the failed job, and its saved checkpoint before clearing a halt. Never clear verification errors solely to drain the queue. Confirm the destination identity, intended brief, and every unrelated field first.

`GET /api/ppc/notes/health` returns aggregate state without contact data. `verified=false` completion means no readable source note was copied; null indicates a legacy completion or an unfinished job. Counts alone do not prove event delivery or frontend usability.

## Verification

Run `node --test ppc-team-note-service.test.cjs ppc-inbox-route.test.cjs tests/ppc-montelli-transcript-ingestion.test.cjs montelli-stage-map.test.js atlas-ghl-webhook-safety.test.js`.

For a live release, verify the exact deployed revision, credentials against the PPC location/contact, independent cloud-owned job completion, destination readback, source-note preservation, and a representative teammate note in the actual user view. A replay can test transport, but is not evidence that GHL's native trigger is configured.

## Source workflow (September 9, 2026)

Published PPC workflow `2027fc35-4aed-4854-83f3-a75b134b81bb`, **PPC — Team Note Updates to Sales Dialer**, has Note Added and Note Changed triggers, re-entry enabled, and one POST Webhook action to the existing `/webhook/ghl` endpoint. Custom data `ppc_event=team_note_changed` identifies the workflow. The receiver requires the exact workflow ID, PPC location, and contact ID. It stores identity only, not the incoming full contact or note body.

Workflow payloads do not guarantee a unique note revision. Each receipt gets a new identity so repeated changes back to an earlier value are not lost. Contact jobs coalesce events, fetch current source notes, and avoid rewriting an already-current brief. Native API events retain payload-hash deduplication.

Release `d8529a7` passed 64 checks. A manual workflow test at 11:14:35 UTC produced inbox event 2; Render completed verified readback at 11:15:24 UTC, `ALREADY_CURRENT`. This interval included the previous deployment's lease expiring and is not a steady-state latency measurement. No original note was altered to test the trigger. Natural team activity and sleeping-service delivery still need observation.

The correct GHL contact URL is on `app.divinityaligned.net`; selecting Notes appends `?view=notes`. William's original full property note was visually verified there. JustCall's existing HighLevel button used the wrong `www` host. Support ticket `215475857278063` is investigating the supported base-URL setting and reuse of one browser tab.

## Outstanding release acceptance

- Observe a natural Note Added/Changed event end to end; published triggers and manual delivery are verified.
- Verify actual in-call readability, not only the contact detail screen.
- Resolve misleading existing next-action text without inferring ownership or changing campaign membership from notes alone.
- Render currently uses the free plan and can sleep. No upgrade is authorized. Verify cold-start delivery and recovery; do not promise continuous background polling on this plan.
- Pause the temporary Codex repair follow-up only after the full requested behavior is verified. Local fallback remains disabled.
