# JustCall → GHL Auto-Sync Matrix

**Context version:** CALL-TRANSCRIPT-CONTEXT-2026-08-04-V1
**Observed for:** Call `400683713`, Team plan, contact `PSVc2FuuA0dqyaQPXqOE`

## Auto-Sync Status

| Data Item | Auto-Synced | GHL Location | Notes |
|---|---|---|---|
| Call activity (outgoing) | Yes | Completed contact task | Title: "Outgoing call to Montelli Call Note Test" |
| Call ID | Yes | Task body | `Call ID: 400683713` |
| Timestamp | Yes | Task due date | `2026-08-04T13:59:48.000Z` |
| Duration | Yes | Task body | `Call Duration: 00h 00m 32s` |
| Recording link | Yes | Task body | Shortened URL present |
| Transcript text | No | — | Not present in any GHL surface |
| Transcript link | No | — | Not present in any GHL surface |
| Call summary | No | — | Not present in any GHL surface |
| AI analysis | No | — | Not present in any GHL surface |
| Disposition tag | No | — | Not present in any GHL surface |
| Last Call Outcome | No | — | Not present in any GHL surface |
| Voicemail data | No | — | Not applicable (answered call) |

## Inspected GHL Surfaces

| Surface | API Status | Records Found | Call Match |
|---|---|---|---|
| Contact notes | 200 | 30 (1 test note) | 1 (test note only) |
| Contact tasks | 200 | 2 | 1 (auto-synced) |
| Conversations | 200 | 0 | 0 |
| Custom fields | 200 | 0 values | 0 |
| Appointments | 200 | 0 | 0 |
| Opportunities | 200 | 0 | 0 |
| Timeline/activities | 404 | Unsupported | — |
| Workflow enrollment | 404 | Unsupported | — |

## Duplication Decision Rules

When preparing a transcript note, classify based on what GHL already contains:

| GHL State | Classification |
|---|---|
| Equivalent idempotent note exists | `WRITE_NOT_NEEDED_EQUIVALENT_STRUCTURED_NOTE_EXISTS` |
| Complete transcript already present | `WRITE_NOT_NEEDED_TRANSCRIPT_ALREADY_PRESENT` |
| Metadata-only activity exists | `WRITE_SHOULD_BE_REDUCED` |
| No matching records | `WRITE_NEEDED` |
| GHL visibility incomplete | `WRITE_BLOCKED_UNCERTAIN_EXISTING_DATA` |

## Caveats

- Observed for one call on one Team-plan account. Do not overgeneralize.
- GHL integration settings may affect sync behavior; these were not API-readable.
- Browser-based timeline inspection was unavailable (Kane credits exhausted).
- Conversation API was readable and complete; no hidden conversations existed.
