# Call Transcript Subsystem — Incidents

**Context version:** CALL-TRANSCRIPT-CONTEXT-2026-08-04-V1

---

## Incident 001: Transcript API 403 Misdiagnosis

**Date:** 2026-08-04
**Severity:** Low (read-only investigation, no production impact)
**Classification:** Integration diagnosis

### Summary

An owner-controlled call (ID `400683713`) had a complete transcript visible in JustCall Call Logs. The initial API request to `GET /v2.1/calls_ai/400683713?fetch_transcription=true` returned `403` with a message referencing the AI Review Assist add-on.

### Root Cause

The Calls AI endpoint defaults `fetch_summary`, `fetch_ai_insights`, `fetch_action_items`, and `fetch_smart_chapters` to `true`. The client requested transcription without explicitly disabling those paid fields, causing the Team-plan request to require AI Review Assist.

### Resolution

The corrected query explicitly disables all paid fields:

```
GET /v2.1/calls_ai/400683713
  ?fetch_transcription=true
  &fetch_summary=false
  &fetch_ai_insights=false
  &fetch_action_items=false
  &fetch_smart_chapters=false
```

This returned HTTP 200 with exact call identity and provider transcript data.

### Superseded Claims

- `JUSTCALL_TRANSCRIPT_FEATURE_NOT_ENABLED`
- Transcript not generated
- Transcript UI-only
- AI Review Assist required for transcript-only API retrieval

### Evidence

- Live read-only API probe: `C:\Users\mscott\AppData\Local\Temp\opencode\exact-call-diagnostic.js`
- Incident report: `reports/incidents/justcall-transcript-api-2026-08-04/incident-report.md`

---

## Incident 002: Preview Expiration Before Approval

**Date:** 2026-08-04
**Severity:** Low (no write occurred)
**Classification:** Process control

### Summary

The first sync-aware revised preview (`call_note_preview_06a760cbb95b9c2021ac`) expired at `2026-08-04T16:51:23.917Z` before the exact approval phrase was received. The approval was not carried forward.

### Resolution

A fresh preview was generated (`call_note_preview_a1d5f3e95d91e26ad43e`) with a new ID, hash, and expiry. The expired preview was superseded and its approval instruction removed.

### Controls Verified

- Expired preview cannot be approved
- Superseded preview revokes active approvals
- New preview requires new exact approval language
