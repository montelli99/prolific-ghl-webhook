'use strict';

const COURSE_CLASS = Object.freeze({
  EXPLICIT: 'COURSE_EXPLICIT',
  DERIVED: 'COURSE_DERIVED',
  CONFLICT: 'COURSE_CONFLICT',
  MISSING: 'COURSE_MISSING',
});

const SCRIPT_REGISTRY = Object.freeze({
  INT: {
    id: 'INT',
    type: 'shortcut',
    exactSourceWording: '[Name], are you still accepting offers for [address]? My name is [your name], I\'m looking to purchase this as a rental for my portfolio.',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '10, 235-237',
    intendedContactPaths: ['LISTING_AGENT', 'BROKER', 'DIRECT_SELLER', 'FSBO_SELLER'],
    trigger: 'Before every call.',
    requiredVariables: ['Name', 'address', 'your name'],
    prohibitedUseCases: ['Do not treat INT alone as completed Stage 1 work.'],
    requiredPrecedingEvent: null,
    requiredFollowingEvent: 'CALL_ATTEMPT_STARTED',
    confirmationRequirement: 'Operator confirms INT was sent outside this simulation.',
    courseClassification: COURSE_CLASS.EXPLICIT,
  },
  AGENT_INITIAL: {
    id: 'AGENT_INITIAL',
    type: 'call_script',
    exactSourceWording: 'Happy [day it is], I\'m calling regarding the property at [address] - I\'m interested in potentially purchasing this as a rental for my portfolio. I just have a couple questions - did I catch you at a good time?\n\nBased on the photos online the property looks great inside and out, I\'m SHOCKED it hasn\'t sold yet. Now.. Regarding other buyers who have walked it - have you received any feedback?\n\nInteresting, okay - Regarding the roof and HVAC; when were those last installed?\n\nYeah it sounds great - now the property itself, is it currently occupied or vacant?\n\nIf occupied: Ask if the owner is living in it or if it is being rented out. If rented: What is the current rent? When did they sign? What kind of lease are they on?\n\nIf vacant: Noted, and I am curious - it looks like a great house, why wouldn\'t the seller just rent it out and collect a couple thousand dollars each month?\n\nThen: Are utilities still on?\n\nI would purchase outright by using a DSCR loan which is solely based on what it makes as a rental. As long as the rent covers the mortgage I\'ll be good to go at the price you\'re asking.\n\nI\'m going to give my lender a quick call and see how I can get approved. Is there a good email I can send over details to?',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '25-51',
    intendedContactPaths: ['LISTING_AGENT', 'BROKER'],
    trigger: 'Listed-property agent or broker contact path selected.',
    requiredVariables: ['day it is', 'address'],
    prohibitedUseCases: ['Do not use for confirmed direct seller path.'],
    requiredPrecedingEvent: 'INT_CONFIRMED_SENT',
    requiredFollowingEvent: 'CALL_COMPLETED_RECORDED or CALL_NO_ANSWER_RECORDED',
    confirmationRequirement: 'Operator records call outcome and answers.',
    courseClassification: COURSE_CLASS.EXPLICIT,
  },
  SELLER_INITIAL: {
    id: 'SELLER_INITIAL',
    type: 'call_script',
    exactSourceWording: 'Happy [day it is], my name is [your name] are you still accepting offers at [property address]?\n\nGreat - I\'m interested in potentially purchasing this as a rental for my portfolio. I just have a couple questions - did I catch you at a good time?\n\nRegarding the roof and HVAC; when were those last installed?\n\nNow the property itself, is it currently occupied or vacant?\n\nIf occupied: Ask if they are living in it or if it is being rented out. If rented: What is the current rent? When did they sign? What kind of lease are they on?\n\nIf vacant: Noted, and I am curious - it looks like a great house, why wouldn\'t you just rent it out and collect a couple thousand dollars each month?\n\nThen: Are utilities still on?\n\nCan I confirm that asking price?\n\nI\'m going to give my lender a quick call and see how I can get approved. Is there a good email I can send over details to?',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '55-81',
    intendedContactPaths: ['DIRECT_SELLER', 'FSBO_SELLER', 'PPC_SELLER'],
    trigger: 'Confirmed direct seller, FSBO seller, or PPC seller contact path selected.',
    requiredVariables: ['day it is', 'your name', 'property address'],
    prohibitedUseCases: ['Do not use for listing agent path.'],
    requiredPrecedingEvent: 'INT_CONFIRMED_SENT',
    requiredFollowingEvent: 'CALL_COMPLETED_RECORDED or CALL_NO_ANSWER_RECORDED',
    confirmationRequirement: 'Operator records call outcome and answers.',
    courseClassification: COURSE_CLASS.EXPLICIT,
  },
  SELLER_REHAB: {
    id: 'SELLER_REHAB',
    type: 'call_script',
    exactSourceWording: 'Happy [day it is], my name is [your name] I\'m interested in potentially purchasing [property address]. Regarding the roof and HVAC, when were those last installed? How would you rate condition 1-10? What would it need for it to be a 10? Occupied or vacant? If vacant: what has you opposed to putting a few bucks in and making a profit? Are utilities still on? What are you looking to net? What is the best email I can send over details to?',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '85-113',
    intendedContactPaths: ['DIRECT_SELLER', 'FSBO_SELLER', 'PPC_SELLER'],
    trigger: 'Seller path plus supported renovation/distressed condition.',
    requiredVariables: ['day it is', 'your name', 'property address'],
    prohibitedUseCases: ['Do not use without supported renovation condition.'],
    requiredPrecedingEvent: 'INT_CONFIRMED_SENT',
    requiredFollowingEvent: 'CALL_COMPLETED_RECORDED or CALL_NO_ANSWER_RECORDED',
    confirmationRequirement: 'Operator confirms rehab condition applies.',
    courseClassification: COURSE_CLASS.EXPLICIT,
  },
  NO_ANSWER_VOICE_MEMO: {
    id: 'NO_ANSWER_VOICE_MEMO',
    type: 'voice_memo_script',
    exactSourceWording: 'Happy [Day it is] [Client Name] - just tried to call you regarding the purchase of your property on [address]. I\'m going to call my DSCR lender to get approved, they simply just look at the rental income. Going to loop you into a group chat with my business partner Jaxon - have a blessed evening.',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '176-180',
    intendedContactPaths: ['LISTING_AGENT', 'BROKER', 'DIRECT_SELLER', 'FSBO_SELLER', 'PPC_SELLER'],
    trigger: 'After two unanswered calls.',
    requiredVariables: ['Day it is', 'Client Name', 'address'],
    prohibitedUseCases: ['Do not offer after only one unanswered call.'],
    requiredPrecedingEvent: 'CALL_NO_ANSWER_RECORDED twice',
    requiredFollowingEvent: 'NOA_CONFIRMED_SENT',
    confirmationRequirement: 'Operator confirms voice memo sent.',
    courseClassification: COURSE_CLASS.EXPLICIT,
  },
  NOA: {
    id: 'NOA',
    type: 'shortcut',
    exactSourceWording: 'Are you still accepting offers for [ADDRESS]?',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '11, 176-180',
    intendedContactPaths: ['LISTING_AGENT', 'BROKER', 'DIRECT_SELLER', 'FSBO_SELLER', 'PPC_SELLER'],
    trigger: 'After two unanswered calls and no-answer handling begins.',
    requiredVariables: ['ADDRESS'],
    prohibitedUseCases: ['Do not send after one unanswered call.'],
    requiredPrecedingEvent: 'CALL_NO_ANSWER_RECORDED twice',
    requiredFollowingEvent: 'NOTES_CONFIRMED_RECORDED',
    confirmationRequirement: 'Operator confirms NOA sent.',
    courseClassification: COURSE_CLASS.EXPLICIT,
  },
  CCC: {
    id: 'CCC',
    type: 'shortcut',
    exactSourceWording: 'It is great aligning with you [name], I look forward to connecting the dots with you shortly at [address]. Feel free to browse through our closings with similar clients on our website - Divinity Aligned LLC: Expert Solutions for Life\'s Major Transitions',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '13, 235-237',
    intendedContactPaths: ['LISTING_AGENT', 'BROKER', 'DIRECT_SELLER', 'FSBO_SELLER', 'PPC_SELLER'],
    trigger: 'After every completed call.',
    requiredVariables: ['name', 'address'],
    prohibitedUseCases: ['Do not send merely because INT was sent.'],
    requiredPrecedingEvent: 'CALL_COMPLETED_RECORDED',
    requiredFollowingEvent: 'CONTACT_CARD_CONFIRMED_SENT',
    confirmationRequirement: 'Operator confirms CCC sent.',
    courseClassification: COURSE_CLASS.EXPLICIT,
  },
  CONTACT_CARD: {
    id: 'CONTACT_CARD',
    type: 'operator_action',
    exactSourceWording: 'Send CCC + contact card after EVERY call.',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '235-237',
    intendedContactPaths: ['LISTING_AGENT', 'BROKER', 'DIRECT_SELLER', 'FSBO_SELLER', 'PPC_SELLER'],
    trigger: 'After every completed call, paired with CCC.',
    requiredVariables: [],
    prohibitedUseCases: ['Do not mark sent without operator confirmation.'],
    requiredPrecedingEvent: 'CALL_COMPLETED_RECORDED',
    requiredFollowingEvent: 'NOTES_CONFIRMED_RECORDED',
    confirmationRequirement: 'Operator confirms contact card sent.',
    courseClassification: COURSE_CLASS.EXPLICIT,
  },
});

function getStage1Script(id) {
  return SCRIPT_REGISTRY[id] || null;
}

function renderStage1Script(id, context = {}) {
  const script = getStage1Script(id);
  if (!script) return { ok: false, reason: 'COURSE_MISSING_SCRIPT', scriptId: id };
  const replacements = {
    '[Name]': context.name || context.contactName || '[Name]',
    '[name]': context.name || context.contactName || '[name]',
    '[Client Name]': context.name || context.contactName || '[Client Name]',
    '[your name]': context.operatorName || context.senderName || '[your name]',
    '[day it is]': context.day || '[day it is]',
    '[Day it is]': context.day || '[Day it is]',
    '[day]': context.day || '[day]',
    '[address]': context.propertyAddress || context.address || '[address]',
    '[ADDRESS]': context.propertyAddress || context.address || '[ADDRESS]',
    '[property address]': context.propertyAddress || context.address || '[property address]',
  };
  let body = script.exactSourceWording;
  for (const [needle, value] of Object.entries(replacements)) body = body.split(needle).join(value);
  return { ok: true, script, body };
}

module.exports = { COURSE_CLASS, SCRIPT_REGISTRY, getStage1Script, renderStage1Script };
