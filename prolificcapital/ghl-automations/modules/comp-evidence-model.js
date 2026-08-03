'use strict';

const COMP_STATES = Object.freeze({
  CANDIDATE_COMP: 'CANDIDATE_COMP',
  SELECTED_COMP: 'SELECTED_COMP',
  REJECTED_COMP: 'REJECTED_COMP',
  OWNER_APPROVED_COMP: 'OWNER_APPROVED_COMP',
});

const VALUATION_STATES = Object.freeze({
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  PRELIMINARY_RANGE: 'PRELIMINARY_RANGE',
  PROPOSED_ARV: 'PROPOSED_ARV',
  OWNER_APPROVED_ARV: 'OWNER_APPROVED_ARV',
});

function createCompRecord(fields) {
  return {
    compId: fields.compId || `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address: fields.address || null,
    source: fields.source || 'operator-supplied',
    status: fields.status || 'sold',
    price: fields.price || null,
    saleDate: fields.saleDate || null,
    distance: fields.distance || null,
    propertyType: fields.propertyType || null,
    beds: fields.beds || null,
    baths: fields.baths || null,
    sqft: fields.sqft || null,
    yearBuilt: fields.yearBuilt || null,
    lotSize: fields.lotSize || null,
    condition: fields.condition || null,
    adjustments: fields.adjustments || [],
    inclusionReason: fields.inclusionReason || null,
    exclusionReason: fields.exclusionReason || null,
    confidence: fields.confidence || 'medium',
    evidenceTimestamp: new Date().toISOString(),
    ownerApprovalStatus: null,
    state: COMP_STATES.CANDIDATE_COMP,
  };
}

function selectComp(comp, reason) {
  if (!reason) throw new Error('selectComp requires a reason');
  return { ...comp, state: COMP_STATES.SELECTED_COMP, inclusionReason: reason, evidenceTimestamp: new Date().toISOString() };
}

function rejectComp(comp, reason) {
  if (!reason) throw new Error('rejectComp requires a reason');
  return { ...comp, state: COMP_STATES.REJECTED_COMP, exclusionReason: reason, evidenceTimestamp: new Date().toISOString() };
}

function ownerApproveComp(comp, ownerId) {
  if (!ownerId) throw new Error('ownerApproveComp requires ownerId');
  if (comp.state !== COMP_STATES.SELECTED_COMP) throw new Error('Only SELECTED_COMP can be owner-approved');
  return { ...comp, state: COMP_STATES.OWNER_APPROVED_COMP, ownerApprovalStatus: 'approved', evidenceTimestamp: new Date().toISOString() };
}

function getSelectedComps(comps) {
  return comps.filter(c => c.state === COMP_STATES.SELECTED_COMP || c.state === COMP_STATES.OWNER_APPROVED_COMP);
}

function getRejectedComps(comps) {
  return comps.filter(c => c.state === COMP_STATES.REJECTED_COMP);
}

function compSetChanged(previousComps, currentComps) {
  if (!previousComps || previousComps.length !== currentComps.length) return true;
  const prevIds = new Set(previousComps.map(c => c.compId));
  return currentComps.some(c => !prevIds.has(c.compId));
}

function determineValuationState(comps, ownerApproved) {
  const selected = getSelectedComps(comps);
  if (selected.length === 0) return VALUATION_STATES.INSUFFICIENT_EVIDENCE;
  if (ownerApproved) return VALUATION_STATES.OWNER_APPROVED_ARV;
  return VALUATION_STATES.PROPOSED_ARV;
}

function computeArvRange(comps) {
  const selected = getSelectedComps(comps);
  if (selected.length === 0) return { state: VALUATION_STATES.INSUFFICIENT_EVIDENCE, low: null, base: null, high: null };
  const prices = selected.map(c => c.price).filter(p => typeof p === 'number' && p > 0);
  if (prices.length === 0) return { state: VALUATION_STATES.INSUFFICIENT_EVIDENCE, low: null, base: null, high: null };
  prices.sort((a, b) => a - b);
  const low = prices[0];
  const high = prices[prices.length - 1];
  const base = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  return { state: VALUATION_STATES.PRELIMINARY_RANGE, low, base, high, compCount: prices.length };
}

module.exports = {
  COMP_STATES,
  VALUATION_STATES,
  createCompRecord,
  selectComp,
  rejectComp,
  ownerApproveComp,
  getSelectedComps,
  getRejectedComps,
  compSetChanged,
  determineValuationState,
  computeArvRange,
};
