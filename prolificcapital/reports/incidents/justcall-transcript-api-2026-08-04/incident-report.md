# JustCall Transcript API Retrieval Incident

**Date:** 2026-08-04  
**Classification:** Read-only integration diagnosis  
**Production impact:** None

## Summary

An owner-controlled call had a complete transcript in JustCall Call Logs, while the initial API request returned `403`. The transcript existed and was not UI-only.

## Root Cause

The Calls AI endpoint defaults summary, AI insights, action items, and smart chapters to enabled. The client requested transcription without explicitly disabling those paid fields, causing the Team-plan request to require AI Review Assist.

## Correct Retrieval Contract

Use the official Calls AI endpoint with:

- `fetch_transcription=true`
- `fetch_summary=false`
- `fetch_ai_insights=false`
- `fetch_action_items=false`
- `fetch_smart_chapters=false`

The corrected read-only request returned HTTP 200 with exact call identity and provider transcript data.

## Superseded Claims

- `JUSTCALL_TRANSCRIPT_FEATURE_NOT_ENABLED`
- Transcript not generated
- Transcript UI-only
- AI Review Assist required for transcript-only API retrieval

## Current Controls

- Provider transcript is classified `TRANSCRIPT_PROVIDER_API` and `PROVIDER_TRANSCRIPT`.
- Call and AI identifiers must be present, unique, and exact.
- Transcript normalization preserves provider wording and hash provenance.
- GHL note creation requires an immutable preview and exact owner approval.
- The owner-controlled test path is restricted to one designated test contact with zero associated opportunities.
- Production contacts and opportunities remain excluded.
- Provider sends, automatic calls, SMS, GHL writes, production GHL writes, and stage movements remained zero during investigation.
- Kill switch remained `PAUSED`.
