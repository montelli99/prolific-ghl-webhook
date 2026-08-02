# Outreach Compliance Resolver

**Module:** `outreach-compliance-resolver.js`

## Purpose

Unified fail-closed compliance resolver used by both previews and execution. Aggregates GHL tags, JustCall blacklist, JustCall text history, local suppression registry, and execution journal into a single compliance verdict per candidate.

## Guards

| Guard | Required State | Sources |
|-------|---------------|---------|
| DNC | CLEAR | GHL tags, JustCall blacklist, JustCall contact status, local registry |
| STOP_OPT_OUT | CLEAR | GHL tags, JustCall blacklist, local registry |
| WRONG_NUMBER | CLEAR or NOT_APPLICABLE | GHL tags, local registry |
| PENDING_REPLY | CLEAR | GHL tags, JustCall history, local registry |
| ACTIVE_HUMAN_WORK | CLEAR | GHL tags, local registry |
| PRIOR_OUTREACH | CLEAR | JustCall history, execution journal, local registry |
| DUPLICATE_HISTORY | CLEAR | Execution journal, local registry |
| PROVIDER_UNCERTAINTY | CLEAR | JustCall history, local registry |

## Resolution Rules

1. Any trusted-source BLOCKED result wins
2. Conflicting sources return UNKNOWN, never CLEAR
3. Absence of a GHL tag is UNKNOWN, not CLEAR
4. All required guards must be CLEAR for production eligibility
5. UNKNOWN always blocks

## Output Schema

```json
{
  "schema": "outreach-compliance-resolver-v1",
  "passed": false,
  "blocked": true,
  "unknown": true,
  "guards": {
    "DNC": { "state": "UNKNOWN", "sources": [...], "evidence": [...], "blockerCode": "DNC_UNKNOWN" },
    ...
  },
  "timezone": { "timeZone": "America/Chicago", "ok": true, "windowOk": false, "windowReason": "WEEKEND_BLOCKS_CANARY" },
  "role": { "role": "agent", "level": "HIGH_CONFIDENCE_INFERRED", "scriptOk": true },
  "policyVersion": "OP-2026-08-02-v1",
  "checkedAt": "ISO timestamp"
}
```
