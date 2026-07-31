'use strict';

const fs = require('fs');
const path = require('path');

const PIPELINE_ID = 'nSf3NXYVkt8X4PgW9aZ3';
const LOCATION_ID = '61XPzSqRy7UKMwW9DeB8';
const OWNER_ID = 'PGfXxlXCRXs3hXN3Gq7R';
const LEAD_ENTERED_STAGE_ID = '7067148a-2ee8-4e5b-93c8-31e0253fea68';
const CONTACT_MADE_STAGE_ID = '934c4c52-4b22-457a-8d10-55ab6600fdee';
const SELECTED_SENDER_SUFFIX = '2619';

const STAGES = Object.freeze([
  ['Lead Entered', LEAD_ENTERED_STAGE_ID, 'INITIAL_CONTACT', 'INT', 'Prepare contact, send INT, call twice, collect initial data.'],
  ['Contact Made', CONTACT_MADE_STAGE_ID, 'CALL_DUE', 'CCC', 'Send CCC, log call facts, classify agent/seller, occupancy, condition, feedback, rent, roof/HVAC.'],
  ['Offer Ready to be Sent to Seller', '3da698e7-aba8-4d4a-b14b-7742f7b44ac7', 'TEXT_DUE', null, 'Evaluate deal type and send details to Seth/Kayla/Jaxon for LOI/offer.'],
  ['Offer Sent to Lead', 'eef16a9b-8ca9-43b7-9cad-fb9c352b560d', 'FOLLOW_UP', 'GCJ', 'Confirm receipt, send GCJ, start 48-hour feedback timer.'],
  ['Offer Received', 'd5375376-26dc-4dc3-9b06-f55178f8a23b', 'FOLLOW_UP', null, 'Monitor response and relay counters or decisions.'],
  ['Offer Ready to Gain Feedback', '83f2c0df-a9c5-44fe-b42f-46ed60274e66', 'OFFER_FEEDBACK', 'LOI', 'Call with realignment script and ask for feedback/clarification.'],
  ['No Answer After Offer Ready to Gain Feedback', 'b82940e0-e55c-4359-98e6-35cb22e065ab', 'FOLLOW_UP', 'LOI2DAYS', 'Voice memo, LOI2DAYS, SD, and DOM-181 reminder sequence.'],
  ['Seller Declined Offer', '8dc3463c-8a45-41a1-a305-2013527b1bd8', 'FOLLOW_UP', 'SD', 'Send SD, ask for other properties, note DOM, set circle-back.'],
  ['Active Negotiation', 'a7a5c7ac-3933-4c68-bfce-b81eaacf622e', 'NEGOTIATION_ACTION', null, 'Montelli relays; Kayla/Jaxon negotiate.'],
  ['Terms Agreed', 'e6480e04-1b0f-4f79-af96-7cf5fb634ac5', 'CONTRACT_ACTION', null, 'Kayla drafts contract. Montelli stays warm every 3-5 days.'],
  ['Awaiting Seller Title Info', '1e97ae23-78a6-4698-919f-ba0d6a0e08c6', 'CONTRACT_ACTION', null, 'Kayla/Jaxon/TC territory.'],
  ['Contract Out', 'f0b739d5-f270-410c-b9e9-bce2e26a53ff', 'CONTRACT_ACTION', null, 'Kayla sends contract; Montelli monitors.'],
  ['Under Contract', '645611af-ae9a-4dfc-aba9-8bfff08dc79a', 'CONTRACT_ACTION', null, 'TC handoff, inspection/appraisal/title coordination.'],
  ['Under Contract w/ Another Buyer', 'b68f7087-559d-470b-9ddf-d1452f4b027e', 'FOLLOW_UP', null, 'Monitor whether buyer performs.'],
  ['Sent to Buyers', '129094e2-ea70-49c1-a670-b599ee25ba3f', 'CONTRACT_ACTION', null, 'Disposition/buyer-facing status.'],
  ['Inspection Complete', 'b7ab06be-9a28-40a2-9dc9-6697fc09a836', 'CONTRACT_ACTION', null, 'Kayla reviews inspection and repair/credit issues.'],
  ['Appraisal Complete', '49142ba4-2360-49ca-9a86-6223dc847440', 'CONTRACT_ACTION', null, 'Kayla decides renegotiation or exit if appraisal is low.'],
  ['JV Sent', '36993fe3-cfc3-4651-99d6-3146627869a3', 'CONTRACT_ACTION', null, 'Kayla sends JV agreement.'],
  ['JV Signed', '6eb610d7-31f2-4380-ab03-fd0c2f771e8b', 'CONTRACT_ACTION', null, 'Title/books setup.'],
  ['Wire Instructions Set Up', '6f97e402-288e-417a-b561-65a8287e5653', 'CONTRACT_ACTION', null, 'Confirm title wiring and processor setup.'],
  ['Closing Date Assigned', 'e446607c-2d2c-4664-b0cd-96f9de0584e1', 'CONTRACT_ACTION', null, 'Closing countdown, close, ask for referrals/other properties.'],
]);

const SHORTCUT_BODIES = Object.freeze({
  INT: '[Name], are you still accepting offers for [address]? My name is [your name], I\'m looking to purchase this as a rental for my portfolio.',
  NOA: 'Are you still accepting offers for [address]?',
  DNCT: '[Name], would you be opposed to accepting an offer for [address]? My name is [name], I\'m looking at purchasing as a rental for my portfolio.',
  CCC: 'It is great aligning with you [name], I look forward to connecting the dots with you shortly at [address]. Feel free to browse through our closings with similar clients on our website — Divinity Aligned LLC: Expert Solutions for Life\'s Major Transitions',
  GCJ: '[Name] - happy [day]! Creating a group chat for the purchase on [address] with my business partner Jaxon. He is currently in a meeting with our lender; The LOI will be coming from our partner at Homewithkaylamauser@gmail.com ; simply inform us it has been received for presentation, and also ensure to check other folders as well. Have a blessed rest of the week!',
  LOI: 'Happy [day]! For the intent of my call — I have just now found some time to iron out any further details regarding the offer we had finalized. Have you gained any initial feedback from your seller just yet?',
  LOI2DAYS: 'Happy Sunday! I hate to be a bother — We spoke recently. I was curious: did you end up losing the listing or did your seller just give up on selling?',
  INLOI: '[Name], thank you for the swift response – the photos online look great. I\'m sure they don\'t even do the property justice! We will set up a home inspection like any real estate purchase – within 24 hours. We are not willing to incur costs with a contractor/inspector when the seller could simply sell it to another buyer while I spend a few thousand dollars to do due diligence. As a business owner yourself, I can only hope this is understandable.',
  F50: 'Happy [day]! I understand your intent to sell outright, would you be completely opposed to taking half your price now and the rest in one lump sum in the near future?',
  F10: 'Happy [day]! I understand your intent to sell outright, would you be completely opposed to taking 10% of your price now and the rest in one lump sum in just 24 months?',
  PEND: 'Tami, happy Thursday! I came across your listing at [address] and noticed it\'s pending. Congratulations, that\'s exciting! Wishing you a smooth closing — Feel free to keep my offer in your back pocket; I\'m intending to acquire this as a rental property. I\'m gonna give my DSCR Lender a quick call and send an offer over if I get approved. Feel free to browse through my closings with similar clients on our website — Divinity Aligned LLC: Expert Solutions for Life\'s Major Transitions',
  SD: 'Happy Wednesday! Thank you for the update – feel free to revisit this right before the listing expires if your seller has not been able to find their number with owner occupants. Wishing you a smooth closing – feel free to keep us in mind for the future if you have listings that can\'t sell out right and are owned outright. This would be a great solution for homeowners who aren\'t seeing the outright number they\'re hoping for. Buy-box: Red States (Landlord Friendly) Turnkey Properties Single Family & Multi Family $150,000 - $550,000 3 bed + 10k + Population No HOA\'s No pools No flood zones',
});

const CALL_SCRIPTS = Object.freeze({
  AGENT_INITIAL: 'Happy [day], I\'m calling regarding the property at [address] — I\'m interested in potentially purchasing this as a rental for my portfolio. I just have a couple questions — did I catch you at a good time?',
  SELLER_INITIAL: 'Happy [day], my name is [your name] are you still accepting offers at [property address]? Great - I\'m interested in potentially purchasing this as a rental for my portfolio.',
  OFFER_FEEDBACK: 'Happy [day] [name], I am just now finding some time to realign with you regarding [address]. We sent an offer. Is there any clarification I can align regarding the details?',
});

function defaultSpecPath() {
  return path.resolve(__dirname, '..', '..', 'docs', 'atlas-kayla-course-parity-spec.md');
}

function extractSection(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const next = markdown.indexOf('\n## ', start + 4);
  return markdown.slice(start, next < 0 ? markdown.length : next).trim();
}

function loadKaylaCourseSpec(options = {}) {
  const specPath = options.specPath || defaultSpecPath();
  const markdown = fs.readFileSync(specPath, 'utf8');
  const workflowConflict = extractSection(markdown, 'Governing Conflict');
  const stageRows = STAGES.map((stage, index) => ({
    order: index + 1,
    stageName: stage[0],
    stageId: stage[1],
    mode: stage[2],
    textShortcut: stage[3],
    coursePurpose: stage[4],
    requiredHumanAction: stage[4],
    allowedAutomation: index === 0 ? 'Telegram may show untouched leads and preview INT; send only exact operator-approved count.' : 'Dry-run recommendation and preview only unless separately approved.',
    manualConfirmationPoints: ['operator exact-count approval', 'dry-run hash verification'],
    nextAllowedStages: index === 0 ? [CONTACT_MADE_STAGE_ID] : [],
    sourceCitations: [`docs/atlas-kayla-course-parity-spec.md#21-stage-operating-map stage ${index + 1}`],
    workflowConflicts: workflowConflict ? [{ code: 'COURSE_RULE_CONFLICT', summary: 'Workflow-brain automation conflicts with manual/operator-confirmed launch model.' }] : [],
  }));

  return {
    specVersion: 'atlas-kayla-course-parity-v1',
    sourcePath: specPath,
    loadedAt: new Date(0).toISOString(),
    productionLocks: { locationId: LOCATION_ID, pipelineId: PIPELINE_ID, ownerId: OWNER_ID, leadEnteredStageId: LEAD_ENTERED_STAGE_ID, contactMadeStageId: CONTACT_MADE_STAGE_ID, selectedSenderSuffix: SELECTED_SENDER_SUFFIX },
    stages: stageRows,
    shortcuts: Object.entries(SHORTCUT_BODIES).map(([name, body]) => ({ name, body, source: 'docs/atlas-kayla-course-parity-spec.md#script-inventory', status: 'APPROVED_BY_COURSE' })),
    callScripts: CALL_SCRIPTS,
    courseRules: [
      { id: 'INT_BEFORE_CALL', citation: 'docs/atlas-kayla-course-parity-spec.md#course-rules', text: 'Send INT before calling.' },
      { id: 'TWO_CALLS_BEFORE_NOA', citation: 'docs/atlas-kayla-course-parity-spec.md#course-rules', text: 'Call twice before no-answer handling.' },
      { id: 'CCC_AFTER_CALL', citation: 'docs/atlas-kayla-course-parity-spec.md#course-rules', text: 'Send CCC and contact card after every call.' },
      { id: 'REALIGN_48H', citation: 'docs/atlas-kayla-course-parity-spec.md#course-rules', text: 'Post-offer feedback call is due 48 hours after offer sent.' },
      { id: 'MONTELLI_RELAY_KAYLA_NEGOTIATES', citation: 'docs/atlas-kayla-course-parity-spec.md#course-rules', text: 'Montelli relays; Kayla/Jaxon negotiate.' },
    ],
    conflicts: workflowConflict ? [{ code: 'COURSE_RULE_CONFLICT', section: 'Governing Conflict', summary: workflowConflict }] : [],
    unsupportedRules: ['LIVE_ALLOWED is unavailable in this dry-run implementation.'],
  };
}

function getStageById(spec, stageId) {
  return spec.stages.find(stage => stage.stageId === stageId) || null;
}

module.exports = { loadKaylaCourseSpec, getStageById, SHORTCUT_BODIES, CALL_SCRIPTS, PIPELINE_ID, LOCATION_ID, OWNER_ID, LEAD_ENTERED_STAGE_ID, CONTACT_MADE_STAGE_ID, SELECTED_SENDER_SUFFIX };
