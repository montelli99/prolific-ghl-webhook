// config.js — environment + constants
const path = require('path');

const PIPELINE_STAGES = {
  NEW_LEAD: { order: 1, label: 'New Lead', emoji: '🆕' },
  QUALIFIED: { order: 2, label: 'Qualified', emoji: '✅' },
  LOI_REQUESTED: { order: 3, label: 'LOI Requested', emoji: '📤' },
  LOI_APPROVED: { order: 4, label: 'LOI Approved', emoji: '👍' },
  OFFER_SENT: { order: 5, label: 'Offer Sent', emoji: '📨' },
  NEGOTIATING: { order: 6, label: 'Negotiating', emoji: '🔄' },
  UNDER_CONTRACT: { order: 7, label: 'Under Contract', emoji: '📝' },
  CLOSED: { order: 8, label: 'Closed', emoji: '🏁' },
  ARCHIVED: { order: 9, label: 'Archived', emoji: '📦' },
  DEAD: { order: 0, label: 'Dead', emoji: '⚰️' }
};

const STAGE_CHECKLISTS = {
  NEW_LEAD: [
    'Property address entered as Opportunity Name in GHL',
    'Population check (>10K) — discard if under',
    'Property condition noted (turnkey / reno / livable)'
  ],
  QUALIFIED: [
    'INT text sent before call',
    'Call attempted (max 2x)',
    'Agent/seller name, phone, email collected',
    'Roof/HVAC age noted',
    'Occupancy + rent + lease details collected',
    'CCC text + contact card sent after call',
    'Rental comps checked (Zillow + Rentometer)',
    '1% rule check passed/failed'
  ],
  LOI_REQUESTED: [
    'Email sent to claytoninvestmentsolutions@gmail.com',
    'Subject line: "FB LOI Request [address]" or "Renovation - LOI Request [address]"',
    'All property details in email body',
    'Status updated in GHL'
  ],
  LOI_APPROVED: [
    'Approved LOI received from Seth',
    'LOI link imported into GHL',
    'Ready to send offer'
  ],
  OFFER_SENT: [
    'GCJ text sent to create group chat',
    'Jaxon looped in with client',
    '48-hour follow-up reminder set',
    'Moved to "Active Negotiation" in GHL'
  ],
  NEGOTIATING: [
    '48hr follow-up call completed',
    'Feedback collected and noted in GHL',
    'Questions relayed to Jaxon if applicable',
    'If declined: SD text sent, DOM noted, calendar set (DOM - 181)'
  ],
  UNDER_CONTRACT: [
    'TC engaged by Kayla',
    'Agreement sent to agent/seller',
    'Inspection scheduled',
    'Appraisal ordered',
    'JV/consulting agreement signed',
    'Title company wiring instructions received'
  ],
  CLOSED: [
    'Funds wired from title',
    '"Any other properties?" asked for double/triple dip',
    'Deal archived in GHL',
    'Lessons documented'
  ]
};

const KEY_CONTACTS = {
  kayla: { role: 'Owner/Closer', email: 'homewithkaylamauser@gmail.com' },
  jaxon: { role: 'Business Partner/Closer', email: 'JaxonDeasonHomes1@gmail.com' },
  seth:  { role: 'Underwriter/LOI Generator', email: 'claytoninvestmentsolutions@gmail.com' }
};

const TEXT_SHORTCUTS = {
  INT: (addr, name) =>
    `${name}, are you still accepting offers for ${addr}? My name is Montelli, I'm looking to purchase a rental for my portfolio.`,
  CCC: (addr, name) =>
    `It is great aligning with you ${name}, I look forward to connecting the dots with you shortly at ${addr}. Feel free to browse through our closings on our website — Divinity Aligned LLC.`,
  GCJ: (addr, name) =>
    `${name} — happy ${_day()}, creating a group chat for the purchase on ${addr} with my business partner Jaxon. The LOI will be coming from Homewithkaylamauser@gmail.com; please confirm receipt and check other folders.`,
  SD: () =>
    `Thank you for the update — feel free to revisit this right before the listing expires. Buy-box: Red States, $150K-$550K, 3 bed+, 10k+ pop, No HOA, No pools, No flood zones.`,
  LOI: (addr) =>
    `I am just now finding some time to iron out any further details regarding the offer at ${addr}. Have you gained any initial feedback from your seller?`
};

const FOLLOWUP_TEMPLATES = {
  '48hr': (name, address, day) =>
    `Happy ${_day()} ${name}, I am just now finding some time to realign with you regarding ${address}. We sent an offer — is there any clarification I can align on the details? *Let them talk. If questions: Noted — I'll relay to my business partner.*`,
  '7day_uc': (name, address) =>
    `Happy ${_day()} ${name}, we spoke last week — you mentioned ${address} went under contract. I just found time to ensure the buyer wired earnest money and inspections completed.`,
  'dom_expiry': (name, address, days) =>
    `Happy ${_day()} ${name}, I noticed ${address} has been on market ${days} days. If your seller hasn't found their number with owner-occupants, our offer for a rental portfolio purchase still stands.`,
  'stalled': (name, address, daysSinceAction) =>
    `⚠️ ${address} — no activity in ${daysSinceAction} days. Stage: ${name}. Consider follow-up or mark dead.`,
  'voice_memo': (name, address) =>
    `Happy ${_day()} ${name} — just tried to call you regarding the purchase of ${address}. I'm going to call my DSCR lender. Going to loop you into a group chat with my business partner Jaxon. Have a blessed evening.`
};

function _day() {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return days[new Date().getDay()];
}

const CHECK_INTERVALS = {
  FOLLOWUP_48HR: '*/30 * * * *',    // every 30 min
  STALLED_DEALS: '0 */4 * * *',     // every 4 hours
  DAILY_BRIEF_MORNING: '0 7 * * *', // 7am ET
  DAILY_BRIEF_EVENING: '0 19 * * *' // 7pm ET
};

const CALL_SCRIPTS = {
  AGENT_INITIAL: (addr, name, day) =>
    `*Smile. SLOW. Your energy is your currency.*

Happy ${day}, I'm calling regarding the property at ${addr} — I'm interested in potentially purchasing this as a rental for my portfolio. I just have a couple questions — did I catch you at a good time?

Based on the photos online the property looks great inside and out, I'm SHOCKED it hasn't sold yet. Now.. Regarding other buyers who have walked it — have you received any feedback?

Interesting, okay – Regarding the roof and HVAC; when were those last installed?

Yeah it sounds great – now the property itself, is it currently occupied or vacant?

[If occupied: owner or tenant? If rented: what's the current rent? When did they sign? What kind of lease?]

[If vacant: Noted, and I am curious — it looks like a great house, why wouldn't the seller just rent it out and collect a couple thousand dollars each month?]

Okay, that makes sense… Are utilities still on?

Awesome, thanks for all the info. I'm really interested in this property, and I would purchase outright by using a DSCR loan which is solely based on what it makes as a rental – As long as the rent covers the mortgage I'll be good to go at the price you're asking.

I'm going to give my lender a quick call and see how I can get approved. Is there a good email I can send over details to?

Great - thanks, it was great connecting with you, looking forward to aligning details with you shortly.`,

  SELLER_INITIAL: (addr, name, day) =>
    `*Smile. SLOW!*

Happy ${day}, my name is Montelli, are you still accepting offers at ${addr}?

Great - I'm interested in potentially purchasing this as a rental for my portfolio. I just have a couple questions - did I catch you at a good time?

Regarding the roof and HVAC; when were those last installed?

Yeah it sounds great – now the property itself, is it currently occupied or vacant?

[If occupied: owner or tenant? If rented: what's the current rent? When did they sign? What kind of lease?]

[If vacant: Noted, and I am curious — it looks like a great house, why wouldn't you just rent it out and collect a couple thousand dollars each month?]

Okay, that makes sense. Are utilities still on?

Thanks for all the info. I'm really interested in your property and I would purchase outright by using a DSCR loan which is solely based on what it makes as a rental – As long as the rent covers the mortgage I'll be good to go at the price you're asking. Can I confirm that asking price?

I'm going to give my lender a quick call and see how I can get approved. Is there a good email I can send over details to?

Great - thanks, it was great connecting with you, looking forward to aligning details with you shortly.`,

  SELLER_REHAB: (addr, name, day) =>
    `*Smile. SLOW!*

Happy ${day}, my name is Montelli, I'm interested in potentially purchasing ${addr}.

Regarding the roof and HVAC, when were those last installed?

Good to know - the condition of the property. How would you rate it 10 being the best?

What would it need for it to be a 10?

Noted – now the property itself, is it currently occupied or vacant?

[If occupied + rented: What is the current rent? When did they sign? What kind of lease?]

[If vacant: Noted, and I am curious — it looks like it could be a good flip, what has you opposed to putting a few bucks in and making a profit?]

Okay, that makes sense. Are utilities still on?

Thanks for all the information. Considering the fact the property needs renovation and most buyers couldn't qualify for bank financing, we wouldn't ask for any commissions since we aren't real estate agents. What are you looking to net on this price wise?

What is the best email I can send over details to?

Great - thanks, it was great connecting with you, looking forward to aligning details with you shortly.`,

  NO_ANSWER: (addr, name, day) =>
    `*Send voice memo — SMILING*

Happy ${day} ${name} — just tried to call you regarding the purchase of your property on ${addr}. I'm going to call my DSCR lender to get approved — they simply just look at the rental income. Going to loop you into a group chat with my business partner Jaxon. Have a blessed evening.`,

  GAIN_FEEDBACK: (addr, name, day) =>
    `Happy ${day} ${name}, I am just now finding some time to realign with you regarding ${addr}. We sent an offer — do you have any feedback from your seller? Any clarification I can provide on the details?

[If they haven't reviewed:] Not a problem — I know how busy you are. I'll circle back. Just wanted to ensure it didn't land in spam.

[If they have questions:] Let me take note of that and relay it to my business partner. I'll get back with you shortly.`,

  GOOD_STANDING: (addr, name, day) =>
    `Happy ${day} ${name}! I appreciate your patience as we were in a few closings with clients the past few weeks; I have just now found some time to gain feedback from the offer we sent.`,

  UC_7DAY_CHECK: (addr, name, day, daySpoke) =>
    `Happy ${day} ${name} — We spoke on ${daySpoke} you mentioned the property at ${addr} went under contract. I just now found some time to ensure the buyer has wired earnest money and the inspections have since been completed.

[If closing:] Congratulations, glad it all aligned well for you. It was great connecting with you and if you aren't opposed I'd love to explore the opportunities with you in the future. Our business model aligns well with properties that are owned outright or are facing a short sale.

[If fell through:] Noted, I had made a note for our underwriters to keep this offer valid through the sellers inspections. Looking forward to getting this across the finish line with you soon.`,

  SELLER_DECLINED: (addr, name, day) =>
    `Happy ${day} ${name}! Thank you for the update – feel free to revisit this right before the listing expires if your seller has not been able to find their number with owner occupants. Wishing you a smooth closing – feel free to keep us in mind for the future if you have listings that can't sell out right and are owned outright. This would be a great solution for homeowners who aren't seeing the outright number they're hoping for.

[THEN: Note the Days on Market → subtract 181 → put in calendar to call when listing expires.]`,

  F50: (addr, name, day) =>
    `Happy ${day} ${name}! I understand your intent to sell outright, would you be completely opposed to taking half your price now and the rest in one lump sum in the near future?`,

  F10: (addr, name, day) =>
    `Happy ${day} ${name}! I understand your intent to sell outright, would you be completely opposed to taking 10% of your price now and the rest in one lump sum in just 24 months?

[If they ask when the rest will be paid:] Our goal is to ensure it gets paid off quickly, it simply just depends on the rental income.`,
};

module.exports = {
  PIPELINE_STAGES, STAGE_CHECKLISTS, KEY_CONTACTS,
  TEXT_SHORTCUTS, FOLLOWUP_TEMPLATES, CALL_SCRIPTS, CHECK_INTERVALS, _day
};
