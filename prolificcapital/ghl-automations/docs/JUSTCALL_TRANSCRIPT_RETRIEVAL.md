# JustCall Transcript Retrieval

**Context version:** CALL-TRANSCRIPT-CONTEXT-2026-08-04-V1

## Authoritative Endpoint

```
GET https://api.justcall.io/v2.1/calls_ai/{id}
```

## Required Query Flags

| Flag | Value | Reason |
|---|---|---|
| `fetch_transcription` | `true` | Retrieve transcript text |
| `fetch_summary` | `false` | Requires AI Review Assist on Team/Pro |
| `fetch_ai_insights` | `false` | Requires AI Review Assist on Team/Pro |
| `fetch_action_items` | `false` | Requires AI Review Assist on Team/Pro |
| `fetch_smart_chapters` | `false` | Requires AI Review Assist on Team/Pro |

Omitting any of the `false` flags causes them to default to `true`, which triggers the AI Review Assist entitlement check on Team and Pro plans.

## Authentication

```
Authorization: api_key:api_secret
Accept: application/json
```

The auth value is the raw `api_key:api_secret` string, not Base64-encoded.

## Response Shape

```json
{
  "data": {
    "id": 400683713,
    "call_sid": "CA...",
    "platform": "justcall",
    "call_transcription": [
      {
        "speaker_id": "15718140891",
        "speaker_name": "New JustCall Contact",
        "sentence": "Transcript text here.",
        "timestamp": {
          "starttime": 3,
          "endtime": 30
        }
      }
    ]
  },
  "status": "success"
}
```

## Identity Verification Requirements

Before accepting a transcript, verify:

1. Top-level `data.id` matches the requested call ID
2. No conflicting `call_id` or `callId` aliases exist
3. `data.call_sid` matches the call record's `call_sid` (if both present)
4. Transcript segments are non-empty
5. Segment timestamps are within the call duration and non-overlapping

## Plan Requirements

- **Team plan:** Transcript-only retrieval works. AI Review Assist is not required when all paid fields are explicitly disabled.
- **Pro plan:** Same as Team.
- **Pro Plus and above:** AI Review Assist is included; the `false` flags are not required but are harmless.

## Error Responses

| Status | Meaning |
|---|---|
| 200 | Success; transcript data in response |
| 401 | Authentication failure |
| 403 | Access denied (may indicate missing AI Review Assist if paid fields are enabled) |
| 404 | Call not found or AI data not yet generated |

## Related Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /v2.1/calls/{id}` | Call metadata (direction, duration, recording, etc.) |
| `GET /v2.1/calls/{id}?fetch_ai_data=true` | Call metadata with AI data (requires AI Review Assist) |
| `GET /v2.1/calls/{id}/recording/download` | Download call recording |
| `GET /v2.1/calls/{id}/journey` | Call journey details |
