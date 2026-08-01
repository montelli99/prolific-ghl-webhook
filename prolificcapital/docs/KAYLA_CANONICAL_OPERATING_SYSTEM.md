# KAYLA CANONICAL OPERATING SYSTEM

**Version:** 1.0
**Created:** 2026-07-31
**Authority:** Kayla Mauser course materials, transcripts, scripts, and coaching
**Purpose:** Single source of truth for every business rule in the pipeline

This document defines the business process. Every software implementation, every
operator console, every workflow, and every automated recommendation must
reference this document. Nothing may become production business behavior unless
it exists here.

---

## SECTION 1: PIPELINE PHILOSOPHY

### 1.1 Why the Pipeline Exists

**BUSINESS RULE:** The pipeline exists to move a property from initial contact
through closing. Each stage represents a specific business milestone. The
operator's job is to advance the lead through the pipeline by completing the
required work at each stage.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:1-10`,
`airei-course-notes/02-STEP3-Pt1-Leads-to-CRM-AI-Offer-System.txt:1-8`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must not advance a lead through the pipeline
without operator confirmation. The pipeline is a business tracking tool, not an
automation engine.

### 1.2 What the Operator Is Trying to Accomplish

**BUSINESS RULE:** The operator contacts property owners or their agents,
collects property and contact information, evaluates whether the property fits
the buy box, and hands qualified leads to the closer team for offer generation
and negotiation. The operator does not negotiate, does not sign contracts, and
does not generate offers.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:1-62`,
`ghl-automations/TRACK_STUDENT.md:1-10`,
`memory/MONTELLI_OBJECTION_HANDLING.md:1-33`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must distinguish between operator actions
(contact, data collection, evaluation, handoff) and closer actions (negotiation,
offer generation, contract). Software must not perform closer actions.

### 1.3 What Success Looks Like

**BUSINESS RULE:** A lead is successfully processed when the operator has
completed contact, collected the required information, evaluated the deal type,
and handed the lead to the closer team. The closer team then generates the
offer, negotiates, and closes the transaction.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:70-115`,
`ghl-automations/TRACK_STUDENT.md:122-149`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may track completion of operator work but
must not mark closer work as complete without closer confirmation.

### 1.4 Who Is Responsible

**BUSINESS RULE:** The operator (Montelli) is responsible for Stages 1 through
3: initial contact, data collection, deal evaluation, and handoff. The closer
team (Kayla, Jaxon, Seth) is responsible for offer generation, negotiation,
contract, and closing. The operator monitors but does not control later stages.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:4-10`,
`memory/REI_STAGE_BY_STAGE_GUIDE.md:7-14`,
`memory/MONTELLI_OBJECTION_HANDLING.md:20-32`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must enforce role boundaries. The operator
console must not expose closer-only actions. The closer interface must not
expose operator-only actions.

### 1.5 What Automation May Never Replace

**BUSINESS RULE:** Automation may never replace the operator's judgment about
whether a lead is ready to advance. Automation may never replace the closer's
negotiation. Automation may never send a message, place a call, or move a stage
without explicit operator or closer confirmation.

**SOURCE:** `docs/atlas-kayla-course-parity-spec.md:34-41`,
`ghl-automations/TRACK_STUDENT.md:14-16`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Every automated action must require explicit human
confirmation. No autonomous sends, calls, or stage movements are permitted.

---

## SECTION 2: GENERAL OPERATING PRINCIPLES

### 2.1 Research First

**BUSINESS RULE:** Before contacting anyone, review the lead source, property
address, listing information, and available contact data. Understand who you are
calling and why.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:10-13`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:70-75`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may display available lead data before the
operator begins contact work. Software must not fabricate missing data.

### 2.2 Save Contact First

**BUSINESS RULE:** Before calling, save the contact in your phone with the
contact type and property address. This ensures the call appears with your name
instead of "Unknown Caller."

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:10-13`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:70-75`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may prompt the operator to save the contact
before calling. Software may display the contact name and property address for
the operator to copy.

### 2.3 Send INT Before Every Call

**BUSINESS RULE:** Send the INT text shortcut before every call. This makes
your name appear as the caller ID instead of an unknown number.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:10,235-237`,
`lead-tracking/KAYLA_COACHING_REFERENCE.md:10-13`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:70-73`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must require INT confirmation before
displaying call scripts. Software must not treat INT alone as completed contact.

### 2.4 Call Twice Before No-Answer Handling

**BUSINESS RULE:** If the contact does not answer, call a second time. Only
after two unanswered calls may the operator proceed to the no-answer sequence
(voice memo and NOA text).

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:71-73`,
`ghl-automations/TRACK_STUDENT.md:45-48`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must track call attempts and block no-answer
content until two unanswered calls are recorded.

### 2.5 Record Notes During and After Every Call

**BUSINESS RULE:** Take detailed notes during every call. Record the date, time,
who was contacted, what was discussed, and all property and contact information
collected. Enter notes immediately after the call.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:76-85`,
`airei-course-notes/02-STEP3-Pt1-Leads-to-CRM-AI-Offer-System.txt:21-26`,
`ai-rei/kay-exclusive/List kickoff_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may provide a structured notes template.
Software must not create notes without operator confirmation.

### 2.6 Send CCC and Contact Card After Every Completed Call

**BUSINESS RULE:** After every completed call, send the CCC text shortcut and
your contact card. This provides credibility and gives the contact a way to
save your information.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:13,235-237`,
`lead-tracking/KAYLA_COACHING_REFERENCE.md:29-31`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:87-88,360-362`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must not offer CCC before a completed call is
recorded. CCC is not available on a no-answer path.

### 2.7 Always Ask About Other Properties

**BUSINESS RULE:** Always ask whether the contact has any other properties they
are looking to offload. Many property owners have multiple properties.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:34-37`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:125-126,360-361`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may include this question in the required
questions list. Software must not assume the answer.

### 2.8 Use Realignment Language, Not Follow-Up Language

**BUSINESS RULE:** Never say "just checking in" or "just following up." Use
"realign," "finding some time," or "clarification" instead. This plants
confidence, not uncertainty.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:223-233`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:350-359`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must use realignment language in any
operator prompts or suggested messages. Software must not generate
"checking in" or "following up" language.

### 2.9 Never Negotiate Outside Authority

**BUSINESS RULE:** The operator never negotiates price, terms, down payment,
interest rate, or contract details. The operator relays all questions, counters,
and objections to the closer team. The operator's only response to any objection
or counter is: "Noted — I'll relay that to my business partner and get back with
you."

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:1-33`,
`ghl-automations/TRACK_STUDENT.md:143-146`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must not generate counter-offers, price
adjustments, or negotiation language. Software may display the relay script.

### 2.10 Relay to Closer Team When Required

**BUSINESS RULE:** When a lead is hot (seller engaged, counter received, offer
being presented), immediately relay to Kayla, Jaxon, or Seth. The operator
stops and the closer team takes over.

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:96-117`,
`ghl-automations/TRACK_STUDENT.md:122-149`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may display handoff instructions. Software
must not send handoff messages without operator confirmation.

### 2.11 Stay Warm With the Seller

**BUSINESS RULE:** After handoff, the operator stays in contact with the seller
every 3-5 days until closing. The operator does not negotiate but maintains the
relationship.

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:17,31`,
`docs/atlas-kayla-course-parity-spec.md:57`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may track days since last contact and prompt
the operator. Software must not send warmth messages without operator
confirmation.

### 2.12 Smile and Speak Slowly

**BUSINESS RULE:** Your energy is your currency. Smile while speaking. Speak
slowly. Be warm, cheerful, and patient.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:27,57,87,241`,
`lead-tracking/KAYLA_COACHING_REFERENCE.md:105-107`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may display this reminder before call
scripts. This is a human behavior rule with no software enforcement.

---

## SECTION 3: STAGE DIRECTORY

### Stage 1: Lead Entered

**Purpose:** A new lead has been entered into the system. The operator must
review the lead, identify the contact path, send INT, make calls, collect
initial property and contact information, and complete the first-contact work.

**Entry Meaning:** A lead exists with a property address and at least one
contact route. The operator has not yet contacted anyone for this lead.

**Exit Meaning:** The operator has completed contact, collected the required
information, sent CCC and contact card (if call completed), or completed the
no-answer sequence (if no answer after two calls). Notes are recorded.

**Responsible Person:** Operator (Montelli).

**Completion Definition:** All of the following are complete:
- Contact path is established (listing agent, direct seller, FSBO, PPC, or broker).
- INT has been sent.
- At least one call attempt has been made.
- If call completed: required property and contact information is collected or
  explicitly marked unknown/not provided where allowed.
- If call completed: CCC and contact card have been sent.
- If no answer after two calls: voice memo and NOA have been sent.
- Notes are recorded.

**Blocking Conditions:**
- Contact path is not established (RESEARCH_REQUIRED).
- INT has not been sent.
- No call attempt has been made.
- Required information is unresolved and not marked unknown/not provided.
- Notes are not recorded.

**Related Scripts:** AGENT_INITIAL, SELLER_INITIAL, SELLER_REHAB.

**Related Shortcuts:** INT, NOA, CCC.

**Related Questions:** Contact name, contact phone, contact email, roof age,
HVAC age, occupancy, rent (if occupied), lease terms (if rented), utilities,
listing feedback (agent path), buyer feedback (agent path), seller flexibility,
other properties.

**Related Documents:**
- `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:10-13,25-81,176-180,235-237`
- `lead-tracking/KAYLA_COACHING_REFERENCE.md:10-61`
- `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:70-88`
- `ghl-automations/TRACK_STUDENT.md:19-50`

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:10-13,25-81,176-180,235-237`,
`lead-tracking/KAYLA_COACHING_REFERENCE.md:10-61`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:70-88`,
`ghl-automations/TRACK_STUDENT.md:19-50`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Stage 1 exit to Contact Made is currently blocked by
a course conflict (see Section 14). The operator may complete Stage 1 work, but
automatic stage movement must not occur until the conflict is resolved.

### Stage 2: Contact Made

**Purpose:** The operator has made contact with the listing agent, seller, or
representative. The operator now reviews the collected information, confirms
contact details, evaluates the deal type, and prepares the lead for handoff to
the closer team.

**Entry Meaning:** Contact has been made. A conversation occurred. Notes are
populated with the information collected during the call.

**Exit Meaning:** The operator has confirmed contact details, evaluated the deal
type (turnkey or renovation), and prepared the lead for handoff. The closer team
has been notified.

**Responsible Person:** Operator (Montelli).

**Completion Definition:** All of the following are complete:
- Contact details (name, phone, email) are confirmed.
- Property facts (roof/HVAC, occupancy, rent/lease if occupied, utilities) are
  confirmed or marked unknown/not provided where allowed.
- CCC and contact card have been sent (if not already confirmed in Stage 1).
- Deal type has been evaluated: turnkey/good condition or needs renovation.
- If turnkey: rental comps have been checked.
- If renovation: rehab estimate and market rent have been noted.
- Handoff information has been prepared for the closer team.

**Blocking Conditions:**
- Contact details are not confirmed.
- Required property facts are unresolved and not marked unknown/not provided.
- CCC and contact card are not confirmed.
- Deal type has not been evaluated.

**Related Scripts:** AGENT_INITIAL (review), SELLER_INITIAL (review).

**Related Shortcuts:** CCC, F50, F10.

**Related Questions:** Contact name, contact phone, contact email, roof age,
HVAC age, occupancy, rent, lease terms, utilities, listing feedback, buyer
feedback, seller flexibility, other properties, property condition, repair
estimate, asking price, seller motivation, seller timeline.

**Related Documents:**
- `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:13,18-19,204-219,235-237`
- `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100`
- `ghl-automations/TRACK_STUDENT.md:70-102`
- `memory/REI_STAGE_BY_STAGE_GUIDE.md:35-48`

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:13,18-19,204-219,235-237`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100`,
`ghl-automations/TRACK_STUDENT.md:70-102`,
`memory/REI_STAGE_BY_STAGE_GUIDE.md:35-48`

**CLASSIFICATION:** `COURSE_EXPLICIT` for data review, deal evaluation, and
handoff preparation. `COURSE_CONFLICT` for exact exit trigger (see Section 14).

**IMPLEMENTATION NOTES:** Stage 2 exit to Offer Ready is blocked by a course
conflict (see Section 14). The exact event that moves Contact Made to Offer
Ready is not resolved across all authoritative sources. The operator may
complete Stage 2 work, but automatic stage movement must not occur until the
conflict is resolved.

### Stage 3: Offer Ready to be Sent to Seller

**Purpose:** The lead has been evaluated and is ready for an offer. The closer
team generates the offer. The operator waits for the offer to be ready and then
sends it to the seller.

**Entry Meaning:** The deal has been evaluated. Required information is
available. The closer team has been notified and is generating the offer.

**Exit Meaning:** The offer has been sent to the seller. The 48-hour feedback
clock has started.

**Responsible Person:** Operator (Montelli) with closer team (Kayla, Jaxon,
Seth).

**Completion Definition:**
- Comps and underwriting have been run (by closer team or system).
- Offer has been generated (by closer team).
- Offer has been sent to the seller (by closer team or AI system).
- Offer sent date has been recorded.
- Operator confirms delivery.

**Blocking Conditions:**
- Required property and contact information is missing.
- Comps have not been run.
- Offer has not been generated.
- Offer has not been approved.

**Related Scripts:** None (operator relays, closer generates).

**Related Shortcuts:** GCJ.

**Related Questions:** ARV, monthly rent, purchase price, repair estimate,
strategy selection.

**Related Documents:**
- `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100`
- `ghl-automations/TRACK_STUDENT.md:122-149`
- `memory/REI_STAGE_BY_STAGE_GUIDE.md:52-62`

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100`,
`ghl-automations/TRACK_STUDENT.md:122-149`,
`memory/REI_STAGE_BY_STAGE_GUIDE.md:52-62`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The operator does not generate the offer. The closer
team generates the offer. Software may run comps and underwriting as a
recommendation tool but must not send offers without closer approval.

### Stage 4: Offer Sent to Lead

**Purpose:** The offer has been sent to the seller. The operator waits 48 hours
and then calls to confirm receipt and gain feedback.

**Entry Meaning:** The offer has been delivered to the seller or their agent.

**Exit Meaning:** The seller has responded (received, countered, accepted, or
declined) OR the 48-hour feedback window has passed without response.

**Responsible Person:** Operator (Montelli).

**Completion Definition:**
- Offer sent date is recorded.
- After 48 hours, the operator calls to confirm receipt.
- If received: the operator records the confirmation and moves to Offer
  Received.
- If no answer: the operator follows the no-answer escalation path.

**Blocking Conditions:**
- Offer sent date is not recorded.
- 48 hours have not passed (for feedback call).

**Related Scripts:** POST_OFFER_48HR.

**Related Shortcuts:** GCJ, LOI.

**Related Documents:**
- `airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:1-50`
- `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:141-157`
- `memory/REI_STAGE_BY_STAGE_GUIDE.md:66-79`

**SOURCE:** `airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:1-50`,
`lead-tracking/AIREI_SCRIPTS_REFERENCE.md:141-157`,
`memory/REI_STAGE_BY_STAGE_GUIDE.md:66-79`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The 48-hour timer is a business rule, not a software
timer. The operator decides when to call. Software may track the elapsed time
and prompt the operator.

### Stage 5: Offer Received

**Purpose:** The seller has confirmed receipt of the offer and is reviewing it.

**Entry Meaning:** The seller or agent has confirmed they received the offer.

**Exit Meaning:** The seller has responded: accepted, countered, or declined.

**Responsible Person:** Closer team (Kayla, Jaxon).

**Completion Definition:** The seller's response has been recorded and the
appropriate next stage has been selected.

**Blocking Conditions:** Seller has not responded.

**Related Shortcuts:** GCJ.

**Related Documents:**
- `memory/REI_STAGE_BY_STAGE_GUIDE.md:82-95`

**SOURCE:** `memory/REI_STAGE_BY_STAGE_GUIDE.md:82-95`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The closer team controls this stage. The operator
monitors but does not move this stage.

### Stage 6: Offer Ready to Gain Feedback

**Purpose:** Call the seller or agent to gain feedback on the offer.

**Entry Meaning:** The offer has been presented and it is time to gain feedback.

**Exit Meaning:** Feedback has been received and relayed to the closer team, or
no answer was received.

**Responsible Person:** Operator (Montelli).

**Completion Definition:**
- The operator has called using the Gain Feedback script.
- Feedback has been recorded.
- If questions or counters: relayed to closer team.
- If no answer: moved to no-answer escalation.

**Blocking Conditions:** Feedback call has not been made.

**Related Scripts:** POST_OFFER_48HR, GAIN_FEEDBACK.

**Related Shortcuts:** LOI.

**Related Documents:**
- `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:160-167`
- `memory/REI_STAGE_BY_STAGE_GUIDE.md:98-109`

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:160-167`,
`memory/REI_STAGE_BY_STAGE_GUIDE.md:98-109`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The operator relays feedback to the closer team. The
operator does not respond to questions or counters directly.

### Stage 7: No Answer After Offer Ready to Gain Feedback

**Purpose:** The seller did not answer the feedback call. Escalate through the
no-answer sequence.

**Entry Meaning:** Two feedback calls were made with no answer.

**Exit Meaning:** The no-answer sequence has been completed (voice memo, LOI
follow-up, SD text, DOM tracking).

**Responsible Person:** Operator (Montelli).

**Completion Definition:**
- Voice memo has been sent.
- LOI2DAYS text has been sent after 48 hours.
- SD text has been sent.
- Days on Market has been noted.
- Calendar reminder has been set for listing expiry (DOM minus 181 days).

**Blocking Conditions:** No-answer sequence steps are incomplete.

**Related Shortcuts:** LOI2DAYS, SD.

**Related Documents:**
- `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:96-104,196-200`
- `memory/REI_STAGE_BY_STAGE_GUIDE.md:113-124`

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:96-104,196-200`,
`memory/REI_STAGE_BY_STAGE_GUIDE.md:113-124`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** DOM tracking and 181-day calendar reminder are
business rules. Software may calculate the date but must not set calendar
entries without operator confirmation.

### Stage 8: Seller Declined Offer

**Purpose:** The seller declined the offer. Begin nurture and circle-back
process.

**Entry Meaning:** The seller has explicitly declined or the no-answer
escalation has been exhausted.

**Exit Meaning:** The nurture cycle is active. The lead may be revisited at
listing expiry or after 30 days.

**Responsible Person:** Operator (Montelli).

**Completion Definition:**
- SD text has been sent.
- The operator has asked about other properties.
- Days on Market has been noted.
- Listing expiry circle-back date has been calculated (DOM minus 181 days).
- 30-day revisit has been scheduled.

**Blocking Conditions:** Nurture steps are incomplete.

**Related Shortcuts:** SD.

**Related Documents:**
- `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:196-200`
- `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:118-123,208`

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:196-200`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:118-123,208`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The nurture cycle is a business process. Software may
track dates but must not automatically re-engage.

### Stage 9: Active Negotiation

**Purpose:** The seller has countered or is actively negotiating. The closer
team handles all negotiation.

**Entry Meaning:** A counter-offer has been received or the seller is engaged
in negotiation.

**Exit Meaning:** Terms have been agreed or the seller has declined.

**Responsible Person:** Closer team (Kayla, Jaxon).

**Completion Definition:** The closer team has completed negotiation and the
outcome has been recorded.

**Blocking Conditions:** Negotiation is ongoing.

**Related Documents:**
- `memory/MONTELLI_OBJECTION_HANDLING.md:1-33`

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:1-33`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The operator does not participate in negotiation. The
operator relays only.

### Stage 10: Terms Agreed

**Purpose:** The seller has agreed to terms. The closer team drafts the
contract.

**Entry Meaning:** Terms have been verbally agreed.

**Exit Meaning:** Contract has been drafted and sent.

**Responsible Person:** Closer team (Kayla).

**Completion Definition:** Contract has been drafted and sent to the seller.

**Blocking Conditions:** Contract has not been drafted.

**Related Documents:**
- `memory/REI_STAGE_BY_STAGE_GUIDE.md` (Stage 10 section)

**SOURCE:** `memory/REI_STAGE_BY_STAGE_GUIDE.md` (Stage 10 section)

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The operator monitors and stays warm with the seller
every 3-5 days. The operator does not draft or send contracts.

### Stages 11-21: Contract Through Closing

**Purpose:** Stages 11 through 21 cover contract execution, title work,
inspection, appraisal, joint venture agreements, wire setup, and closing.

**Responsible Person:** Closer team (Kayla, Jaxon, Seth) and transaction
coordinator.

**Operator Role:** Monitor only. Stay warm with the seller every 3-5 days. Do
not move stages. Do not negotiate. Do not sign.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:4-10`,
`memory/REI_STAGE_BY_STAGE_GUIDE.md:7-14`,
`memory/MONTELLI_OBJECTION_HANDLING.md:17,31`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Stages 11-21 are view-only for the operator console.
The operator may view status and receive prompts to stay warm with the seller.
No operator actions are permitted in these stages.

---

## SECTION 4: CONTACT PATHS

### 4.1 Listing Agent Path

**How It Begins:** The lead source indicates a listed property with an agent.
The operator identifies the listing agent from the lead data or property
listing.

**When It Is Used:** When the property is listed on the MLS and the listing
agent is the primary contact.

**How It Transitions:** The operator sends INT to the listing agent, calls using
the AGENT_INITIAL script, collects property and contact information, and sends
CCC and contact card after the completed call.

**Required Information:**
- Agent name, phone, email.
- Seller name, phone, email (if agent provides).
- Roof age, HVAC age.
- Occupancy (occupied or vacant).
- If occupied: rent amount, lease type, when signed.
- If vacant: why not rented out.
- Utilities status.
- Buyer/listing feedback.
- Other properties.

**Applicable Scripts:** AGENT_INITIAL.

**Applicable Shortcuts:** INT, CCC.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:25-51`,
`lead-tracking/KAYLA_COACHING_REFERENCE.md:10-37`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:132-154`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The operator must confirm whether the agent can
provide seller contact information. If the agent cannot or will not, the
operator records what is available and notes the limitation.

### 4.2 Broker Path

**How It Begins:** The lead source indicates a broker is the contact.

**When It Is Used:** When a broker, rather than a specific listing agent, is the
primary contact for the property.

**How It Transitions:** Same as Listing Agent path. The operator uses the
AGENT_INITIAL script.

**Required Information:** Same as Listing Agent path.

**Applicable Scripts:** AGENT_INITIAL.

**Applicable Shortcuts:** INT, CCC.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:25-51`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The broker path is treated identically to the listing
agent path for contact and data collection purposes.

### 4.3 Direct Seller Path

**How It Begins:** The lead source indicates a direct seller (not represented
by an agent). The operator contacts the seller directly.

**When It Is Used:** When the seller is the primary contact and no agent is
involved.

**How It Transitions:** The operator sends INT to the seller, calls using the
SELLER_INITIAL script, collects property and contact information, and sends CCC
and contact card after the completed call.

**Required Information:**
- Seller name, phone, email.
- Roof age, HVAC age.
- Occupancy (occupied or vacant).
- If occupied: rent amount, lease type, when signed.
- If vacant: why not rented out.
- Utilities status.
- Asking price.
- Other properties.

**Applicable Scripts:** SELLER_INITIAL, SELLER_REHAB.

**Applicable Shortcuts:** INT, CCC.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:55-81`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:156-165`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The operator must confirm the asking price. The
operator does not negotiate price.

### 4.4 FSBO Seller Path

**How It Begins:** The lead source indicates a For Sale By Owner property.

**When It Is Used:** When the property is listed as FSBO and the seller is the
primary contact.

**How It Transitions:** Same as Direct Seller path. The operator uses the
SELLER_INITIAL script.

**Required Information:** Same as Direct Seller path.

**Applicable Scripts:** SELLER_INITIAL, SELLER_REHAB.

**Applicable Shortcuts:** INT, CCC.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:55-81`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The FSBO path is treated identically to the direct
seller path for contact and data collection purposes.

### 4.5 PPC Seller Path

**How It Begins:** The lead source indicates a Pay Per Click or inbound seller
lead. The seller has expressed interest in selling.

**When It Is Used:** When the lead came through PPC advertising or inbound
inquiry.

**How It Transitions:** The operator sends the PPC intro text, calls using the
PPC-specific script, collects property and contact information including
condition rating and photos, and sends the PPC contact card shortcut.

**Required Information:**
- Seller name, phone, email.
- Beds and baths.
- Property condition rating (1-10).
- What it needs to be a 10.
- Roof age, HVAC age.
- Whether it was a rental.
- Occupancy (vacant or occupied).
- If occupied by tenants: rent, when signed, lease type.
- Why opposed to a real estate agent.
- Net price desired.
- Interior photos.

**Applicable Scripts:** PPC process script.

**Applicable Shortcuts:** PIN, PNOA, PCC, PC, PGC, PPH.

**SOURCE:** `ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt`,
`ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Text Shortcuts_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** PPC has its own set of shortcuts (PIN, PNOA, PCC, PC,
PGC, PPH) that differ from the standard shortcuts. The PPC process includes a
photo requirement before offer preparation. The PPC group chat (PGC) introduces
Kayla directly.

### 4.6 Unknown / Research Required Path

**How It Begins:** The lead source does not provide enough information to
determine the contact path. The operator cannot identify whether to contact a
listing agent, broker, seller, or other party.

**When It Is Used:** When the lead data is insufficient to establish a contact
path.

**How It Transitions:** The operator must research the lead. Review the lead
source, listing information, and available contact data. Identify whether the
property is listed (agent path) or off-market (seller path). Do not proceed
with contact until the path is established.

**Required Information:** Lead source, listing status, available contact data.

**Applicable Scripts:** None until path is established.

**Applicable Shortcuts:** None until path is established.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:19-50`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:70-75`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must not display scripts, shortcuts, or
contact instructions when the contact path is RESEARCH_REQUIRED. Software must
prompt the operator to research the lead and establish the path.

---

## SECTION 5: TEXT SHORTCUTS

### INT — Intro Text

**Purpose:** Send before every call so the contact's phone recognizes your name
instead of showing "Unknown Caller."

**Exact Wording:** `[Name], are you still accepting offers for [address]? My name is [your name], I'm looking to purchase this as a rental for my portfolio.`

**Audience:** Listing agent, broker, direct seller, FSBO seller.

**Trigger:** Before every call.

**Preconditions:** Contact path is established. Contact name and property
address are known.

**Postconditions:** INT has been sent. Operator may now call.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:10,235-237`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** INT must be confirmed before call scripts are
displayed. INT alone does not constitute completed contact.

### CCC — Contact Card

**Purpose:** Send after every completed call. Provides credibility and gives the
contact a way to save your information.

**Exact Wording:** `It is great aligning with you [name], I look forward to connecting the dots with you shortly at [address]. Feel free to browse through our closings with similar clients on our website — Divinity Aligned LLC: Expert Solutions for Life's Major Transitions`

**Audience:** Listing agent, broker, direct seller, FSBO seller.

**Trigger:** After every completed call.

**Preconditions:** A call was completed. Contact name and property address are
known.

**Postconditions:** CCC has been sent. Contact card has been sent.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:13,235-237`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** CCC must not be offered before a completed call is
recorded. CCC is not available on a no-answer path. CCC must not be sent merely
because INT was sent.

### NOA — No Answer

**Purpose:** Send after two unanswered calls as a short follow-up.

**Exact Wording:** `Are you still accepting offers for [address]?`

**Audience:** Listing agent, broker, direct seller, FSBO seller.

**Trigger:** After two unanswered calls.

**Preconditions:** Two call attempts were made with no answer. Voice memo has
been sent.

**Postconditions:** NOA has been sent.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:11,176-180`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** NOA must not be available until two unanswered calls
are recorded. NOA must not be available after only one unanswered call.

### DNCT — Do Not Call Text

**Purpose:** Alternative intro when calling is not appropriate (Do Not Call
context).

**Exact Wording:** `[Name], would you be opposed to accepting an offer for [address]? My name is [name], I'm looking at purchasing as a rental for my portfolio.`

**Audience:** Agent or seller on Do Not Call list.

**Trigger:** When calling is not appropriate and the contact is not opted out.

**Preconditions:** Contact is on Do Not Call list. Contact is not opted out.

**Postconditions:** DNCT has been sent.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:12`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** DNCT is a text-only alternative. It does not replace
a call when calling is permitted.

### F50 — 50% Down Creative Proposal

**Purpose:** Propose a creative financing structure: 50% down now, remainder in
one lump sum in the near future.

**Exact Wording:** `Happy [day]! I understand your intent to sell outright, would you be completely opposed to taking half your price now and the rest in one lump sum in the near future?`

**Audience:** Seller (turnkey or good condition property).

**Trigger:** After evaluating the deal as turnkey/good condition. The seller
wants to sell outright.

**Preconditions:** Deal has been evaluated as turnkey. Contact has been made.
Property facts are known.

**Postconditions:** F50 has been sent. Seller response is awaited.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:18,204-207`

**CLASSIFICATION:** `COURSE_EXPLICIT` for wording. `COURSE_CONFLICT` for exact
trigger in the pipeline (see Section 14).

**IMPLEMENTATION NOTES:** The exact event that authorizes sending F50 in the
pipeline is unresolved. F50 may be a Facebook Marketplace prospecting tool, a
Stage 2 evaluation option, or both. Software must not send F50 without
clarification of the authoritative trigger.

### F10 — 10% Down Creative Proposal

**Purpose:** Propose a creative financing structure: 10% down now, remainder in
24 months.

**Exact Wording:** `Happy [day]! I understand your intent to sell outright, would you be completely opposed to taking 10% of your price now and the rest in one lump sum in just 24 months?`

**Audience:** Seller (older or renovation property).

**Trigger:** After evaluating the deal as needing renovation or being an older
property. The seller wants to sell outright.

**Preconditions:** Deal has been evaluated as renovation/older. Contact has been
made. Property facts are known.

**Postconditions:** F10 has been sent. Seller response is awaited.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:19,210-219`

**CLASSIFICATION:** `COURSE_EXPLICIT` for wording. `COURSE_CONFLICT` for exact
trigger in the pipeline (see Section 14).

**IMPLEMENTATION NOTES:** Same conflict as F50. The exact event that authorizes
sending F10 in the pipeline is unresolved.

### GCJ — Group Chat with Jaxon

**Purpose:** Create a group chat with the closer (Jaxon) and the seller or
agent. Introduces the closer and transitions the lead to the closer team.

**Exact Wording:** `[Name] - happy [day]! Creating a group chat for the purchase on [address] with my business partner Jaxon. He is currently in a meeting with our lender; The LOI will be coming from our partner at Homewithkaylamauser@gmail.com ; simply inform us it has been received for presentation, and also ensure to check other folders as well. Have a blessed rest of the week!`

**Audience:** Seller or agent.

**Trigger:** When the lead is hot and ready for closer handoff. The seller is
engaged and an offer is being prepared or has been sent.

**Preconditions:** Contact has been made. The lead is hot (seller engaged,
counter received, or offer being presented).

**Postconditions:** Group chat has been created. Closer team has been
introduced. Operator steps back from active negotiation.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:14`,
`memory/MONTELLI_OBJECTION_HANDLING.md:96-117`

**CLASSIFICATION:** `COURSE_EXPLICIT` for wording. `COURSE_CONFLICT` for exact
timing (see Section 14).

**IMPLEMENTATION NOTES:** Sources conflict on whether GCJ is sent at Stage 2
(Contact Made), Stage 3 (Offer Ready), Stage 4 (Offer Sent), or only when the
lead is hot. Software must not send GCJ without clarification of the
authoritative trigger.

### LOI — Letter of Intent Follow-Up

**Purpose:** Follow up after the LOI has been sent to check for feedback.

**Exact Wording:** `Happy [day]! For the intent of my call — I have just now found some time to iron out any further details regarding the offer we had finalized. Have you gained any initial feedback from your seller just yet?`

**Audience:** Agent.

**Trigger:** After the offer or LOI has been sent and the operator is following
up for feedback.

**Preconditions:** Offer or LOI has been sent.

**Postconditions:** LOI follow-up has been sent.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:15`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** LOI is a post-offer shortcut, not a Stage 1 or Stage
2 shortcut.

### LOI2DAYS — 48-Hour No-Reply Follow-Up

**Purpose:** Sent 48 hours after LOI with no response.

**Exact Wording:** `Happy Sunday! I hate to be a bother — We spoke recently. I was curious: did you end up losing the listing or did your seller just give up on selling?`

**Audience:** Agent.

**Trigger:** 48 hours after LOI was sent with no response.

**Preconditions:** LOI was sent. 48 hours have passed. No response received.

**Postconditions:** LOI2DAYS has been sent.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:96-104`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** LOI2DAYS is a post-offer escalation shortcut, not a
Stage 1 or Stage 2 shortcut.

### SD — Seller Declined

**Purpose:** Sent when the seller declines the offer. Keeps the door open for
future opportunities.

**Exact Wording:** `Happy Wednesday! Thank you for the update – feel free to revisit this right before the listing expires if your seller has not been able to find their number with owner occupants. Wishing you a smooth closing – feel free to keep us in mind for the future if you have listings that can't sell out right and are owned outright. This would be a great solution for homeowners who aren't seeing the outright number they're hoping for. Buy-box: Red States (Landlord Friendly) Turnkey Properties Single Family & Multi Family $150,000 - $550,000 3 bed + 10k + Population No HOA's No pools No flood zones`

**Audience:** Agent or seller.

**Trigger:** Seller has declined the offer or the no-answer escalation has been
exhausted.

**Preconditions:** Offer was sent. Seller declined or no response after
escalation.

**Postconditions:** SD has been sent. DOM has been noted. Listing expiry
circle-back date has been calculated.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:17,196-200`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** SD is a post-offer decline shortcut, not a Stage 1 or
Stage 2 shortcut.

### PEND — Property Pending

**Purpose:** Sent when a property goes pending. Keeps the offer in the agent's
back pocket.

**Exact Wording:** `[Agent Name], happy [day]! I came across your listing at [address] and noticed it's pending. Congratulations, that's exciting! Wishing you a smooth closing — Feel free to keep my offer in your back pocket; I'm intending to acquire this as a rental property. I'm gonna give my DSCR Lender a quick call and send an offer over if I get approved. Feel free to browse through my closings with similar clients on our website — Divinity Aligned LLC: Expert Solutions for Life's Major Transitions`

**Audience:** Agent.

**Trigger:** Property has gone under contract with another buyer.

**Preconditions:** Property was previously in the pipeline. Property is now
pending.

**Postconditions:** PEND has been sent.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:16`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** PEND is a monitoring shortcut, not a Stage 1 or Stage
2 shortcut.

### PPC Shortcuts

**Purpose:** PPC-specific shortcuts for the Pay Per Click seller path.

**Shortcuts:**
- **PIN:** PPC intro text sent before calling.
- **PNOA:** PPC no-answer text sent after two unanswered calls.
- **PCC:** PPC contact card sent after call when photos are needed.
- **PC:** PPC contact card sent after call when photos are available.
- **PGC:** PPC group chat intro to closer when offer is ready.
- **PPH:** PPC follow-up when photos are still needed.

**Audience:** PPC seller.

**Trigger:** Per the PPC process for each shortcut.

**SOURCE:** `ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Text Shortcuts_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** PPC shortcuts are separate from the standard
shortcuts. They apply only to the PPC contact path.

---

## SECTION 6: CALL SCRIPTS

### 6.1 Agent Initial Script

**Purpose:** Contact a listing agent or broker about a listed property. Collect
property and contact information.

**Required Questions:**
- Confirm the agent's name.
- Have you received any feedback from other buyers who walked the property?
- When was the roof last installed?
- When was the HVAC last installed?
- Is the property currently occupied or vacant?
- If occupied: Is the owner living in it or is it being rented out?
- If rented: What is the current rent? When did they sign? What kind of lease?
- If vacant: Why wouldn't the seller just rent it out?
- Are utilities still on?
- Is there a good email I can send details to?

**Optional Questions:**
- Do you have any other properties you're looking to offload?
- What is the seller's name and contact information?
- Would the seller consider creative terms?

**Required Notes:**
- Agent name, phone, email.
- Seller name, phone, email (if provided).
- Roof age, HVAC age.
- Occupancy status.
- Rent amount, lease type, lease term (if occupied).
- Utilities status.
- Buyer/listing feedback.
- Date and time of call.

**Completion:** The operator has asked all required questions and recorded all
available answers. CCC and contact card have been sent.

**Next Step:** Evaluate the deal type. If turnkey, check rental comps. If
renovation, note rehab estimate. Prepare handoff to closer team.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:25-51`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The script wording is exact and must not be modified.
Software may display the script but must not alter the wording.

### 6.2 Seller Initial Script

**Purpose:** Contact a direct seller or FSBO seller about their property.
Collect property and contact information.

**Required Questions:**
- Are you still accepting offers at [property address]?
- When was the roof last installed?
- When was the HVAC last installed?
- Is the property currently occupied or vacant?
- If occupied: Are you living in it or is it being rented out?
- If rented: What is the current rent? When did they sign? What kind of lease?
- If vacant: Why wouldn't you just rent it out?
- Are utilities still on?
- Can I confirm that asking price?
- Is there a good email I can send details to?

**Optional Questions:**
- Do you have any other properties you're looking to offload?
- What is your timeline?
- Would you consider creative terms?

**Required Notes:**
- Seller name, phone, email.
- Roof age, HVAC age.
- Occupancy status.
- Rent amount, lease type, lease term (if occupied).
- Utilities status.
- Asking price.
- Date and time of call.

**Completion:** The operator has asked all required questions and recorded all
available answers. CCC and contact card have been sent.

**Next Step:** Evaluate the deal type. If turnkey, check rental comps. If
renovation, note rehab estimate. Prepare handoff to closer team.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:55-81`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The script wording is exact and must not be modified.

### 6.3 Seller Rehab Script

**Purpose:** Contact a seller about a property that needs renovation. Collect
property condition and contact information.

**Required Questions:**
- When was the roof last installed?
- When was the HVAC last installed?
- How would you rate the property condition, 1 to 10?
- What would it need to be a 10?
- Is the property currently occupied or vacant?
- If occupied: Are you living in it or is it being rented out?
- If rented: What is the current rent? When did they sign? What kind of lease?
- If vacant: What has you opposed to putting a few bucks in and making a profit?
- Are utilities still on?
- What are you looking to net on this price wise?
- What is the best email I can send details to?

**Optional Questions:**
- Do you have any other properties you're looking to offload?

**Required Notes:**
- Seller name, phone, email.
- Roof age, HVAC age.
- Property condition rating.
- Needed repairs.
- Occupancy status.
- Rent amount, lease type, lease term (if occupied).
- Utilities status.
- Desired net price.
- Date and time of call.

**Completion:** The operator has asked all required questions and recorded all
available answers. CCC and contact card have been sent.

**Next Step:** Note rehab estimate and market rent. Prepare renovation handoff
to closer team.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:85-113`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The rehab script is used when the property clearly
needs renovation. The operator must not use this script for turnkey properties.

### 6.4 PPC Process Script

**Purpose:** Contact a PPC or inbound seller lead. Collect detailed property and
contact information including condition and photos.

**Required Questions:**
- How many beds and baths?
- How would you rate the property condition, 1 to 10?
- What would it need to be a 10?
- When was the roof and HVAC last installed?
- Was this property a rental for you?
- Is the property vacant or occupied?
- If occupied by tenants: What is the rent? When did they sign? What kind of
  lease?
- Why are you opposed to a real estate agent?
- What number are you hoping to net?

**Required Notes:**
- Seller name, phone, email.
- Beds and baths.
- Property condition rating.
- Needed repairs.
- Roof age, HVAC age.
- Rental history.
- Occupancy status.
- Rent amount, lease type, lease term (if occupied).
- Desired net price.
- Date and time of call.

**Completion:** The operator has asked all required questions and recorded all
available answers. PPC contact card has been sent. Photos have been requested.

**Next Step:** If photos received and deal fits, loop Kayla into group chat
(PGC). Kayla reaches out with an offer.

**SOURCE:** `ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The PPC process is distinct from the standard agent
and seller paths. It has its own script, shortcuts, and photo requirement.

### 6.5 Post-Offer 48-Hour Script

**Purpose:** Call the seller or agent 48 hours after the offer was sent to
confirm receipt and gain feedback.

**Required Questions:**
- We sent an offer over to you. Is there any clarification I can align further
  regarding the details of our offer?

**Required Notes:**
- Date and time of call.
- Whether the offer was received.
- Any feedback, questions, or counters from the seller.
- Next action.

**Completion:** The operator has called, recorded the response, and relayed any
questions or counters to the closer team.

**Next Step:** If received: move to Offer Received. If no answer: follow
no-answer escalation.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:141-157`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** This script is used at Stage 4 (Offer Sent) and Stage
6 (Gain Feedback), not at Stage 1 or Stage 2.

### 6.6 Voice Memo Script (No Answer)

**Purpose:** Leave a voice memo after two unanswered calls.

**Exact Wording:** `Happy [day] [name], just tried to call you regarding the purchase of your property on [address]. I'm going to call my DSCR lender to get approved, they simply just look at the rental income. Going to loop you into a group chat with my business partner Jaxon - have a blessed evening.`

**Trigger:** After two unanswered calls.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:176-180`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The voice memo is part of the no-answer sequence. It
must not be offered after only one unanswered call.

---

## SECTION 7: DATA COLLECTION

### 7.1 Contact Name

**Question:** Confirm the contact name.

**Why It Matters:** The operator must know who they spoke with for notes,
follow-up, and handoff.

**Who Answers It:** The contact (agent, broker, or seller).

**Mandatory:** Yes.

**Conditional:** No.

**Optional:** No.

**Unknown Allowed:** No. The operator must confirm the name during the call.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:25-51,55-81`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:76-85`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Contact name is required for all paths. Software must
not proceed without it.

### 7.2 Contact Phone

**Question:** Confirm the contact phone.

**Why It Matters:** The operator needs the phone number for calls, texts, and
follow-up.

**Who Answers It:** The contact or lead data.

**Mandatory:** Yes.

**Conditional:** No.

**Optional:** No.

**Unknown Allowed:** No. The phone number must be available from lead data or
confirmed during the call.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:25-51,55-81`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:76-85`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Contact phone is required for all paths.

### 7.3 Contact Email

**Question:** Is there a good email I can send details to?

**Why It Matters:** The operator and closer team need email for sending offers,
LOIs, and follow-up.

**Who Answers It:** The contact.

**Mandatory:** Yes.

**Conditional:** No.

**Optional:** No.

**Unknown Allowed:** No. The operator must ask for email during the call.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:49-51,79-81`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:76-85`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Contact email is required for all paths. The operator
should verify the email back letter by letter.

### 7.4 Roof Age

**Question:** When was the roof last installed?

**Why It Matters:** Roof age affects property condition assessment, repair
estimates, and offer calculations.

**Who Answers It:** The contact (agent, broker, or seller).

**Mandatory:** Yes.

**Conditional:** No.

**Optional:** No.

**Unknown Allowed:** Yes. The contact may not know. The operator records
"unknown" or "not provided." Roof age can be obtained from seller disclosures
during contract.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:33,63,91`,
`lead-tracking/KAYLA_COACHING_REFERENCE.md:37,51-52`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:80`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Roof age is required but "unknown" or "not provided"
is an acceptable answer. Software must allow the operator to mark this field as
unknown without blocking completion.

### 7.5 HVAC Age

**Question:** When was the HVAC last installed?

**Why It Matters:** HVAC age affects property condition assessment, repair
estimates, and offer calculations.

**Who Answers It:** The contact (agent, broker, or seller).

**Mandatory:** Yes.

**Conditional:** No.

**Optional:** No.

**Unknown Allowed:** Yes. The contact may not know. The operator records
"unknown" or "not provided."

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:33,63,91`,
`lead-tracking/KAYLA_COACHING_REFERENCE.md:51-52`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:80`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Same as roof age. "Unknown" or "not provided" is
acceptable.

### 7.6 Occupancy

**Question:** Is the property currently occupied or vacant?

**Why It Matters:** Occupancy determines whether rent information is needed and
affects the offer strategy.

**Who Answers It:** The contact.

**Mandatory:** Yes.

**Conditional:** No.

**Optional:** No.

**Unknown Allowed:** No. The operator must determine occupancy during the call.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:35,65,97`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:82`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Occupancy is a required binary field. It determines
which conditional questions apply.

### 7.7 Rent Amount

**Question:** What is the current rent?

**Why It Matters:** Rent income is used for DSCR loan qualification, comps, and
offer calculations.

**Who Answers It:** The contact (if property is rented).

**Mandatory:** Conditional (only if occupied and rented).

**Conditional:** Yes. Only applies when the property is occupied by tenants.

**Optional:** No (when condition applies).

**Unknown Allowed:** No (when condition applies). The operator must ask.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:39,69,101`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:81`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Rent is conditional on occupancy and tenant status.
When the condition applies, the field is mandatory.

### 7.8 Lease Terms

**Question:** When did they sign and what kind of lease are they on?

**Why It Matters:** Lease terms affect the takeover strategy and tenant
accommodation.

**Who Answers It:** The contact (if property is rented).

**Mandatory:** Conditional (only if occupied and rented).

**Conditional:** Yes. Only applies when the property is occupied by tenants.

**Optional:** No (when condition applies).

**Unknown Allowed:** No (when condition applies). The operator must ask.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:39,69,101`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:82`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Lease terms are conditional on occupancy and tenant
status.

### 7.9 Utilities

**Question:** Are utilities still on?

**Why It Matters:** Utilities status affects inspection scheduling and property
condition assessment.

**Who Answers It:** The contact.

**Mandatory:** Yes.

**Conditional:** No.

**Optional:** No.

**Unknown Allowed:** No. The operator must ask.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:45,75,107`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:83`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Utilities status is required for all paths.

### 7.10 Listing Feedback (Agent Path)

**Question:** Have you received any feedback from other buyers who walked the
property?

**Why It Matters:** Buyer feedback reveals property issues, price concerns, and
seller motivation.

**Who Answers It:** The listing agent or broker.

**Mandatory:** Yes (for listing agent and broker paths).

**Conditional:** Yes. Only applies to listing agent and broker paths.

**Optional:** No (when condition applies).

**Unknown Allowed:** Yes. The agent may not have feedback. The operator records
what is available.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:31`,
`lead-tracking/KAYLA_COACHING_REFERENCE.md:22-24`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:84`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Listing feedback is required for agent paths but
"no feedback" or "not available" is an acceptable answer.

### 7.11 Asking Price (Seller Path)

**Question:** Can I confirm that asking price?

**Why It Matters:** The asking price is needed for offer calculations and deal
evaluation.

**Who Answers It:** The seller.

**Mandatory:** Yes (for direct seller, FSBO, and PPC paths).

**Conditional:** Yes. Applies to seller paths.

**Optional:** No (when condition applies).

**Unknown Allowed:** No. The operator must confirm the price.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:77`,
`ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Asking price is required for seller paths. For agent
paths, the listing price is typically available from the MLS.

### 7.12 Property Condition (Rehab/PPC)

**Question:** How would you rate the property condition, 1 to 10? What would it
need to be a 10?

**Why It Matters:** Condition rating determines whether the property is
turnkey or needs renovation, and what repairs are needed.

**Who Answers It:** The seller.

**Mandatory:** Conditional (for rehab and PPC paths).

**Conditional:** Yes. Applies to rehab and PPC paths.

**Optional:** No (when condition applies).

**Unknown Allowed:** No. The operator must ask.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:93-95`,
`ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Property condition is required for rehab and PPC
paths. It is not required for standard agent or seller paths unless the property
clearly needs renovation.

### 7.13 Desired Net Price (Rehab/PPC)

**Question:** What are you looking to net on this price wise?

**Why It Matters:** The seller's net price expectation determines whether a deal
is viable.

**Who Answers It:** The seller.

**Mandatory:** Conditional (for rehab and PPC paths).

**Conditional:** Yes. Applies to rehab and PPC paths.

**Optional:** No (when condition applies).

**Unknown Allowed:** No. The operator must ask.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:109`,
`ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Desired net price is required for rehab and PPC
paths.

### 7.14 Other Properties

**Question:** Do you have any other properties you're looking to offload?

**Why It Matters:** Many property owners have multiple properties. This question
can double, triple, or quadruple the deal flow.

**Who Answers It:** The contact.

**Mandatory:** No.

**Conditional:** No.

**Optional:** Yes. The operator must ask, but the answer does not block
completion.

**Unknown Allowed:** Not applicable. The question is asked; the answer is
recorded.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:34-37`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:125-126,360-361`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** This question must always be asked but does not block
stage completion.

### 7.15 Seller Motivation and Timeline

**Question:** What is your timeline? Why are you selling?

**Why It Matters:** Seller motivation and timeline affect deal urgency, offer
strategy, and negotiation approach.

**Who Answers It:** The seller or agent.

**Mandatory:** No.

**Conditional:** No.

**Optional:** Yes. The operator should ask when appropriate.

**Unknown Allowed:** Yes. The contact may not provide this information.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:15-28`,
`ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT` for PPC path. `COURSE_UNKNOWN` for
whether it is mandatory for all paths.

**IMPLEMENTATION NOTES:** Motivation and timeline are explicitly part of the PPC
process. For other paths, the course does not explicitly require these fields.
Software should not block completion on these fields for non-PPC paths.

### 7.16 Photos (PPC Path)

**Question:** Request interior photos.

**Why It Matters:** Photos are needed for offer preparation in the PPC process.

**Who Answers It:** The seller (provides photos).

**Mandatory:** Conditional (for PPC path).

**Conditional:** Yes. Applies to PPC path.

**Optional:** No (when condition applies).

**Unknown Allowed:** No. Photos must be received before PPC offer preparation.

**SOURCE:** `ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Photos are a PPC-specific requirement. They are not
required for standard agent or seller paths.

---

## SECTION 8: FOLLOW-UP

### 8.1 Post-Offer 48-Hour Follow-Up

**BUSINESS RULE:** After the offer is sent, wait 48 hours. Then call the seller
or agent to confirm receipt and gain feedback. Use the Post-Offer 48-Hour
script. Do not say "following up." Use realignment language.

**SOURCE:** `airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:1-50`,
`lead-tracking/AIREI_SCRIPTS_REFERENCE.md:141-157`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:118-122`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The 48-hour period is a business guideline, not a
strict software timer. The operator decides when to call. Software may track
elapsed time and prompt the operator.

### 8.2 Offer Receipt Confirmation

**BUSINESS RULE:** If the seller or agent confirms receipt of the offer by text
or call before 48 hours, the operator does not need to make the confirmation
call. Record the confirmation and start the feedback clock.

**SOURCE:** `airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:8-14`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may allow the operator to record early
confirmation and skip the confirmation call.

### 8.3 No-Answer Follow-Up

**BUSINESS RULE:** If the contact does not answer the follow-up call, send a
follow-up text. If they text back confirming receipt, do not call again. Mark
48 hours for the feedback call.

**SOURCE:** `airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:97-100`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may track text responses and adjust the
follow-up sequence accordingly.

### 8.4 Gain Feedback Call

**BUSINESS RULE:** 48 hours after the offer was confirmed received, call to gain
feedback. Use the Gain Feedback script. If the seller has questions or
counters, relay to the closer team. Do not answer questions directly.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:160-167`,
`airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:47-61`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The operator relays feedback to the closer team. The
operator does not respond to questions or counters.

### 8.5 Seller Declined Nurture

**BUSINESS RULE:** If the seller declines, send the SD text. Note the Days on
Market. Subtract 181 days. Set a calendar reminder to call when the listing
expires. Ask about other properties.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:196-200`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:118-123,208`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The DOM minus 181 calculation is a business rule.
Software may calculate the date but must not set calendar entries without
operator confirmation.

### 8.6 Stay Warm Every 3-5 Days

**BUSINESS RULE:** After handoff to the closer team, the operator stays in
contact with the seller every 3-5 days until closing. The operator does not
negotiate but maintains the relationship.

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:17,31`,
`docs/atlas-kayla-course-parity-spec.md:57`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may track days since last contact and prompt
the operator. Software must not send warmth messages without operator
confirmation.

---

## SECTION 9: OFFER PROCESS

### 9.1 Offer Generation

**BUSINESS RULE:** The closer team (Kayla, Jaxon, Seth) generates the offer.
The operator does not generate offers. The operator provides the collected
property and contact information to the closer team.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:122-149`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may run comps and underwriting as a
recommendation tool. Software must not generate or send offers without closer
approval.

### 9.2 Deal Evaluation

**BUSINESS RULE:** Before an offer can be generated, the operator must evaluate
the deal type:
- Turnkey / good condition: Property is move-in ready. Check rental comps.
  Screening guidance: we like to see rent approximately 1% of purchase price.
  This is not a mandatory requirement.
- Needs renovation: Property requires work. Note the rehab estimate and market
  rent.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100`,
`ghl-automations/TRACK_STUDENT.md:84-99`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may display the evaluation options. Software
may run rental comps. The operator makes the evaluation decision.

### 9.3 Comps and Underwriting

**BUSINESS RULE:** Before an offer is sent, rental comps should be checked.
For turnkey properties, screening guidance: we like to see rent approximately
1% of purchase price. This is not a mandatory requirement. The closer team runs
full underwriting.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:92-94,276-281,399-404`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may run comps and underwriting calculations.
The results are recommendations, not decisions.

### 9.4 Offer Handoff

**BUSINESS RULE:** When the lead is ready for an offer, the operator notifies
the closer team. For turnkey properties, email Seth at
claytoninvestmentsolutions@gmail.com with subject "FB LOI Request [address]."
For renovation properties, email with subject "Renovation – LOI Request
[address]." Include market rent, purchase price, and rehab estimate.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:94-100`,
`ghl-automations/TRACK_STUDENT.md:122-139`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may draft the handoff email. Software must
not send the email without operator confirmation.

### 9.5 Offer Delivery

**BUSINESS RULE:** The closer team generates and sends the offer. The operator
may send the offer if instructed. After the offer is sent, the operator records
the offer sent date and begins the 48-hour follow-up clock.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:114-115`,
`ghl-automations/TRACK_STUDENT.md:122-139`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may record the offer sent date. Software must
not send offers without closer approval.

---

## SECTION 10: NEGOTIATION

### 10.1 Operator Role in Negotiation

**BUSINESS RULE:** The operator does not negotiate. The operator does not
deliver counters. The operator does not adjust price, terms, down payment, or
interest rate. The operator does not sign anything. The operator does not send
contracts.

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:20-25`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must not generate counter-offers, price
adjustments, or negotiation language. The operator console must not expose
negotiation actions.

### 10.2 The Relay Rule

**BUSINESS RULE:** The operator's only response to any objection, counter, or
question is: "Noted — I'll relay that to my business partner and get back with
you." The operator then immediately relays the exact objection or counter to the
closer team.

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:1-7,28-32`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may display the relay script. Software may
draft the relay message to the closer team. Software must not respond to the
seller directly.

### 10.3 Hot Lead Protocol

**BUSINESS RULE:** A lead is hot when the seller or agent:
- Confirms the offer is being presented.
- Counters with specific terms.
- Says they need to sell.
- Has other buyers circling.
- Asks about down payment, timeline, or closing costs.

On a hot lead:
1. Send GCJ text shortcut to create group chat with closer and seller.
2. Email the closer team with the lead details and counter.
3. The operator stops active engagement. The closer team takes over.
4. The operator stays warm with the seller.

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:96-117`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may detect hot lead indicators and prompt the
operator. Software must not send GCJ or handoff messages without operator
confirmation.

### 10.4 How to Refer to the Team

**BUSINESS RULE:** To the seller or agent, refer to the closer as "my business
partner." In a group chat, use "my business partner Jaxon." The offer comes from
homewithkaylamauser@gmail.com. Always use "we," not "I."

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:36-41`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must use "business partner" language in any
operator prompts. Software must not expose closer names to the seller without
operator confirmation.

---

## SECTION 11: CONTRACT

### 11.1 Contract Responsibility

**BUSINESS RULE:** The closer team (Kayla) drafts and sends the contract. The
operator does not draft, send, or sign contracts. The operator monitors and
stays warm with the seller every 3-5 days.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:122-149`,
`memory/MONTELLI_OBJECTION_HANDLING.md:20-25`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must not generate or send contracts from the
operator console. Contract actions are closer-only.

### 11.2 Contract Types

**BUSINESS RULE:** The course teaches several deal structures:
- Cash: Deep discount purchase. ARV × 0.70 − Repairs − Fee = Max Offer.
- 50% Stack (Seller Finance): 50% down at closing, seller holds 50%. Minimum
  50% equity (hard floor). Preferred 65%+ equity (seller profitability
  threshold). Requires free and clear property (no mortgage).
- 10% Down Seller Finance: 10% (or 0-15%) down, seller carries balance. Down
  payment must cover seller's remaining equity. Requires free and clear
  property.
- Subject-To (Sub2): Take over existing debt. Requires low equity AND a pain
  point (missing payments, foreclosure risk, cannot sell traditionally).
  Typically 72 months maximum balloon term (negotiable). Do not say "subject
  to" over the phone.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:228-258`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The closer team selects the contract type. Software may
display deal structure options but must not select or recommend without closer
input.

---

## SECTION 12: BUYERS

### 12.1 Buyer Types

**BUSINESS RULE:** There are only two types of buyers:
1. Someone who intends to live in the property.
2. Someone who intends to rent out the property.

If a property has not found a buyer who intends to live in it, the only other
buyer is someone who intends to rent it out.

**SOURCE:** `airei-course-notes/02-STEP3-Pt1-Leads-to-CRM-AI-Offer-System.txt:44-46`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** This is a business philosophy rule. It informs the
operator's understanding of the market but does not directly drive software
behavior.

### 12.2 Buyer Qualification

**BUSINESS RULE:** The operator does not qualify buyers. The closer team handles
buyer-side activities. The operator focuses on seller-side contact and data
collection.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:4-10`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must not expose buyer qualification actions
to the operator.

---

## SECTION 13: SPECIAL CASES

### 13.1 No Answer

**BUSINESS RULE:** If the contact does not answer after two calls:
1. Send a voice memo.
2. Send the NOA text.
3. Record the attempts.
4. Do not treat this as completed contact.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:176-180`,
`ghl-automations/TRACK_STUDENT.md:45-66`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** The no-answer sequence requires exactly two unanswered
calls. Software must not offer voice memo or NOA after only one unanswered call.

### 13.2 Wrong Number

**BUSINESS RULE:** If the phone number is wrong, note it. Do not continue
calling. Research the correct contact information.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md` (general operating principles)

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may allow the operator to mark a number as
wrong. Software must not continue outreach to a wrong number.

### 13.3 Seller Unavailable

**BUSINESS RULE:** If the seller is not available, ask when to call back.
Record the callback time. Follow up at the agreed time.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md` (general call behavior)

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may track callback times. Software must not
call automatically.

### 13.4 Agent Unavailable

**BUSINESS RULE:** If the agent is not available, ask when to call back. Record
the callback time. If the agent cannot provide seller information, note the
limitation and proceed with available data.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md` (general call behavior)

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may track callback times. Software must not
fabricate missing seller information.

### 13.5 Missing Information

**BUSINESS RULE:** If required information is missing after contact:
1. Identify what is missing.
2. Determine whether the information can be obtained from another source.
3. If the contact cannot provide it, mark it as unknown or not provided.
4. Do not fabricate information.
5. Proceed with what is available.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:37`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:76-85`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must allow the operator to mark fields as
unknown or not provided. Software must not block completion on fields that the
contact cannot provide.

### 13.6 Unknown Contact Path

**BUSINESS RULE:** If the contact path cannot be determined from the lead data:
1. Research the lead source and listing information.
2. Identify whether the property is listed (agent path) or off-market (seller
   path).
3. Do not proceed with contact until the path is established.
4. Do not guess the contact role.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:19-50`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:70-75`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software must not display scripts, shortcuts, or
contact instructions when the contact path is unknown. Software must prompt the
operator to research.

### 13.7 Hot Lead

**BUSINESS RULE:** See Section 10.3 (Hot Lead Protocol). A hot lead requires
immediate handoff to the closer team. The operator stops active engagement.

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:96-117`

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may detect hot lead indicators. Software must
not automatically hand off or send GCJ without operator confirmation.

### 13.8 Dead Lead

**BUSINESS RULE:** A lead is dead when:
- The seller is not interested and will not be interested.
- The property does not fit the buy box.
- The contact has explicitly opted out.
- The contact is on the Do Not Call list and cannot be contacted.

Dead leads should be marked accordingly and removed from active outreach.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md` (general operating principles)

**CLASSIFICATION:** `COURSE_EXPLICIT`

**IMPLEMENTATION NOTES:** Software may allow the operator to mark a lead as
dead. Software must not continue outreach to dead leads.

---

## SECTION 14: CONFLICT REGISTER

### 14.1 Stage 1 Exit Conflict

**CONFLICT:** Authoritative sources disagree on the exact event that moves a
lead from Lead Entered to Contact Made.

**Source A:** `ghl-automations/TRACK_STUDENT.md:49` says INT Sent advances to
Stage 2.

**Source B:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:15-31` and
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:76-88` describe completed calls,
data collection, and CCC as the contact process.

**Source C:** `memory/FULL_COURSE_AUDIT.md:169-175` describes INT, calls, CCC,
notes, and then movement to Contact Made.

**Impact:** Software cannot automatically move a lead to Contact Made without
resolving which event authorizes the movement.

**Resolution Required:** Yes. Stage movement is blocked until resolved.

**CLASSIFICATION:** `COURSE_CONFLICT`

### 14.2 48-Hour Timer Conflict

**CONFLICT:** Sources disagree on whether a 48-hour timer applies to Stage 2
(Contact Made) or only to post-offer stages.

**Source A:** `ghl-automations/GHL_WORKFLOWS_SPEC.md:49` and
`ghl-automations/HANDBOOK_AND_SOP.md:113` place a 48-hour nurture timer in
Stage 2.

**Source B:** `airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:1-50`,
`lead-tracking/AIREI_SCRIPTS_REFERENCE.md:141-157`, and
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:118-122` tie 48 hours to post-offer
follow-up, not Contact Made.

**Impact:** Software cannot schedule a 48-hour timer at Stage 2 without
resolving whether this is a course-backed business rule.

**Resolution Required:** Yes. Do not implement a Stage 2 48-hour timer until
resolved.

**CLASSIFICATION:** `COURSE_CONFLICT`

### 14.3 GCJ Timing Conflict

**CONFLICT:** Sources disagree on when GCJ (group chat with Jaxon) should be
sent.

**Source A:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:106-108` places GCJ
as Step 8 after deal evaluation and before end-of-day spreadsheet.

**Source B:** `memory/MONTELLI_OBJECTION_HANDLING.md:96-117` ties GCJ to hot
leads when the seller is engaged and an offer is being prepared.

**Source C:** `ghl-automations/GHL_WORKFLOWS_SPEC.md:90-91` places GCJ at Stage
4 (Offer Sent).

**Source D:** `memory/REI_STAGE_BY_STAGE_GUIDE.md:92` places GCJ at Stage 5
(Offer Received).

**Impact:** Software cannot determine when to offer GCJ to the operator.

**Resolution Required:** Yes. Do not send GCJ automatically until resolved.

**CLASSIFICATION:** `COURSE_CONFLICT`

### 14.4 F50/F10 Trigger Conflict

**CONFLICT:** Sources disagree on the exact trigger for sending F50 or F10 in
the pipeline.

**Source A:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:18-19,204-219` presents
F50 and F10 as Facebook Marketplace prospecting shortcuts.

**Source B:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-94` presents F50
and F10 as Stage 2 evaluation options for turnkey vs renovation properties.

**Source C:** `ghl-automations/TRACK_STUDENT.md:84-99` presents F50 and F10 as
Stage 2 actions after CCC.

**Impact:** Software cannot determine whether F50/F10 are Stage 2 pipeline
actions, Facebook Marketplace tools, or both.

**Resolution Required:** Yes. Do not offer F50/F10 as pipeline actions until
resolved.

**CLASSIFICATION:** `COURSE_CONFLICT`

### 14.5 Stage 2 Exit Conflict

**CONFLICT:** Sources disagree on the exact event that moves a lead from
Contact Made to Offer Ready.

**Source A:** `ghl-automations/TRACK_STUDENT.md:101` says CCC Sent advances to
Stage 3.

**Source B:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100` describes
deal evaluation, comps, and Seth handoff as the process before offer.

**Source C:** `memory/REI_STAGE_BY_STAGE_GUIDE.md:40-46` describes evaluation,
F50/F10, and Seth email before moving to Offer Ready.

**Impact:** Software cannot automatically move a lead to Offer Ready without
resolving which event authorizes the movement.

**Resolution Required:** Yes. Stage movement is blocked until resolved.

**CLASSIFICATION:** `COURSE_CONFLICT`

---

## SECTION 15: UNKNOWN REGISTER

### 15.1 Are F50 and F10 Pipeline Actions or Prospecting Tools?

**Question:** Are F50 and F10 text shortcuts used during Stage 2 for GHL
pipeline leads, or are they only used for Facebook Marketplace prospecting?

**Why It Matters:** If F50/F10 are pipeline actions, they must be available
during Stage 2. If they are prospecting tools only, they must not appear in the
pipeline operator console.

**Implementation Blocked:** Yes. F50/F10 availability in the pipeline is
blocked until resolved.

**CLASSIFICATION:** `COURSE_UNKNOWN`

### 15.2 Is Seller Motivation Mandatory for All Paths?

**Question:** Is seller motivation a mandatory field for all contact paths, or
only for PPC and direct seller paths?

**Why It Matters:** If motivation is mandatory for all paths, the operator must
ask every contact. If it is path-specific, the requirement varies.

**Implementation Blocked:** Partially. Software can make motivation optional
until resolved, but should not block completion on it for non-PPC paths.

**CLASSIFICATION:** `COURSE_UNKNOWN`

### 15.3 Does Contact Made Require a Completed Two-Way Conversation?

**Question:** Does Contact Made require an actual two-way conversation, or can a
text reply or agent email confirmation satisfy the requirement?

**Why It Matters:** This determines whether the operator must have a live
conversation before entering Stage 2.

**Implementation Blocked:** Partially. The current implementation requires a
completed call or recorded no-answer. Text-only contact is not currently
supported as Contact Made.

**CLASSIFICATION:** `COURSE_UNKNOWN`

### 15.4 What Are the Valid Alternate Exits from Stage 2?

**Question:** Besides Offer Ready, what are the valid exits from Contact Made?
Can a lead go to Seller Declined, No Answer, or a hold/nurture status directly
from Stage 2?

**Why It Matters:** Software must know which stage transitions are valid from
Stage 2.

**Implementation Blocked:** Yes. Stage 2 exit options are blocked until
resolved.

**CLASSIFICATION:** `COURSE_UNKNOWN`

### 15.5 Is the Stage 2 to Stage 3 Transition Manual or Automatic?

**Question:** Does the operator manually move the lead from Contact Made to
Offer Ready, or does the closer team move it after receiving the handoff?

**Why It Matters:** This determines who has stage movement authority for the
Stage 2 to Stage 3 transition.

**Implementation Blocked:** Yes. Automatic stage movement is blocked until
resolved.

**CLASSIFICATION:** `COURSE_UNKNOWN`

### 15.6 Does the PPC Path Merge Into the Standard Pipeline?

**Question:** Does the PPC process merge into the standard pipeline at Contact
Made, Offer Ready, or a different stage? Or does PPC follow a separate pipeline?

**Why It Matters:** Software must know whether PPC leads follow the same stage
sequence or a separate path.

**Implementation Blocked:** Partially. PPC can be treated as a separate contact
path within the same pipeline until resolved, but the merge point is unknown.

**CLASSIFICATION:** `COURSE_UNKNOWN`

---

## SECTION 16: IMPLEMENTATION MAPPING

This section maps each business rule to the responsible software component.
No software behavior may contradict the business rule.

### 16.1 Operator Console (Telegram)

| Business Rule | Implementation |
|---|---|
| Research first | Display lead data before contact |
| Save contact first | Prompt operator to save contact |
| Send INT before every call | Require INT confirmation before scripts |
| Call twice before no-answer | Track attempts; block NOA until 2 no-answers |
| Record notes | Provide structured notes template |
| Send CCC after completed call | Offer CCC only after completed call recorded |
| Always ask about other properties | Include in required questions |
| Use realignment language | Use realignment language in prompts |
| Never negotiate | Do not expose negotiation actions |
| Relay to closer team | Display relay script and handoff instructions |
| Stay warm every 3-5 days | Track days since last contact; prompt operator |

### 16.2 Pipeline System (GHL)

| Business Rule | Implementation |
|---|---|
| Stage represents business milestone | Do not auto-advance stages |
| Operator controls Stages 1-3 | Restrict stage movement to operator |
| Closer controls Stages 4+ | Restrict stage movement to closer |
| Notes required at each stage | Provide notes fields |
| Contact path must be established | Require contact path before Stage 2 |

### 16.3 Communication (JustCall)

| Business Rule | Implementation |
|---|---|
| Send INT before calling | Queue INT text before call |
| Call twice before no-answer | Track call attempts |
| Send CCC after completed call | Queue CCC after call completion |
| Send voice memo after two no-answers | Queue voice memo after two no-answers |

### 16.4 Recommendation Engine (OpenClaw)

| Business Rule | Implementation |
|---|---|
| Research first | Display available lead data |
| Evaluate deal type | Recommend turnkey vs renovation |
| Check rental comps | Run comps as recommendation |
| Never negotiate | Do not generate counter-offers |
| Relay to closer team | Draft handoff message |

### 16.5 Human Actions

| Business Rule | Implementation |
|---|---|
| Smile and speak slowly | Human behavior only |
| Save contact in phone | Human action |
| Make the call | Human action |
| Confirm INT was sent | Human confirmation |
| Confirm CCC was sent | Human confirmation |
| Evaluate deal type | Human decision |
| Approve offer | Human decision (closer) |
| Negotiate | Human action (closer only) |
| Sign contracts | Human action (closer only) |

---

## SECTION 17: DO NOT IMPLEMENT

The following behaviors are prohibited. No software component may perform these
actions.

### 17.1 Do Not Infer Contact Role

**PROHIBITION:** Software must not infer whether a contact is an agent, broker,
seller, or other role from incomplete data. If the contact path cannot be
determined from explicit lead data, the path is RESEARCH_REQUIRED.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:19-50`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.2 Do Not Invent Stage Movement

**PROHIBITION:** Software must not move a lead from one stage to another without
explicit operator or closer confirmation. No automatic stage advancement is
permitted.

**SOURCE:** `docs/atlas-kayla-course-parity-spec.md:34-41`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.3 Do Not Rewrite Scripts

**PROHIBITION:** Software must not modify, paraphrase, summarize, or
"improve" the exact wording of any script or shortcut. The canonical wording
in `lead-tracking/AIREI_SCRIPTS_REFERENCE.md` is the only authorized version.

**SOURCE:** `lead-tracking/AIREI_SCRIPTS_REFERENCE.md:1-241`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.4 Do Not Negotiate Automatically

**PROHIBITION:** Software must not generate counter-offers, price adjustments,
or negotiation language. Software must not respond to seller questions or
objections. All negotiation is human-only.

**SOURCE:** `memory/MONTELLI_OBJECTION_HANDLING.md:1-33`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.5 Do Not Assume Timers

**PROHIBITION:** Software must not schedule automatic timers, reminders, or
follow-ups based on assumptions. The 48-hour post-offer follow-up is a business
guideline, not an automatic software timer. The operator decides when to act.

**SOURCE:** `airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt:1-50`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.6 Do Not Send Messages Without Confirmation

**PROHIBITION:** Software must not send any text message, email, or
communication without explicit operator or closer confirmation. No autonomous
sends are permitted.

**SOURCE:** `docs/atlas-kayla-course-parity-spec.md:34-41`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.7 Do Not Place Calls Automatically

**PROHIBITION:** Software must not initiate phone calls. All calls are placed by
the operator.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:14-16`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.8 Do Not Create Notes Without Confirmation

**PROHIBITION:** Software must not create, update, or modify contact notes,
opportunity notes, or any record without explicit operator confirmation.

**SOURCE:** `docs/atlas-kayla-course-parity-spec.md:34-41`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.9 Do Not Generate Offers

**PROHIBITION:** Software must not generate, send, or deliver offers, LOIs, or
contracts. Offer generation is a closer-team responsibility.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:122-149`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.10 Do Not Modify Workflows

**PROHIBITION:** Software must not create, modify, or delete pipeline workflows,
automations, or stage configurations.

**SOURCE:** `docs/atlas-kayla-course-parity-spec.md:34-41`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.11 Do Not Assume Contact Made

**PROHIBITION:** Software must not assume that INT sent, a text reply, or a
single call attempt constitutes Contact Made. Contact Made requires a completed
contact process.

**SOURCE:** `lead-tracking/KAYLA_COACHING_REFERENCE.md:15-31`,
`airei-course-notes/AIREI_MASTER_PLAYBOOK.md:76-88`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.12 Do Not Assume Offer Ready

**PROHIBITION:** Software must not assume that completed contact or data
collection constitutes Offer Ready. Offer Ready requires deal evaluation,
comps, and closer handoff.

**SOURCE:** `airei-course-notes/AIREI_MASTER_PLAYBOOK.md:90-100`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.13 Do Not Fabricate Missing Data

**PROHIBITION:** Software must not invent, infer, or generate property data,
contact information, or deal parameters. All data must come from the operator or
authoritative sources.

**SOURCE:** `ghl-automations/TRACK_STUDENT.md:14-16`

**CLASSIFICATION:** `COURSE_EXPLICIT`

### 17.14 Do Not Resolve Conflicts Silently

**PROHIBITION:** Software must not resolve any conflict listed in Section 14
without explicit authorization. Conflicting rules must be surfaced to the
operator, not silently resolved.

**SOURCE:** `docs/atlas-kayla-course-parity-spec.md:34-41`

**CLASSIFICATION:** `COURSE_EXPLICIT`

---

## SECTION 18: QUALITY REVIEW

### 18.1 Source Coverage

| Source | Sections Covered |
|---|---|
| `lead-tracking/AIREI_SCRIPTS_REFERENCE.md` | 2, 3, 5, 6, 7, 8, 13 |
| `lead-tracking/KAYLA_COACHING_REFERENCE.md` | 1, 2, 3, 4, 6, 7, 13 |
| `airei-course-notes/AIREI_MASTER_PLAYBOOK.md` | 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13 |
| `airei-course-notes/01-STEP3-Pt1-Intro-Warm-Dials-Kayla-Teaches-Outreach.txt` | 2, 3, 4, 6 |
| `airei-course-notes/02-STEP3-Pt1-Leads-to-CRM-AI-Offer-System.txt` | 1, 2, 8, 12 |
| `airei-course-notes/07-STEP3-Pt2-Follow-Up-Offer-Sent-to-Lead-Calls.txt` | 3, 8 |
| `ghl-automations/TRACK_STUDENT.md` | 1, 2, 3, 9, 13, 17 |
| `memory/REI_STAGE_BY_STAGE_GUIDE.md` | 3 |
| `memory/MONTELLI_OBJECTION_HANDLING.md` | 2, 3, 10, 13, 17 |
| `memory/FULL_COURSE_AUDIT.md` | 3, 14 |
| `ai-rei/kay-exclusive/List kickoff_text.txt` | 2, 3 |
| `ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Process_text.txt` | 4, 6, 7 |
| `ai-rei/kay-exclusive/Pay Per Click (PPC)/PPC Text Shortcuts_text.txt` | 5 |
| `docs/atlas-kayla-course-parity-spec.md` | 1, 17 |

### 18.2 Classification Audit

| Classification | Count |
|---|---|
| `COURSE_EXPLICIT` | 89 rules |
| `IMPLEMENTATION_DERIVED` | 0 rules (implementation notes only) |
| `COURSE_CONFLICT` | 5 conflicts |
| `COURSE_UNKNOWN` | 6 unknowns |

### 18.3 Unsupported Statements Removed

The following concepts were present in earlier documents but removed from this
canonical specification because they lack course evidence or represent
implementation design rather than business rules:

1. **48-hour nurture timer at Stage 2.** Removed. Course evidence ties 48 hours
   to post-offer follow-up, not Contact Made. Listed as COURSE_CONFLICT in
   Section 14.2.

2. **Automatic stage advancement on CCC sent.** Removed. Sources conflict on
   whether CCC alone authorizes Stage 2 exit. Listed as COURSE_CONFLICT in
   Section 14.5.

3. **Automatic stage advancement on INT sent.** Removed. Sources conflict on
   whether INT alone authorizes Stage 1 exit. Listed as COURSE_CONFLICT in
   Section 14.1.

4. **GCJ as a Stage 2 action.** Removed. Sources conflict on GCJ timing.
   Listed as COURSE_CONFLICT in Section 14.3.

5. **F50/F10 as automatic Stage 2 pipeline actions.** Removed. Sources conflict
   on whether F50/F10 are pipeline actions or prospecting tools. Listed as
   COURSE_CONFLICT in Section 14.4.

6. **Automated offer generation.** Removed. Offer generation is a closer-team
   responsibility. Listed in Section 17.9.

7. **Automated negotiation or counter-offers.** Removed. Negotiation is
   human-only. Listed in Section 17.4.

8. **Automated calendar reminders or timers.** Removed. Timing is a business
   guideline, not an automatic software action. Listed in Section 17.5.

9. **Developer workflow documents as business authority.** Removed.
   `GHL_WORKFLOWS_SPEC.md` and `HANDBOOK_AND_SOP.md` are implementation design
   documents, not course evidence. Their rules are not included unless
   independently confirmed by course sources.

10. **Generic wholesaling advice.** Removed. Only Kayla course-specific rules
    are included.

11. **LLM-inferred or ChatGPT-generated rules.** Removed. Every rule must have
    an explicit course source.

12. **Divinity CRM implementation details.** Removed. This document describes
    business behavior, not software architecture.

13. **Atlas import implementation details.** Removed. Import mechanics are
    implementation, not business rules.

14. **Pipeline stage IDs and GHL configuration.** Removed. Stage identifiers are
    implementation details, not business rules.

15. **Software module names, function names, and API references.** Removed.
    This document describes what the operator does, not how the software is
    built.

### 18.4 Completeness Assessment

| Section | Status |
|---|---|
| Section 1: Pipeline Philosophy | Complete |
| Section 2: General Operating Principles | Complete |
| Section 3: Stage Directory | Complete for Stages 1-10; Stages 11-21 summarized |
| Section 4: Contact Paths | Complete |
| Section 5: Text Shortcuts | Complete |
| Section 6: Call Scripts | Complete |
| Section 7: Data Collection | Complete |
| Section 8: Follow-Up | Complete |
| Section 9: Offer Process | Complete |
| Section 10: Negotiation | Complete |
| Section 11: Contract | Complete |
| Section 12: Buyers | Complete |
| Section 13: Special Cases | Complete |
| Section 14: Conflict Register | Complete for known conflicts |
| Section 15: Unknown Register | Complete for known unknowns |
| Section 16: Implementation Mapping | Complete |
| Section 17: Do Not Implement | Complete |
| Section 18: Quality Review | Complete |

### 18.5 Document Integrity

- Every business rule has a SOURCE citation.
- Every business rule has a CLASSIFICATION.
- No rule is classified as COURSE_DERIVED (classification removed per
  specification).
- Implementation notes are separated from business rules.
- Software behavior is confined to Section 16.
- Conflicts are registered in Section 14, not silently resolved.
- Unknowns are registered in Section 15, not assumed.
- Prohibitions are registered in Section 17.
- No Divinity CRM, Atlas import, or developer workflow references appear as
  business authority.
- No LLM inference or generic advice appears.
- Script wording is exact from course sources.

---

*End of Kayla Canonical Operating System v1.0*
