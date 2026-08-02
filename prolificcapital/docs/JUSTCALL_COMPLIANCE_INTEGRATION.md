# JustCall Compliance Integration

**Status:** CONNECTED_AND_VERIFIED (read-only)
**API Version:** v2.1
**Auth:** HTTP Basic (api_key:api_secret)
**Base URL:** `https://api.justcall.io/v2.1/`

## Capability Audit

| Capability | Endpoint | Status | Notes |
|-----------|----------|--------|-------|
| Users/agents | GET /v2.1/users | CONNECTED_AND_VERIFIED | 2 users: Montelli Scott (Admin), Kayla Mauser (Owner) |
| Phone numbers | GET /v2.1/phone-numbers | CONNECTED_AND_VERIFIED | 2 numbers: (571) 601-2619 (Montelli), (904) 447-2520 (Kayla) |
| SMS capability | phone-numbers.capabilities | CONNECTED_AND_VERIFIED | Both numbers: SMS=Yes, MMS=Yes, Call=Yes |
| 10DLC compliance | phone-numbers.sms_compliance | CONNECTED_AND_VERIFIED | Both numbers: Verified |
| Business registration | phone-numbers.business_registration | CONNECTED_AND_VERIFIED | Both numbers: Approved |
| Blacklist | GET /v2.1/contacts/blacklist | CONNECTED_AND_VERIFIED | 0 entries (empty) |
| Contact status | GET /v2.1/contacts | CONNECTED_AND_VERIFIED | Returns blacklist/dnd/dnm per contact |
| Text history | GET /v2.1/texts | CONNECTED_AND_VERIFIED | 18 total texts, supports direction filter, pagination |
| Text detail | GET /v2.1/texts/{id} | CONNECTED_AND_VERIFIED | Returns delivery_status, sms_info, direction |
| Call history | GET /v2.1/calls | CONNECTED_AND_VERIFIED | 1 call, supports AI data fetch |
| AI coaching | GET /v2.1/call-ai-data/get/{id} | CONNECTED_AND_VERIFIED | Call score, sentiment, summary, transcript |
| Webhooks | GET /v2.1/webhooks | CONNECTED_PARTIAL | 0 webhooks registered |
| Account/billing | GET /v2.1/account | API_NOT_SUPPORTED | 404 |
| Credits/funding | GET /v2.1/credits | API_NOT_SUPPORTED | 404 |
| Plan tier | GET /v2.1/plan | API_NOT_SUPPORTED | 404 |
| Opt-out list | GET /v2.1/opt-out | API_NOT_SUPPORTED | 404 |
| Suppression list | GET /v2.1/suppression | API_NOT_SUPPORTED | 404 |

## Sender Verification

- **571-601-2619 (Montelli):** SMS=Yes, MMS=Yes, Call=Yes, 10DLC=Verified, Business=Approved, Status=Available
- **904-447-2520 (Kayla):** SMS=Yes, MMS=Yes, Call=Yes, 10DLC=Verified, Business=Approved, Status=Available

## Text History Summary

- 18 total texts (all outgoing)
- All from 571-601-2619 to 571-814-0891 (owner's phone)
- Last text: 2026-07-19
- No inbound replies
- No blacklisted contacts
- No webhooks registered

## Funding/Account Readiness

- **API_NOT_SUPPORTED:** JustCall v2.1 does not expose account credit, plan, or billing endpoints
- **Alternative evidence:** Both phone numbers show `sms_compliance: Verified`, `business_registration: Approved`, `current_status: Available`
- **Pre-send verification:** Owner must confirm account is on a paid plan with SMS credits before production canary

## Integration Modules

- `justcall-suppression-read-service.js` — Blacklist + contact status lookup
- `justcall-text-history-read-service.js` — Text history with direction/delivery filtering
- `justcall-integration.js` — Existing SMS send + AI coaching (unchanged)
