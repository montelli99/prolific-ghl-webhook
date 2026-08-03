# Rollback Plan V1.0

**Baseline:** `pipeline-production-v1.0` (commit `7adf254`)
**Baseline Hash:** `d0377b3aca119b8e0107e826fd4c6a0cd35a1323a7d12bcf7e15253b7ae4a6bc`

## When to Roll Back

If the first supervised canary reveals a defect in any production module, roll back to this frozen baseline.

## Rollback Procedure

### 1. Stop Execution

```
Transition kill switch to PAUSED (if not already).
Verify: 0 sends, 0 writes, 0 movements.
```

### 2. Revert Repository

```
git checkout pipeline-production-v1.0
```

Or if the tag is not pushed:

```
git checkout 7adf254
```

### 3. Verify Baseline

```
node -e "const crypto = require('crypto'); const baseline = require('./reports/production-baseline.json'); const current = { ... }; console.log(baseline.baselineHash === current.baselineHash);"
```

### 4. Verify Tests

```
Run all test suites. Confirm 312/312 pass.
```

### 5. Verify Runtime

```
- Gateway PID 11784, port 18789
- Single Telegram consumer
- Kill switch PAUSED
- 0 sends, 0 writes, 0 movements
```

### 6. Resume

The system is now at the frozen baseline. Any production plan must be regenerated from fresh hydration.

## What Rollback Does NOT Affect

- **GHL data.** No GHL writes occur during canary. Rollback does not touch GHL.
- **JustCall data.** No JustCall configuration changes. Rollback does not touch JustCall.
- **Telegram.** OpenClaw runtime is unchanged. Rollback does not restart the gateway.
- **Memory.** Pipeline memory files are not modified by rollback.
- **Dataset.** 213 opportunities unchanged.

## Recovery After Rollback

1. Investigate the defect using the frozen baseline as reference.
2. Fix the defect in a new branch.
3. Re-run all 312 tests.
4. Create a new production baseline (`v1.1`).
5. Tag and freeze.
