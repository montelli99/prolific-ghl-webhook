/**
 * scripts.js — Stage scripts for the teleprompter
 * 
 * Each stage has:
 *   - title: short label
 *   - duration: estimated minutes
 *   - goal: one-line "what you're trying to accomplish"
 *   - opener: how to open the conversation
 *   - discovery: questions to ask
 *   - objection: common objection + response
 *   - close: how to wrap up + next step
 *   - red_flags: signs to bail or escalate
 *   - variables: list of {var, source} for substitution (e.g. address, seller_name)
 */

const SCRIPTS = {
  LEAD_ENTERED: {
    title: 'New Lead — Triage',
    duration: 3,
    goal: 'Verify the lead is real and worth pursuing before we invest time.',
    opener: "Hi {seller_name}, this is {agent_name} calling about {address}. Did I catch you at a good time?",
    discovery: [
      "How long have you owned {address}?",
      "Are you the decision-maker, or is there someone else I should include?",
      "What made you reach out about selling?"
    ],
    objection: {
      "I'm just curious, not really selling": "Totally understand. Most homeowners I talk to are at least exploring — would you be open to a quick no-pressure conversation?",
    },
    close: "OK, so the next step is for me to pull comps on {address} and put together an offer range. When's a good time to follow up — tomorrow afternoon or Wednesday morning?",
    red_flags: [
      "Property is in foreclosure with < 30 days to auction",
      "Seller asks for cash upfront",
      "Title issues mentioned early"
    ],
    variables: ['seller_name', 'agent_name', 'address']
  },
  
  CONTACT_MADE: {
    title: 'Discovery Call',
    duration: 15,
    goal: 'Understand seller motivation, condition, and price expectations.',
    opener: "Great, thanks for taking my call. Tell me a little about {address} — how long have you been there?",
    discovery: [
      "What condition would you say the property is in?",
      "Any repairs needed — roof, HVAC, foundation?",
      "What's your ideal timeline to close?",
      "Have you gotten any other offers yet?",
      "What's the mortgage situation — do you know the approximate balance?"
    ],
    objection: {
      "I haven't really thought about a number": "That's totally fine. Let me ask it differently — if you could walk away with a check tomorrow, what would make it worth it?",
    },
    close: "Here's what I'd like to do: pull the comps, run a quick offer range, and get back to you by {follow_up_date}. Sound fair?",
    red_flags: [
      "Seller wants retail price for distressed property",
      "Mortgage balance is higher than realistic value",
      "Multiple liens or title clouds"
    ],
    variables: ['seller_name', 'address', 'follow_up_date']
  },
  
  OFFER_READY: {
    title: 'Presenting the Offer',
    duration: 10,
    goal: 'Present the offer clearly, handle objections, lock in next step.',
    opener: "OK, I've run the numbers on {address}. I'm at a number that's about {pct_of_retail}% of retail. Let me walk you through how I got there.",
    discovery: [],
    objection: {
      "That's way too low": "I hear you. Let me explain — I'm factoring in {condition_notes} and the holding costs I'd take on. The offer I'm giving you is what the property is worth to ME as an investor. If you need retail, that's a different buyer.",
      "Can you do better?": "Possibly. What number would make this a yes for you? I'll see if I can structure it differently."
    },
    close: "Here's what happens next — I send over the formal offer letter, you review, and we either accept or counter. I'll get it in your inbox today. When can I call you back to discuss — Friday or Monday?",
    red_flags: [
      "Seller won't give a target number",
      "Asking for proof of funds but won't sign anything"
    ],
    variables: ['seller_name', 'address', 'pct_of_retail', 'condition_notes']
  },
  
  OFFER_SENT: {
    title: 'Waiting for Response',
    duration: 0,
    goal: 'Wait for seller to review. Send reminder at 48hrs.',
    opener: "Just a quick note — I sent over the offer for {address} earlier. Did you get a chance to look at it?",
    discovery: [],
    objection: {},
    close: "Take your time reviewing. I'll follow up on {follow_up_date} if I don't hear from you first.",
    red_flags: [],
    variables: ['address', 'follow_up_date']
  },
  
  OFFER_RECEIVED: {
    title: 'Counter Offer Review',
    duration: 5,
    goal: "Analyze counter, decide if it's worth negotiating.",
    opener: "OK, I got the counter from {seller_name}. Let me run the numbers real quick.",
    discovery: [],
    objection: {},
    close: "I'm going to come back with one more response. I'll have it to you within 24 hours.",
    red_flags: [
      "Counter is more than 15% above our offer",
      "Seller changed contract terms (not just price)"
    ],
    variables: ['seller_name']
  },
  
  GAIN_FEEDBACK: {
    title: 'Feedback After Counter',
    duration: 10,
    goal: 'Understand what seller wants, see if we can structure a deal.',
    opener: "Thanks for the counter. Before I respond, help me understand — what would make this work for you?",
    discovery: [
      "Is it the price or the terms?",
      "What if we could split the difference on price but extend the close date?",
      "Would you accept a higher offer if I paid all cash?"
    ],
    objection: {
      "I just need more money": "I get it. Let me see if I can re-structure. What number would make this a 'yes' today?",
    },
    close: "Let me go back, run the new numbers, and I'll have a response to you by tomorrow afternoon.",
    red_flags: [],
    variables: []
  },
  
  NO_ANSWER: {
    title: 'Follow-up on No Contact',
    duration: 2,
    goal: 'Get back in touch with non-responsive seller.',
    opener: "Hi {seller_name}, this is {agent_name} from {company}. I've been trying to reach you about {address}. Just leaving a quick message — when you get a chance, give me a call back at {agent_phone}.",
    discovery: [],
    objection: {},
    close: "I'll try again in 2-3 days. If no response after 3 attempts, move lead to NURTURE.",
    red_flags: [
      "Phone disconnected",
      "Seller asks to be removed from contact list"
    ],
    variables: ['seller_name', 'agent_name', 'company', 'address', 'agent_phone']
  },
  
  SELLER_DECLINED: {
    title: 'Respecting the Decline',
    duration: 2,
    goal: 'Leave door open, mark stage, add to nurture.',
    opener: "I understand, {seller_name}. I appreciate you taking the time to talk with me.",
    discovery: [],
    objection: {},
    close: "If anything changes in the next 6 months, feel free to give me a call. Have a great day.",
    red_flags: [],
    variables: ['seller_name']
  },
  
  ACTIVE_NEGOTIATION: {
    title: 'Working Through Terms',
    duration: 15,
    goal: 'Get to a signed agreement that works for both sides.',
    opener: "OK, we agree on price — now let me explain how the contract works.",
    discovery: [
      "EMD: Are you comfortable with ${emd} earnest money?",
      "Inspection period: 14 days is standard — does that work?",
      "Close of escrow: 30 days from contract acceptance?"
    ],
    objection: {
      "I want a 60-day close": "I can do that, but I'll need a higher EMD to offset my holding costs. Would ${emd_higher} work?",
    },
    close: "OK, I think we have a deal. Let me draft the contract and get it over to you today for signature.",
    red_flags: [
      "Seller keeps moving goalposts on every term",
      "Spouse/partner not aligned"
    ],
    variables: ['emd', 'emd_higher']
  },
  
  TERMS_AGREED: {
    title: 'Pre-Contract',
    duration: 5,
    goal: 'Confirm all terms in writing, set contract delivery date.',
    opener: "Great, we have a deal. Here's what happens next: I send the contract within 24 hours, you review, and we get it signed by {contract_deadline}.",
    discovery: [],
    objection: {},
    close: "You'll get the contract via DocuSign-style email. Watch for it from {tc_email}.",
    red_flags: [],
    variables: ['contract_deadline', 'tc_email']
  },
  
  AWAITING_TITLE: {
    title: 'Title Search',
    duration: 1,
    goal: 'Hand off to title, confirm preliminary title report is clean.',
    opener: "Title is running the search now. Should have preliminary report in 3-5 business days.",
    discovery: [],
    objection: {},
    close: "Once we get the prelim back, I'll forward it to you for review.",
    red_flags: [
      "Title comes back with liens or clouds",
      "Seller doesn't have full legal authority to sign"
    ],
    variables: []
  },
  
  CONTRACT_OUT: {
    title: 'PSA Out for Signature',
    duration: 5,
    goal: 'Get PSA signed by seller + buyer.',
    opener: "PSA went out via RabbitSign to {seller_email}. They have 48 hours to sign.",
    discovery: [],
    objection: {},
    close: "Once seller signs, I'll counter-sign. You'll get a copy of the fully-executed PSA.",
    red_flags: [
      "Seller doesn't sign within 48 hours",
      "Seller asks for changes to PSA terms"
    ],
    variables: ['seller_email']
  },
  
  UNDER_CONTRACT: {
    title: 'PSA Fully Executed',
    duration: 0,
    goal: 'PSA signed by all parties. Begin inspection period.',
    opener: "PSA is fully executed. Inspection period starts today — ends {inspection_end_date}.",
    discovery: [],
    objection: {},
    close: "Schedule inspector ASAP. Let me know if you want a recommended list.",
    red_flags: [],
    variables: ['inspection_end_date']
  },
  
  INSPECTION_PERIOD: {
    title: 'Inspection Window',
    duration: 14,
    goal: 'Complete inspection, negotiate repairs or credits.',
    opener: "Inspector is scheduled for {inspection_date}. Plan to be on-site if possible.",
    discovery: [],
    objection: {},
    close: "Once inspection report is in, decide: (1) proceed as-is, (2) request repairs, (3) request credit, (4) terminate.",
    red_flags: [
      "Major structural issues",
      "Mold, foundation, or roof issues that exceed 10% of purchase price"
    ],
    variables: ['inspection_date']
  },
  
  INSPECTION_COMPLETE: {
    title: 'Post-Inspection',
    duration: 5,
    goal: 'Decide whether to proceed.',
    opener: "Got the inspection report. Here's what I'm seeing — {inspection_summary}.",
    discovery: [],
    objection: {
      "There are way more issues than expected": "OK, let me think about this. I can either (1) ask seller to credit us ${credit_amount}, (2) ask seller to fix the major items, or (3) walk away. Which do you want to pursue?"
    },
    close: "I'll send the response to seller by end of day.",
    red_flags: [
      "Issues that exceed our repair budget",
      "Seller refuses to negotiate"
    ],
    variables: ['inspection_summary', 'credit_amount']
  },
  
  APPRAISAL_ORDERED: {
    title: 'Appraisal Ordered',
    duration: 7,
    goal: 'Wait for appraisal, decide next step based on value.',
    opener: "Appraisal is ordered. Expect it back in 5-7 business days.",
    discovery: [],
    objection: {},
    close: "If appraisal comes in at or above contract price, we're good. If it comes in low, we renegotiate.",
    red_flags: [
      "Appraisal comes in significantly below contract price"
    ],
    variables: []
  },
  
  APPRAISAL_DONE: {
    title: 'Appraisal Back',
    duration: 3,
    goal: 'Review appraisal, decide if price needs adjusting.',
    opener: "Appraisal came in at ${appraisal_value}. {appraisal_vs_contract}.",
    discovery: [],
    objection: {},
    close: "If appraised value is below contract: ask seller to reduce price or split the difference. If at or above: proceed to closing.",
    red_flags: [
      "Appraisal gap > 5% of contract price"
    ],
    variables: ['appraisal_value', 'appraisal_vs_contract']
  },
  
  JV_SENT: {
    title: 'JV Agreement Out for Signature',
    duration: 5,
    goal: 'Get JV partners to sign the operating agreement.',
    opener: "JV agreement went out to all partners. They have 48 hours to sign.",
    discovery: [],
    objection: {},
    close: "Once all partners sign, we're cleared to fund.",
    red_flags: [
      "Partner disputes percentage split",
      "Partner won't sign within 48 hours"
    ],
    variables: []
  },
  
  JV_SIGNED: {
    title: 'JV Fully Executed',
    duration: 0,
    goal: 'All JV partners have signed. Ready to fund.',
    opener: "JV is fully executed. Wiring instructions go out today.",
    discovery: [],
    objection: {},
    close: "Wire setup is next. Title will email wiring instructions to all parties.",
    red_flags: [],
    variables: []
  },
  
  WIRE_SETUP: {
    title: 'Wire Setup',
    duration: 2,
    goal: 'Get wire instructions verified, funds ready to send.',
    opener: "Title will email wire instructions. CALL TITLE to verify — never trust email-only wiring instructions.",
    discovery: [],
    objection: {},
    close: "Wire funds 24-48 hours before closing. Title confirms receipt.",
    red_flags: [
      "Wiring instructions received by email without phone verification — possible wire fraud"
    ],
    variables: []
  },
  
  CLOSING_DATE: {
    title: 'Closing',
    duration: 1,
    goal: 'Fund the deal, get keys, do the happy dance.',
    opener: "Today is closing day. Title will call when they receive the wire.",
    discovery: [],
    objection: {},
    close: "Once funded, you get keys. Update CRM to CLOSED and celebrate.",
    red_flags: [],
    variables: []
  }
};

function renderScript(stageId, variables = {}) {
  const script = SCRIPTS[stageId];
  if (!script) return null;
  
  // Variable substitution
  const substitute = (text) => {
    if (!text) return text;
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      return variables[key] || `{${key}}`;
    });
  };
  
  return {
    ...script,
    opener: substitute(script.opener),
    close: substitute(script.close),
    red_flags: script.red_flags,
    discovery: script.discovery.map(substitute),
    objection: Object.fromEntries(
      Object.entries(script.objective || script.objection || {}).map(([k, v]) => [substitute(k), substitute(v)])
    )
  };
}

module.exports = { SCRIPTS, renderScript };
