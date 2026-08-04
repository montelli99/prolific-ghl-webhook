'use strict';

const { normalizeE164 } = require('./call-note-schema');

const MATCHED = 'MATCHED_CONTACT_AND_OPPORTUNITY';

function entityId(entity = {}) {
  return entity.id || entity.contactId || entity.opportunityId || null;
}

function contactPhone(contact = {}) {
  return normalizeE164(contact.phone || contact.phoneNumber || contact.mobilePhone);
}

function isProductionOpportunity(opportunity, pipelineId) {
  const actualPipeline = opportunity.pipelineId || opportunity.pipeline_id;
  if (actualPipeline !== pipelineId) return false;
  const classification = opportunity.recordClass || opportunity.classification?.recordClass;
  if (classification !== 'PRODUCTION') return false;
  return !/\b(test|demo|sandbox|qa|canary)\b/i.test(String(opportunity.name || ''));
}

function matchCallToGhl({ call, contacts = [], opportunities = [], locationId, pipelineId }) {
  if (!call?.remotePhone || !locationId || !pipelineId) return result('UNKNOWN', 'Missing normalized phone, location, or pipeline.');
  const exactContacts = contacts.filter(contact => {
    const candidateLocation = contact.locationId || contact.location_id;
    return candidateLocation === locationId && contactPhone(contact) === call.remotePhone;
  });
  if (exactContacts.length === 0) return result('NO_CONTACT', 'No exact phone match in the required GHL location.');
  if (exactContacts.length > 1) return result('MULTIPLE_CONTACTS', 'Multiple contacts share the exact phone in the required location.', { contactIds: exactContacts.map(entityId) });

  const contact = exactContacts[0];
  if (contact.dnd === true || contact.wrongNumber === true || /dnc|wrong.number/i.test((contact.tags || []).join(' '))) {
    return result('TEST_OR_NON_PRODUCTION', 'Contact has DNC, wrong-number, or exclusion evidence.', { contactId: entityId(contact) });
  }
  const linked = opportunities.filter(opportunity => String(opportunity.contactId || opportunity.contact?.id) === String(entityId(contact)));
  const production = linked.filter(opportunity => isProductionOpportunity(opportunity, pipelineId));
  if (production.length === 0) {
    return result(linked.length ? 'TEST_OR_NON_PRODUCTION' : 'MATCHED_CONTACT_NO_OPPORTUNITY', linked.length ? 'Only test or non-production opportunities are associated.' : 'Exact contact has no associated production opportunity.', { contactId: entityId(contact) });
  }
  if (production.length > 1) return result('MATCHED_CONTACT_MULTIPLE_OPPORTUNITIES', 'Exact contact has multiple production opportunities.', { contactId: entityId(contact), opportunityIds: production.map(entityId) });
  const opportunity = production[0];
  return result(MATCHED, 'Exact phone, location, contact, and production opportunity match.', {
    contactId: entityId(contact),
    contactName: contact.name || contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    contactRole: contact.role || contact.contactRole || 'unknown',
    opportunityId: entityId(opportunity),
    propertyAddress: opportunity.propertyAddress || opportunity.address || opportunity.name || '',
    currentStage: opportunity.stageName || opportunity.currentStage || 'Lead Entered',
    currentStageId: opportunity.pipelineStageId || opportunity.stageId || null,
    contact,
    opportunity,
  });
}

function result(status, reason, extra = {}) {
  return { status, reason, reviewQueue: status === MATCHED ? null : 'CALL_NOTE_REVIEW_REQUIRED', ...extra };
}

module.exports = { MATCHED, matchCallToGhl, isProductionOpportunity };
