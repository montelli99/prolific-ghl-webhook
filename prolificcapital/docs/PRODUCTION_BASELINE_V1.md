# Production Baseline V1.0

**Baseline Hash:** `d0377b3aca119b8e0107e826fd4c6a0cd35a1323a7d12bcf7e15253b7ae4a6bc`
**Git Commit:** `7adf254`
**Tag:** `pipeline-production-v1.0`
**Frozen:** 2026-08-03

## Repository

- **Commit:** `7adf254` — `fix(pipeline): persist immutable canary plans and approvals`
- **Working tree:** Clean
- **Branch:** `master`

## Policy

- **Version:** `OP-2026-08-02-v1`
- **Template:** `OWNER_APPROVED_PIPELINE_INT`
- **Template hash:** `f5e3d8a...` (see `reports/production-baseline.json`)
- **Business window:** Mon-Fri 12:00 PM – 6:00 PM property-local timezone
- **Weekend:** Blocked, no override
- **Sender:** 571-601-2619
- **Max canary:** 3

## Runtime

- **Gateway:** PID 11784, port 18789, single Telegram consumer
- **Pipeline topic:** 389
- **Owner ID:** 718718959
- **Kill switch:** PAUSED (0 sends, 0 writes, 0 movements)

## Dataset

- **Total opportunities:** 213
- **Production:** 206
- **Non-production:** 7 (all classified, all archived/lost)

## Module Hashes

See `reports/production-baseline.json` for full SHA-256 hashes of all 20 production modules.

## Tests

| Suite | Pass/Total |
|-------|-----------|
| Policy enforcement | 46/46 |
| Compliance integration | 52/52 |
| Live guards | 25/25 |
| Dry-run | 93/93 |
| Course canary | 24/24 |
| JustCall | 11/11 |
| Hydrator | 27/27 |
| Canary certification | 34/34 |
| **Total** | **312/312** |

## Accepted Limitations

1. **Supervised canary only.** Unattended operation not yet enabled.
2. **Manual JustCall funding confirmation.** API does not expose account balance.
3. **Webhooks deferred.** Inbound SMS and delivery events not registered. Manual monitoring required.
4. **Text history pagination PARTIAL.** 13/18 JustCall texts fetched (5 likely deleted). 0 candidate matches.
5. **No local suppression entries.** Registry exists but is empty. All candidates clear via JustCall blacklist + GHL tags.
6. **Active-human-work lock duration.** Manual release only. No automatic timeout.

## Rollback

See `docs/ROLLBACK_PLAN_V1.md`.
