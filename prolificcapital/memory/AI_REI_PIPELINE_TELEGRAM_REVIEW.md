# AI REI Pipeline Telegram Review

## Discovered Telegram Architecture

- Command router: `ghl-automations/modules/telegram-command-router.js`.
- Router contract: returns `{ reply, postToTopicId? }`; the OpenClaw layer sends Telegram messages.
- Direct send helpers exist in `ghl-automations/modules/pipeline-dashboard.js` and `ghl-automations/modules/followup-alert.js` for scheduled notifications.
- Message formatting convention is Markdown text with concise summaries.
- No local callback-query framework or inline keyboard helper existed in this repo, so Pipeline review returns `replyMarkup` payloads for the OpenClaw bot layer to send.

## OpenClaw Runtime Integration

- Bridge: `C:\Users\mscott\AI_Workspace\OpenClaw\src\telegram\pipeline-review-bridge.ts`.
- Native command registration: `C:\Users\mscott\AI_Workspace\OpenClaw\src\telegram\bot-native-commands.ts` registers `/pipeline` through the existing authenticated Telegram command path.
- Callback dispatch: `C:\Users\mscott\AI_Workspace\OpenClaw\src\telegram\bot-handlers.ts` routes only `pl:` callback data to the Pipeline bridge before the existing command/model callback handlers.
- Bridge root resolution: `PIPELINE_REVIEW_ROOT`, or default `..\prolificcapital\ghl-automations` relative to the OpenClaw process working directory.
- OpenClaw test coverage: `pnpm test src/telegram/pipeline-review-bridge.test.ts` passed with `6/6` tests.
- Full OpenClaw `pnpm tsgo --noEmit --pretty false` currently has unrelated pre-existing failures outside this Pipeline bridge; no remaining Pipeline bridge error was present after the `reply_markup` type fix.
- Runtime registration note: `/pipeline` is registered independently of the broader native command menu flag, because this environment has general native commands disabled.
- Callback behavior: OpenClaw answers `pl:` callback queries before dispatching to the review bridge so Telegram buttons do not spin while the review module edits the message.
- Gateway runtime note: the scheduled task wrapper currently points at a missing WinGet Node path. The validated runtime used `C:\Program Files\nodejs\node.exe` with `scripts/run-node.mjs gateway --port 18789` and inherited user-level Pipeline env vars explicitly.
- Destination routing: `/pipeline` review output is posted to AI REI Pipeline topic `389` in group `-1003975794600` by default. Topic `1677` is GHL Automations, not Pipeline. Bot DMs are treated as command sources, not the review-output destination.
- Destination overrides: set `PIPELINE_REVIEW_TELEGRAM_CHAT_ID` and `PIPELINE_REVIEW_TELEGRAM_TOPIC_ID` to change the target, or set `PIPELINE_REVIEW_TELEGRAM_DESTINATION=source` only for local/source-chat debugging.
- Production destination config: `PIPELINE_REVIEW_TELEGRAM_CHAT_ID`, `PIPELINE_REVIEW_TELEGRAM_TOPIC_ID`, and `PIPELINE_REVIEW_TELEGRAM_DESTINATION=pipeline` must be present. The resolver fails closed if either value is missing, malformed, points outside the AI REI Pipeline topic, or points at GHL Automations topic `1677`.
- Source debugging restriction: `PIPELINE_REVIEW_TELEGRAM_DESTINATION=source` is rejected in production unless `PIPELINE_REVIEW_ALLOW_SOURCE_DESTINATION=1` is explicitly set, and even then the source must already be the Pipeline topic.
- Shared resolver: OpenClaw Pipeline command sends, callback edits/fallbacks, report summaries, alert summaries, scheduled notifications, and routing-test notifications use the same validated `PIPELINE_TOPIC` destination resolver.
- Callback topic binding: Pipeline callback tokens include reviewer ID, chat ID, and message thread ID. Copied/replayed callbacks from DM, topic `1677`, another topic, another group, or another reviewer are rejected before Pipeline action processing.

## Pipeline Menu

`/pipeline` opens the read-only Pipeline review center. `/dashboard` remains the live dashboard command.

Menu sections:

- Shadow Health
- Review Queue
- Recent Decisions
- Pending Outcomes
- Pipeline Coverage
- Data Quality
- Call Intelligence
- Readiness
- Alerts
- Reports
- Help
- Back

## Authorization

Access is controlled only by immutable Telegram numeric user IDs:

- `PIPELINE_TELEGRAM_REVIEWER_IDS`
- `PIPELINE_TELEGRAM_ADMIN_IDS`

Current local user-level env check: both variables are configured with numeric-only Telegram IDs. Do not reveal the raw IDs in logs, docs, or Telegram output.

Reviewer access includes health, sanitized decisions, outcomes, coverage, readiness, reports, and append-only annotations. Admin access additionally includes alerts and validation/report regeneration actions.

Unauthorized users receive only a generic access-denied response and a sanitized audit event.

## Privacy Boundary

Telegram may show anonymized opportunity refs, stage names, recommendations, confidence, sanitized reasoning, evidence counts, intent labels, outcome classes, readiness classes, versions, and aggregate metrics.

Telegram must never show seller names, phones, emails, property addresses, raw GHL IDs, raw Telegram IDs, browser headers, `Authorization`, `token-id`, cookies, environment secrets, full notes, or full transcripts.

## Review Queue

Queue items are prioritized deterministically by discrepancy severity, dangerous transition, router miss, conflicting evidence, changed recommendation, human override, ambiguous evidence, insufficient data, then ordinary pending review.

Queue pagination:

- Page size: `5`.
- Page label: `Page current/total` plus total matching items.
- Ordering: priority rank, then decision timestamp, then anonymous reference.
- Navigation: `Previous`, `Next`, `Refresh`, `Change Filter`, and `Back` where applicable.
- First page hides `Previous`; last page hides `Next`.
- Empty filter results show `No decisions currently match this filter.` with `Change Filter`, `Refresh`, and `Back`.
- Stale or out-of-range pages show a sanitized refresh prompt instead of throwing.
- Callback tokens preserve filter, page number, snapshot hash, reviewer, chat, and topic. Callback data remains opaque.

Filters supported by the service:

- All
- Unreviewed
- High Priority
- Proposed Moves
- Insufficient Data
- Conflicts
- Router Misses
- Human Overrides
- High Risk
- Deferred

## Annotation Flow

Annotations append to `ghl-automations/data/pipeline-human-review-annotations.jsonl`. Existing annotations are never updated or deleted. Corrections append a superseding annotation.

Accept means reviewer agreement only. It does not execute the recommendation.

Observation-phase review procedure:

- Use Telegram for real reviews only when the reviewer has sufficient evidence.
- Allowed statuses: `ACCEPTED`, `REJECTED`, `MODIFIED`, `NEEDS_MORE_DATA`, `DEFERRED`.
- Do not annotate a decision unless the reviewer actually evaluated it.
- Do not accept a recommendation merely to increase readiness.
- Controlled reason codes and required notes remain enforced by config.
- Live seller decisions must not receive fabricated test reviews.

## Controlled Reason Codes

Reason code config: `ghl-automations/config/pipeline-review-reason-codes.json`.

Notes are required for router misses, false positives, course-rule ambiguity, high-risk transitions, and other reasons. Notes are limited to 1,000 characters and are rejected if they contain PII, auth material, or raw production IDs.

## Callback Security

Callback payloads use short-lived opaque random tokens. Tokens are bound to reviewer, chat, decision, action, and expiration. Replayed, forged, expired, cross-user, and cross-chat callbacks are rejected.

OpenClaw callback integration only accepts the `pl:` namespace. Callback data must remain short opaque tokens and must not include raw opportunity IDs, contact IDs, stage IDs, auth headers, cookies, or seller data.

## Review State

Multi-step state is local, expiring, and bound to Telegram user ID, chat ID, decision, action, and step. Timeout is 15 minutes. Expired or cancelled state cannot append annotations.

## Idempotency

Annotation submission uses a deterministic idempotency key tied to reviewer, decision, action, reason, and notes. Duplicate callbacks do not create duplicate annotations.

## Decision History

Decision History is available from Decision Detail.

History combines, chronologically:

- Shadow decisions for the same anonymous opportunity hash.
- Observed outcomes for the selected decision.
- Human review annotations.
- Superseding annotation corrections.
- Relevant sanitized audit milestones for the selected decision.

History pagination:

- Page size: `5` entries.
- Navigation: `Previous`, `Next`, `Latest`, `Back to Decision`, and `Back to Queue`.
- Entry labels: `DECISION`, `OUTCOME`, `HUMAN_REVIEW`, `REVIEW_CORRECTION`, `AUDIT`, and sanitized `INTEGRITY WARNING`.
- Superseded annotations remain visible and marked `Superseded`; replacements remain separate chronological records.

History privacy and integrity:

- No raw opportunity IDs, contact IDs, Telegram IDs, full notes, transcripts, auth values, or seller PII are displayed.
- Invalid timestamps or bad supersedes references produce sanitized integrity warnings rather than silent omission.
- Display validation is scoped to visible fields to avoid false positives on internal hashes/UUIDs.

## AI Briefing Layer

Service: `ghl-automations/services/pipeline-ai-briefing-service.js`.

The briefing layer converts sanitized Pipeline decisions into plain-English review guidance before showing review buttons.

Briefing structure:

- What happened.
- Current situation.
- What I found.
- What I could not verify.
- My recommendation.
- Why I recommend it.
- What could change the recommendation.
- What I need from you.
- Suggested next step.
- Review choices.

Plain-language translations:

- `KEEP_STAGE` becomes “Keep this lead in the current stage for now.”
- `RUN_BUY_BOX_CHECK` becomes an explanation that the lead still needs to be checked against buying criteria.
- `CLEAR` becomes “The information points consistently toward this recommendation, but human verification still depends on the evidence shown.”
- `INSUFFICIENT_DATA` becomes “I do not have enough supporting activity to make this recommendation with high confidence.”
- `STILL_PENDING` becomes “The real-world outcome has not been determined yet.”

Human-verifiability distinction:

- AI recommendation confidence is separate from whether a human can independently verify the recommendation from the available evidence.
- A `CLEAR` router result can still be reviewed as `NEEDS_MORE_DATA` when communication context is missing.

User-facing review buttons:

- `Agree`: stores `ACCEPTED`.
- `Need More Information`: stores `NEEDS_MORE_DATA`.
- `Disagree`: stores `REJECTED`.
- `Change Recommendation`: stores `MODIFIED`.
- `Review Later`: stores `DEFERRED`.

Every button explanation states that review buttons record judgment only and do not change GHL.

Secondary briefing flows:

- `Explain More`: detailed reasoning, supporting signals, limiting signals, alternatives considered, outcome status, and transition risk.
- `Show Evidence`: compact sanitized evidence counts, summaries, and missing evidence categories.
- `Technical Details`: internal codes, versions, counts, and anonymous reference; secondary only.
- `What Do These Mean?`: plain-English review-button help.
- `Add Context`: targeted questions and local append-only context capture.

Human-supplied context:

- Stored locally in `ghl-automations/data/pipeline-human-context.jsonl`.
- Test override: `PIPELINE_HUMAN_CONTEXT_PATH`.
- Records are append-only, sanitized, tied to the anonymous decision reference, and store reviewer hashes rather than raw Telegram IDs.
- Human context does not change GHL, move stages, or mutate router decisions.
- Guided context-answer callbacks append local context and immediately return a regenerated briefing in the same Telegram thread.
- The context-question prompt exposes `Yes`, `No`, `Not Sure`, `Add Context`, `Skip`, `Back`, and `Cancel`; opening the prompt or custom-context instructions does not append a record.

Unsupported-claim controls:

- The current implementation is deterministic and does not rely on an LLM.
- If an LLM is added later, it must be constrained by the structured briefing object and fail closed to deterministic rendering.
- Missing facts are described as unverifiable; no seller motivation, property condition, offer amount, calls, SMS, deadlines, contracts, ownership details, user actions, or GHL changes are invented.

Privacy and routing:

- Briefings pass the existing privacy validator before Telegram delivery.
- All briefing messages, edits, callbacks, reports, alerts, and daily briefings use the central topic-389 destination resolver.
- Callback state remains bound to reviewer, chat, topic/thread, decision, action, and expiration.

Live AI briefing validation 2026-07-28:

- Reviewed live case: `Lead-f09b842550b5`.
- Primary briefing used plain English and hid internal codes from the main view.
- `Explain More`: pass.
- `Show Evidence`: pass.
- `Technical Details`: pass.
- `What Do These Mean?`: pass.
- `Add Context`: pass.
- Annotation delta during validation: `0`.
- Daily briefing test sent to topic `389`: pass.
- Topic `389` sends: `2`.
- Topic `389` edits: `8`.
- DM content: `0`.
- Topic `1677` content: `0`.
- General group content: `0`.
- Callback acknowledgements: `8`.
- Privacy scan: pass.

## Audit Ledger

Audit ledger: `ghl-automations/data/pipeline-review-audit.jsonl`.

Events include menu opens, unauthorized access, decision opens, review actions, callback rejection, exports, alerts, and blocked actions. Audit records store anonymized reviewer hashes, not raw Telegram IDs.

## Readiness

Readiness evaluator: `ghl-automations/tools/pipeline-readiness-evaluator.js`.

Classifications:

- NOT_ELIGIBLE
- INSUFFICIENT_LIVE_DATA
- OBSERVATION_ONLY
- HUMAN_ASSISTED_CANDIDATE
- READY_FOR_USER_REVIEW
- BLOCKED_HIGH_RISK
- BLOCKED_BY_ERRORS

Readiness does not authorize automation.

## Readiness Gates

Gate config: `ghl-automations/config/pipeline-readiness-gates.json`.

The baseline requires 30 distinct opportunities, 25 reviewed decisions, 20 outcomes, 15 evidence-rich cases, 30 observation days, 90% acceptance, 90% outcome alignment, zero dangerous false positives, zero high-severity misses, and unresolved rate at or below 20%.

## Transition Risk Map

Risk map: `ghl-automations/config/pipeline-transition-risk-map.json`.

Risk classes: LOW, MEDIUM, HIGH, CRITICAL. HIGH and CRITICAL transitions remain recommendation/review only. CRITICAL transitions are blocked from automatic movement by default.

## Permanently Blocked Actions

Blocked actions include contracts, signing, JV signing, wire setup, wire instructions, funding confirmation, closing, legal commitments, title-clearance claims, appraisal-resolution claims, money movement, and any action creating legal obligations.

## Notifications

Notification events are defined at the service level for future OpenClaw delivery integration. They must be independently disableable and suppress duplicate no-change cycle notifications.

Notification delivery through OpenClaw Telegram now uses the central Pipeline topic resolver.

Daily review digest policy:

- Send to AI REI Pipeline topic `389` only when meaningful review items exist.
- Meaningful items include new decisions, changed recommendations, ambiguous/conflicting cases, router misses, human overrides, overdue reviews, readiness changes, and active integrity/privacy/safety alerts.
- Suppress the digest when there is nothing meaningful to review.
- Never include seller PII, raw GHL IDs, auth material, full notes, or transcripts.

Durable notification state:

- State file: `ghl-automations/data/runtime/pipeline-telegram-notification-state.json`.
- Test override: `PIPELINE_TELEGRAM_NOTIFICATION_STATE_PATH`.
- State survives gateway/process/scheduled-task restart.
- Records store hashed idempotency keys, type, destination type, topic match, timestamps, status, retry count, sanitized error class, and retention timestamp.
- State does not store bot tokens, seller PII, raw decision text, or raw GHL IDs.

Idempotency key design:

- Deterministic key fields: notification type, sanitized reference, reporting window, destination type, topic, readiness/alert state, and version.
- Key is SHA-256 hashed before storage.
- Message text alone is not used as the dedupe key.

Suppression and retry behavior:

- Daily digests: once per reporting day.
- Readiness changes: once per unique state transition.
- Overdue review digest: once per day while still overdue.
- Test routing notification: once per explicit test-run ID.
- Failed sends may retry according to policy.
- Confirmed `SENT` records are not resent.
- `PENDING` records are classified as `DELIVERY_UNCERTAIN` to avoid rapid duplicate retries after a crash between Telegram acceptance and local `SENT` recording.

Retention:

- Ordinary records default to 90 days.
- Test records can be cleaned up by retention policy.
- Annotation, decision, outcome, and safety/privacy audit ledgers are never deleted by notification cleanup.

## Validation Results 2026-07-28

Controlled live `/pipeline` navigation through the existing OpenClaw Telegram runtime passed:

- `live_dispatch=ok`
- Real `sendMessage` calls: `8`
- Real `editMessageText` calls: `5`
- Callback acknowledgements: `5`
- Privacy scan: `PASS`
- Navigation steps covered: `12`

Follow-up destination fix:

- Previous controlled validation incorrectly sent `/pipeline` output to the ProlificClawd bot DM because the OpenClaw bridge reused the source chat as the destination.
- The bridge now defaults to AI REI Pipeline topic `389` in group `-1003975794600`.
- Controlled post-fix dispatch verified `sent_to_expected_chat=true`, `sent_to_expected_topic=true`, `source_was_dm=true`, and `privacy_scan_ok=true`.

Production topic-routing validation:

- Destination configured: yes.
- Destination type: `PIPELINE_TOPIC`.
- Chat match: yes.
- Topic match: yes.
- Topic `1677` match: no.
- DM source `/pipeline`: posted Pipeline menu to topic `389`; DM received only generic redirect acknowledgement.
- Topic `389` menu navigation: `Shadow Health`, `Refresh`, `Back`, `Review Queue`, and `Open decision` stayed in topic `389`.
- Reports command: routed to topic `389`.
- Alerts command: routed to topic `389`.
- Sanitized Markdown readiness report: routed to topic `389`.
- Routing test notification: routed to topic `389`; duplicate suppressed in-process.
- Copied callback from DM: rejected with no output.
- Copied callback from topic `1677`: rejected with no output.
- Topic `1677` destination misconfiguration dry run: rejected with no Pipeline content sent.
- Production `destination=source` dry run from DM: rejected with only generic warning and no Pipeline content.

Live routing matrix 2026-07-28:

- Source ProlificClawd DM, command `/pipeline`: expected AI REI Pipeline topic `389`; result pass.
- Source AI REI Pipeline topic `389`, action `Refresh`: expected same Pipeline topic; result pass.
- Source AI REI Pipeline topic `389`, action `Review Queue`: expected same Pipeline topic; result pass.
- Source AI REI Pipeline topic `389`, action `Open decision`: expected same Pipeline topic; result pass.
- Source AI REI Pipeline topic `389`, sanitized report delivery: expected same Pipeline topic; result pass.
- Scheduled/test notification: expected AI REI Pipeline topic `389`; result pass.

Live routing counters from controlled validation:

- Pipeline topic sends: `4`.
- Pipeline topic edits: `5`.
- Callback acknowledgements: `7`.
- DM acknowledgements: `1` generic redirect.
- DM Pipeline content: `0`.
- Topic `1677` Pipeline content: `0`.
- General group Pipeline content: `0`.
- Negative copied-callback output: `0`.
- Privacy scan: pass.

Fixture review in topic `389`:

- Fixture-only temp annotation ledger count before: `0`.
- After first `NEEDS_MORE_DATA` review: `1`.
- After duplicate attempt: `1`.
- Idempotency: pass.
- Temp audit events: `3`.
- Wrong-destination content: `0`.
- Privacy scan: pass.

Final safety audit:

- Production annotation count: `0`.
- Production audit count after routing validation: `39` sanitized events.
- Decision ledger: `7` decisions.
- Run ledger: `7` runs.
- Outcome ledger: `7` outcomes.
- GHL write counter total: `0`.

## Observation Phase Start 2026-07-28

Observation baseline:

- Baseline report directory: `ghl-automations/reports/pipeline-shadow/baselines/`.
- Baseline file: `observation-baseline-2026-07-28T14-26-31-204Z.md`.
- Baseline decisions: `7`.
- Baseline runs: `7`.
- Baseline outcomes: `7`.
- Baseline production annotations: `0`.
- Readiness: `INSUFFICIENT_LIVE_DATA`.

Review queue targets during observation:

- Unreviewed count.
- Average review age.
- Overdue count.
- Accepted count.
- Rejected count.
- Modified count.
- Needs-more-data count.
- Deferred count.

First real review-pass preparation 2026-07-28:

- Total live decisions: `7`.
- Evidence-rich cases: `3`.
- Reviewable now: `1`.
- Needs more data: `6`.
- Deferred: `0`.
- Integrity blocked: `0`.
- Manual production reviews completed: `0`.
- Production annotations remain: `0`.
- Router misses: `0`.
- Dangerous false positives: `0`.
- Readiness remains: `INSUFFICIENT_LIVE_DATA`.

Evidence-rich review summaries:

- `Lead-f09b842550b5`: stage `Lead Entered`, recommendation `KEEP_STAGE`, confidence `CLEAR`, evidence present `contactNotes`, gaps `conversations`, `calls`, `transcripts`, `dispositions`, outcome `STILL_PENDING`, reviewability `Ready for Review` because the recommendation is clear and has supporting note evidence.
- `Lead-4e5cf26c3470`: stage `Offer Ready`, recommendation `KEEP_STAGE`, confidence `INSUFFICIENT_DATA`, evidence present `contactNotes`, gaps `conversations`, `calls`, `transcripts`, `dispositions`, outcome `STILL_PENDING`, reviewability `Needs More Data` because some evidence exists but confidence remains insufficient.
- `Lead-a79dacb4d57a`: stage `Offer Ready`, recommendation `KEEP_STAGE`, confidence `INSUFFICIENT_DATA`, evidence present `contactNotes`, gaps `conversations`, `calls`, `transcripts`, `dispositions`, outcome `STILL_PENDING`, reviewability `Needs More Data` because some evidence exists but confidence remains insufficient.

Queue behavior:

- Evidence-rich cases are prioritized before zero-evidence cases.
- Each queue item displays `Reviewability` as `Ready for Review`, `Needs More Data`, `Deferred`, or `Integrity Warning`.
- The updated queue was delivered to AI REI Pipeline topic `389` with no DM content, no topic `1677` content, and no privacy findings.

Human-review reminder:

- Do not batch-approve.
- Do not annotate live decisions unless the reviewer actually inspects the case.
- Use `NEEDS_MORE_DATA` for insufficient evidence after human confirmation.
- Never count `NEEDS_MORE_DATA` as accepted or as a router miss.

First production human review 2026-07-28:

- Reviewed case: `Lead-f09b842550b5`.
- Current stage: `Lead Entered`.
- Recommendation: `KEEP_STAGE`.
- Confidence: `CLEAR`.
- Evidence available: `contactNotes: 1`.
- Evidence missing: `conversationMessages`, `calls`, `transcripts`, `dispositions`.
- Outcome state: `STILL_PENDING`.
- Human review outcome: `NEEDS_MORE_DATA`.
- Reason code: `INSUFFICIENT_EVIDENCE`.
- Annotation behavior: appended once; duplicate replay reused the existing annotation.
- Audit behavior: one sanitized audit event appended.
- Decision history: updated with `HUMAN_REVIEW` entry.
- Queue after review: `7` total, `6` unreviewed.
- Remaining six cases: untouched and still `NEEDS_MORE_DATA`/`UNREVIEWED`.
- GHL writes: `0`.
- Automatic stage movement: `DISABLED`.
- Readiness: `INSUFFICIENT_LIVE_DATA`.

Monthly checkpoint response shape:

- Observation period.
- Total decisions.
- Distinct opportunities.
- Reviewed decisions.
- Pending reviews.
- Observed outcomes.
- Pending outcomes.
- Evidence-rich cases.
- Data-quality gaps.
- Router misses.
- Dangerous false positives.
- Human overrides.
- Transition-level readiness.
- Thresholds passed and failed.
- Active blockers.
- Telegram delivery status.
- Privacy and safety audit.
- Test results.
- Router changes, which must be `NONE` unless separately approved.
- Live GHL writes, which must be `NONE`.
- Automatic stage movement, which must be `DISABLED`.
- Overall readiness.
- Recommendation: `CONTINUE OBSERVATION`, `REVIEW ROUTER CHANGE PROPOSAL`, `TRANSITION READY FOR USER REVIEW`, or `BLOCKED — SAFETY OR PRIVACY ISSUE`.

Router change control:

- No router changes are allowed during observation without explicit user approval.
- A change proposal requires multiple independent examples, consistent failure pattern, sanitized evidence, reason-code agreement, transition-level impact analysis, regression fixtures, and passing existing tests.
- Automatic stage movement: `DISABLED`.
- Readiness: `INSUFFICIENT_LIVE_DATA`.

Pagination/history/durable-dedupe validation 2026-07-28:

- Bridge tests: `19/19 PASS`.
- Telegram review tests: `34 PASS`.
- Live one-page queue/history in topic `389`: pass.
- Live queue page label observed: yes.
- Live Next observed: yes.
- Live Previous observed: yes.
- Live Decision History observed: yes.
- Live topic `389` queue/history sends: `1`.
- Live topic `389` queue/history edits: `7`.
- Live queue/history DM Pipeline content: `0`.
- Live queue/history topic `1677` content: `0`.
- Live queue/history general-group content: `0`.
- Fixture multi-page validation with 11 safe fixture decisions: pages `2/4` and `3/4` observed via topic `389` command and `Next` callback.
- Fixture multi-page DM content: `0`.
- Fixture multi-page topic `1677` content: `0`.
- Restart durable dedupe test: first explicit test-run notification sent to topic `389`; same test-run ID after gateway restart suppressed with zero sends; new test-run ID sent to topic `389`.
- Production annotation count after all validation: `0`.
- GHL write counter total: `0`.

Covered views:

- Menu
- Shadow Health
- Review Queue
- Decision Detail
- Pending Outcomes
- Pipeline Coverage
- Data Quality
- Call Intelligence
- Readiness
- Alerts
- Reports

Fixture-only annotation validation passed with `PIPELINE_REVIEW_INCLUDE_TEST_FIXTURES=1` and temporary annotation/audit paths outside the production ledgers:

- Fixture decision: `TEST-FIXTURE-NON-PRODUCTION-PIPELINE-REVIEW`
- Annotation count before: `0`
- Annotation count after first review: `1`
- Annotation count after replay: `1`
- Idempotency: `PASS`
- Review-state expiration blocked: `PASS`
- Audit events in temp audit ledger: `3`
- Privacy scan: `PASS`

Authorization validation passed:

- Unauthorized numeric Telegram ID received generic `Access denied.` only.
- Unauthorized response did not disclose decision, queue, health, total, or pending counts.

Current live ledger/readiness snapshot:

- Production decision ledger: `7` valid decisions.
- Run ledger: `7` valid runs.
- Outcome ledger: `7` valid outcomes.
- Review queue: `7` total, `7` unreviewed, `6` insufficient-data, `0` proposed moves.
- Live stage coverage: `Lead Entered=5`, `Offer Ready=2`.
- Conversations observed: `0`.
- Calls observed: `0`.
- JUSTCALL observed: `0`.
- LC_PHONE_TWILIO observed: `0`.
- Readiness: `INSUFFICIENT_LIVE_DATA`.

Shadow health blocker:

- Latest read-only full shadow cycle returned `BLOCKED_AUTH` because the authenticated browser session was unavailable.
- Last successful cycle remains recorded in health history.
- Ledger validation still passes.
- GHL writes remain `0`.
- Automatic movement remains `DISABLED`.

Focused regression status:

- `node ghl-automations/tools/_test_pipeline_telegram_review.js`: `23 PASS`.
- `node ghl-automations/tools/_test_pipeline_readiness.js`: `14 PASS`.
- `node ghl-automations/tools/_test_pipeline_shadow_ledger.js`: `8 PASS`.
- `node ghl-automations/tools/_test_pipeline_shadow_operations.js`: `12 PASS`.
- `node ghl-automations/modules/_test_intent_router.js`: `27 PASS, 0 FAIL`.
- `node ghl-automations/tests/pipeline-router-regression.test.js`: `78/78 PASS`.
- `node --check ghl-automations/modules/pipeline-telegram-review.js`: `PASS`.
- `node --check ghl-automations/services/pipeline-review-service.js`: `PASS`.
- `node --check src/telegram/pipeline-review-bridge.ts`: `PASS`.
- `pnpm test src/telegram/pipeline-review-bridge.test.ts`: `6/6 PASS`.
- `pnpm tsgo --noEmit --pretty false`: `FAIL`, with pre-existing unrelated TypeScript errors outside the Pipeline bridge path.

## Live Validation Procedure

Before live validation:

- Configure `PIPELINE_TELEGRAM_REVIEWER_IDS` and `PIPELINE_TELEGRAM_ADMIN_IDS` with immutable numeric Telegram user IDs only.
- Confirm no second Telegram polling process will be started if OpenClaw is already running.
- Do not print or persist Telegram bot tokens, cookies, browser headers, `Authorization`, or `token-id`.

Live validation checklist:

- Send `/pipeline` from an authorized numeric Telegram account.
- Verify menu, health, queue, outcomes, coverage, quality, calls, readiness, alerts, and reports render through the real OpenClaw bot.
- Verify unrelated inline callbacks still pass through existing OpenClaw handlers.
- Verify malformed, expired, replayed, cross-user, and cross-chat `pl:` callbacks are rejected.
- Use only a clearly marked non-production fixture decision for live annotation testing. Do not append fabricated review judgments to live production decisions.
- Confirm duplicate annotation callback attempts do not append duplicate records.
- Confirm Telegram output contains no raw GHL IDs, raw Telegram IDs, seller PII, auth material, or raw ledger JSONL.

## Reports And Exports

Allowed exports are sanitized review queues, unresolved decisions, transition metrics, readiness Markdown, weekly Markdown, and aggregate review summaries. Raw JSONL ledgers are never sent through Telegram.

## Current Limitations

Current live data is limited to seven early-stage opportunities. Readiness is expected to remain `INSUFFICIENT_LIVE_DATA` until live reviews and outcomes accumulate.

The current shadow cycle is blocked by GHL/browser authentication availability. Refresh the authenticated GHL browser session before expecting `HEALTHY` shadow-cycle status.

## Zero-Write Guarantee

The Telegram review center reads local ledgers/reports and appends local annotations/audit events only. It exposes no GHL mutation capability, no stage movement, no messaging, no note/task creation, and no workflow trigger.
