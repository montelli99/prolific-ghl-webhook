# Call Transcript Production Policy

**Context version:** CALL-TRANSCRIPT-CONTEXT-2026-08-04-V1
**Status:** TEST_CONTACT_ONLY

## Current State

- **Test contact certified:** `PSVc2FuuA0dqyaQPXqOE`
- **Production contacts:** Blocked
- **Kill switch:** `PAUSED`
- **GHL writes:** 1 (test note only)
- **Production GHL writes:** 0

## Unresolved Owner Decisions

Before any production contact can receive a transcript note, the owner must explicitly decide:

### Eligibility
- Which contact roles are eligible (agent, seller, buyer, etc.)?
- Which pipeline stages are eligible?
- Should notes be restricted to contacts with active opportunities only?

### Content
- Full normalized transcript or summary only?
- Should `[UNCLEAR]` markers be included in production notes?
- Should probable transcription errors be flagged in production notes?

### Corrections
- Who can request a transcript correction?
- Does a correction require re-approval?
- Should the original note be superseded or annotated?

### Retention
- How long should preview artifacts be retained?
- How long should approval artifacts be retained?
- Should consumed approvals be archived or deleted?

### Approval Authority
- Is the owner the sole approver?
- Can designated operators prepare previews?
- Can designated operators approve notes?

### Consent and Compliance
- Does the contact consent form cover transcript storage in GHL?
- Does call recording consent cover transcription?
- Are there jurisdiction-specific requirements?

### Sensitive Information
- Should transcript notes redact phone numbers, addresses, or financial figures?
- Should certain call topics (medical, legal, financial advice) block note creation?

## Automation Isolation

- Verified for test contact: adding a note did not trigger tasks, conversations, appointments, opportunities, stage movements, contact field changes, or tag changes.
- Production workflow isolation requires a separate audit before any production write.
- If any GHL workflow is triggered by note creation, production writes must remain blocked until the workflow is identified and assessed.

## Write Gateway Constraints

Even after production is enabled:

- Only `CREATE_APPROVED_CALL_TRANSCRIPT_NOTE` is permitted
- Generic GHL writes remain unreachable through this path
- No fields, tags, tasks, opportunities, stages, SMS, calls, appointments, documents, or workflows
- Kill switch must be `PAUSED` (not `CANARY_ALLOWED` or any other state)
- Every write requires exact owner approval with full binding
