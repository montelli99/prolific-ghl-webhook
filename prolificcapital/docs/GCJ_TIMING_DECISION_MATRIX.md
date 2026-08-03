# GCJ Timing Decision Matrix

**Policy:** OP-2026-08-02-v1
**Closer:** Kayla Mauser (Montelli's pipeline per June 1, 2026 decision)

## Path-Specific Triggers

| Path | Trigger | Preconditions | Closer | Message | Offer Exists | LOI Exists | Hot Lead | Montelli Steps Back |
|------|---------|--------------|--------|---------|-------------|-----------|----------|-------------------|
| STANDARD_LISTING_AGENT | Stage 4 (Offer Sent) | Offer sent, seller confirms receipt | Kayla | GCJ text | Yes | Yes | No | After group creation |
| DIRECT_SELLER | Stage 4 (Offer Sent) | Offer sent, seller confirms receipt | Kayla | GCJ text | Yes | Yes | No | After group creation |
| PPC | Stage 4 (Offer Sent) | Offer sent via PPC flow | Kayla | PGC text | Yes | Yes | No | After group creation |
| HOT_LEAD | Immediate | Seller engaged, countering, other buyers | Kayla | GCJ text | No | No | Yes | Immediately after GCJ + email |
| OTHER | Operator judgment | Per course evidence | Kayla | GCJ text | Varies | Varies | Varies | Per path |

## Course Sources

| Source | Timing | Classification |
|--------|--------|---------------|
| Master Playbook Step 8 | Stage 2 (after deal evaluation) | COURSE_EXPLICIT |
| TRACK_STUDENT | Stage 4 (after offer sent, seller confirms receipt) | COURSE_EXPLICIT |
| TRACK_MONTELLI | Stage 4 (offer sent) | COURSE_EXPLICIT |
| Hot Lead Protocol | Immediate on hot lead | COURSE_EXPLICIT |
| Canonical OS Section 14.3 | Path-specific, not stage-specific | COURSE_CONFLICT |

## Resolution

The Canonical OS classifies GCJ timing as `COURSE_CONFLICT` because sources disagree. The most common implementation (TRACK_STUDENT, TRACK_MONTELLI) places it at Stage 4. The hot-lead path is a separate immediate trigger. The system preserves path-specific triggers and does not invent a universal rule.

## Required Participants

| Participant | Role | JustCall Status |
|------------|------|-----------------|
| Montelli Scott | Operator, creates group, sends GCJ, stays warm | User 508588, 571-601-2619 |
| Kayla Mauser | Closer, presents offer | User 506515, 904-447-2520 |
| Seller/Agent | External contact | Phone from GHL |

Seth (LOI) and Jaxon (not Montelli's closer) are not group participants.

## Group Handoff Checklist

1. Open the external contact conversation in JustCall.
2. Create a new Group SMS.
3. Add Kayla Mauser (904-447-2520) as internal closer.
4. Confirm external seller/listing-agent phone.
5. Verify all three participants before sending.
6. Send the approved GCJ introduction message.
7. Record group/thread identifier or screenshot evidence.
8. Confirm Kayla is visibly present.
9. Confirm external contact is present.
10. Mark GROUP_HANDOFF_CREATED only after evidence.
11. Mark GROUP_HANDOFF_CONFIRMED after first successful message verification.
12. Montelli steps back from active negotiation but stays warm every 3-5 days.
