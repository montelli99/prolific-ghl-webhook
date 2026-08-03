# Pipeline Reboot Recovery

**Version:** 1.1
**Last updated:** 2026-08-03

## Overview

The Pipeline system recovers automatically after Windows reboot. The gateway starts via Task Scheduler, forces PAUSED, and reports readiness. No business operations resume automatically.

## Startup Sequence

1. Windows boots → networking available
2. Task Scheduler triggers `\OpenClaw Gateway` at user logon
3. `gateway.cmd` executes:
   - Resolves Node executable
   - Validates `openclaw.json`
   - Checks port 18789 availability
   - Acquires single-instance lock
   - Forces kill switch to PAUSED
   - Records Git revisions
   - Starts OpenClaw gateway
4. Gateway initializes Telegram channel
5. Agent `app-prolific-eng` loads workspace and memory
6. System is READY_PAUSED

## What Happens to In-Progress Work

| Pre-Reboot State | Post-Reboot State |
|---|---|
| PAUSED | PAUSED (unchanged) |
| DRY_RUN_ONLY | PAUSED (forced) |
| CANARY_ALLOWED | PAUSED (forced) |
| PREVIEW_PENDING_APPROVAL | REQUIRES_FRESHNESS_REVALIDATION |
| APPROVED_PENDING_EXECUTION | OWNER_REVIEW_REQUIRED_AFTER_RESTART |
| EXECUTING | INTERRUPTED_EXECUTION |
| UNCERTAIN | Hard blocked, no retry |
| COMPLETED | Preserved |
| FAILED | Preserved |

## Recovery Queue

After reboot, the recovery queue lists all items requiring owner review. The owner can inspect it with:

```
node ghl-automations/openclaw/pipeline-contact-card.cjs status
```

Or in Telegram: "Verify the Pipeline after reboot."

## Pre-Reboot Checklist

1. In Telegram Pipeline topic 389: "Prepare the Pipeline for a reboot."
2. Confirm REBOOT_SAFE response.
3. Reboot Windows manually.
4. After reboot, in Telegram: "Verify the Pipeline after reboot."
5. Confirm READY_PAUSED with correct revisions.

## Post-Reboot Verification

Run from PowerShell:

```powershell
.\ops\pipeline-status.ps1
```

Expected: `READY_PAUSED`

Check:
- Gateway PID and port 18789
- One Telegram consumer
- Correct group (-1003975794600) and topic (389)
- Kill switch PAUSED
- No active sends
- Recovery queue count
- Repository revisions match expected
- Contact card hash matches

## Troubleshooting

### Gateway didn't start
- Check Task Scheduler: `schtasks /query /tn "\OpenClaw Gateway"`
- Check boot log: `logs\gateway\boot-*.log`
- Run manually: `C:\Users\mscott\.openclaw\gateway.cmd`

### Port 18789 in use
- Check: `netstat -ano | findstr :18789`
- Stop conflicting process or reboot

### Stale lock
- gateway.cmd auto-recovers stale locks
- Manual: delete `ghl-automations\data\runtime\gateway.lock`

### Telegram not connecting
- Check internet connectivity
- Check bot token in openclaw.json
- Gateway will retry Telegram connection automatically

### GHL/JustCall unavailable
- Gateway starts in DEGRADED_PAUSED mode
- No business operations execute
- System recovers when services return
