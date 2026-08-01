# CONTROLLED PRODUCTION CANARY

**Version:** 1.0
**Created:** 2026-08-01
**Bot:** Kayla Pipeline Operator Bot
**Status:** AWAITING_OWNER_APPROVAL

---

## CANARY SCOPE

| Parameter | Limit |
|---|---|
| Maximum sends | 3 |
| Sender | +*******2619 (locked) |
| Message type | INT (initial contact text) only |
| Recipients | 3 distinct contacts, 3 distinct properties |
| Execution | Sequential, one at a time |
| Retries | None — uncertain results are NOT retried |
| Stage movement | Disabled |
| GHL writes | Disabled |
| Follow-up automation | Disabled |

---

## PRE-SEND VALIDATION GATES

Every canary item must pass ALL of these before sending:

1. Real GHL opportunity ID (validates against `^[A-Za-z0-9_-]{8,80}$`)
2. Real contact ID
3. Correct pipeline (`nSf3NXYVkt8X4PgW9aZ3`)
4. Correct stage (Lead Entered: `7067148a-2ee8-4e5b-93c8-31e0253fea68`)
5. Correct course contact path (LISTING_AGENT, DIRECT_SELLER, FSBO, PPC, BROKER)
6. Exact Kayla first-contact script (INT)
7. Valid property context (address, fingerprint)
8. Distinct contacts (no duplicates in batch)
9. Distinct properties (no duplicates in batch)
10. No DNC
11. No STOP/opt-out
12. No wrong-number evidence
13. No pending reply
14. No active human work
15. No uncertain prior send
16. No duplicate action ID
17. Known property timezone
18. Within approved local send window (10:00-18:00, no weekends)
19. Verified sender ending 2619
20. Provider authentication fresh
21. 10DLC approved
22. Immutable plan journal writable

---

## CANARY EXECUTION FLOW

1. Owner sends `/outreach` to load leads
2. Bot displays canary candidates with all validation results
3. Owner reviews and selects specific items
4. Owner sends approval (e.g., "send 1 and 3")
5. Bot switches to `CANARY_ALLOWED`
6. For each selected item:
   a. Re-read contact from GHL
   b. Re-read opportunity from GHL
   c. Re-read restriction state (DNC, STOP, etc.)
   d. Revalidate contact path and script
   e. Revalidate sender
   f. Verify local time window
   g. Verify action ID unused
   h. Journal pre-send entry
   i. Call JustCall API once
   j. Classify result (ACCEPTED, REJECTED, UNCERTAIN)
   k. Capture provider message ID
   l. Report result to Telegram
7. After all items: bot returns to `PAUSED`
8. Reconciliation report displayed

---

## STOP CONDITIONS

| Condition | Action |
|---|---|
| Any SMS sent to wrong number | Immediate PAUSED, investigate |
| Any GHL write detected | Immediate PAUSED, investigate |
| Provider authentication failure | Immediate PAUSED, do not retry |
| Uncertain provider result | Mark UNCERTAIN, continue to next item, do NOT retry |
| Fourth send attempted | Blocked by canary limit |
| Owner cancels | PAUSED immediately |

---

## RECONCILIATION CHECKLIST

After canary completion, verify:

- [ ] Planned items = selected items = attempted items
- [ ] Provider message IDs captured for all sent items
- [ ] No unapproved sends
- [ ] No duplicate sends
- [ ] No fourth send
- [ ] Correct sender (2619) on all sends
- [ ] Correct contact on all sends
- [ ] Correct property context on all sends
- [ ] No production GHL writes
- [ ] No stage movements
- [ ] No calls
- [ ] No emails
- [ ] No follow-up automation triggered
- [ ] Journal complete and consistent
- [ ] Kill switch returned to PAUSED

---

## POST-CANARY

### If canary passes (all 3 sends confirmed, reconciliation clean):

Do NOT immediately enable unrestricted live mode.

Set `MANUAL_LIVE_ALLOWED` only if these operating limits are configured:
- Exact Telegram-selected records only
- Maximum 10 sends per plan
- Maximum 15 new initial messages per day
- One message per contact per day
- Approved local send window (10:00-18:00)
- No weekends initially
- No automatic follow-ups
- No unattended cron
- No background catch-up
- No automatic retries
- No automatic stage movement

### If canary fails:

Remain PAUSED. Do not weaken guards. Repair only the proven defect.

---

*End of Controlled Production Canary v1.0*
