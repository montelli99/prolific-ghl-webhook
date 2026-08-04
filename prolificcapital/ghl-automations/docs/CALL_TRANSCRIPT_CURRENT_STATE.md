# Call Transcript Subsystem — Current State

**Context version:** CALL-TRANSCRIPT-CONTEXT-2026-08-04-V1
**Authoritative as of:** 2026-08-04
**Supersedes:** All prior transcript availability, retrieval, and GHL sync claims

---

## Transcript Retrieval

- **Endpoint:** `GET /v2.1/calls_ai/{id}`
- **Required query flags:**
  - `fetch_transcription=true`
  - `fetch_summary=false`
  - `fetch_ai_insights=false`
  - `fetch_action_items=false`
  - `fetch_smart_chapters=false`
- **Auth:** Raw `Authorization: api_key:api_secret` (not Basic base64)
- **Plan requirement:** Team plan includes transcript-only retrieval. AI Review Assist is not required when all paid fields are explicitly disabled.
- **Exact identity:** Top-level call ID, AI call ID, and call SID must be present, unique, and match. Conflicting or missing identifiers fail closed.

## GHL Auto-Sync

JustCall's native GHL integration automatically synchronizes:

| Item | Auto-Synced | Storage Location |
|---|---|---|
| Call activity (outgoing/incoming) | Yes | Completed contact task |
| Call ID | Yes | Task body |
| Timestamp | Yes | Task due date |
| Duration | Yes | Task body |
| Recording link | Yes | Task body |
| Transcript text | No | — |
| Transcript link | No | — |
| Call summary | No | — |
| AI analysis | No | — |
| Disposition tag | No | — |
| Last Call Outcome | No | — |

Observed for call `400683713` on Team plan. Do not overgeneralize beyond this test.

## Transcript Normalization

- Raw provider transcript is preserved verbatim.
- Normalization adds `[UNCLEAR]` markers for nonsensical or incomplete phrases.
- Probable transcription errors are flagged but wording is never silently corrected.
- Owner corrections require a new preview with a new ID and hash.
- Normalization diff is recorded for every preview.

## Note Schema

- Schema version: `owner-controlled-transcript-note-v2-sync-aware`
- Avoids duplicating auto-synced call metadata.
- Contains: normalized transcript, verified facts, risk flags, provenance, and production-effects block.
- Idempotency key: SHA-256 of call ID, transcript hash, contact ID, and schema version.

## Approval Binding

- Owner Telegram ID, chat ID, topic ID, originating message ID
- Preview ID and hash, note-body hash, call ID, transcript hash, contact ID
- Expiration (15 minutes), schema version
- HMAC-signed; consumed exactly once

## Write Gateway

- One permitted operation: `CREATE_APPROVED_CALL_TRANSCRIPT_NOTE`
- Generic GHL writes unreachable through this path
- No fields, tags, tasks, opportunities, stages, SMS, calls, appointments, documents, or workflows
- Requires `PAUSED` kill-switch state
- All POST responses treated as write-uncertain; no automatic retry

## Production Policy

- Test contact `PSVc2FuuA0dqyaQPXqOE` certified
- Production contacts remain blocked
- Unresolved owner decisions: eligible roles/stages, full transcript vs. summary, corrections, retention, approval authority, consent/compliance, sensitive information

## Current Effects

- Provider sends: 0
- Automatic calls: 0
- SMS: 0
- GHL writes: 1 (test note only)
- Production GHL writes: 0
- Stage movements: 0
- State: `PAUSED`
