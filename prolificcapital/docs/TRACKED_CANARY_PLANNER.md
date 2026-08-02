# Tracked Canary Planner

**Module:** `canary-plan-builder.js`
**Preview tool:** `tools/canary-plan-preview.js`

## Purpose

Tracked, tested, committed production canary planner. Generates immutable preview plans from live GHL data with full compliance resolution. No production execution path is exposed.

## Architecture

```
Authoritative GHL hydration (CANARY profile)
  → Production record filtering
  → Property-local timezone derivation
  → Role/contact validation
  → Owner INT variant rendering
  → JustCall blacklist + text history lookup
  → Local suppression registry lookup
  → Unified compliance resolution
  → Immutable plan construction
  → Preview artifact
```

## Inputs

- Fresh authoritative hydration (GHL API)
- Active production records only (206 of 213)
- Owner operational policy v1.0.0
- OWNER_APPROVED_PIPELINE_INT template
- Property-local timezone (ZIP3 mapping)
- JustCall suppression + text history (read-only)
- Local suppression registry
- Current timestamp

## Output

```json
{
  "planId": "plan_<hash>",
  "planHash": "<sha256>",
  "schema": "canary-plan-v1",
  "policyVersion": "OP-2026-08-02-v1",
  "templateId": "OWNER_APPROVED_PIPELINE_INT",
  "executable": false,
  "productionEffects": { "sends": 0, "ghlWrites": 0, "stageMovements": 0 },
  "totalCandidates": 77,
  "selectedCount": 0,
  "blockedCount": 77,
  "blockerDistribution": { "DNC": 77, "STOP_OPT_OUT": 77, ... }
}
```

## Live E2E Result (2026-08-02)

- **77 candidates** identified from 206 production records
- **0 selected** (all blocked by fail-closed compliance)
- **All 8 guards** show 77 UNKNOWN each (no CLEAR sources available)
- **Honest result:** No candidate falsely cleared

## Safety

- No sendSMS method exposed
- No GHL write capability
- No stage movement capability
- Plan marked `executable: false`
- Kill switch PAUSED
- Provider sends: 0
- GHL writes: 0
- Stage movements: 0
