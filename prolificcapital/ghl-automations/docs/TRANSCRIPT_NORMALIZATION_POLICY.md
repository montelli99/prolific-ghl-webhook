# Transcript Normalization Policy

**Context version:** CALL-TRANSCRIPT-CONTEXT-2026-08-04-V1

## Principles

1. **Raw transcript is always preserved.** The provider's exact wording is stored verbatim and never discarded.
2. **Normalization adds markers, never removes words.** The only allowed transformation is appending `[UNCLEAR]` to phrases that are nonsensical, incomplete, or cannot be safely interpreted.
3. **Probable transcription errors are flagged, not corrected.** Grammatical anomalies or likely extra/missing words are annotated as `PROBABLE_TRANSCRIPTION_ERROR` but the original wording is preserved.
4. **No silent factual or grammatical rewriting.** The system must never "fix" wording, grammar, or facts without explicit owner review.
5. **Owner corrections require a new preview.** Any owner-requested change to the transcript text creates a new preview with a new ID, hash, and approval requirement.

## Annotation Types

| Type | Meaning | Example |
|---|---|---|
| `UNCLEAR` | Phrase is nonsensical or incomplete; must not drive actions | "request to leave information in utility [UNCLEAR]" |
| `PROBABLE_TRANSCRIPTION_ERROR` | Likely provider transcription artifact; preserved exactly | "The roof is the ten years old" |

## Normalization Diff

Every preview records a normalization diff listing:

- Removed empty transport segments (if any)
- Every annotation applied, with type, phrase, and reason
- A statement that no wording changes were applied (if none were)

## Hash Provenance

- **Provider transcript hash:** SHA-256 of the raw provider segments (before any normalization)
- **Normalized transcript hash:** SHA-256 of the normalized segments (after annotations)
- Both hashes are recorded in every preview and note for auditability

## What Normalization Does NOT Do

- Summarize or paraphrase
- Correct grammar or spelling
- Fill in missing words
- Resolve ambiguous pronouns
- Translate or localize
- Redact or omit content (except empty transport segments)
- Infer speaker intent
- Assign sentiment or tone
