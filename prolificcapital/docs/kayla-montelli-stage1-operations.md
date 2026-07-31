# Kayla Montelli Stage 1 Operations

## Scope

This document describes the Stage 1 operator flow for the Kayla/Montelli pipeline. It is a script-prompter and operator-console workflow. It does not send messages, place calls, write GHL notes, or move stages by itself.

## Course Rule: Stage 1 Sequence

1. Lead enters from Kayla's lead sheet or an approved lead source.
2. The operator reviews and prepares the lead.
3. The operator identifies the contact path for this property: listing agent, broker, direct seller, FSBO seller, PPC seller, or research required.
4. The operator sends `INT` before calling.
5. The operator calls the appropriate available contact.
6. The operator uses the matching agent or seller script.
7. The operator collects the required property/contact information.
8. If there is no answer, the course requires two call attempts before no-answer handling.
9. After two unanswered calls, the operator sends the voice memo and `NOA`.
10. After a completed call, the operator sends `CCC` and the contact card.
11. The operator records structured notes and collected information in GHL.
12. Stage movement remains blocked because the source materials conflict on the exact Stage 1 exit event.

Sources: `lead-tracking/AIREI_SCRIPTS_REFERENCE.md`, `lead-tracking/AIREI_SYSTEM_PLAYBOOK_v2.md`, `lead-tracking/KAYLA_COACHING_REFERENCE.md`, `ghl-automations/TRACK_STUDENT.md`, `ghl-automations/TRACK_MONTELLI.md`, `memory/FULL_COURSE_AUDIT.md`.

## Contact Paths

COURSE RULE: A listed property with an explicit listing-agent contact uses the listing-agent path and `AGENT_INITIAL` script.

COURSE RULE: A direct seller, FSBO seller, or PPC seller path uses the seller script when the seller contact is explicitly established.

TECHNICAL IMPLEMENTATION: If the contact path is not established, Telegram prompts the operator to research the lead source and listing information. It does not fabricate a role.

## Scripts And Shortcuts

- `INT`: sent before every call. It is not a completed Stage 1 action by itself.
- `AGENT_INITIAL`: used for listing-agent or broker path.
- `SELLER_INITIAL`: used for direct seller, FSBO seller, or PPC seller path.
- `SELLER_REHAB`: used only when a supported renovation condition applies.
- `NO_ANSWER_VOICE_MEMO`: available after two unanswered calls.
- `NOA`: available after the documented no-answer condition.
- `CCC`: sent after a completed call.
- `CONTACT_CARD`: sent after a completed call with `CCC`.

## Information Collection

The Stage 1 schema prompts for contact name, phone, email, roof age, HVAC age, occupancy, tenant status, monthly rent, lease terms, utilities, listing or buyer feedback, seller flexibility, property condition when applicable, other properties, call outcome, attempt count, and next action.

TECHNICAL IMPLEMENTATION: Existing reliable fields may be used where known. Otherwise, the information is included in the structured Stage 1 note preview. No new production GHL fields are created by this task.

## Notes Schema

The note preview is deterministic and starts with `KAYLA STAGE 1 CONTACT RECORD`. It distinguishes completed-call and no-answer paths and never claims an unconfirmed action was completed.

## Telegram Commands

- `Show me my Stage 1 leads.`
- `Start the first lead.`
- `Who am I supposed to contact?`
- `This is the listing agent.`
- `This is a direct seller.`
- `I need to research who the contact is.`
- `Show the INT shortcut.`
- `I sent INT.`
- `Show the agent script.`
- `Show the seller script.`
- `Start the first call.`
- `No answer.`
- `I called again and there was no answer.`
- `Show the voice memo.`
- `I sent the voice memo and NOA.`
- `They answered.`
- `Show me the questions.`
- `The roof is 10 years old and HVAC is 6 years old.`
- `Show CCC.`
- `I sent CCC and the contact card.`
- `Show the notes.`
- `I entered the notes.`
- `What does Kayla say to do next?`

## Course Conflict

COURSE CONFLICT: The available materials conflict on whether `INT Sent` alone advances to Contact Made, or whether call/contact work, `CCC`, and notes must be completed first.

TECHNICAL IMPLEMENTATION: After operator work is complete, the system returns `STAGE_1_OPERATOR_WORK_COMPLETE` and keeps `STAGE_MOVEMENT_DISABLED_COURSE_CONFLICT_UNRESOLVED`. No automatic stage movement occurs.

## Production Preview

The production readiness preview is read-only. It evaluates current Lead Entered opportunities only to choose which course prompt Telegram should show.

Zero-action guarantees:

- Production sends: 0
- Production calls: 0
- Production writes: 0
- Stage movements: 0
