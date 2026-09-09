# PPC team notes service

Production belongs to the existing `prolific-ghl-webhook` Render service and existing Neon database. Codex and OpenCode are development tools, not runtime dependencies. The old Windows `PPC Team Note Dialer Sync` task is disabled and must not run concurrently with this service.

## Scope

The service reads contact and note data from PPC location `GDq92uruRngbi9mLGGrV`. It updates only the existing Sales Dialer contact field `1252710` (Seller Call Brief), after exact normalized phone verification. It never creates, edits, or deletes source notes, places calls, sends messages, or changes campaigns, stages, or ownership.

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

## Outstanding release acceptance

- Confirm/configure native GHL Note Added and Note Changed delivery.
- Verify actual in-call readability, not only the contact detail screen.
- Resolve misleading existing next-action text without inferring ownership or changing campaign membership from notes alone.
- Render currently uses the free plan and can sleep. No upgrade is authorized. Verify cold-start delivery and recovery; do not promise continuous background polling on this plan.
- Pause the temporary Codex repair follow-up only after the full requested behavior is verified. Local fallback remains disabled.
