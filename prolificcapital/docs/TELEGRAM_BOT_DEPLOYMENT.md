# TELEGRAM BOT DEPLOYMENT

**Version:** 2.0
**Created:** 2026-08-01
**Updated:** 2026-08-01 (owner bootstrap added)
**Bot:** Kayla Pipeline Operator Bot
**Entry Point:** `ghl-automations/bot/kayla-telegram-bot.js`

---

## SERVICE IDENTITY

| Field | Value |
|---|---|
| Service name | `kayla-pipeline-bot` |
| Entry point | `ghl-automations/bot/kayla-telegram-bot.js` |
| Service wrapper | `ghl-automations/bot/start-bot.bat` |
| Working directory | `ghl-automations/` |
| Runtime | Node.js 22+ |
| Mode | Long polling (single instance, lock file prevents duplicates) |
| Deployment location | Local operator machine or managed server |

---

## OWNER BOOTSTRAP

On first startup with no `TELEGRAM_OWNER_USER_ID` set and no existing owner config, the bot enters bootstrap mode:

1. Bot generates a one-time 32-character hex claim code (15-minute expiry)
2. Code is displayed in the service console/log only — never in Telegram
3. Montelli opens `@Prolificclawd_bot` in a **private chat** and sends: `/claim <code>`
4. Bot validates: private chat, not forwarded, not edited, not a bot account
5. Bot writes owner config to `data/owner-config.json` with integrity digest
6. Bot invalidates the bootstrap code permanently
7. Bot confirms binding without printing sensitive data

**After binding:**
- Owner config persists across restarts
- `/claim` is permanently disabled
- Rebinding requires deleting `data/owner-config.json` and restarting
- Integrity digest prevents manual tampering

---

## ENVIRONMENT VARIABLES

| Variable | Required | Source | Notes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | **YES** | Secure env | Bot token from @BotFather |
| `TELEGRAM_OWNER_USER_ID` | Optional | Secure env | Pre-configured owner ID (alternative to bootstrap) |
| `TELEGRAM_ADMIN_USER_IDS` | Optional | Secure env | Comma-separated additional admin user IDs |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Optional | Secure env | Comma-separated chat IDs |
| `TELEGRAM_MODE` | Optional | Secure env | `polling` (default) |
| `JUSTCALL_API_KEY` | **YES** | `secrets/.env` | Already configured |
| `JUSTCALL_API_SECRET` | **YES** | `secrets/.env` | Already configured |
| `GHL_API_TOKEN` | **YES** | `secrets/.env` | Already configured |
| `DEPLOY_REVISION` | Optional | Env or git | Git commit hash |

---

## STARTUP COMMAND

```bash
cd ghl-automations
set TELEGRAM_BOT_TOKEN=8524789360:AAFaD0tUTRm2EZ5YpeZ3J5En25vinNNOeDk
set TELEGRAM_OWNER_USER_ID=<montelli_telegram_user_id>
set TELEGRAM_ADMIN_USER_IDS=<additional_admin_ids>
node bot/kayla-telegram-bot.js
```

Or with all env vars from secrets:

```bash
cd ghl-automations
call ..\secrets\.env
set TELEGRAM_BOT_TOKEN=8524789360:AAFaD0tUTRm2EZ5YpeZ3J5En25vinNNOeDk
set TELEGRAM_OWNER_USER_ID=<montelli_telegram_user_id>
node bot/kayla-telegram-bot.js
```

---

## STARTUP BEHAVIOR

1. Validates `TELEGRAM_BOT_TOKEN` — exits if missing
2. Acquires instance lock (`data/bot.lock`) — exits if another instance is running
3. Calls `getMe` to verify token — exits if invalid
4. Forces kill switch to `PAUSED` if not already paused
5. Begins long-polling loop
6. **Never sends on startup** — no catch-up, no pending action execution

---

## SHUTDOWN

| Method | Behavior |
|---|---|
| `Ctrl+C` (SIGINT) | Graceful: stops polling, releases lock, logs shutdown |
| `kill` (SIGTERM) | Same as SIGINT |
| Process crash | Lock file has 5-minute TTL; next startup clears stale lock |

---

## LOGGING

| Location | Content |
|---|---|
| `ghl-automations/logs/bot.log` | Structured JSON lines: timestamp, level, message, data |
| stdout/stderr | Same JSON lines (console) |

Secrets are redacted: any log key matching `/token|key|secret|password|auth/i` is replaced with `***REDACTED***`.

---

## HEALTH CHECK

Send `/health` to the bot in Telegram. Response includes:

- Process running since (timestamp)
- Deployment revision
- Telegram mode
- Kill switch state
- Active session count
- Pending canary plan count
- Canary send count
- Production writes: 0
- Stage movements: 0
- Journal: writable
- Stage movement: disabled
- Production mode capability

---

## RESTART POLICY

| Event | Action |
|---|---|
| Process crash | Restart immediately |
| Intentional stop | Restart when ready |
| Duplicate instance detected | Exit immediately (lock prevents) |
| After restart | Bot starts in PAUSED. No sends. No catch-up. |

---

## ROLLBACK

To immediately stop all operations:

1. Send `/pause` in Telegram (admin only)
2. Or: edit `data/telegram-outreach-dry-run/kill-switch.json`, set `state` to `PAUSED`
3. Or: stop the bot process

---

## DEPLOYED COMMIT

Record the git commit hash at deployment time:

```bash
git rev-parse HEAD
```

Set as `DEPLOY_REVISION` environment variable for health reporting.

---

## SECURITY NOTES

- Bot token must NOT be in source code. Currently hardcoded in 5 files — move to environment variable.
- `secrets/.env` is gitignored and contains all production credentials.
- The bot only responds to authorized chat IDs (if `TELEGRAM_ALLOWED_CHAT_IDS` is set).
- Unknown users receive no sensitive lead data.
- Only the owner can enable canary mode or approve live sends.
- All API keys and tokens are redacted from logs.

---

*End of Telegram Bot Deployment v1.0*
