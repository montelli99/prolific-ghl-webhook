# Atlas GHL Production Import 2026-07-30

Status: `ATLAS_PRODUCTION_CLOSEOUT_COMPLETE`

## Git

- Commit: `9cbebe0628f0a8de19c92eb63923abc57e2ae90c`
- Local annotated tag: `atlas-ghl-production-import-2026-07-30`
- Push status: not pushed during operations phase because local branch `master` has no configured upstream.

## Production Artifacts

- Final reconciliation: `lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-passed-2e14a7cd6564.json`
- Final reconciliation hash: `2e14a7cd65646bc15defd3500c9915284cd293e0f6f129d267ba842236a811b1`
- Closeout artifact: `lead-tracking/atlas-deals/reconciliations/atlas-production-import-closeout-20260730-b969c160bb0b.json`
- Closeout artifact hash: `b969c160bb0bc98b4e80c59808ada45c1e0c738b756660e079822594625804d8`

## Final Counts

- Atlas-valid opportunities: `206`
- Physical target-pipeline opportunities: `213`
- Remaining executable rows: `0`
- Outreach and unauthorized side effects: `0`

## Blocked Rows

- `import-ready:69`: `SOURCE_DATA_CONFLICT`
- `import-ready:217`: `PERMANENT_IDENTITY_AMBIGUITY`
- `import-ready:273`: `PERMANENT_IDENTITY_AMBIGUITY`

## Reusable CLI

```bash
node ghl-automations/tools/atlas-import.js prepare --source <path>
node ghl-automations/tools/atlas-import.js preflight --manifest <path>
node ghl-automations/tools/atlas-import.js execute --manifest <path> --live --authorize "run live" --journal <journal-path>
node ghl-automations/tools/atlas-import.js reconcile --artifact <path>
```

## Unresolved Limitation

Continue recording `UNRESOLVED_MESSAGE_BODY_OBSERVABILITY_LIMITATION`.
