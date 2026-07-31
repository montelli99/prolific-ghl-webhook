# Atlas Kayla Course Parity Spec

Generated: 2026-07-31

Purpose: define the course-derived operating process Atlas must preserve before Telegram-controlled outreach is enabled for the Montelli Atlas pipeline.

This is a reconstruction artifact. It does not authorize live sends, stage movement, workflow edits, contact notes, task creation, tagging, or campaign enrollment.

## Production Locks

| Item | Locked value |
| --- | --- |
| Location | `61XPzSqRy7UKMwW9DeB8` |
| Pipeline | `nSf3NXYVkt8X4PgW9aZ3` |
| Owner | `PGfXxlXCRXs3hXN3Gq7R` |
| Lead Entered stage | `7067148a-2ee8-4e5b-93c8-31e0253fea68` |
| Selected sender | masked JustCall number ending `2619`, 571 area code per owner instruction |
| Live sends during this reconstruction | `0` |
| Production writes during this reconstruction | `0` |

## Source Priority

| Source | Use | Notes |
| --- | --- | --- |
| `airei-course-notes/AIREI_MASTER_PLAYBOOK.md` | Primary course process, scripts, cadence, deal evaluation | Built from 15 docs and 18 video transcripts. |
| `lead-tracking/AIREI_SCRIPTS_REFERENCE.md` | Exact shortcut and call script reference | Confirms INT before calls, CCC after calls, post-offer scripts. |
| `lead-tracking/KAYLA_COACHING_REFERENCE.md` | Kayla live-call behavior and coaching | Confirms save contact first, INT before call, feedback question, ask for other properties. |
| `ghl-automations/TRACK_STUDENT.md` | Manual script-prompter model and stage boundaries | Conflicts with workflow-brain automation model. Treat as core safety model for owner-commanded Telegram outreach. |
| `ghl-automations/GHL_WORKFLOWS_SPEC.md` | 21-stage production workflow design | Useful for stage map, but conflicts where it assumes autonomous GHL workflow sends or stage moves. |
| `memory/KAYLA_CLOSING_PROCESS.md` | Contract-to-close relay and monitoring cadence | Confirms Montelli relays, Kayla negotiates, 3-5 day warmth cadence. |
| `memory/kayla-stack-method-sop.md` | Stack-method underwriting qualification | Confirms 10K population check, Zillow Rental Manager process, 70 percent LTV, 8 percent rate, $250 cash-flow floor. |
| `memory/AI_REI_VERIFIED_OPERATIONS.md` | Current production locks and workflow state | Confirms live webhook, published workflows, 21 stage IDs, role boundaries. |

## Governing Conflict

`ghl-automations/GHL_WORKFLOWS_SPEC.md` says GHL workflows are the brain and may attach SMS, waits, field writes, document generation, and auto-advancement.

`ghl-automations/TRACK_STUDENT.md`, `airei-course-notes/AIREI_MASTER_PLAYBOOK.md`, and owner launch direction require operator-confirmed outreach. In this launch model, Telegram is the operator console, Atlas is a recommender and exact-count executor only after explicit approval, and no hidden mass-send or autonomous cron outreach is allowed.

Resolution for implementation: preserve the workflow-brain document as historical production design, but implement Atlas outreach in the manual-confirmation style until explicitly approved otherwise.

## Course Rules

| Rule | Evidence |
| --- | --- |
| Save contact first with name, contact type, and property address context. | `AIREI_MASTER_PLAYBOOK.md` lines 70-75, `KAYLA_COACHING_REFERENCE.md` lines 10-13. |
| Send `INT` before calling. | `AIREI_MASTER_PLAYBOOK.md` lines 70-73, `AIREI_SCRIPTS_REFERENCE.md` lines 10 and 235-237. |
| Call twice before no-answer handling. | `AIREI_MASTER_PLAYBOOK.md` lines 71-73, `TRACK_STUDENT.md` lines 45-48. |
| If no answer after two calls, send voice memo and `NOA`. | `TRACK_STUDENT.md` lines 45-66, `AIREI_SCRIPTS_REFERENCE.md` lines 176-180. |
| During calls, collect agent/seller contact, roof/HVAC, occupancy, rent, lease, utilities, buyer feedback, creative-term openness. | `AIREI_MASTER_PLAYBOOK.md` lines 76-85. |
| Send `CCC` and contact card after every call. | `AIREI_MASTER_PLAYBOOK.md` lines 87-88 and 360-362, `AIREI_SCRIPTS_REFERENCE.md` lines 235-237. |
| Ask whether there are other properties to offload. | `AIREI_MASTER_PLAYBOOK.md` lines 125-126 and 360-361, `KAYLA_COACHING_REFERENCE.md` lines 34-37. |
| Use realignment/clarification language, not checking-in/following-up language. | `AIREI_MASTER_PLAYBOOK.md` lines 350-359, `AIREI_SCRIPTS_REFERENCE.md` lines 223-233. |
| Montelli relays; Kayla/Jaxon negotiate. | `TRACK_STUDENT.md` lines 325-345, `memory/KAYLA_CLOSING_PROCESS.md` lines 141-155. |
| Post-offer feedback call is due 48 hours after offer sent. | `AIREI_MASTER_PLAYBOOK.md` lines 118-122 and 406-410, `TRACK_STUDENT.md` lines 154-179. |
| If seller declines or disappears, note DOM, subtract 181, and calendar the listing-expiry circle-back. | `AIREI_MASTER_PLAYBOOK.md` lines 118-123 and 208, `AIREI_SCRIPTS_REFERENCE.md` lines 196-200. |
| After terms agreed and through closing, keep seller warm every 3-5 days. | `TRACK_STUDENT.md` lines 350-371, `memory/KAYLA_CLOSING_PROCESS.md` lines 124-138. |

## Script Inventory

| Code | Use | Trigger |
| --- | --- | --- |
| `INT` | Intro text before first or follow-up call. | Before calls. |
| `NOA` | Short no-answer text. | After two unanswered calls. |
| `DNCT` | Text-only outreach for do-not-call context. | When calling is not appropriate and contact is not opted out. |
| `CCC` | Contact-card credibility text. | After every call. |
| `GCJ` | Group chat with Jaxon/business partner. | After offer sent or hot lead handoff. |
| `LOI` | Offer/LOI feedback realignment. | After offer sent, especially 48-hour feedback sequence. |
| `LOI2DAYS` | Second no-response escalation. | 48 hours after no answer in feedback sequence. |
| `INLOI` | Inspection/LOI due-diligence explanation. | If seller asks about viewing/walking/inspection after LOI. |
| `F50` | 50 percent down creative proposal. | Turnkey or good-condition property. |
| `F10` | 10 percent down, 24-month payoff proposal. | Older or renovation property. |
| `PEND` | Pending listing back-pocket offer. | Property went pending. |
| `SD` | Seller declined or no-response closeout. | Decline, late escalation, or listing-expiry nurture. |

Implementation requirement: messages must be generated from the verified shortcut bodies in `AIREI_MASTER_PLAYBOOK.md` and `AIREI_SCRIPTS_REFERENCE.md`, not invented variants. Any exact-body conflict must be shown to the operator for approval instead of silently selecting one.

## 21-Stage Operating Map

| Stage | Course process | Automation boundary |
| --- | --- | --- |
| 1. Lead Entered | Prepare contact, send `INT`, call twice, collect initial data. | Telegram may show untouched leads and preview `INT`; send only exact operator-approved count. |
| 2. Contact Made | Send `CCC`, log call facts, classify agent/seller, occupancy, condition, feedback, rent, roof/HVAC. | Atlas can summarize required fields and missing data. Do not auto-move without approval. |
| 3. Offer Ready to be Sent to Seller | Evaluate deal type and send details to Seth/Kayla/Jaxon for LOI/offer. | Atlas can run comps/underwriting and draft notification. No agreement/offer send without approval. |
| 4. Offer Sent to Lead | Confirm receipt, send `GCJ`, start 48-hour feedback timer. | Telegram can prompt operator. No hidden timer send. |
| 5. Offer Received | Monitor response. If counter, relay to Kayla/Jaxon. If accepted, Kayla moves toward terms. If declined, closeout path. | Operator notes decision; Atlas recommends route only. |
| 6. Offer Ready to Gain Feedback | Call with realignment script and ask for feedback/clarification. | Telegram can queue due feedback calls and preview `LOI`. |
| 7. No Answer After Offer Ready to Gain Feedback | Day 1 voice memo, 48-hour `LOI2DAYS`, 96-hour `SD`, DOM-181 reminder. | Exact-count escalation only after explicit approval; calendar/task write requires separate approval. |
| 8. Seller Declined Offer | Send `SD`, ask for other properties, note DOM, set listing-expiry circle-back. | No auto-archive or 30-day re-engage without approval. |
| 9. Active Negotiation | Montelli relays seller questions/counters; Kayla/Jaxon negotiate. | Atlas may capture and format counter details. It must not counter-offer. |
| 10. Terms Agreed | Kayla drafts contract. Montelli stays warm every 3-5 days. | Atlas can draft Kayla handoff and reminders. No contract generation/send by Telegram outreach executor. |
| 11. Awaiting Seller Title Info | Kayla/Jaxon/TC territory. Request mortgage/title info when approved. | View-only unless owner explicitly authorizes a request. |
| 12. Contract Out | Kayla sends contract; Montelli monitors every 3-5 days until signed. | No document send or envelope action without explicit approval. |
| 13. Under Contract | TC handoff, inspection/appraisal/title coordination, seller warmth. | Atlas can summarize next steps; no seller text without approval. |
| 14. Under Contract w/ Another Buyer | Monitor whether buyer performs, use UC follow-up script after course-approved timing. | No automatic poaching or nurture sends. |
| 15. Sent to Buyers | Disposition/buyer-facing status. | Not part of initial seller outreach executor. |
| 16. Inspection Complete | Kayla reviews inspection, negotiates repairs/credits if needed. | Atlas may record summary and flag major issues. |
| 17. Appraisal Complete | If appraisal low, Kayla decides renegotiation or exit. | Atlas can compare values; no renegotiation language unless approved. |
| 18. JV Sent | Kayla sends JV agreement. | View-only for outreach executor. |
| 19. JV Signed | Title/books setup. | View-only for outreach executor. |
| 20. Wire Instructions Set Up | Confirm title wiring and processor setup. | View-only for outreach executor. |
| 21. Closing Date Assigned | Closing countdown, close, ask for referrals/other properties after close. | Atlas can prompt post-close ask; send requires approval. |

## Telegram Command Parity Requirements

| Command intent | Required behavior | Current gap |
| --- | --- | --- |
| Show untouched leads | Read Stage 1 Atlas-valid leads and show property-specific contact context. | Existing `/pipeline` is read-only review, not an outreach queue. |
| Find N agents/owners to contact | Select exactly N eligible contact-property contexts with layered locks. | Missing exact-count selector. |
| Preview messages | Render verified shortcut bodies with merge fields and show unresolved fields. | Missing outreach preview session. |
| Send first N / send numbers | Send only operator-selected entries, count exactly, via locked sender. | Missing gated JustCall executor. |
| Hold / skip | Update local session state only until production note/task writes are approved. | Missing session state for outreach batch. |
| Pause / resume outreach | Stop executor and prevent further sends. | No proven outreach kill switch. |
| Show replies | Read conversation/integration events without storing sensitive bodies in artifacts. | Message-body observability remains limited. |
| Mark wrong number / DNC | Requires compliance-safe production write path and confirmation. | Not implemented; must not be faked with local-only state for production compliance. |
| Move to Contact Made | Must use proven event-emitting path or keep as recommendation. | Raw API stage movement is not proven equivalent to GHL UI workflow enrollment. |

## Implementation Categories

| Category | Work |
| --- | --- |
| Preserve | Keep existing importer, workflow health reads, `/pipeline`, shadow ledger, intent router, and JustCall wrapper. |
| Connect | Add Telegram outreach session layer that reuses read-only GHL lookup and verified script templates. |
| Repair | Add a real outreach kill switch, sender lock, exact-count guard, duplicate-send guard, and unresolved-field gate. |
| Complete | Implement lead selection, preview, hold/skip, operator-confirmed sends, reply review, and compliance actions. |
| Deploy | Do not deploy until dry-run artifacts prove zero writes and zero sends in reconstruction mode. |
| Verify | Unit-test selector, locks, template merge, exact-count executor, kill switch, and no-production-write mode. |
| Canary | One owner-approved contact-property context only, with active kill switch and post-send readback. |

## JustCall Sender Verification

Prior read-only artifact `lead-tracking/atlas-deals/audits/atlas-justcall-readonly-configuration-probe-60f6016de488.json` verified two JustCall numbers. The selected Montelli number ending `2619` was visible as available, local, SMS-capable, MMS-capable, call-capable, `sms_compliance: Verified`, and `business_registration: Approved`, owned by Montelli Scott.

Fresh recheck attempted on 2026-07-31 with the local shell and local `.env`; the module did not find `JUSTCALL_API_KEY` and `JUSTCALL_API_SECRET`, so the live recheck remains blocked by credential environment wiring. No write endpoint was called and no send endpoint was called.

## Open Risks

| Risk | Status |
| --- | --- |
| `UNRESOLVED_MESSAGE_BODY_OBSERVABILITY_LIMITATION` | Still active. Do not store/copy sensitive message bodies in artifacts. |
| JustCall throughput, quiet hours, STOP/HELP, webhook status | Not fully observable from prior read-only endpoints. |
| GHL broad stage-change workflow | Published and active; any production stage movement can fire a webhook. |
| Exact-count Telegram outreach | Not implemented. |
| Production DNC/wrong-number compliance writes | Not implemented and must not be simulated as production truth. |
| Raw API stage move side effects | Not proven equivalent to authenticated GHL UI workflow enrollment. |
