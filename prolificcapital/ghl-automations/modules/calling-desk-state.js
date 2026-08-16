'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR = 'C:\\Users\\mscott\\AI_Workspace\\prolificcapital\\ghl-automations\\data\\runtime';
const STATE_FILE = path.join(STATE_DIR, 'pipeline-calling-desk-state.json');
const STATE_TMP = STATE_FILE + '.tmp';

const EMPTY_STATE = Object.freeze({
  schemaVersion: 1,
  chatId: '-1003975794600',
  topicId: '389',
  activeContactId: null,
  activeOpportunityId: null,
  activeSellerName: null,
  activePhone: null,
  activeProperty: null,
  activeStageId: null,
  activeStageName: null,
  selectedAt: null,
  lastMatchedCallId: null,
  lastMatchedCallAt: null,
  pendingDisposition: null,
  pendingTargetStageId: null,
  pendingRecommendation: null,
  pendingAction: null,
  awaitingNext: false,
  updatedAt: null,
});

function loadCallingDeskState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { ...EMPTY_STATE };
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      console.error('[calling-desk-state] Malformed state file, returning empty state');
      return { ...EMPTY_STATE };
    }
    return { ...EMPTY_STATE, ...parsed, schemaVersion: parsed.schemaVersion || 1 };
  } catch (err) {
    console.error('[calling-desk-state] Failed to load state:', err.message || err);
    return { ...EMPTY_STATE };
  }
}

function saveCallingDeskState(state) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    const toSave = { ...state, updatedAt: new Date().toISOString() };
    const json = JSON.stringify(toSave, null, 2);
    fs.writeFileSync(STATE_TMP, json, 'utf-8');
    fs.renameSync(STATE_TMP, STATE_FILE);
  } catch (err) {
    console.error('[calling-desk-state] Failed to save state:', err.message || err);
    try { if (fs.existsSync(STATE_TMP)) fs.unlinkSync(STATE_TMP); } catch (_) {}
  }
}

function clearActiveSeller() {
  const state = loadCallingDeskState();
  const cleared = {
    ...state,
    activeContactId: null,
    activeOpportunityId: null,
    activeSellerName: null,
    activePhone: null,
    activeProperty: null,
    activeStageId: null,
    activeStageName: null,
    selectedAt: null,
    lastMatchedCallId: null,
    lastMatchedCallAt: null,
    pendingDisposition: null,
    pendingTargetStageId: null,
    pendingRecommendation: null,
    pendingAction: null,
    awaitingNext: false,
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(cleared);
  return cleared;
}

function setActiveSeller(seller) {
  const state = loadCallingDeskState();
  const updated = {
    ...state,
    activeContactId: seller.contactId,
    activeOpportunityId: seller.opportunityId,
    activeSellerName: seller.sellerName,
    activePhone: seller.phone,
    activeProperty: seller.property,
    activeStageId: seller.stageId,
    activeStageName: seller.stageName,
    selectedAt: new Date().toISOString(),
    lastMatchedCallId: null,
    lastMatchedCallAt: null,
    pendingDisposition: null,
    pendingTargetStageId: null,
    pendingRecommendation: null,
    pendingAction: seller.pendingAction || null,
    awaitingNext: false,
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(updated);
  return updated;
}

// Record the exact owner-approved action that is currently armed for the active
// seller. Only the router's presentation of an actionable card may arm it; the
// guarded execution path refuses to act unless it matches this value.
function setPendingAction(action) {
  const state = loadCallingDeskState();
  const updated = {
    ...state,
    pendingAction: action || null,
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(updated);
  return updated;
}

function recordMatchedCall(callId) {
  const state = loadCallingDeskState();
  const updated = {
    ...state,
    lastMatchedCallId: callId,
    lastMatchedCallAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(updated);
  return updated;
}

function setPendingDisposition(disposition, targetStageId) {
  const state = loadCallingDeskState();
  const updated = {
    ...state,
    pendingDisposition: disposition,
    pendingTargetStageId: targetStageId || null,
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(updated);
  return updated;
}

function recordStageMove(stageId, stageName) {
  const state = loadCallingDeskState();
  const updated = {
    ...state,
    activeStageId: stageId || state.activeStageId,
    activeStageName: stageName || state.activeStageName,
    pendingDisposition: null,
    pendingTargetStageId: null,
    pendingRecommendation: null,
    pendingAction: null,
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(updated);
  return updated;
}

// Persist an explicit owner-approval state. `yes` may execute exactly one guarded
// move only when a fresh pending recommendation exists and all fields are valid.
function setPendingRecommendation(rec) {
  const state = loadCallingDeskState();
  const generatedAt = rec.generatedAt || new Date().toISOString();
  const expiresAt = rec.expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const updated = {
    ...state,
    pendingRecommendation: {
      contactId: rec.contactId || state.activeContactId || null,
      opportunityId: rec.opportunityId || state.activeOpportunityId || null,
      currentStageId: rec.currentStageId || state.activeStageId || null,
      currentStageName: rec.currentStageName || state.activeStageName || null,
      targetStageId: rec.targetStageId || null,
      targetStageName: rec.targetStageName || null,
      action: rec.action || null,
      reason: rec.reason || null,
      generatedAt,
      expiresAt,
    },
    pendingDisposition: rec.pendingDisposition || null,
    pendingTargetStageId: rec.targetStageId || rec.pendingTargetStageId || null,
    awaitingNext: false,
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(updated);
  return updated;
}

function clearPendingRecommendation() {
  const state = loadCallingDeskState();
  const updated = {
    ...state,
    pendingRecommendation: null,
    pendingDisposition: null,
    pendingTargetStageId: null,
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(updated);
  return updated;
}

function setAwaitingNext(value) {
  const state = loadCallingDeskState();
  const updated = {
    ...state,
    awaitingNext: Boolean(value),
    updatedAt: new Date().toISOString(),
  };
  saveCallingDeskState(updated);
  return updated;
}

module.exports = {
  loadCallingDeskState,
  saveCallingDeskState,
  clearActiveSeller,
  setActiveSeller,
  recordMatchedCall,
  setPendingDisposition,
  recordStageMove,
  setPendingRecommendation,
  clearPendingRecommendation,
  setAwaitingNext,
  setPendingAction,
};
