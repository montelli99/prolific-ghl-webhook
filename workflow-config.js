// AI REI Pipeline — Stage Workflow Config
// Each stage: name, id, scripts, shortcuts, triggers, nextStages
// Montelli Pipeline (ygQaJ2hi7ouJeA5HR7uu)

const PIPELINE_ID = 'ygQaJ2hi7ouJeA5HR7uu';

const STAGES = {

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 1 — LEAD ENTERED
  // ─────────────────────────────────────────────────────────────────────────────
  '0651d634-1b58-4039-9908-03c4077c88cb': {
    name: 'Lead Entered',
    position: 0,

    // Montelli's action: call the seller
    action: 'Call seller — use INT text first, then agent script, then seller script',
    montelliTasks: [
      'Send INT text to seller',
      'Call seller using agent/seller script',
      'Collect: agent name/phone/email, seller name/phone, roof/HVAC age, occupancy, utilities, rent',
      'Send CCC text after call',
      'Enter all notes in GHL'
    ],

    // Scripts for this stage
    scripts: {
      agentScript: `Happy [day], I'm calling regarding the property at [Property Address] — I'm interested in potentially purchasing this as a rental for my portfolio. I just have a couple questions — did I catch you at a good time?

Based on the photos online the property looks great inside and out, I'm SHOCKED it hasn't sold yet. Now.. Regarding other buyers who have walked it — have you received any feedback?

Interesting, okay – Regarding the roof and HVAC; when were those last installed?

Yeah it sounds great – now the property itself, is it currently occupied or vacant?

Okay, that makes sense… Are utilities still on?

Awesome, thanks for all the info. I'm really interested in this property, and I would purchase outright by using a DSCR loan which is solely based on what it makes as a rental – As long as the rent covers the mortgage I'll be good to go at the price you're asking.

I'm going to give my lender a quick call and see how I can get approved. Is there a good email I can send over details to?

Great - thanks, it was great connecting with you, looking forward to aligning details with you shortly.`,

      sellerScript: `Happy [day], my name is [Your Name] are you still accepting offers at [Property Address]?

Great - I'm interested in potentially purchasing this as a rental for my portfolio. I just have a couple questions - did I catch you at a good time?

Regarding the roof and HVAC; when were those last installed?

Yeah it sounds great – now the property itself, is it currently occupied or vacant?`,

      rehabSellerScript: `Happy [day], my name is [Your Name] I'm interested in potentially purchasing [Property Address] -

Regarding the roof and HVAC, when were they last installed?

Good to know - the condition of the property. How would you rate it 10 being the best?

What would it need for it to be a 10?

Noted – now the property itself, is it currently occupied or vacant?

Noted, and I am curious - it looks like it could be a good flip, what has you opposed to putting a few bucks in and making a profit?

Okay, that makes sense. Are utilities still on?

Thanks for all the information. Considering the fact the property needs renovation and most buyers couldn't qualify for bank financing, we wouldn't ask for any commissions since we aren't real estate agents. What are you looking to net on this price wise?

What is the best email I can send over details to?

Great - thanks, it was great connecting with you, looking forward to aligning details with you shortly.`
    },

    // Text shortcuts used in this stage
    shortcuts: ['INT', 'CCC'],

    // Stage trigger: what moves the lead to the NEXT stage
    trigger: 'Montelli manually moves to Contact Made after call + notes entered in GHL',

    // Auto-advance condition (for GHL workflow / webhook logic)
    autoAdvance: null, // manual until webhook workflow is configured by Rose

    nextStage: '660c657c-8b59-4f56-9ea4-b3cbb62aa313', // Contact Made
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 2 — CONTACT MADE
  // ─────────────────────────────────────────────────────────────────────────────
  '660c657c-8b59-4f56-9ea4-b3cbb62aa313': {
    name: 'Contact Made',
    position: 1,

    action: 'Evaluate deal type — turnkey or needs renovation',
    montelliTasks: [
      'Evaluate: turnkey or renovation?',
      'If turnkey → propose F50 or F10 to seller',
      'If renovation → email Kayla + Jaxon with rehab estimate + market rent',
      'Email Seth (claytoninvestmentsolutions@gmail.com) — subject "Renovation – LOI Request [address]"',
      'Move to Stage 3 (Offer Ready to be Sent to Seller)'
    ],

    scripts: {
      f50Script: `Happy [day]! I understand your intent to sell outright, would you be completely opposed to taking 50% of your price now and the rest in one lump sum in the near future?`,
      f10Script: `Happy [day]! I understand your intent to sell outright, would you be completely opposed to taking 10% of your price now and the rest in one lump sum in just 24 months?`,
      emailKaylaJaxon: `Subject: [Property Address] — LOI Request

Hey Kayla / Jaxon,

[Property Address] is ready for offer generation. Seller [seller name] can be reached at [seller phone].

Property details:
- Condition: [turnkey / needs renovation]
- [Roof age / HVAC age if known]
- [Occupancy status]
- [Rent if occupied]

MLS Listing Price: $[listing price]
ARV: $[ARV]
Estimated Rehab: $[rehab estimate if applicable]
Market Rent: $[market rent]

Please generate the LOI and send to [seller email].

Thanks,
[Your Name]`
    },

    shortcuts: ['F50', 'F10'],

    trigger: 'Montelli evaluates deal, sends F50/F10 or emails Kayla/Jaxon for renovation LOI',

    autoAdvance: null,

    nextStage: 'e30583a3-e53e-45ae-a3e3-a5672fdd4d28', // Offer Ready to be Sent to Seller
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 3 — OFFER READY TO BE SENT TO SELLER
  // ─────────────────────────────────────────────────────────────────────────────
  'e30583a3-e53e-45ae-a3e3-a5672fdd4d28': {
    name: 'Offer Ready to be Sent to Seller',
    position: 2,

    action: 'Kayla/Jaxon generates offer. Wait for offer link.',
    montelliTasks: [
      'Confirm Kayla/Jaxon received the deal info',
      'Wait for AI offer link to come back',
      'Once offer link received → notify Montelli to confirm send',
      'Move to Stage 4 (Offer Sent to Lead)'
    ],

    scripts: {
      offerConfirmation: `Hey [Kayla/Jaxon] — [Property Address] is at Stage 3. Did the offer come through yet?`
    },

    shortcuts: [],

    trigger: 'Kayla/Jaxon sends offer via AI → Montelli confirms send → moves to Stage 4',

    autoAdvance: null,

    nextStage: '9bbe635c-2bee-42e2-b1ad-3f9b6c314acd', // Offer Sent to Lead
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 4 — OFFER SENT TO LEAD
  // ─────────────────────────────────────────────────────────────────────────────
  '9bbe635c-2bee-42e2-b1ad-3f9b6c314acd': {
    name: 'Offer Sent to Lead',
    position: 3,

    action: 'Wait 48 hours. Call to confirm receipt.',
    montelliTasks: [
      'Set 48-hour timer from send date',
      'Call seller to confirm offer received',
      'If confirmed: "Awesome, I\'ll let Kayla know" → move to Stage 5 (Offer Received)',
      'If not received: re-send offer, check spam, confirm email',
      'Log confirmation date in GHL notes'
    ],

    scripts: {
      confirmReceipt: `Happy [day] [name], I'm calling regarding the property at [address]. We sent an offer a couple days ago — I wanted to make sure it came through and wasn't lost in a spam folder. Did you get a chance to see it?`,

      confirmReceiptFollowUp: `Hey [name], this is [your name] again following up on the offer for [address]. Just wanted to make sure it landed — we sent it from Homewithkaylamauser@gmail.com. Feel free to check other folders. Let me know when you get a chance to look it over!`
    },

    shortcuts: ['LOI'],

    trigger: 'After 48 hrs with seller confirmation → Montelli moves to Stage 5 (Offer Received)',

    autoAdvance: null, // webhook can auto-advance if Rose configures GHL to POST on stage change

    nextStage: 'de4357bb-9ef7-479f-9cd8-69009d815b98', // Offer Received
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 5 — OFFER RECEIVED
  // ─────────────────────────────────────────────────────────────────────────────
  'de4357bb-9ef7-479f-9cd8-69009d815b98': {
    name: 'Offer Received',
    position: 4,

    action: 'Seller has the offer. Waiting for their response.',
    montelliTasks: [
      'Wait for seller response',
      'If counter: → Stage 9 (Active Negotiation)',
      'If accept: → Stage 10 (Terms Agreed)',
      'If decline: → Stage 8 (Seller Declined Offer)',
      'Send GCJ text shortcut to create group chat with Jaxon + seller'
    ],

    scripts: {
      gcjScript: `[Seller Name] - happy [day]! Creating a group chat for the purchase on [Property Address] with my business partner Jaxon. He is currently in a meeting with our lender; The LOI will be coming from our partner at Homewithkaylamauser@gmail.com. Simply inform us it has been received for presentation, and also ensure to check other folders as well. Have a blessed rest of the week!`
    },

    shortcuts: ['GCJ'],

    trigger: 'Seller response → Montelli determines counter/accept/decline → moves to appropriate stage',

    autoAdvance: null,

    // Branches — Montelli picks direction:
    branchCounter: '4cf61ef7-f125-42cc-8fba-deda6591a156',   // Active Negotiation
    branchAccept: 'f805edc3-5782-4398-a692-d919c967a64c',    // Terms Agreed
    branchDecline: 'bcc4d024-d7ec-46ab-8e1c-b0a212ca8fbc',   // Seller Declined Offer
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 6 — OFFER READY TO GAIN FEEDBACK
  // ─────────────────────────────────────────────────────────────────────────────
  '7e18de44-53b7-421f-8504-001c902afb3a': {
    name: 'Offer Ready to Gain Feedback',
    position: 5,

    action: 'Call seller to gain feedback on the offer.',
    montelliTasks: [
      'Call seller using realignment script',
      'If questions: "Noted — I\'ll relay to my business partner and get back with you"',
      'Relay seller questions to Kayla/Jaxon immediately',
      'Move to appropriate stage based on seller response'
    ],

    scripts: {
      realignmentScript: `Happy [day] [name], I am just now finding some time to realign with you. We spoke on [day] regarding the property at [address]. We had sent an offer over to you. Is there any clarification I can align further regarding the details of our offer?`,

      relayScript: `Noted — what I'll do is relay this over to my business partner and I'll get back with you. I look forward to aligning finer details with you shortly. Have a great rest of your day!`
    },

    shortcuts: ['LOI', 'LOI2DAYS'],

    trigger: 'After call → seller response determines next stage',

    branchCounter: '4cf61ef7-f125-42cc-8fba-deda6591a156',
    branchAccept: 'f805edc3-5782-4398-a692-d919c967a64c',
    branchDecline: 'bcc4d024-d7ec-46ab-8e1c-b0a212ca8fbc',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 7 — NO ANSWER AFTER OFFER READY TO GAIN FEEDBACK
  // ─────────────────────────────────────────────────────────────────────────────
  '138be6ca-2f31-49e1-b751-78a09edfab0d': {
    name: 'No Answer After Offer Ready to Gain Feedback',
    position: 6,

    action: 'No answer on call. Leave voice memo.',
    montelliTasks: [
      'Send voice memo to seller',
      'Set 48-hour follow-up reminder',
      'If still no answer → send LOI2DAYS text',
      'If no response after LOI2DAYS → send SD text + note DOM',
      'Calendar: listing expiry date (DOM - 181 days) → call back before listing expires'
    ],

    scripts: {
      voiceMemo: `Happy [day] [their name], I had called intending to introduce myself regarding purchasing [property address] as a rental for my portfolio. I'm going to give my lender a quick call, they only look at servicing the debt based on the rental income with a DSCR loan. To streamline the communication I will loop you in with my business partner Jaxon who will be purchasing with me regarding the finer details of our offer.`
    },

    shortcuts: ['LOI', 'LOI2DAYS', 'SD'],

    trigger: 'After voice memo + 48hr no response → auto-advance to Seller Declined Offer OR keep warm depending on DOM',

    autoAdvance: null,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 8 — SELLER DECLINED OFFER
  // ─────────────────────────────────────────────────────────────────────────────
  'bcc4d024-d7ec-46ab-8e1c-b0a212ca8fbc': {
    name: 'Seller Declined Offer',
    position: 7,

    action: 'Seller said no. Keep warm for future.',
    montelliTasks: [
      'Send SD text shortcut to seller',
      'Ask: "Do you have any other properties you\'re looking to offload?"',
      'Note Days on Market (DOM)',
      'Calendar reminder: listing expiry = DOM - 181 days → call back before listing expires',
      'Keep lead in GHL for future follow-up'
    ],

    scripts: {
      sdScript: `Happy [day]! Thank you for the update – feel free to revisit this right before the listing expires if your seller has not been able to find their number with owner occupants. Wishing you a smooth closing — feel free to keep us in mind for the future if you have listings that can't sell outright and are owned outright. Buy-box: Red States (Landlord Friendly) Turnkey Properties Single Family & Multi Family $[150k] - $[550k] 3 bed + 10k+ Population No HOA's No pools No flood zones`
    },

    shortcuts: ['SD'],

    trigger: 'Keep warm. Archive but stay in GHL pipeline. Follow up at listing expiry.',

    autoAdvance: null,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 9 — ACTIVE NEGOTIATION
  // ─────────────────────────────────────────────────────────────────────────────
  '4cf61ef7-f125-42cc-8fba-deda6591a156': {
    name: 'Active Negotiation',
    position: 8,

    action: 'Seller countered or is negotiating. Pivot to seller financing if needed.',
    montelliTasks: [
      'Listen for counter terms',
      'Relay counter details to Kayla/Jaxon immediately',
      'If price too high: pivot to seller financing script',
      'If terms agreed: → Stage 10 (Terms Agreed)',
      'If deal dies: → Stage 8 (Seller Declined Offer)'
    ],

    scripts: {
      pivotScript: `I understand your intent to sell outright, would you be completely opposed to taking half your price now and the rest in one lump sum in the near future?`,

      counterRelayScript: `Noted — let me bring my business partner in on this. Hold tight.`
    },

    shortcuts: ['F50', 'GCJ'],

    trigger: 'Montelli determines outcome → Terms Agreed OR Seller Declined Offer',

    autoAdvance: null,

    branchTermsAgreed: 'f805edc3-5782-4398-a692-d919c967a64c',
    branchDeclined: 'bcc4d024-d7ec-46ab-8e1c-b0a212ca8fbc',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 10 — TERMS AGREED
  // ─────────────────────────────────────────────────────────────────────────────
  'f805edc3-5782-4398-a692-d919c967a64c': {
    name: 'Terms Agreed',
    position: 9,

    action: 'Seller agreed to terms. Kayla/Jaxon draft contract.',
    montelliTasks: [
      'Notify Kayla + Jaxon: deal is agreed, draft contract',
      'Confirm close timeline with seller',
      'Set calendar for expected close date',
      'Move to Stage 11 (Contract Out)'
    ],

    scripts: {
      notifyKayla: `Hey Kayla — [Property Address] terms are agreed. Seller [name] at [phone/email]. Deal: [price], [terms]. Please draft the contract.`
    },

    shortcuts: ['GCJ'],

    trigger: 'Kayla/Jaxon drafts contract → Montelli moves to Stage 11',

    autoAdvance: null,

    nextStage: 'b0e24feb-7fa3-4447-8bc5-4cd40ae264d1', // Contract Out
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 11 — CONTRACT OUT
  // ─────────────────────────────────────────────────────────────────────────────
  'b0e24feb-7fa3-4447-8bc5-4cd40ae264d1': {
    name: 'Contract Out',
    position: 10,

    action: 'Contract sent to seller. Waiting for signature.',
    montelliTasks: [
      'Confirm seller received contract',
      'Ensure seller reviews and signs',
      'Once signed → move to Stage 12 (Under Contract)'
    ],

    scripts: {
      contractFollowUp: `Hey [name], just checking in — did you receive the contract for [address]? Any questions before signing?`
    },

    shortcuts: [],

    trigger: 'Signed contract received → Montelli moves to Stage 12',

    autoAdvance: null,

    nextStage: '2dd14d3a-7c82-41ce-9308-0e01a25b093a', // Under Contract
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 12 — UNDER CONTRACT
  // ─────────────────────────────────────────────────────────────────────────────
  '2dd14d3a-7c82-41ce-9308-0e01a25b093a': {
    name: 'Under Contract',
    position: 11,

    action: 'Signed. Kayla runs TC (transaction coordinator) process.',
    montelliTasks: [
      'Kayla assigns TC',
      'Order home inspection',
      'Order appraisal',
      'Notify title company',
      'Confirm earnest money deposit sent',
      'Move to Inspection Complete as each item completes'
    ],

    scripts: {
      tcHandoff: `[Property Address] is UNDER CONTRACT. Please initiate TC process: inspection, appraisal, title, earnest money deposit.`
    },

    shortcuts: [],

    trigger: 'Each milestone completed → Montelli moves stage in GHL',

    autoAdvance: null,

    // Branch through: Inspection Complete → Appraisal Complete → JV Sent → JV Signed → Wire Instructions Set Up → Closing Date Assigned
    branchInspection: 'a4c6722d-7df7-4354-950d-9610ef75e2ab',
    branchBackup: 'd35374ef-5b5b-4c29-9525-7be99503f42a', // Under Contract w/ Another Buyer
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 13 — UNDER CONTRACT W/ ANOTHER BUYER
  // ─────────────────────────────────────────────────────────────────────────────
  'd35374ef-5b5b-4c29-9525-7be99503f42a': {
    name: 'Under Contract w/ Another Buyer',
    position: 12,

    action: 'Seller has another buyer. Stay warm as backup.',
    montelliTasks: [
      'Stay in touch with agent',
      'Ask agent to notify you if first buyer falls through',
      'Do NOT send SD — stay warm',
      'Check in every 2 weeks until closing or deal dies'
    ],

    scripts: {
      backupCheckIn: `Hey [name], checking in on [address] — just want to stay in the loop in case anything changes on your end. Still interested if the first buyer falls through.`
    },

    shortcuts: [],

    trigger: 'Agent notifies deal fell through → Montelli moves to Terms Agreed (negotiate fresh) OR closes out',

    autoAdvance: null,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 14 — INSPECTION COMPLETE
  // ─────────────────────────────────────────────────────────────────────────────
  'a4c6722d-7df7-4354-950d-9610ef75e2ab': {
    name: 'Inspection Complete',
    position: 13,

    action: 'Review inspection report. Negotiate repairs/credit if needed.',
    montelliTasks: [
      'Review inspection report',
      'If issues found → negotiate repairs or credit with seller',
      'If clean → notify Kayla proceed to appraisal',
      'Move to Stage 15 (Appraisal Complete)'
    ],

    scripts: {
      negotiateRepairs: `Happy [day] [name] — got the inspection report back on [address]. A few items need attention: [list issues]. Would you be willing to credit $[amount] at closing to cover these? Or would you prefer we handle repairs separately?`
    },

    shortcuts: [],

    trigger: 'Repair negotiations done → Montelli moves to Appraisal Complete',

    autoAdvance: null,

    nextStage: '520d191e-4625-4cf1-837b-2bd6ce2473b6', // Appraisal Complete
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 15 — APPRAISAL COMPLETE
  // ─────────────────────────────────────────────────────────────────────────────
  '520d191e-4625-4cf1-837b-2bd6ce2473b6': {
    name: 'Appraisal Complete',
    position: 14,

    action: 'Property appraised. Confirm value matches agreed purchase price.',
    montelliTasks: [
      'Confirm property appraised at agreed value',
      'If low appraisal → renegotiate price or pull from deal',
      'If at value → notify Kayla to proceed to JV',
      'Move to Stage 16 (JV Sent)'
    ],

    scripts: {
      lowAppraisal: `Happy [day] [name] — just got the appraisal back on [address]. It came in at $[appraised value] which is below our agreed purchase price of $[agreed price]. Would you be open to adjusting to $[new price]? Or shall we proceed as-is?`
    },

    shortcuts: [],

    trigger: 'Appraisal confirmed at value → Montelli moves to JV Sent',

    autoAdvance: null,

    nextStage: '24c8699c-7a51-44ef-ab0c-daec3b3f69e7', // JV Sent
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 16 — JV SENT
  // ─────────────────────────────────────────────────────────────────────────────
  '24c8699c-7a51-44ef-ab0c-daec3b3f69e7': {
    name: 'JV Sent',
    position: 15,

    action: 'Kayla/Jaxon sends JV agreement to title company.',
    montelliTasks: [
      'Confirm Kayla/Jaxon sent JV to title',
      'Confirm title company received it',
      'Move to Stage 17 (JV Signed)'
    ],

    scripts: {
      titleFollowUp: `Hey [title company] — checking on JV for [address]. Has it come through? Any questions?`
    },

    shortcuts: [],

    trigger: 'Title confirms receipt → Montelli moves to JV Signed',

    autoAdvance: null,

    nextStage: 'b858ae7b-c706-4da1-9e60-5cb72b5f0ad0', // JV Signed
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 17 — JV SIGNED
  // ─────────────────────────────────────────────────────────────────────────────
  'b858ae7b-c706-4da1-9e60-5cb72b5f0ad0': {
    name: 'JV Signed',
    position: 16,

    action: 'All JV docs signed. Get wire instructions.',
    montelliTasks: [
      'Confirm all JV documents signed',
      'Request wire instructions from title company',
      'Confirm wire instructions match agreed deal terms',
      'Move to Stage 18 (Wire Instructions Set Up)'
    ],

    scripts: {
      wireRequest: `Hey [title company] — JV is signed for [address]. Please send over wire instructions so we can fund the earnest money deposit.`
    },

    shortcuts: [],

    trigger: 'Wire instructions received → Montelli moves to Wire Instructions Set Up',

    autoAdvance: null,

    nextStage: '125f89a5-39e2-4c41-b099-c4e038d70cb6', // Wire Instructions Set Up
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 18 — WIRE INSTRUCTIONS SET UP
  // ─────────────────────────────────────────────────────────────────────────────
  '125f89a5-39e2-4c41-b099-c4e038d70cb6': {
    name: 'Wire Instructions Set Up',
    position: 17,

    action: 'Wire instructions received. Fund earnest money deposit.',
    montelliTasks: [
      'Verify wire instructions (routing, account, amount)',
      'Fund earnest money deposit',
      'Confirm funds sent — get receipt from title/escrow',
      'Move to Stage 19 (Closing Date Assigned)'
    ],

    scripts: {
      verifyWire: `Confirming wire details for [address] earnest money deposit: $[amount] to [title company]. Routing: [routing] Account: [account]. Please confirm receipt.`
    },

    shortcuts: [],

    trigger: 'Funds confirmed sent → Montelli moves to Closing Date Assigned',

    autoAdvance: null,

    nextStage: '02c0e45f-47be-4969-a02a-a24257ae9871', // Closing Date Assigned
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE 19 — CLOSING DATE ASSIGNED
  // ─────────────────────────────────────────────────────────────────────────────
  '02c0e45f-47be-4969-a02a-a24257ae9871': {
    name: 'Closing Date Assigned',
    position: 18,

    action: 'Deal closing. Get paid. Ask for more business.',
    montelliTasks: [
      'Confirm closing date with all parties',
      'Final walk-through if applicable',
      'CLOSE. Get paid.',
      'Ask: "Do you have any other properties you\'re looking to offload?" (double/triple dip)',
      'Archive deal in GHL'
    ],

    scripts: {
      doubleDip: `Hey [name] — congrats on closing! Quick question — do you have any other properties you\'re looking to offload? Or know anyone who does? Always looking for more deals.`
    },

    shortcuts: ['SD', 'GCJ'],

    trigger: 'Deal closes → archive in GHL',

    autoAdvance: null, // terminal stage
  },
};

module.exports = { STAGES, PIPELINE_ID };