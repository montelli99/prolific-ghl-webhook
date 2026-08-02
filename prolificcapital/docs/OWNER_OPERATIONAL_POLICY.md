# Owner Operational Policy — Prolific Capital GHL Pipeline

**Policy ID:** OP-2026-08-02-v1
**Version:** 1.0.0
**Effective:** 2026-08-02 16:00 UTC
**Owner:** Montelli Scott (718718959)
**Scope:** Kayla/Montelli GHL Pipeline REI Operations

---

## Source Precedence

1. LAW / COMPLIANCE / PROVIDER OPT-OUT STATE
2. CURRENT OWNER_OPERATIONAL_POLICY
3. KAYLA_CANONICAL_OPERATING_SYSTEM
4. VERIFIED ORIGINAL COURSE TRANSCRIPTS AND SHORTCUTS
5. CURRENT LIVE GHL / JUSTCALL STATE
6. ACCEPTED IMPLEMENTATION CONTRACTS
7. TECHNICAL DEFAULTS
8. DERIVED OR HISTORICAL DOCUMENTS

Technical defaults may not override owner policy. Derived artifacts may not silently override original course evidence. Unknown state must never be converted into permission.

---

## Outreach Days

**Rule:** No prospect outreach on Saturday or Sunday.
**Enforcement:** HARD_REQUIRED — no override, no bypass, no MANUAL_LIVE_ALLOWED exception.
**Source:** OWNER_POLICY
**Classification:** Monday–Friday availability and Saturday/Sunday prohibition are OWNER_POLICY. No original course transcript explicitly defines prospect SMS days. The existing weekend-block implementation is TECHNICAL_DEFAULT aligned to OWNER_POLICY.

## Outreach Hours

**Rule:** Prospect SMS window is Monday through Friday, 12:00 PM through 6:00 PM.
**Enforcement:** HARD_REQUIRED — no override, no bypass.
**Source:** OWNER_POLICY
**Supersedes:** 10:00 AM technical default in `evaluateCanaryWindow`

### End-Boundary Semantics

- 12:00:00 PM is allowed.
- 5:59:59 PM is allowed.
- 6:00:00 PM and later is blocked.

## Timezone Policy

**Status:** RESOLVED — PROPERTY_LOCAL_TIMEZONE
**Rule:** The 12:00 PM–6:00 PM window uses the property's local timezone derived from the full property address ZIP code.
**Source:** OWNER_POLICY
**Implementation:** Full 5-digit ZIP → timezone mapping with ZIP3-level precision. Multi-zone states (FL, IN, KY, MI, TN, TX, KS, NE, ND, SD, ID, OR, NV) use ZIP3-level resolution. Unknown or ambiguous timezone blocks production.
**Day rendering:** `[day]` in the INT template is rendered using the same property-local timezone that controls the send window.

## Weekend Override

**Rule:** Weekend sending has no ad-hoc conversational override. No MANUAL_LIVE_ALLOWED bypass. No kill-switch state bypass.
**Enforcement:** HARD_REQUIRED

## Plan Expiration

**Rule:** A canary plan expires on the earliest of:
- Configured absolute TTL (30 minutes)
- End of its valid business window (6:00:00 PM local)
- Change of local day when `[day]` is rendered
- Policy version change
- Template version change
- Opportunity/contact change
- Stage/status change
- New inbound reply
- Suppression/opt-out change
- Prior-outreach change
- Sender/provider readiness change
- Selection mutation

A Sunday plan cannot be held for Monday. A Monday plan must be created from fresh live state during or immediately before the valid Monday window. Every regeneration requires a new plan ID, new hash, fresh rendered weekday, fresh guards, and new explicit approval.

**Enforcement:** HARD_REQUIRED

## INT Template

**Production template (OWNER_APPROVED_PIPELINE_INT):**
> Happy [day], [Name]! Are you still accepting offers for [address]? My name is [your name], I'm looking to purchase this as a rental for my portfolio.

**Course canonical (COURSE_CANONICAL_INT — preserved for audit):**
> [Name], are you still accepting offers for [address]? My name is [your name], I'm looking to purchase this as a rental for my portfolio.

**Provenance:** OWNER_APPROVED_PIPELINE_INT is an explicitly approved project variant derived from the owner's operating preference. It combines the "Happy [day]" greeting from the SELLER_INITIAL call script (AIREI_MASTER_PLAYBOOK.md line 157) with the INT shortcut body. It is not Kayla's original SMS wording. The original course INT (COURSE_CANONICAL_INT) has no greeting and is preserved separately for audit.

## Sender Lock

**Rule:** Approved Pipeline sender is the 571 number ending 2619.
**Enforcement:** HARD_REQUIRED

## Canary Limit

**Rule:** Maximum initial production canary size is 3 records.
**Enforcement:** HARD_REQUIRED

## Approval

**Rule:** Every production send requires an immutable plan and explicit owner approval.
**Enforcement:** HARD_REQUIRED

## Compliance Guards

All compliance guards are HARD_REQUIRED. Unknown state must block, not pass. Absence of a GHL tag is not affirmative clearance.

| Guard | Sources | Unknown Behavior |
|-------|---------|-----------------|
| DNC | GHL tags, JustCall suppression, local registry | BLOCK |
| STOP/Opt-out | GHL tags, JustCall opt-out, local registry | BLOCK |
| Wrong number | GHL tags, prior message outcome | BLOCK |
| Pending reply | GHL conversation metadata, JustCall inbound, local journal | BLOCK |
| Active human work | Owner/session state, notes/tasks, operator-lock registry | BLOCK |
| Prior outreach | GHL journal, JustCall history, execution journal | BLOCK |
| Duplicate | In-plan check, historical journal, provider history | BLOCK |
| Contact path | Stage 1 transaction, role classification | BLOCK |
| Provider uncertainty | JustCall readiness probe | BLOCK |

### Compliance State Values

Each guard must return one of: `CLEAR`, `BLOCKED`, or `UNKNOWN`. `UNKNOWN` always blocks. `CLEAR` requires positive evidence from at least one trusted source. `WRONG_NUMBER` additionally supports `NOT_APPLICABLE_NO_PRIOR_CONTACT`.

### Source Precedence for Compliance

1. Explicit STOP/opt-out/DNC from any trusted source blocks.
2. Conflicting trusted sources block.
3. Missing required source blocks.
4. Absence of a tag is not affirmative clearance.

## Retry Policy

**Rule:** No automatic retries after an uncertain provider result.
**Enforcement:** HARD_REQUIRED

## GHL Writes

**Rule:** No automatic GHL note, task, field, workflow, or contact write during the initial SMS canary.
**Enforcement:** HARD_REQUIRED

## Stage Movement

**Rule:** No automatic GHL stage movement during the initial SMS canary.
**Enforcement:** HARD_REQUIRED

## Project Isolation

**Rule:** Divinity CRM is a separate project and must never influence this Pipeline.
**Enforcement:** HARD_REQUIRED
