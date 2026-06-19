# Feature Requests

Capabilities requested by the user.

---

## [FR-20260611-001] GHL token â†’ env vars

**Logged**: 2026-06-11T15:05:00Z
**Priority**: high
**Source**: self-audit

### Summary
Move GHL_API_KEY and GHL_LOCATION_ID from hardcoded values in source files to environment variables or .env file.

### Why
Token `pit-b8e79120-be2e-46c9-9615-336385d15315` is hardcoded in `_test_api.js` and likely `ghl-integration.js`. PIT tokens have full CRM access. Security hygiene requires env vars.

### Scope
- All test files in ghl-automations/modules/_test_*.js
- ghl-integration.js
- Any other files with hardcoded token

---

## [FR-20260611-002] Fix JV inbox cron delivery

**Logged**: 2026-06-11T15:05:00Z
**Priority**: critical
**Source**: cron audit

### Summary
Fix the broken cron job that checks AgentMail for JV deal submissions â€” missing delivery.to target.

---

## [FR-20260611-003] Create followup-alert cron

**Logged**: 2026-06-11T15:05:00Z
**Priority**: high
**Source**: self-audit

### Summary
Wire `followup-alert.js` to a cron job (every 30min, 9am-9pm ET). Module is built and tested (17/17 pass), just needs scheduling.

---

## [FR-20260611-004] Create pipeline-dashboard cron

**Logged**: 2026-06-11T15:05:00Z
**Priority**: high
**Source**: self-audit

### Summary
Wire `pipeline-dashboard.js` to a cron job (9am Mon-Sat). Module is built and tested (19/19 pass), just needs scheduling.

---

## [FR-20260611-005] Extend modules to read Kayla's pipeline

**Logged**: 2026-06-11T15:05:00Z
**Priority**: medium
**Source**: live API audit

### Summary
All 50 active opps are in Kayla's pipeline. Read-only modules (followup-alert, pipeline-dashboard) should be extended to also monitor Kayla's pipeline. Current safety rules block all writes to Kayla's pipeline (correctly), but reads are safe.

## [FEAT-20260619-001] env_var_validation

**Logged**: 2026-06-19T07:46:00Z
**Priority**: medium
**Status**: pending
**Area**: infra

### Requested Capability
Startup-time validation that compares SECRETS.env values vs backend/.env vs frontend/.env and warns on mismatches.

### User Context
User gave me real RabbitSign key in SECRETS.env but I had overwritten it with an AgentMail token in backend/.env. Cost ~30 minutes of debugging "Invalid x-rabbitsign-api-signature" errors that were really just wrong-key-in-wrong-file errors.

### Complexity Estimate
simple

### Suggested Implementation
Add ackend/src/scripts/validate-env.js that:
1. Reads SECRETS.env (source of truth)
2. Reads backend/.env, frontend/.env (runtime)
3. Compares shared keys (RABBITSIGN_API_KEY, NEON_DATABASE_URL, CLERK_*, etc.)
4. Logs warnings on mismatch before backend startup

Add to render build command: 
ode src/scripts/validate-env.js && node src/index.js

### Metadata
- Frequency: first_time
- Related Features: env management
- Tags: env-validation, debugging, prevention

---

## [FEAT-20260619-002] teleprompter_project

**Logged**: 2026-06-19T07:46:00Z
**Priority**: low
**Status**: pending
**Area**: frontend

### Requested Capability
Separate teleprompter project (per session memory).

### User Context
User mentioned building a separate teleprompter project as a follow-up to CRM. No specific spec yet — need to ask about: target user (Montelli alone or all 30 students?), platform (web/mobile/desktop?), content source (script prompts from CRM or manual paste?).

### Complexity Estimate
medium-to-complex

### Suggested Implementation
TBD — ask user for spec.

### Metadata
- Frequency: first_time
- Tags: teleprompter, follow-up-project

---

## [FEAT-20260619-003] ui_polish_dashboard

**Logged**: 2026-06-19T07:46:00Z
**Priority**: low
**Status**: pending
**Area**: frontend

### Requested Capability
Production-quality UI polish on dashboard/lead-detail pages.

### User Context
User wants "production-quality UI." Current state: functional but unstyled in places.

### Complexity Estimate
medium

### Suggested Implementation
- Add loading skeletons to all data-fetching pages
- Improve empty states (no leads, no notifications, etc.)
- Better error boundaries
- Consistent spacing/typography via Tailwind tokens
- Mobile responsive testing

### Metadata
- Frequency: first_time
- Tags: ui, design, polish
