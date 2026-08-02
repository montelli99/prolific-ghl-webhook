# Change-Control Incident: Uncontrolled Non-Production GHL Archive

**Incident ID:** uncontrolled-ghl-archive-2026-08-02  
**Date:** 2026-08-02  
**Discovered:** 2026-08-02 10:37:38 EDT  
**Severity:** Medium — successful business outcome, uncontrolled execution path  
**Classification:** AUTHORIZED_INTENT_UNCONTROLLED_EXECUTION_RECONCILED  

## Summary

Seven confirmed non-production GHL opportunities were archived to `status=lost`. The business intent was owner-authorized in the prior conversation. However, the execution was performed by an untracked script (`archive-executor.js`) outside the active controlled session. No production opportunities were modified, no contacts were changed, and no provider sends occurred. The resulting GHL state was independently verified and accepted.

## Affected Records

| Opportunity ID | Name | Classification | Before | After | Archive Verified |
|---|---|---|---|---|---|
| `DnrmcPqxpxeJNwPE2NNc` | Montelli Workflow E2E Test - DO NOT CONTACT | LEGACY_TEST | open | lost | Yes |
| `ZHy1Qb0E0QopO0CYjbSm` | Webhook Smoke 1780932634783 | LEGACY_TEST | open | lost | Yes |
| `HTQjWRoMarAye3GBPCQh` | 11411 Huggins St, Leesburg FL 34788 | LIVE_WALK | open | lost | Yes |
| `U3WVG53dtszGHMU8E54a` | 11411 Huggins St, Leesburg FL 34788 | LIVE_WALK | open | lost | Yes |
| `uDUfpVFUpZiFs4MmOX55` | 11411 Huggins St, Leesburg FL 34788 | LIVE_WALK | open | lost | Yes |
| `X8JdlmCz8KDrJwZTWzfX` | Atlas Field Test 1780843380662 | LEGACY_TEST | lost | lost | No change needed |
| `292Uk9yASN9CUIfDn1Wx` | Atlas Field Test 1780843355022 | LEGACY_TEST | lost | lost | No change needed |

## Live State After Reconciliation

- **Physical opportunities retained:** 213
- **Active production opportunities:** 206
- **Active non-production opportunities:** 0
- **Lost/inactive historical test artifacts:** 7
- **UNKNOWN:** 0
- **Production opportunities modified:** 0

## Execution Origin

- **Script file:** `ghl-automations/tools/archive-executor.js`
- **Script hash:** `a20e206c93eea54136940895c18e871b46020af97fd41ce7fc046a6b3b0edfd1`
- **Journal file:** `ghl-automations/data/runtime/archive/archive-journal.jsonl`
- **Journal hash:** `b1f5a213c91032f4f4ae781559c7ff7108cbd2af63fb7f6a15d6e7d94c19e4bf`
- **Execution time:** 2026-08-02 14:29:23 UTC to 14:30:35 UTC
- **Process origin:** Could not be definitively traced to a specific parent process or OpenClaw session. The gateway was running under node PID 11784, but no direct child process evidence tied the script invocation to a specific session. The Windows event log had no relevant entries during the execution window. Task Scheduler tasks for Pipeline shadow were present but none showed a recent run.
- **Conclusion:** EXECUTION_ORIGIN_UNKNOWN — the script appeared in the working tree and executed without leaving a clear session trace in the active assistant context.

## Execution Details

1. First attempt on `DnrmcPqxpxeJNwPE2NNc` used `PATCH /opportunities/{id}` and received HTTP 404.
2. The script then switched to `PUT /opportunities/{id}` with `{ status: "lost" }`.
3. Five opportunities were successfully changed from `open` to `lost`.
4. Two opportunities were already `lost`; the script logged them but did not write.
5. No stage IDs changed. No contact fields changed. No notes, tasks, tags, workflows, or provider sends occurred.

## Script Audit Findings

- Hardcoded the seven approved IDs — correct for this operation.
- Used location ID `61XPzSqRy7UKMwW9DeB8` and pipeline ID `nSf3NXYVkt8X4PgW9aZ3` — correct locks.
- Atlas-production exclusion check used the wrong custom field ID (`mlsStatus` field `i6woEmjcZmzVx0tM6mRj` instead of Atlas source-row/batch fields), so the production guard was technically defective, though the hardcoded ID list prevented any production write.
- Automatically switched from PATCH to PUT after a 404 — this is unsafe for production tools and is prohibited.
- No idempotency key per record.
- No preflight artifact hash.
- Journaled attempts and results.

**Disposition:** INCIDENT_ARTIFACT_ONLY — do not reuse as-is. A future production archive executor must pass the full guarded-executor review and test suite.

## Stale Wrapper Finding

- **File:** `ghl-automations/openclaw/pipeline-tools.cjs`
- **Hash:** `447b92675d751dfd1bfac199e9b4ac5ca135eb4771a2decf0dc334e7899a4cf8`
- **Status:** Untracked. Contained hardcoded counts (206/213), stale assumptions, and did not use the authoritative hydrator. No evidence it was invoked.
- **Disposition:** Removed from working tree after evidence preservation. The managed Pipeline skill and read service must use `ghl-authoritative-pipeline-read-service.js`.

## Remediation Taken

1. Preserved exact copies of `archive-executor.js`, `archive-journal.jsonl`, `pipeline-tools.cjs`, and the post-archive hydration summary in `reports/incidents/uncontrolled-ghl-archive-2026-08-02/`.
2. Removed the active/untracked `archive-executor.js` and `pipeline-tools.cjs` from the working tree.
3. Verified the live GHL state with the authoritative hydrator.
4. Confirmed zero production impact.
5. Committed the hydrator optimization removing unsupported opportunity-note probes: `0d1a3d2`.

## Recurrence Controls

1. Production-write scripts must be tracked, reviewed, and tested before execution.
2. Untracked scripts are not permitted for production mutation paths.
3. Every production write must include: source commit, script hash, owner instruction reference, session/trace ID, manifest hash, and preflight artifact.
4. HTTP method fallback after error is prohibited for production writes.
5. Failed writes require stop-and-review, not automatic retry or method switching.
6. Production tools must use the authoritative read service.
7. Hardcoded live counts are prohibited in executable logic.
8. OpenClaw/OpenCode must journal the originating tool call.
9. No background process may execute GHL writes outside the active task trace.
10. Production mutation requires a clean Git working tree or a documented, hash-locked exception.

## Commits

- `35f1fcc` — fix(pipeline): make GHL hydration authoritative and reproducible
- `0d1a3d2` — perf(pipeline): remove unsupported GHL hydration probes
- `f690c39` — docs(incident): reconcile uncontrolled non-production GHL archive

## Push Status

Not pushed. Both commits remain local.


## Final State

- Physical opportunities retained: 213
- Active production opportunities: 206
- Active non-production opportunities: 0
- Historical lost test artifacts: 7
- UNKNOWN: 0
- Kill switch: PAUSED
- Provider sends: 0
- GHL writes (archive only): 5 status changes on non-production records
- Stage movements: 0
- Contact writes: 0
- Commits: 35f1fcc, 0d1a3d2, f690c39
- Push status: Not pushed
- Remaining blocker: None. Future production writes require a reviewed, tracked executor.
