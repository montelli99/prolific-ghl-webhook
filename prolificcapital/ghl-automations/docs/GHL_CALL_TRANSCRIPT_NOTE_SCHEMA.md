# GHL Call Transcript Note Schema

**Context version:** CALL-TRANSCRIPT-CONTEXT-2026-08-04-V1
**Current schema version:** `owner-controlled-transcript-note-v2-sync-aware`

## Schema Evolution

| Version | Changes |
|---|---|
| `owner-controlled-transcript-note-v1` | Initial schema with call metadata, transcript, facts, risks, provenance |
| `owner-controlled-transcript-note-v2-sync-aware` | Removes duplicated auto-synced metadata; adds "ALREADY AUTO-SYNCED" and "NOT AUTO-SYNCED" sections; references GHL task ID |

## Note Structure (v2)

```
Owner-Controlled Call Transcript Test
owner_controlled_transcript_note_key:{idempotencyKey}

TEST DISCLAIMER
- Owner-controlled test
- Not a production deal
- No opportunity associated
- No stage movement
- No follow-up automation

TRANSCRIPT PROVENANCE
- JustCall call ID
- Transcript source: PROVIDER_TRANSCRIPT
- Provider transcript hash
- Transcript retrieval timestamp

ALREADY AUTO-SYNCED BY JUSTCALL TO GHL
- GHL object: Completed task {taskId}
- Direction
- Timestamp
- Duration
- Recording link: present in GHL task; URL omitted
- The metadata above is referenced for provenance and is not duplicated

NOT AUTO-SYNCED BY JUSTCALL TO GHL
- Provider transcript text
- Transcript link
- Call summary
- AI analysis
- Disposition tag
- Last Call Outcome

TRANSCRIPT
{normalized transcript with [UNCLEAR] markers}

STRUCTURED FACTS
- {label}: {value} (evidence: "{transcript quote}")

RISK FLAGS
- {code}: {detail}

PROVENANCE
- Provider transcript hash
- Note-preview hash
- Call ID
- Test contact ID
- Supersedes preview ID (if applicable)

PRODUCTION EFFECTS
- Provider sends: 0
- Calls automatically placed: 0
- GHL writes before approval: 0
- Stage movements: 0
```

## Idempotency Key

```
SHA-256(callId, transcriptHash, contactId, noteSchemaVersion)
```

The key is embedded in the note body as `owner_controlled_transcript_note_key:{key}` and used for duplicate detection during pre-write reconciliation.

## Design Rules

1. Never duplicate call metadata already auto-synced by JustCall to GHL.
2. Always include the normalized transcript (not raw, not summarized).
3. Facts must be directly supported by transcript evidence.
4. Risk flags must be explicit and actionable.
5. Provenance must include provider transcript hash for auditability.
6. Production effects block must always state zero for all categories before approval.
