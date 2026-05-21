// scenarios.js — Real objections + responses from AI REI scripts
// Based on: AIREI_SCRIPTS_REFERENCE.md + AIREI_SYSTEM_PLAYBOOK_v2.md
// Run: node scenarios.js <keyword>

const SCENARIOS = [

  // ── CALL OPENERS ──────────────────────────────────────────────────
  {
    id: "opener_agent",
    tags: ["opener", "cold", "call", "introduction", "agent"],
    situation: "Starting a cold call to a listing agent",
    sample_say: "The agent answers the phone",
    response: (name, addr) =>
      "Happy " + day() + " " + name + ", I'm calling regarding the property at " + addr + " — I'm interested in potentially purchasing this as a rental for my portfolio. I just have a couple questions. Did I catch you at a good time?",
    when_to_use: "Every cold call. The opener before qualifying.",
    tip: "Smile. Slow. Your energy is your currency."
  },
  {
    id: "opener_seller",
    tags: ["opener", "fsbo", "seller", "direct", "call"],
    situation: "Cold calling a FSBO seller directly",
    sample_say: "Seller picks up",
    response: (name, addr) =>
      "Happy " + day() + " my name is Montelli, are you still accepting offers at " + addr + "?",
    when_to_use: "FSBO calls. Direct seller. Lead sheet entries.",
    tip: "Short. Direct. First sentence is the offer."
  },

  // ── QUALIFYING QUESTIONS ─────────────────────────────────────────
  {
    id: "feedback_other_buyers",
    tags: ["feedback", "other", "buyers", "walked", "viewed"],
    situation: "Asking agent: have other buyers given feedback on the property?",
    sample_say: "Have you received any feedback from buyers who've walked through?",
    response: (addr) =>
      "Based on the photos online the property looks great inside and out. I'm shocked it hasn't sold yet. Now — regarding other buyers who have walked it — have you received any feedback?",
    when_to_use: "During agent call. After opener. Qualifies seller motivation.",
    tip: "The 'shocked it hasn't sold' line disarms the agent and opens them up."
  },
  {
    id: "qualify_roof_hvac",
    tags: ["roof", "hvac", "condition", "age", "renovation"],
    situation: "Asking about the roof and HVAC age/condition",
    sample_say: "When were the roof and HVAC last installed?",
    response: (addr) =>
      "Regarding the roof and HVAC — when were those last installed?",
    when_to_use: "During every call. Second qualifier after confirming deal exists.",
    tip: "Write it down. Roof/HVAC age is the first number in your underwriting."
  },
  {
    id: "qualify_occupied",
    tags: ["occupied", "vacant", "tenant", "renting", "occupancy"],
    situation: "Asking whether property is occupied or vacant",
    sample_say: "Is the property currently occupied or vacant?",
    response: (addr) =>
      "The property itself — is it currently occupied or vacant?",
    when_to_use: "Third question on every call. Determines next script branch.",
    tip: "If vacant: ask why not rented. If occupied: ask rent + lease type."
  },
  {
    id: "qualify_rent",
    tags: ["rent", "rental", "income", "lease", "tenant"],
    situation: "Follow-up to occupied: what is the current rent?",
    sample_say: "It's rented — what's the current rent and what kind of lease?",
    response: () =>
      "What is the current rent? Thanks for clarifying — and when did they sign? What kind of lease are they on?",
    when_to_use: "Only when property is tenant-occupied. Never volunteer this question.",
    tip: "Fixed-term lease is better than month-to-month. No Section 8."
  },
  {
    id: "vacant_why_not_rented",
    tags: ["vacant", "why", "rent", "empty"],
    situation: "Property is vacant — asking why the seller didn't rent it",
    sample_say: "It's vacant — why wouldn't the seller just rent it out?",
    response: (addr) =>
      "Noted — I'm curious. It looks like a great house. Why wouldn't the seller just rent it out and collect a couple thousand dollars each month?",
    when_to_use: "When property is vacant. Opens up the motivation conversation.",
    tip: "Disarms the seller. Shows you're thinking like an investor, not a buyer."
  },
  {
    id: "utilities",
    tags: ["utilities", "electric", "gas", "on", "off"],
    situation: "Asking if utilities are still on before scheduling a visit",
    sample_say: "Are utilities still on at the property?",
    response: () =>
      "Okay, that makes sense. Are utilities still on?",
    when_to_use: "Near end of every qualifying call. Before wrapping up.",
    tip: "If utilities are off, that's an extra cost to factor in."
  },

  // ── DSCR EXPLAINER ────────────────────────────────────────────────
  {
    id: "dscr_explain",
    tags: ["dscr", "loan", "financing", "rental", "income", "approve"],
    situation: "Explaining DSCR loan — why you don't need bank financing",
    sample_say: "I would purchase outright — how?",
    response: (addr) =>
      "I'm really interested in this property. I would purchase outright by using a DSCR loan which is solely based on what it makes as a rental. As long as the rent covers the mortgage I'll be good to go at the price you're asking. I'm going to give my lender a quick call and see how I can get approved.",
    when_to_use: "After qualifying. When agent or seller asks how you can pay cash without a mortgage.",
    tip: "Say 'as long as the rent covers the mortgage' — explains the DSCR logic in one line."
  },
  {
    id: "confirm_email",
    tags: ["email", "send", "details", "confirm", "info"],
    situation: "Wrapping up call — getting email to send details",
    sample_say: "Is there a good email I can send over details to?",
    response: (addr) =>
      "Thanks for all the info — I'm really interested in this property. Is there a good email I can send over details to?",
    when_to_use: "End of every qualifying call. Before the CCC.",
    tip: "Get the email before you hang up. Follow up with CCC immediately after."
  },

  // ── TEXT SHORTCUTS (post-call follow-up) ──────────────────────────
  {
    id: "ccc",
    tags: ["ccc", "after", "call", "contact", "card", "following"],
    situation: "Sending after every completed call — contact card + closing",
    sample_say: "Call ended, sending CCC",
    response: (name, addr) =>
      "It is great aligning with you " + name + ", I look forward to connecting the dots with you shortly at " + addr + ". Feel free to browse through our closings on our website — Divinity Aligned LLC: Expert Solutions for Life's Major Transitions",
    when_to_use: "After every call. No exceptions.",
    tip: "CCC stands for Contact Card. Send immediately after hanging up."
  },
  {
    id: "gcj",
    tags: ["gcj", "group", "chat", "jaxon", "loi"],
    situation: "After offer sent — creating group chat with Jaxon",
    sample_say: "LOI is ready, time to loop in Jaxon",
    response: (name, addr) =>
      name + " — happy " + day() + "! Creating a group chat for the purchase on " + addr + " with my business partner Jaxon. He is currently in a meeting with our lender. The LOI will be coming from our partner at Homewithkaylamauser@gmail.com — simply inform us it has been received for presentation, and also ensure to check other folders as well. Have a blessed rest of your week!",
    when_to_use: "After offer is drafted. Before sending to agent/seller.",
    tip: "Attach the LOI email in the group chat. Keep it professional."
  },
  {
    id: "loi_followup",
    tags: ["loi", "followup", "follow", "up", "sent"],
    situation: "Following up after LOI has been sent — no confirmation",
    sample_say: "LOI sent, they haven't confirmed receipt",
    response: (name, addr) =>
      "Happy " + day() + " " + name + ", I have just now found some time to iron out any further details regarding the offer we had finalized on " + addr + ". Have you gained any initial feedback from your seller just yet?",
    when_to_use: "48 hours after LOI sent. When seller/agent hasn't acknowledged receipt.",
    tip: "Say 'iron out further details' not 'following up on our offer' — stays positive."
  },

  // ── FACEBOOK MESSENGER ───────────────────────────────────────────
  {
    id: "f50_turnkey",
    tags: ["f50", "facebook", "50%", "down", "turnkey", "half"],
    situation: "Facebook response to seller who wants to sell outright — turnkey property",
    sample_say: "Seller says they want all cash now, won't consider seller financing",
    response: (name) =>
      "Happy " + day() + " " + name + "! I understand your intent to sell outright. Would you be completely opposed to taking half your price now and the rest in one lump sum in the near future?",
    when_to_use: "Facebook Marketplace leads. Turnkey properties. When seller wants full price now.",
    tip: "F50 = 50% down. Ask for half now, rest in one lump sum. Works on turnkey."
  },
  {
    id: "f10_renovation",
    tags: ["f10", "facebook", "10%", "down", "renovation", "fixer"],
    situation: "Facebook response to seller who wants to sell outright — needs renovation",
    sample_say: "Seller says they need all cash, property needs work",
    response: (name) =>
      "Happy " + day() + " " + name + "! I understand your intent to sell outright. Would you be completely opposed to taking 10% of your price now and the rest in one lump sum in just 24 months?",
    when_to_use: "Facebook Marketplace leads. Renovation properties. 10% down, balance in 24 months.",
    tip: "F10 = 10% down. Only use this on properties that need renovation work."
  },
  {
    id: "f10_rest_of_payment",
    tags: ["f10", "when", "rest", "paid", "lump", "sum", "second"],
    situation: "Seller asks when the rest of the payment will be made",
    sample_say: "When will the rest be paid?",
    response: () =>
      "Our goal is to ensure it gets paid off quickly — it simply just depends on the rental income.",
    when_to_use: "After F10 is sent and seller shows interest. Natural follow-up question.",
    tip: "Keep it vague. Rental income pays it off. Don't commit to exact timeline."
  },
  {
    id: "f10_interested",
    tags: ["f10", "interested", "yes", "want", "proceed"],
    situation: "Seller is interested in the F10 seller financing offer",
    sample_say: "Seller says yes, they're interested",
    response: (name) =>
      "Happy " + day() + " " + name + ", I appreciate the prompt communication. For this to be considered we will simply need to confirm the property address to ensure this is a rental that would make sense for an investment for our portfolio as well as your email address and phone number so that our transaction coordinator can send over the agreement for authorization if we align on it being a great fit. Please message me with the property address, the best email address, and phone number to contact you at — rest assured we will only contact you if the property fits our criteria.",
    when_to_use: "When seller says yes to F10. Converts interest to a data exchange.",
    tip: "Send as a voice note if possible — SMILING. Keeps the energy up."
  },

  // ── VOICEMAIL / NO ANSWER ─────────────────────────────────────────
  {
    id: "no_answer_voicemail",
    tags: ["voicemail", "no", "answer", "vm", "voice", "memo"],
    situation: "No answer — leaving a voice memo",
    sample_say: "No answer, leaving a VM",
    response: (name, addr) =>
      "Happy " + day() + " " + name + " — just tried to call you regarding the purchase of your property on " + addr + ". I'm going to call my DSCR lender to get approved — they simply just look at the rental income. Going to loop you into a group chat with my business partner Jaxon. Have a blessed evening.",
    when_to_use: "No answer on a call. Leave a voice memo, don't text.",
    tip: "Voice memo keeps you in flow state. Don't break momentum by texting."
  },
  {
    id: "good_standing",
    tags: ["delay", "waiting", "feedback", "good", "standing", "hold"],
    situation: "There was a delay getting feedback — checking in",
    sample_say: "It's been a few weeks, checking in",
    response: (name) =>
      "Happy " + day() + "! I appreciate your patience as we were in a few closings with clients the past few weeks — I have just now found some time to gain feedback from the offer we sent.",
    when_to_use: "After a gap in communication. When seller or agent has been radio silent.",
    tip: "Only use this once. If no response after this, move on."
  },

  // ── UNDER CONTRACT FOLLOW-UP ─────────────────────────────────────
  {
    id: "uc_7day_checkin",
    tags: ["under", "contract", "uc", "7day", "earnest", "inspection"],
    situation: "7 days after finding out property went under contract",
    sample_say: "Property went under contract — checking in 7 days later",
    response: (name, addr, day_spoke) =>
      "Happy " + day() + " " + name + " — we spoke on " + day_spoke + " regarding the property at " + addr + " going under contract. I just now found some time to ensure the buyer has wired earnest money and the inspections have since been completed.",
    when_to_use: "7 days after learning a property went UC. Before closing.",
    tip: "Track this in your pipeline. 7 days after UC = next touch point."
  },
  {
    id: "uc_closing",
    tags: ["closing", "congrats", "wired", "earned", "done"],
    situation: "Property is closing — offer congratulations, plant seed for future",
    sample_say: "Property is actually closing",
    response: (name) =>
      "Congratulations — glad it all aligned well for you. It was great connecting with you and if you aren't opposed I'd love to explore opportunities with you in the future. Our business model aligns well with properties that are owned outright or are facing a short sale. Looking forward to providing value alongside you.",
    when_to_use: "When UC property closes. Last touch before archiving.",
    tip: "Always ask: 'Do you have any other properties you're looking to offload?' — even at closing."
  },
  {
    id: "uc_fell_through",
    tags: ["fell", "through", "available", "contract", "back"],
    situation: "Property was under contract but it fell apart — offer still valid",
    sample_say: "The contract fell through",
    response: (name, addr) =>
      "Noted — I had made a note for our underwriters to keep this offer valid through the seller's inspections on " + addr + ". Looking forward to getting this across the finish line with you soon.",
    when_to_use: "When a UC property comes back available. Offer was already sent.",
    tip: "Act fast. If it came back, there was a reason. Get an LOI in hand quickly."
  },

  // ── SELLER DECLINED ───────────────────────────────────────────────
  {
    id: "seller_declined",
    tags: ["declined", "passed", "no", "not", "interested", "sd"],
    situation: "Seller declined the offer or passed",
    sample_say: "Seller passed on our offer",
    response: (name) =>
      "Happy " + day() + " " + name + "! Thank you for the update — feel free to revisit this right before the listing expires if your seller has not been able to find their number with owner occupants. Wishing you a smooth closing — feel free to keep us in mind for the future if you have listings that can't sell outright and are owned outright. This would be a great solution for homeowners who aren't seeing the outright number they're hoping for. Buy-box: Red States, Turnkey SF & Multi $150K-$550K, 3 bed+, 10K+ pop, No HOA, No pools.",
    when_to_use: "After any decline. Send this, then archive the lead.",
    tip: "Note the DOM. Subtract 181. Put in calendar. Circle back when listing expires."
  },

  // ── PENDING / OFF-MARKET ─────────────────────────────────────────
  {
    id: "pending_listing",
    tags: ["pending", "went", "pending", "off", "market", "congrats"],
    situation: "Property went pending but you still want to stay in the picture",
    sample_say: "The property went pending",
    response: (name, addr) =>
      "Happy " + day() + " " + name + "! I came across your listing at " + addr + " and noticed it's pending. Congratulations — that's exciting! Wishing you a smooth closing. Feel free to keep my offer in your back pocket — I'm intending to acquire this as a rental property. I'm going to give my DSCR lender a quick call and send an offer over if I get approved. Feel free to browse through my closings on our website — Divinity Aligned LLC.",
    when_to_use: "When a property you're working on goes pending. Stay in the conversation.",
    tip: "Keep it short. Congrats + stay in pocket. Don't be pushy."
  },

  // ── GOLDEN RULES TRAPS ────────────────────────────────────────────
  {
    id: "never_say",
    tags: ["never", "don't", "avoid", "bad", "words", "checking", "in"],
    situation: "What NEVER to say during a call or text",
    sample_say: "You catch yourself about to say: 'Just checking in'",
    response: () =>
      "DO NOT USE: 'Just checking in' or 'Just following up' — plants seeds of uncertainty. Instead say: 'Happy Wednesday, I just found some time to realign with you.' NEVER ask: 'Did you get a chance to look at it?' — plants doubt. NEVER say 'Is the offer okay?' — undermines your position. NEVER say 'Subject to' on the phone — use proper documentation.",
    when_to_use: "Review before every call. Internal guard-rails, not a script to send.",
    tip: "Print this and tape it to your desk. These phrases lose deals."
  },
  {
    id: "always_say",
    tags: ["always", "do", "say", "realign", "relay", "partner"],
    situation: "What ALWAYS to say — the positive framing anchors",
    sample_say: "Going into a call — what's the right tone?",
    response: () =>
      "ALWAYS: Say 'realign' or 'finding some time' — not 'checking in'. Say 'clarification' — not 'questioning'. Say 'Noted — I'll relay that to my business partner' — buys you time and projects authority. ALWAYS ask: 'Do you have any other properties you're looking to offload?' before hanging up. ALWAYS send INT before every call and CCC after every call.",
    when_to_use: "Pre-call prep. Review before every text blast.",
    tip: "This is the operating system. The scripts are tactics. This is strategy."
  }
];

function day() {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[new Date().getDay()];
}

function searchScenarios(query) {
  if (!query) return SCENARIOS;
  const q = query.toLowerCase();
  return SCENARIOS.filter(
    (s) =>
      s.tags.some((t) => t.includes(q)) ||
      s.situation.toLowerCase().includes(q) ||
      s.id.includes(q)
  );
}

function formatScenario(s, name, addr, extras) {
  return (
    "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
    s.situation +
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
    "When they say / what you face:\n" +
    s.sample_say +
    "\n\nUse this:\n" +
    s.response(name || "[contact name]", addr || "[address]", extras) +
    "\n\n" +
    s.when_to_use +
    "\nTip: " +
    s.tip
  );
}

if (require.main === module) {
  const query = process.argv.slice(2).join(" ");
  const results = searchScenarios(query);
  if (!results.length) {
    console.log(
      'No scenarios for "' +
        query +
        '". Try: opener, qualify, rent, dscr, loi, facebook, voicemail, declined, pending, never, always'
    );
    process.exit(0);
  }
  results.forEach((s) => console.log(formatScenario(s) + "\n"));
}

module.exports = { SCENARIOS, searchScenarios, formatScenario };