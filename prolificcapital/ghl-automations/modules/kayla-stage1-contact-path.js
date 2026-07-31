'use strict';

const CONTACT_PATHS = Object.freeze({
  LISTING_AGENT: 'LISTING_AGENT',
  BROKER: 'BROKER',
  DIRECT_SELLER: 'DIRECT_SELLER',
  FSBO_SELLER: 'FSBO_SELLER',
  PPC_SELLER: 'PPC_SELLER',
  OTHER_CONFIRMED_COURSE_PATH: 'OTHER_CONFIRMED_COURSE_PATH',
  RESEARCH_REQUIRED: 'RESEARCH_REQUIRED',
});

function text(value) { return String(value || '').trim(); }
function lower(value) { return text(value).toLowerCase(); }
function hasContact(contact = {}) { return Boolean(text(contact.name || contact.contactName) || text(contact.phone || contact.phoneNumber) || text(contact.email)); }

function normalizeLeadSource(record = {}) {
  return lower(record.leadSource || record.source || record.raw?.leadSource || record.raw?.source || record.raw?.leadTypes);
}

function selectContactPath(record = {}, options = {}) {
  if (options.operatorSelectedPath) {
    const path = CONTACT_PATHS[options.operatorSelectedPath] || options.operatorSelectedPath;
    if (Object.values(CONTACT_PATHS).includes(path)) {
      return { path, confidence: 'OPERATOR_CONFIRMED', source: 'operator_selection', reason: 'Operator selected contact path for this property.', courseClassification: 'COURSE_DERIVED' };
    }
  }

  const raw = record.raw || {};
  const leadSource = normalizeLeadSource(record);
  const listingAgent = record.listingAgent || raw.listingAgent || raw.listing_agent || raw.agentName || raw.agent_name;
  const agentContact = record.agentContact || { name: listingAgent, phone: raw.agentPhone || record.agentPhone, email: raw.agentEmail || record.agentEmail };
  const broker = record.brokerName || raw.brokerName || raw.brokerage || raw.company;
  const seller = record.sellerContact || { name: record.sellerName || raw.sellerName || raw.ownerName, phone: raw.sellerPhone || record.sellerPhone, email: raw.sellerEmail || record.sellerEmail };

  if (/ppc|pay per click|inbound/.test(leadSource) && hasContact(seller)) {
    return { path: CONTACT_PATHS.PPC_SELLER, selectedContact: seller, confidence: 'EXPLICIT_TRANSACTION_EVIDENCE', source: 'lead_source_and_seller_contact', reason: 'PPC/inbound seller contact is explicit for this property.', courseClassification: 'COURSE_DERIVED' };
  }
  if (/fsbo|for sale by owner/.test(leadSource) && hasContact(seller)) {
    return { path: CONTACT_PATHS.FSBO_SELLER, selectedContact: seller, confidence: 'EXPLICIT_TRANSACTION_EVIDENCE', source: 'lead_source_and_seller_contact', reason: 'FSBO seller contact is explicit for this property.', courseClassification: 'COURSE_DERIVED' };
  }
  if (/direct|seller/.test(leadSource) && hasContact(seller)) {
    return { path: CONTACT_PATHS.DIRECT_SELLER, selectedContact: seller, confidence: 'EXPLICIT_TRANSACTION_EVIDENCE', source: 'lead_source_and_seller_contact', reason: 'Direct seller contact is explicit for this property.', courseClassification: 'COURSE_DERIVED' };
  }
  if (hasContact(agentContact) && (/mls|listed|listing|agent/.test(leadSource) || text(listingAgent))) {
    return { path: CONTACT_PATHS.LISTING_AGENT, selectedContact: agentContact, confidence: 'EXPLICIT_TRANSACTION_EVIDENCE', source: 'listing_agent_field', reason: 'Listed property has explicit listing-agent contact for this property.', courseClassification: 'COURSE_DERIVED' };
  }
  if (text(broker) && hasContact(agentContact)) {
    return { path: CONTACT_PATHS.BROKER, selectedContact: agentContact, confidence: 'EXPLICIT_TRANSACTION_EVIDENCE', source: 'broker_contact_field', reason: 'Broker contact is explicit for this property.', courseClassification: 'COURSE_DERIVED' };
  }
  if (hasContact(seller) && (record.explicitSeller === true || raw.explicitSeller === true)) {
    return { path: CONTACT_PATHS.DIRECT_SELLER, selectedContact: seller, confidence: 'EXPLICIT_TRANSACTION_EVIDENCE', source: 'explicit_seller_marker', reason: 'Seller contact was explicitly marked for this property.', courseClassification: 'COURSE_DERIVED' };
  }
  return {
    path: CONTACT_PATHS.RESEARCH_REQUIRED,
    confidence: 'NOT_ESTABLISHED',
    source: 'insufficient_transaction_evidence',
    reason: 'Contact path is not established for this property. Review the lead source and listing information to identify whether Kayla\'s agent or seller procedure applies.',
    courseClassification: 'COURSE_DERIVED',
  };
}

function scriptForContactPath(path, options = {}) {
  if (path === CONTACT_PATHS.LISTING_AGENT || path === CONTACT_PATHS.BROKER) return 'AGENT_INITIAL';
  if (options.rehab === true && [CONTACT_PATHS.DIRECT_SELLER, CONTACT_PATHS.FSBO_SELLER, CONTACT_PATHS.PPC_SELLER].includes(path)) return 'SELLER_REHAB';
  if ([CONTACT_PATHS.DIRECT_SELLER, CONTACT_PATHS.FSBO_SELLER, CONTACT_PATHS.PPC_SELLER].includes(path)) return 'SELLER_INITIAL';
  return null;
}

module.exports = { CONTACT_PATHS, normalizeLeadSource, selectContactPath, scriptForContactPath };
