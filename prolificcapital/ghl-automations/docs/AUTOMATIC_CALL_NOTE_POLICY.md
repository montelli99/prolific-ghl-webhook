# Automatic Call Note Production Policy

**Policy ID:** `AUTOMATIC_CALL_NOTE_POLICY_V1`
**Version:** `2026-08-05-v1`
**Mode:** `TEST_CONTACT_ONLY`

## Overview

This policy governs automatic creation of structured transcript notes in GHL after a JustCall call completes and its transcript becomes available. The worker operates deterministically without LLM involvement. The model may later read and explain stored notes but never controls note creation.

## Eligibility

### Sender Numbers
- Allowed: `571-601-2619` (Montelli, JustCall 10DLC verified)
- Any other sender number: blocked

### Call Direction
- Allowed: `OUTGOING`
- Inbound calls: blocked

### Call Outcome
- Allowed: `ANSWERED`
- Missed, voicemail, abandoned: blocked

### Minimum Duration
- 10 seconds
- Shorter calls: blocked (likely voicemail or hangup)

### Transcript
- Required: provider transcript via JustCall API
- Browser-scraped or system-generated transcripts: blocked
- Empty transcript: blocked

### Contact Matching
- Exact GHL contact required via normalized E164 phone match
- Zero contacts: blocked
- Multiple matching contacts: blocked
- Name-only match: blocked
- Internal/owner-controlled test numbers: blocked unless TEST_CONTACT_ONLY mode

### Opportunities
- Calls with no opportunity: blocked (owner policy required)
- Calls with multiple opportunities: blocked (owner policy required)
- Archived or lost opportunities: blocked (owner policy required)

### Consent/Compliance
- Owner policy required (unresolved)

### Automation Isolation
- Current state: `AUTOMATION_ISOLATION_PARTIAL` (3 workflows verified, 25 unreadable)
- Production automatic notes require `AUTOMATION_ISOLATION_VERIFIED`

## Write Gate

**Operation:** `CREATE_AUTOMATIC_APPROVED_CALL_TRANSCRIPT_NOTE`

### Allowed
- Create exactly one contact note
- Read back and reconcile

### Forbidden
- Update contact fields
- Modify tags
- Create tasks
- Create or update opportunities
- Move stages
- Send SMS
- Place calls
- Create appointments
- Trigger documents
- Enroll workflows

## Note Schema

**Version:** `automatic-call-transcript-note-v1`

### Sections
1. CALL REFERENCE (call ID, direction, outcome, duration, transcript source, recording, GHL auto-sync object)
2. KEY FACTS (property address, contact role, occupancy, condition, repairs, asking price, motivation, timeline, financing openness, mortgage/payoff, requested next step)
3. FOLLOW-UP / OPEN ITEMS (unanswered questions, explicit commitments, requested follow-up, unclear transcript sections)
4. TRANSCRIPT (normalized transcript with [UNCLEAR] markers)
5. PROVENANCE (call ID, transcript hash, schema version, idempotency marker)

### Auto-Creation Rules
- Do NOT create follow-up tasks
- Do NOT create calendar events
- Do NOT send SMS
- Do NOT place calls
- Do NOT move stages
- Do NOT modify opportunities

## Transcript Normalization

### Allowed
- Whitespace cleanup
- Speaker ordering
- Timestamp preservation
- [UNCLEAR] markers
- Transport noise removal

### Forbidden
- Silently correct facts
- Rewrite grammar as verified
- Infer seller agreement
- Infer motivation
- Schedule based on suspicious text
- Convert ambiguous phrases to actions

## Kill-Switch Model

Independent sub-policy for automatic call note writes:

| State | Behavior |
|-------|----------|
| `DISABLED` | No automatic notes (default) |
| `TEST_CONTACT_ONLY` | Only owner-controlled test contacts |
| `PRODUCTION_ALLOWED` | Eligible production calls (requires all guards) |

This does NOT enable SMS outreach or stage movement.

## Unresolved Categories (Owner Policy Required)

- Consent/compliance state verification
- Allowed contact roles
- Allowed pipeline stages
- Calls with no opportunity
- Calls with multiple opportunities
- Archived or lost opportunities
