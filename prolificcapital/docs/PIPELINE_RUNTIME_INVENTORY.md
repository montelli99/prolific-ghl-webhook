# Pipeline Runtime Inventory

**Generated:** 2026-08-03
**Baseline:** pipeline-production-v1.1-recovery-ready
**Host:** WIN-JNBS65NTMGN

## System

| Component | Value |
|---|---|
| OS | Windows (x64) |
| Hostname | WIN-JNBS65NTMGN |
| User | mscott |
| Node version | v25.6.1 |
| Node path | C:\Program Files\nodejs\node.exe |
| npm global prefix | C:\Users\mscott\AppData\Roaming\npm |
| OpenClaw version | 2026.7.1-2 |
| OpenClaw path | C:\Users\mscott\AppData\Roaming\npm\node_modules\openclaw |
| Ollama version | 0.32.5 |
| Ollama port | 11434 |

## Repositories

| Repository | Path | Remote |
|---|---|---|
| prolificcapital | C:\Users\mscott\AI_Workspace\prolificcapital | (local workspace) |
| OpenClaw | C:\Users\mscott\AI_Workspace\OpenClaw | (local workspace) |
| prolific-ghl-webhook | C:\Users\mscott\AI_Workspace\prolificcapital\prolific-ghl-webhook | github.com/montelli99/prolific-ghl-webhook |

## Gateway

| Component | Value |
|---|---|
| Launcher | C:\Users\mscott\.openclaw\gateway.cmd |
| Task Scheduler | \OpenClaw Gateway |
| Port | 18789 |
| Config | C:\Users\mscott\AI_Workspace\OpenClaw\openclaw.json |
| Lock file | C:\Users\mscott\AI_Workspace\prolificcapital\ghl-automations\data\runtime\gateway.lock |
| Boot logs | C:\Users\mscott\AI_Workspace\prolificcapital\logs\gateway\ |
| Recovery logs | C:\Users\mscott\AI_Workspace\prolificcapital\logs\boot\ |

## Telegram

| Component | Value |
|---|---|
| Bot token | Stored in openclaw.json |
| Pipeline group | -1003975794600 |
| Pipeline topic | 389 |
| Owner ID | 718718959 |
| Agent | app-prolific-eng |
| Workspace | C:\Users\mscott\AI_Workspace\prolificcapital |
| Consumer count | 1 (OpenClaw gateway only) |
| kayla-telegram-bot.js | QUARANTINED — must not run |

## GHL

| Component | Value |
|---|---|
| Base URL | https://services.leadconnectorhq.com |
| API version | 2023-02-21 |
| Location ID | 61XPzSqRy7UKMwW9DeB8 |
| Pipeline ID | nSf3NXYVkt8X4PgW9aZ3 |
| Target stage | 7067148a-2ee8-4e5b-93c8-31e0253fea68 (Lead Entered) |
| Target owner | PGfXxlXCRXs3hXN3Gq7R (Montelli) |
| Token source | secrets/.env (GHL_API_TOKEN) |

## JustCall

| Component | Value |
|---|---|
| API version | v2.1 |
| Base URL | https://api.justcall.io |
| Sender | +15716012619 |
| SMS | Yes |
| MMS | Yes |
| 10DLC | Verified |
| Business | Approved |
| Credentials | secrets/.env (JUSTCALL_API_KEY, JUSTCALL_API_SECRET) |

## Render / Media Host

| Component | Value |
|---|---|
| Service | prolific-ghl-webhook |
| URL | https://prolific-ghl-webhook-0b16.onrender.com |
| VCF route | /assets/contact-cards/montelli-scott-divinity-aligned-v2.vcf |
| Entry point | npm start → node index.js |
| Deploy | Auto-deploy from github.com/montelli99/prolific-ghl-webhook master |

## Contact Card

| Component | Value |
|---|---|
| Spec | docs/montelli-contact-card.json v2.0.0 |
| VCF | ghl-automations/data/runtime/montelli-scott-divinity-aligned.vcf |
| VCF SHA-256 | 77bbcbdab80a604d3161d0a898fd92e1832d258c7c91a41349a86a5d18f60065 |
| Media URL | https://prolific-ghl-webhook-0b16.onrender.com/assets/contact-cards/montelli-scott-divinity-aligned-v2.vcf |
| CLI tool | ghl-automations/openclaw/pipeline-contact-card.cjs |
| Test recipient | ending 0891 |

## Runtime State

| Component | Path |
|---|---|
| Kill switch | ghl-automations/data/telegram-outreach-dry-run/kill-switch.json |
| Runbook | ghl-automations/data/runtime/supervised-canary-runbook-v2.json |
| Recovery queue | ghl-automations/data/runtime/recovery-queue.json |
| Suppression registry | ghl-automations/data/local-suppression-registry.json |
| Production plans | ghl-automations/data/production-plans/ |
| Production approvals | ghl-automations/data/production-approvals/ |
| Self-test preview | ghl-automations/data/runtime/contact-card-self-test-preview.json |
| Self-test approval | ghl-automations/data/runtime/contact-card-self-test-approval.json |
| Self-test result | ghl-automations/data/runtime/contact-card-self-test-result.json |

## Key Modules

| Module | Path |
|---|---|
| Boot safety guard | ghl-automations/modules/boot-safety-guard.js |
| Kill switch | ghl-automations/bot/kill-switch.js |
| Contact card delivery | ghl-automations/modules/contact-card-delivery.js |
| Contact card self-test | ghl-automations/modules/contact-card-self-test.js |
| JustCall integration | ghl-automations/modules/justcall-integration.js |
| Telegram command router | ghl-automations/modules/telegram-command-router.js |
| Canary executor | ghl-automations/bot/canary-executor.js |
| Canary plan builder | ghl-automations/modules/canary-plan-builder.js |
| Approval store | ghl-automations/modules/approval-store.js |
| Compliance resolver | ghl-automations/modules/outreach-compliance-resolver.js |
| Pipeline hydrator | ghl-automations/modules/ghl-authoritative-pipeline-hydrator.js |
| GHL read-only client | ghl-automations/modules/atlas-ghl-readonly-client.js |

## Operations Scripts

| Script | Path |
|---|---|
| Pipeline status | ops/pipeline-status.ps1 |
| Backup | ops/backup-pipeline-runtime.ps1 |
| Export secrets | ops/export-encrypted-secrets.ps1 |
| Import secrets | ops/import-encrypted-secrets.ps1 |
| Rollback | ops/rollback-pipeline.ps1 |
| Contact card CLI | ghl-automations/openclaw/pipeline-contact-card.cjs |

## Ports

| Port | Service | Required |
|---|---|---|
| 18789 | OpenClaw gateway | Yes |
| 11434 | Ollama | Degraded mode allowed |
| 3000 | Agent Forge (if enabled) | No |

## Environment Variables (non-secret)

| Variable | Value |
|---|---|
| PIPELINE_REVIEW_TELEGRAM_CHAT_ID | -1003975794600 |
| PIPELINE_REVIEW_TELEGRAM_TOPIC_ID | 389 |
| PIPELINE_REVIEW_TELEGRAM_DESTINATION | pipeline |
| PIPELINE_TELEGRAM_ADMIN_IDS | 718718959 |
| PIPELINE_TELEGRAM_REVIEWER_IDS | 718718959 |
| OLLAMA_HOST | 0.0.0.0 |
| OLLAMA_BASE_URL | http://localhost:11434 |
