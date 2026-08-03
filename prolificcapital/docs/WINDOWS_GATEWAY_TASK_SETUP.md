# Windows Gateway Task Setup

**Version:** 1.0
**Last updated:** 2026-08-03

## Current Task Definition

- **Name:** \OpenClaw Gateway
- **Trigger:** At user logon
- **Action:** C:\Users\mscott\.openclaw\gateway.cmd
- **Multiple instances:** IgnoreNew
- **Battery:** Disallow start if on batteries, stop if going on batteries

## Export

```
schtasks /query /tn "\OpenClaw Gateway" /xml > ops\windows\OpenClaw-Gateway-Task.xml
```

## Import

```
schtasks /create /xml ops\windows\OpenClaw-Gateway-Task.xml /tn "\OpenClaw Gateway"
```

## Manual Creation

```
schtasks /create /tn "\OpenClaw Gateway" /tr "C:\Users\%USERNAME%\.openclaw\gateway.cmd" /sc onlogon /delay 0000:30 /rl highest /it
```

## Verification

```
schtasks /query /tn "\OpenClaw Gateway" /v
```

## Troubleshooting

- Task not running: check Task Scheduler history
- Last Run Result 0x0 = success
- Last Run Result 0x1 = failure (check boot log)
- If task is disabled: `schtasks /change /tn "\OpenClaw Gateway" /enable`
