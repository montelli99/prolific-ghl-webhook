# New PC Recovery Runbook

**Version:** 1.0
**Last updated:** 2026-08-03

## Prerequisites

- Windows 10/11 (x64)
- Administrator access
- Internet connection
- GitHub access to montelli99 repositories
- Backup bundle from previous PC

## Step 1: Install Node.js

Download and install Node.js v22+ (LTS) from https://nodejs.org

Verify:
```
node --version
```

Expected: v22.x or v25.x

## Step 2: Install OpenClaw

```
npm install -g openclaw@2026.7.1-2
```

Verify:
```
openclaw --version
```

## Step 3: Install Ollama

Download from https://ollama.com and install.

Verify:
```
ollama --version
```

Pull required models (check openclaw.json for model list).

## Step 4: Restore Repositories

Clone or restore from backup:

```
mkdir C:\Users\%USERNAME%\AI_Workspace
cd C:\Users\%USERNAME%\AI_Workspace
git clone <prolificcapital-remote> prolificcapital
cd prolificcapital
git checkout <production-baseline-revision>
```

Restore OpenClaw configuration repository:
```
cd C:\Users\%USERNAME%\AI_Workspace
git clone <openclaw-remote> OpenClaw
cd OpenClaw
git checkout <openclaw-revision>
```

Restore prolific-ghl-webhook:
```
cd C:\Users\%USERNAME%\AI_Workspace\prolificcapital
git clone https://github.com/montelli99/prolific-ghl-webhook.git prolific-ghl-webhook
cd prolific-ghl-webhook
git checkout <webhook-revision>
```

## Step 5: Restore OpenClaw Configuration

Copy `openclaw.json` from backup to:
```
C:\Users\%USERNAME%\AI_Workspace\OpenClaw\openclaw.json
```

Update any hardcoded paths if username differs.

## Step 6: Restore Secrets

From backup, run:
```
powershell -ExecutionPolicy Bypass -File ops\import-encrypted-secrets.ps1 -Source <backup-path>
```

Or restore `secrets\.env` manually with required values (see SECRET_RECOVERY_MANIFEST.md).

## Step 7: Restore Runtime State

From backup, copy state files:
- `state\kill-switch.json` → `ghl-automations\data\telegram-outreach-dry-run\kill-switch.json`
- `state\runbook-v2.json` → `ghl-automations\data\runtime\supervised-canary-runbook-v2.json`
- `memory\*` → `memory\`
- `docs\*` → `docs\`
- `assets\montelli-scott-divinity-aligned.vcf` → `ghl-automations\data\runtime\montelli-scott-divinity-aligned.vcf`

## Step 8: Restore Gateway Script

Copy `gateway.cmd` from backup to:
```
C:\Users\%USERNAME%\.openclaw\gateway.cmd
```

Update paths if username differs.

## Step 9: Import Scheduled Task

```
schtasks /create /xml ops\windows\OpenClaw-Gateway-Task.xml /tn "\OpenClaw Gateway"
```

Or create manually:
- Trigger: At logon
- Action: Start program `C:\Users\%USERNAME%\.openclaw\gateway.cmd`
- Settings: Do not start if on batteries, stop if going on batteries

## Step 10: Validate Paths

Run:
```
node -e "require('fs').existsSync('C:\\Users\\%USERNAME%\\AI_Workspace\\OpenClaw\\openclaw.json') && console.log('OK') || console.log('MISSING')"
node -e "require('fs').existsSync('C:\\Users\\%USERNAME%\\.openclaw\\gateway.cmd') && console.log('OK') || console.log('MISSING')"
```

## Step 11: Start Gateway Manually

```
C:\Users\%USERNAME%\.openclaw\gateway.cmd
```

Check boot log at `logs\gateway\boot-*.log`.

## Step 12: Verify

```
powershell -ExecutionPolicy Bypass -File ops\pipeline-status.ps1
```

Expected: `READY_PAUSED`

Verify:
- [ ] Gateway PID and port 18789
- [ ] One Telegram consumer
- [ ] Correct group (-1003975794600) and topic (389)
- [ ] Kill switch PAUSED
- [ ] No active sends
- [ ] GHL read-only accessible
- [ ] JustCall read-only accessible
- [ ] Render media URL returns 200 with correct VCF
- [ ] Runbook v2 retrievable
- [ ] Contact card hash matches
- [ ] All test suites pass

## Step 13: Enable Scheduled Startup

Enable the task:
```
schtasks /change /tn "\OpenClaw Gateway" /enable
```

## Step 14: Reboot Test

1. Reboot Windows
2. Wait 2-3 minutes
3. Run `ops\pipeline-status.ps1`
4. Confirm READY_PAUSED
5. In Telegram: "Verify the Pipeline after reboot."
6. Confirm correct response

## Step 15: Final Checks

- [ ] Gateway auto-starts after reboot
- [ ] No duplicate processes
- [ ] No kayla-telegram-bot.js running
- [ ] No automatic sends
- [ ] No automatic GHL writes
- [ ] No automatic stage movements
- [ ] Contact card self-test works
- [ ] All test suites pass
