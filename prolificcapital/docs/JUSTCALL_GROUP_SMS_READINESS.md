# JustCall Group SMS Readiness

**Status:** ACTIVE_MANUAL_ONLY
**Verified:** 2026-08-03

## API Probe Results

| Endpoint | Status | Notes |
|----------|--------|-------|
| /v2.1/group-sms | 404 | No REST API endpoint for group SMS |
| /v2.1/group-texts | 404 | No REST API endpoint |
| /v2.1/groups | 404 | No REST API endpoint |
| /v2.1/group-conversations | 404 | No REST API endpoint |
| /v2.1/addons | 404 | No addon visibility via API |
| /v2.1/features | 404 | No feature visibility via API |

## Account State

- **Users:** Montelli Scott (Admin, id 508588), Kayla Mauser (Owner, id 506515)
- **Phone numbers:** 571-601-2619 (Montelli), 904-447-2520 (Kayla)
- **Both numbers:** SMS=Yes, MMS=Yes, 10DLC=Verified, Business=Approved
- **Group SMS:** Owner reports enabled in JustCall dashboard. Not verifiable via API.

## Capability Assessment

| Capability | Status | Evidence |
|-----------|--------|----------|
| Group SMS add-on | ACTIVE (owner-reported) | Owner confirmed activation. API does not expose addon state. |
| API access | NOT_SUPPORTED | No v2.1 REST endpoints for group SMS. |
| JustCall web app | LIKELY_SUPPORTED | Standard JustCall feature. Not tested. |
| JustCall mobile app | LIKELY_SUPPORTED | Standard JustCall feature. Not tested. |
| Montelli participation | SUPPORTED | User 508588, number 571-601-2619. |
| Kayla participation | SUPPORTED | User 506515, number 904-447-2520. |
| External contact + Montelli + Kayla | LIKELY_SUPPORTED | Standard group SMS topology. |
| External contact + Montelli + Jaxon | UNKNOWN | Jaxon not a JustCall user. Would require Jaxon's personal number. |
| Group creation via API | NOT_SUPPORTED | No API endpoint. |
| Group creation via app | LIKELY_SUPPORTED | Standard JustCall feature. |
| One-to-one to group conversion | UNKNOWN | Not tested. |
| Participant limits | UNKNOWN | JustCall docs not consulted for limits. |
| MMS/media in groups | UNKNOWN | Both numbers support MMS. Group MMS not tested. |
| Reply visibility | LIKELY_SUPPORTED | Standard group SMS behavior. |
| Delivery/read status | UNKNOWN | Not tested. |
| Group thread history | UNKNOWN | Not tested via API. |
| STOP/opt-out in group | UNKNOWN | Not tested. |
| Billing/cost | UNKNOWN | API does not expose billing. |

## Classification

**ACTIVE_MANUAL_ONLY** — Group SMS is enabled in the JustCall dashboard but has no REST API support. All group operations (creation, messaging, participant management) must be performed through the JustCall web or mobile app. The system cannot automate group creation or messaging.

## Impact on Pipeline

- **GCJ text shortcut:** Can be sent as a one-to-one SMS from 571-601-2619. This is NOT a group conversation — it is a text announcing that a group will be created.
- **Group creation:** Must be performed manually by the operator in the JustCall app after sending the GCJ text.
- **Group handoff:** Cannot be automated. The system can only produce a manual-app checklist.
- **INT canary:** Not affected. Group SMS is not part of the initial INT canary.
