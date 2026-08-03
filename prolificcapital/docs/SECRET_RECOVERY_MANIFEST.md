# Secret Recovery Manifest

**Version:** 1.0
**Last updated:** 2026-08-03

## Required Secrets

| Secret | Env Variable | Location | Required |
|---|---|---|---|
| Telegram bot token | OPENCLAW_TELEGRAM_BOT_TOKEN | openclaw.json | Yes |
| GHL API token | GHL_API_TOKEN | secrets/.env | Yes |
| GHL location ID | GHL_LOCATION_ID | openclaw.json | Yes |
| GHL pipeline ID | GHL_PIPELINE_ID | openclaw.json | Yes |
| JustCall API key | JUSTCALL_API_KEY | secrets/.env | Yes |
| JustCall API secret | JUSTCALL_API_SECRET | secrets/.env | Yes |
| JustCall sender | JUSTCALL_FROM_NUMBER | openclaw.json | Yes |
| OpenClaw gateway token | OPENCLAW_GATEWAY_TOKEN | openclaw.json | Yes |
| Ollama API key | OLLAMA_API_KEY | env | No (test-key) |

## Recovery Methods

### Method 1: Same-PC DPAPI

Uses Windows Data Protection API. Only works on the same machine and user account.

Export:
```
powershell -ExecutionPolicy Bypass -File ops\export-encrypted-secrets.ps1 -Method DPAPI
```

Import:
```
powershell -ExecutionPolicy Bypass -File ops\import-encrypted-secrets.ps1 -Method DPAPI -Source <path>
```

### Method 2: Portable Password-Encrypted

Uses AES-256 with a user-supplied password. Works across machines.

Export:
```
powershell -ExecutionPolicy Bypass -File ops\export-encrypted-secrets.ps1 -Method Password
```

Import:
```
powershell -ExecutionPolicy Bypass -File ops\import-encrypted-secrets.ps1 -Method Password -Source <path>
```

## Missing Secret Detection

The import script reports which secrets are present and which are missing. A missing-secret report is generated as JSON.

## Security Rules

- Never commit secrets to Git
- Never log secret values
- Never display secrets in Telegram
- Never include secrets in unencrypted backups
- Rotate credentials if a backup bundle is lost
- Store password-encrypted bundles separately from the password
