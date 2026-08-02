# Local Suppression Registry

**Module:** `local-suppression-registry.js`
**Storage:** `data/local-suppression-registry.json`

## Purpose

Authoritative local store for compliance states that may not be fully captured by GHL tags or JustCall API alone. Provides a single source of truth for DNC, STOP, opt-out, wrong-number, pending-reply, active-human-work, prior-outreach, and provider-uncertainty states.

## Suppression Types

| Type | Expires | Source Examples |
|------|---------|----------------|
| DNC | Never | GHL tag, JustCall blacklist, owner directive |
| STOP | Never | Inbound STOP message, JustCall opt-out |
| OPT_OUT | Never | JustCall webhook, manual opt-out |
| WRONG_NUMBER | Never | Provider response, human verification |
| PENDING_REPLY | Manual clearance | Inbound message requiring response |
| ACTIVE_HUMAN_WORK | Manual clearance | Owner lock, active session |
| PRIOR_OUTREACH | Manual clearance | Execution journal, JustCall history |
| PROVIDER_UNCERTAIN | Manual clearance | Failed/uncertain send result |

## Record Schema

```json
{
  "id": "hash",
  "phone": "+1NNNNNNNNNN",
  "type": "DNC|STOP|OPT_OUT|...",
  "state": "BLOCKED|CLEAR|UNKNOWN",
  "source": "GHL tag|JustCall blacklist|owner directive|...",
  "sourceEventId": "optional event/message ID",
  "scope": "PIPELINE",
  "firstObserved": "ISO timestamp",
  "lastVerified": "ISO timestamp",
  "evidenceHash": "hash of evidence",
  "provenance": "source description",
  "supersededBy": null,
  "expiresAt": null
}
```

## Rules

- STOP/DNC/opt-out do not expire automatically
- Conflicting state blocks (BLOCKED wins)
- Unknown source freshness blocks
- Manual owner clearance preserves history and provenance
- No record is silently deleted
- Divinity CRM data excluded
