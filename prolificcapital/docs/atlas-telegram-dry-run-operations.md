# Atlas Telegram Dry-Run Operations

Generated: 2026-07-31

This document describes the dry-run-only Telegram operating layer for the Atlas Kayla pipeline. It implements the governing process in `docs/atlas-kayla-course-parity-spec.md` without sending SMS, placing calls, moving opportunities, editing workflows, creating tasks, creating notes, tagging contacts, or enrolling contacts.

## Safety State

| Counter | Value |
| --- | --- |
| Live sends | `0` |
| Production writes | `0` |
| Stage movements | `0` |
| Workflow modifications | `0` |
| Initial kill-switch state | `DRY_RUN_ONLY` |
| Live mode | Unavailable in this build |

## Telegram Commands

Use `/outreach <request>` or `/kayla <request>`. Natural-language messages that match the supported examples also route to outreach.

Examples:

| Request | Intent |
| --- | --- |
| `show me what Kayla says I should work today` | Show due Kayla work. |
| `show untouched leads` | Build initial-contact dry-run plan. |
| `show me 10 agents` | Build agent-filtered initial-contact plan. |
| `show me five owners Kayla says are due` | Build owner-filtered initial-contact plan. |
| `who should I call now` | Show call-oriented due work. |
| `show text-due leads` | Show text-oriented due work. |
| `show follow-ups due` | Show follow-up work. |
| `preview the first 5` | Preview first five records in the active plan. |
| `hold 3` | Hold item 3 in the active plan. |
| `skip 2 and 7` | Skip items 2 and 7. |
| `restore 2` | Restore item 2. |
| `select 1, 4, and 6` | Select non-contiguous items. |
| `select 1-5` | Select a range. |
| `select all` | Select all currently available items. |
| `why is number 4 due` | Explain the Kayla rule for item 4. |
| `show Kayla's shortcut for 4` | Show the exact rendered shortcut. |
| `approve these for dry run` | Approve and simulate selected actions. |
| `cancel` | Cancel the active plan. |
| `pause outreach` | Set kill switch to `PAUSED`. |
| `resume dry run` | Set kill switch to `DRY_RUN_ONLY`. |
| `what would move to Contact Made` | Show simulated stage results and workflow risk. |

Ambiguous commands return one concise clarification and do not create a plan.

## Session Flow

1. The operator asks for Kayla work or a role-filtered list.
2. Atlas loads the Kayla course model from the parity spec.
3. Atlas evaluates candidate contact-property contexts.
4. Atlas creates an immutable numbered plan with a plan hash.
5. The operator previews, holds, skips, restores, or selects items.
6. An approver approves the dry-run plan.
7. The executor simulates provider acceptance, GHL conversation result, and stage result.
8. A local journal records simulation events only.

Session states:

`DRAFT`, `PLANNED`, `PREVIEWED`, `PARTIALLY_SELECTED`, `APPROVED_DRY_RUN`, `SIMULATED_EXECUTING`, `SIMULATED_COMPLETE`, `CANCELED`, `EXPIRED`, `BLOCKED`.

Active sessions persist under `ghl-automations/data/telegram-outreach-dry-run/` unless `ATLAS_TELEGRAM_DRY_RUN_DIR` points elsewhere. Restarted bots can identify prior sessions by session ID and immutable plan hash.

## Kayla Rules

The dry-run layer uses one canonical loader, `ghl-automations/modules/kayla-course-spec.js`, and does not duplicate process rules in Telegram handlers.

Key rules enforced:

| Rule | Behavior |
| --- | --- |
| INT before call | Stage 1 initial contact previews `INT` and marks call as next step. |
| Two calls before no-answer | No-answer action remains a course rule; dry run does not place calls. |
| CCC after every call | Contact Made uses `CCC` as the post-call shortcut. |
| Realignment language | Follow-up logic uses Kayla realignment/clarification language. |
| Montelli relays | Negotiation and contract actions are recommendation/relay only. |
| 48-hour offer feedback | Offer feedback is modeled but not auto-sent. |

If the parity spec preserves a conflict, the model records `COURSE_RULE_CONFLICT` and prevents live executability.

## Eligibility

Eligibility returns explicit classes such as:

`ELIGIBLE_INITIAL_TEXT`, `ELIGIBLE_OFFER_FEEDBACK`, `ELIGIBLE_NEGOTIATION_ACTION`, `NOT_DUE`, `BLOCKED_DNC`, `BLOCKED_WRONG_NUMBER`, `BLOCKED_PRIOR_OUTREACH_UNCERTAIN`, `BLOCKED_PENDING_REPLY`, `BLOCKED_ACTIVE_HUMAN_WORK`, `BLOCKED_MULTI_PROPERTY_CONTEXT`, `BLOCKED_MISSING_SCRIPT`, and `BLOCKED_MISSING_PROPERTY_CONTEXT`.

Every eligible result includes a Kayla rule citation from the parity spec. Generic real-estate assumptions are not used.

## Role Filters

Supported role filters:

`agents`, `owners`, `brokers`, `investors`, `unknown`, `all`.

Role classification returns role, confidence, evidence, and status (`confirmed`, `inferred`, or `unknown`). If a role-specific Kayla script is required and the role is unknown, the action blocks with `BLOCKED_ROLE_UNCERTAIN`.

## Multi-Property Handling

The dry-run engine uses layered locks:

`CONTACT_COMPLIANCE_LOCK`, `PROPERTY_ACTIVITY_LOCK`, `CONVERSATION_CONTEXT_LOCK`, `TEAM_OWNERSHIP_LOCK`.

It does not blanket-block contacts with multiple properties. For conservative launch simulation, only one planned message per contact per dry-run plan is allowed unless a later approved policy expands that behavior.

## Template Registry

The registry lives in `ghl-automations/modules/kayla-template-registry.js` and classifies Kayla shortcuts as `APPROVED_BY_COURSE`.

Each template includes shortcut name, audience, stage, action type, body, variables, required context, source, status, allowed channel, call-before/after rule, follow-up interval, and manual review requirement.

Missing or conflicting scripts block the affected lead/action.

## Dry-Run Executor

The executor performs simulation only:

1. Verifies approved plan state.
2. Verifies Telegram authorization.
3. Verifies session expiration.
4. Verifies kill-switch state.
5. Uses the immutable plan hash.
6. Generates durable action IDs.
7. Simulates provider acceptance.
8. Simulates GHL conversation result.
9. Simulates stage result.
10. Writes a local journal.

Journal event labels distinguish `SIMULATED_SEND`, `SIMULATED_PROVIDER_ACCEPTED`, and `SIMULATED_STAGE_MOVE`.

## Stage Results

Initial contact can propose `Contact Made` only as a simulated expected result. Because `[Montelli] Stage Change -> Webhook` is published and broad, live stage movement remains blocked with `BLOCKED_WORKFLOW_SIDE_EFFECT_RISK` until workflow side effects are explicitly closed out.

## Kill Switch

Supported states:

`PAUSED`, `DRY_RUN_ONLY`, `LIVE_ALLOWED`.

Initial state is `DRY_RUN_ONLY`. `LIVE_ALLOWED` cannot be entered in this build. A later code/config change plus verified provider credentials is required before any live mode can exist.

## Permissions

Environment variables:

| Role | Variables |
| --- | --- |
| Viewer | `ATLAS_TELEGRAM_VIEWER_IDS` |
| Reviewer | `ATLAS_TELEGRAM_REVIEWER_IDS`, `PIPELINE_TELEGRAM_REVIEWER_IDS` |
| Approver | `ATLAS_TELEGRAM_APPROVER_IDS` |
| Admin | `ATLAS_TELEGRAM_ADMIN_IDS`, `PIPELINE_TELEGRAM_ADMIN_IDS` |

Permissions:

| Role | Allowed |
| --- | --- |
| Viewer | View plans and status. |
| Reviewer | Hold, skip, restore, and comment-equivalent local review actions. |
| Approver | Approve dry-run plans. |
| Admin | Pause and resume dry run. |

No role can send live messages.

## Offline Behavior

If OpenClaw is offline, no Telegram commands are processed. Existing sessions remain on disk. When OpenClaw returns, sessions can be inspected by hash and state. Expired sessions cannot execute. Ambiguous partial state must be treated as `BLOCKED`, not guessed.

## Live Blockers

| Blocker | Classification |
| --- | --- |
| Fresh JustCall credentials unavailable in current shell. | `BLOCKS_CANARY` |
| Exact 2619 sender must be re-verified immediately before canary. | `BLOCKS_CANARY` |
| Broad GHL stage-change workflow creates side-effect risk for Contact Made movement. | `BLOCKS_CANARY` |
| STOP/HELP and DNC persistence/readback path not proven. | `BLOCKS_CANARY` |
| Provider throughput and quiet-hours behavior not fully observable. | `BLOCKS_SCALE_ONLY` |

## Rehearsal

Run:

```bash
node ghl-automations/tools/atlas-telegram-dry-run-rehearsal.js
```

The rehearsal writes hashed artifacts under `lead-tracking/atlas-deals/audits/` and reports zero sends, zero writes, zero stage movements, and zero workflow modifications.
