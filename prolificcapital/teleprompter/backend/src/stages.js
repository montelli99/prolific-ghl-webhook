/**
 * stages.js — Teleprompter pipeline stages
 * 
 * COPIED FROM: divinitycrm/frontend/src/lib/pipeline-stages.js
 * 
 * If you update the stage list, update BOTH files. The single source of truth
 * is `divinitycrm/frontend/src/lib/pipeline-stages.js` in the CRM project.
 * 
 * RULE (per LRN-20260619-001): Do NOT synthesize stages between sources.
 * This file MUST match the CRM canonical 21-stage list exactly.
 */

const STAGES = [
  'LEAD_ENTERED',
  'CONTACT_MADE',
  'OFFER_READY',
  'OFFER_SENT',
  'OFFER_RECEIVED',
  'GAIN_FEEDBACK',
  'NO_ANSWER',
  'SELLER_DECLINED',
  'ACTIVE_NEGOTIATION',
  'TERMS_AGREED',
  'AWAITING_TITLE',
  'CONTRACT_OUT',
  'UNDER_CONTRACT',
  'INSPECTION_PERIOD',
  'INSPECTION_COMPLETE',
  'APPRAISAL_ORDERED',
  'APPRAISAL_DONE',
  'JV_SENT',
  'JV_SIGNED',
  'WIRE_SETUP',
  'CLOSING_DATE'
];

const STAGE_LABELS = {
  LEAD_ENTERED: 'Lead Entered',
  CONTACT_MADE: 'Contact Made',
  OFFER_READY: 'Offer Ready',
  OFFER_SENT: 'Offer Sent',
  OFFER_RECEIVED: 'Offer Received',
  GAIN_FEEDBACK: 'Gain Feedback',
  NO_ANSWER: 'No Answer',
  SELLER_DECLINED: 'Seller Declined',
  ACTIVE_NEGOTIATION: 'Active Negotiation',
  TERMS_AGREED: 'Terms Agreed',
  AWAITING_TITLE: 'Awaiting Title',
  CONTRACT_OUT: 'Contract Out',
  UNDER_CONTRACT: 'Under Contract',
  INSPECTION_PERIOD: 'Inspection Period',
  INSPECTION_COMPLETE: 'Inspection Complete',
  APPRAISAL_ORDERED: 'Appraisal Ordered',
  APPRAISAL_DONE: 'Appraisal Done',
  JV_SENT: 'JV Sent',
  JV_SIGNED: 'JV Signed',
  WIRE_SETUP: 'Wire Setup',
  CLOSING_DATE: 'Closing Date'
};

const OWNERS = {
  LEAD_ENTERED: 'Montelli',
  CONTACT_MADE: 'Montelli',
  OFFER_READY: 'Montelli',
  OFFER_SENT: 'Montelli',
  OFFER_RECEIVED: 'Montelli',
  GAIN_FEEDBACK: 'Montelli',
  NO_ANSWER: 'Montelli',
  SELLER_DECLINED: 'Montelli',
  ACTIVE_NEGOTIATION: 'Montelli',
  TERMS_AGREED: 'Montelli',
  AWAITING_TITLE: 'TC',
  CONTRACT_OUT: 'TC',
  UNDER_CONTRACT: 'TC',
  INSPECTION_PERIOD: 'TC',
  INSPECTION_COMPLETE: 'TC',
  APPRAISAL_ORDERED: 'TC',
  APPRAISAL_DONE: 'TC',
  JV_SENT: 'TC',
  JV_SIGNED: 'TC',
  WIRE_SETUP: 'Closing',
  CLOSING_DATE: 'Closing'
};

const STAGE_BUCKETS = {
  Montelli: STAGES.slice(0, 10),
  TC: STAGES.slice(10, 19),
  Closing: STAGES.slice(19)
};

module.exports = { STAGES, STAGE_LABELS, OWNERS, STAGE_BUCKETS };
