# Call Transcript Subsystem — Agent Start Here

**Context version:** CALL-TRANSCRIPT-CONTEXT-2026-08-04-V1

## Quick Reference

| Question | Answer |
|---|---|
| Where is the transcript? | JustCall Calls AI API: `GET /v2.1/calls_ai/{id}` with transcript-only flags |
| Does Team plan include it? | Yes, when all paid AI fields are explicitly disabled |
| Is AI Review Assist required? | No, for transcript-only retrieval |
| Does GHL auto-sync the transcript? | No. Call metadata and recording link sync; transcript text does not |
| Can we write a transcript note? | Yes, through the owner-controlled preview/approval/write pipeline |
| Is the write path safe? | Yes: exact approval, narrow gateway, idempotency, PAUSED-only |
| Are production contacts writable? | No. Only the designated test contact is permitted |

## Key Files

| File | Purpose |
|---|---|
| `modules/justcall-integration.js` | JustCall v2.1 API client, transcript retrieval, polling |
| `modules/owner-controlled-transcript-note.js` | Call identity verification, transcript normalization, preview/approval stores |
| `modules/owner-controlled-transcript-note-writer.js` | Guarded write pipeline with 12+ pre-write checks |
| `modules/ghl-call-sync-classifier.js` | Classifies what GHL already auto-synced vs. what's missing |
| `modules/ghl-call-note-gateway.js` | GHL REST client with narrow owner-controlled test-note write gate |
| `modules/call-note-schema.js` | Schema definitions, normalization, fact extraction |
| `modules/call-note-approval-store.js` | HMAC-signed approval artifacts |
| `modules/call-note-journal.js` | Idempotent file-based journal |
| `modules/call-note-operator-service.js` | Telegram command parser and router |
| `modules/telegram-command-router.js` | Main Telegram command dispatcher |

## Key Tests

| File | Tests |
|---|---|
| `modules/_test_owner_controlled_transcript_note.js` | 40 tests: API flags, identity, normalization, preview, approval, write safety |
| `modules/_test_ghl_call_sync_classifier.js` | 19 tests: sync classification, transcript/summary/link distinction, supersession |
| `modules/_test_call_note_certification.js` | 101 tests: full call-note pipeline certification |
| `modules/_test_justcall_integration.js` | 11 tests: JustCall API client |

## State

- Kill switch: `PAUSED`
- Test contact: `PSVc2FuuA0dqyaQPXqOE`
- Test call: `400683713`
- GHL writes: 1 (test note only)
- Production writes: 0
- Stage movements: 0

## Superseded Claims

- `JUSTCALL_TRANSCRIPT_FEATURE_NOT_ENABLED`
- Transcript not generated
- Transcript UI-only
- AI Review Assist required for transcript-only API retrieval
- Browser scraping required
- GHL automatically receives transcript text
- Latest call is safe selection
- Metadata-only activity equals transcript note
