'use strict';

function low(text) {
  return String(text || '').toLowerCase();
}

function sentenceEvidence(text, pattern) {
  const match = String(text || '').match(new RegExp(`[^.?!]*${pattern.source}[^.?!]*[.?!]?`, pattern.flags.includes('i') ? 'i' : undefined));
  return match ? match[0].trim() : null;
}

function fact(status, value, confidence, evidence, scope = 'property') {
  return { status, value, confidence, evidence, scope };
}

function extractPrice(text) {
  const normalized = low(text);
  if (/two\s+twenty[- ]?five/.test(normalized)) return fact('NEEDS_CONFIRMATION', 225000, 'medium', sentenceEvidence(text, /two\s+twenty[- ]?five/i));
  const explicitNumber = normalized.match(/(?:want|need|asking|ask|take|price is).{0,20}(\d{3},\d{3})/);
  if (explicitNumber) return fact('KNOWN', Number(explicitNumber[1].replace(/,/g, '')), 'high', sentenceEvidence(text, /(?:want|need|asking|ask|take|price is).{0,20}(\d{3},\d{3})/i));
  const explicit = normalized.match(/(?:want|need|asking|ask|take|price is)\s+(?:around\s+)?(\d{2,3})\s*k/);
  if (explicit) return fact('KNOWN', Number(explicit[1]) * 1000, 'high', sentenceEvidence(text, /(?:want|need|asking|ask|take|price is).*?(\d{2,3})/i));
  return fact('UNKNOWN', null, 'low', null);
}

function extractMinimumPrice(text) {
  const normalized = low(text);
  const explicit = normalized.match(/(?:lowest|least|min(?:imum)?|bottom line).{0,20}(\d{2,3})\s*k/);
  if (explicit) return fact('KNOWN', Number(explicit[1]) * 1000, 'high', sentenceEvidence(text, /(?:lowest|least|min(?:imum)?|bottom line).{0,20}(\d{2,3})/i));
  return fact('UNKNOWN', null, 'low', null);
}

function extractTimeline(text) {
  const normalized = low(text);
  if (/30 days|thirty days/.test(normalized)) return fact('KNOWN', '30 days', 'high', sentenceEvidence(text, /30 days|thirty days/i));
  if (/1-3 months|within 1 to 3 months|one to three months/.test(normalized)) return fact('KNOWN', '1-3 months', 'high', sentenceEvidence(text, /1-3 months|within 1 to 3 months|one to three months/i));
  if (/urgent|asap|quickly/.test(normalized)) return fact('PARTIAL', 'urgent', 'medium', sentenceEvidence(text, /urgent|asap|quickly/i));
  return fact('UNKNOWN', null, 'low', null);
}

function extractOccupancy(text) {
  const normalized = low(text);
  if (/vacant/.test(normalized)) return fact('KNOWN', 'vacant', 'high', sentenceEvidence(text, /vacant/i));
  if (/tenant|renter/.test(normalized)) return fact('KNOWN', 'tenant_occupied', 'high', sentenceEvidence(text, /tenant|renter/i));
  if (/owner occupied|live here|living there/.test(normalized)) return fact('KNOWN', 'owner_occupied', 'high', sentenceEvidence(text, /owner occupied|live here|living there/i));
  if (/family.*living|my son lives|my daughter lives/.test(normalized)) return fact('KNOWN', 'family_occupied', 'medium', sentenceEvidence(text, /family.*living|my son lives|my daughter lives/i));
  return fact('UNKNOWN', null, 'low', null);
}

function extractMortgageBalance(text) {
  const normalized = low(text);
  if (/(owe|owed|mortgage|payoff).*(one fifty|150)/.test(normalized)) return fact('NEEDS_CONFIRMATION', 150000, 'medium', sentenceEvidence(text, /(owe|owed|mortgage|payoff).*(one fifty|150)/i));
  const explicitNumber = normalized.match(/(?:owe|mortgage|payoff|balance of).{0,20}(\d{3},\d{3})/);
  if (explicitNumber) return fact('KNOWN', Number(explicitNumber[1].replace(/,/g, '')), 'high', sentenceEvidence(text, /(?:owe|mortgage|payoff|balance of).{0,20}(\d{3},\d{3})/i));
  const explicit = normalized.match(/(?:owe|mortgage|payoff).{0,20}(\d{2,3})\s*k/);
  if (explicit) return fact('KNOWN', Number(explicit[1]) * 1000, 'high', sentenceEvidence(text, /(?:owe|mortgage|payoff).{0,20}(\d{2,3})/i));
  return fact('UNKNOWN', null, 'low', null);
}

function extractCallback(text) {
  const normalized = low(text);
  const match = normalized.match(/call me\s+(tomorrow morning|tomorrow afternoon|friday after \d+|next monday|next tuesday|next wednesday|next thursday|next friday|end of week|friday|monday|tuesday|wednesday|thursday|saturday|sunday)(?:\s+after\s+(\d+))?/i);
  if (!match) return { requested: false, raw: null, normalized: null, confidence: 'low', evidence: null };
  const raw = match[1] + (match[2] ? ` after ${match[2]}` : '');
  return { requested: true, raw, normalized: raw, confidence: 'medium', evidence: sentenceEvidence(text, /call me\s+(tomorrow morning|tomorrow afternoon|friday after \\d+|next monday|next tuesday|next wednesday|next thursday|next friday|end of week|friday|monday|tuesday|wednesday|thursday|saturday|sunday)/i) };
}

function extractDecisionMakers(text) {
  const normalized = low(text);
  const values = [];
  if (/spouse|wife|husband/.test(normalized)) values.push('spouse');
  if (/partner/.test(normalized)) values.push('partner');
  if (/heir|estate|probate/.test(normalized)) values.push('heirs_or_estate');
  return { status: values.length ? 'KNOWN' : 'UNKNOWN', value: values, confidence: values.length ? 'medium' : 'low', evidence: values.length ? sentenceEvidence(text, /spouse|wife|husband|partner|heir|estate|probate/i) : null, scope: 'contact' };
}

function extractMotivation(text) {
  const normalized = low(text);
  const values = [];
  if (/inherit|inherited|probate|estate/.test(normalized)) values.push('inherited property');
  if (/vacant/.test(normalized)) values.push('vacant property');
  if (/repairs|fixer|rehab/.test(normalized)) values.push('repairs');
  if (/landlord|tenant/.test(normalized)) values.push('landlord fatigue');
  if (/testing the market/.test(normalized)) values.push('testing market');
  return { status: values.length ? 'KNOWN' : 'UNKNOWN', value: values, confidence: values.length ? 'medium' : 'low', evidence: values.length ? sentenceEvidence(text, /inherit|inherited|probate|estate|vacant|repairs|fixer|rehab|landlord|tenant|testing the market/i) : null, scope: 'property' };
}

function extractPropertyCondition(text) {
  const normalized = low(text);
  const values = [];
  if (/roof/.test(normalized)) values.push('roof mentioned');
  if (/hvac|air conditioning|furnace/.test(normalized)) values.push('hvac mentioned');
  if (/plumbing/.test(normalized)) values.push('plumbing mentioned');
  if (/electrical/.test(normalized)) values.push('electrical mentioned');
  if (/foundation/.test(normalized)) values.push('foundation mentioned');
  if (/windows/.test(normalized)) values.push('windows mentioned');
  if (/kitchen/.test(normalized)) values.push('kitchen mentioned');
  if (/bath/.test(normalized)) values.push('bathrooms mentioned');
  if (/floor/.test(normalized)) values.push('flooring mentioned');
  if (/water damage/.test(normalized)) values.push('water damage');
  if (/mold/.test(normalized)) values.push('mold');
  if (/fire damage/.test(normalized)) values.push('fire damage');
  if (/structural/.test(normalized)) values.push('structural issues');
  return { status: values.length ? 'KNOWN' : 'UNKNOWN', value: values, confidence: values.length ? 'medium' : 'low', evidence: values.length ? sentenceEvidence(text, /roof|hvac|air conditioning|furnace|plumbing|electrical|foundation|windows|kitchen|bath|floor|water damage|mold|fire damage|structural/i) : null, scope: 'property' };
}

function extractPropertyAttributes(text) {
  const normalized = low(text);
  const beds = normalized.match(/(\d+)\s*bed/);
  const baths = normalized.match(/(\d+)\s*bath/);
  const sqft = normalized.match(/(\d{3,5})\s*(sq\s*ft|square feet|sqft)/);
  const yearBuilt = normalized.match(/built\s+in\s+(19\d{2}|20\d{2})/);
  const propertyType = /duplex|multifamily|multi family/.test(normalized) ? 'multifamily' : /single family/.test(normalized) ? 'single_family' : /condo/.test(normalized) ? 'condo' : null;
  return {
    propertyType: propertyType ? fact('KNOWN', propertyType, 'medium', sentenceEvidence(text, /duplex|multifamily|multi family|single family|condo/i)) : fact('UNKNOWN', null, 'low', null),
    bedrooms: beds ? fact('KNOWN', Number(beds[1]), 'medium', sentenceEvidence(text, /(\d+)\s*bed/i)) : fact('UNKNOWN', null, 'low', null),
    bathrooms: baths ? fact('KNOWN', Number(baths[1]), 'medium', sentenceEvidence(text, /(\d+)\s*bath/i)) : fact('UNKNOWN', null, 'low', null),
    squareFootage: sqft ? fact('KNOWN', Number(sqft[1]), 'medium', sentenceEvidence(text, /(\d{3,5})\s*(sq\s*ft|square feet|sqft)/i)) : fact('UNKNOWN', null, 'low', null),
    yearBuilt: yearBuilt ? fact('KNOWN', Number(yearBuilt[1]), 'medium', sentenceEvidence(text, /built\s+in\s+(19\d{2}|20\d{2})/i)) : fact('UNKNOWN', null, 'low', null),
  };
}

function extractMarketStatus(text) {
  const normalized = low(text);
  const values = [];
  if (/listed with agent|listed/.test(normalized)) values.push('listed_with_agent');
  if (/fsbo/.test(normalized)) values.push('fsbo');
  if (/expired listing/.test(normalized)) values.push('expired_listing');
  if (/under contract/.test(normalized)) values.push('under_contract');
  if (/another offer|other offer|competing offer/.test(normalized)) values.push('competing_offer');
  return { status: values.length ? 'KNOWN' : 'UNKNOWN', value: values, confidence: values.length ? 'medium' : 'low', evidence: values.length ? sentenceEvidence(text, /listed with agent|listed|fsbo|expired listing|under contract|another offer|other offer|competing offer/i) : null, scope: 'property' };
}

function extractPromises(text) {
  const normalized = low(text);
  const promises = [];
  if (/send (?:you )?photos|send pictures/.test(normalized)) promises.push({ party: 'seller', type: 'send_photos', description: 'Seller said they would send photos', evidence: sentenceEvidence(text, /send (?:you )?photos|send pictures/i) });
  if (/talk to my wife|talk to my husband|talk to my spouse|talk to my partner/.test(normalized)) promises.push({ party: 'seller', type: 'talk_to_spouse', description: 'Seller said they would talk to spouse/partner', evidence: sentenceEvidence(text, /talk to my wife|talk to my husband|talk to my spouse|talk to my partner/i) });
  if (/get the payoff|send the payoff/.test(normalized)) promises.push({ party: 'seller', type: 'get_payoff', description: 'Seller said they would get payoff information', evidence: sentenceEvidence(text, /get the payoff|send the payoff/i) });
  if (/call me /.test(normalized)) promises.push({ party: 'owner', type: 'callback', description: 'Seller requested callback', evidence: sentenceEvidence(text, /call me /i) });
  return promises;
}

function extractFacts(transcript) {
  const text = String(transcript?.text || '').trim();
  const normalized = low(text);
  const callback = extractCallback(text);
  const property = extractPropertyAttributes(text);
  return {
    answered: true,
    sellerIntent: /not interested|stop calling|wrong number/.test(normalized) ? 'not_interested' : /interested|open to|would consider/.test(normalized) ? 'interested' : /maybe|think about it/.test(normalized) ? 'maybe' : 'unknown',
    motivation: extractMotivation(text),
    timeline: extractTimeline(text),
    askingPrice: extractPrice(text),
    minimumPrice: extractMinimumPrice(text),
    propertyType: property.propertyType,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    squareFootage: property.squareFootage,
    yearBuilt: property.yearBuilt,
    propertyCondition: extractPropertyCondition(text),
    occupancy: extractOccupancy(text),
    mortgageBalance: extractMortgageBalance(text),
    decisionMakers: extractDecisionMakers(text),
    callbackRequested: callback.requested,
    preferredCallbackTime: callback.raw,
    callbackWindow: callback,
    objections: [/retail/.test(normalized) ? 'wants retail' : null, /too low/.test(normalized) ? 'price objection' : null, /think about it/.test(normalized) ? 'needs time' : null].filter(Boolean),
    creativeFinanceInterest: /creative|subject to|seller finance/.test(normalized) ? fact('KNOWN', true, 'medium', sentenceEvidence(text, /creative|subject to|seller finance/i), 'property') : fact('UNKNOWN', null, 'low', null, 'property'),
    marketStatus: extractMarketStatus(text),
    dnc: /don't call|do not call|stop calling|remove me/.test(normalized),
    wrongNumber: /wrong number|wrong person|never heard of/.test(normalized),
    promises: extractPromises(text),
    nextActionRecommendation: null,
  };
}

module.exports = { extractFacts };
