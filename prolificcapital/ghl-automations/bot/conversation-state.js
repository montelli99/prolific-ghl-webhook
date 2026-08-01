'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.resolve(__dirname, '..', 'data', 'conversation-state');
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

fs.mkdirSync(STATE_DIR, { recursive: true });

function stateKey(chatId, userId) {
  return `${chatId}_${userId}`;
}

function statePath(chatId, userId) {
  return path.join(STATE_DIR, `${stateKey(chatId, userId)}.json`);
}

function loadState(chatId, userId) {
  try {
    const raw = fs.readFileSync(statePath(chatId, userId), 'utf8');
    const state = JSON.parse(raw);
    if (Date.now() - new Date(state.lastActivity).getTime() > SESSION_TIMEOUT_MS) {
      return createFresh(chatId, userId);
    }
    return state;
  } catch (_) {
    return createFresh(chatId, userId);
  }
}

function saveState(state) {
  state.lastActivity = new Date().toISOString();
  const tmp = statePath(state.chatId, state.userId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, statePath(state.chatId, state.userId));
  return state;
}

function createFresh(chatId, userId) {
  return {
    chatId: String(chatId),
    userId: String(userId),
    active: false,
    lastActivity: new Date().toISOString(),
    currentStage: null,
    currentSessionId: null,
    selectedLead: null,
    displayedCandidates: [],
    activePlanId: null,
    lastBotMessageId: null,
    lastBotMessageText: null,
    pendingQuestion: null,
    expectedAnswerType: null,
    referencedItems: [],
    pendingConfirmation: null,
    contactPath: null,
    corrections: [],
    summary: null,
  };
}

function touchState(chatId, userId) {
  const state = loadState(chatId, userId);
  state.active = true;
  return saveState(state);
}

function expireState(chatId, userId) {
  try { fs.unlinkSync(statePath(chatId, userId)); } catch (_) {}
}

function isActive(chatId, userId) {
  const state = loadState(chatId, userId);
  return state.active && (Date.now() - new Date(state.lastActivity).getTime() < SESSION_TIMEOUT_MS);
}

function setPendingQuestion(chatId, userId, question, expectedAnswerType) {
  const state = loadState(chatId, userId);
  state.pendingQuestion = question;
  state.expectedAnswerType = expectedAnswerType;
  state.active = true;
  return saveState(state);
}

function clearPendingQuestion(chatId, userId) {
  const state = loadState(chatId, userId);
  state.pendingQuestion = null;
  state.expectedAnswerType = null;
  return saveState(state);
}

function setActivePlan(chatId, userId, planId) {
  const state = loadState(chatId, userId);
  state.activePlanId = planId;
  state.active = true;
  return saveState(state);
}

function setStage(chatId, userId, stage, sessionId) {
  const state = loadState(chatId, userId);
  state.currentStage = stage;
  state.currentSessionId = sessionId;
  state.active = true;
  return saveState(state);
}

function setSelectedLead(chatId, userId, lead) {
  const state = loadState(chatId, userId);
  state.selectedLead = lead;
  state.active = true;
  return saveState(state);
}

function setDisplayedCandidates(chatId, userId, candidates) {
  const state = loadState(chatId, userId);
  state.displayedCandidates = candidates;
  state.active = true;
  return saveState(state);
}

function setLastBotMessage(chatId, userId, messageId, text) {
  const state = loadState(chatId, userId);
  state.lastBotMessageId = messageId;
  state.lastBotMessageText = text;
  state.active = true;
  return saveState(state);
}

function addCorrection(chatId, userId, correction) {
  const state = loadState(chatId, userId);
  state.corrections.push({ text: correction, at: new Date().toISOString() });
  if (state.corrections.length > 20) state.corrections = state.corrections.slice(-20);
  state.active = true;
  return saveState(state);
}

function setSummary(chatId, userId, summary) {
  const state = loadState(chatId, userId);
  state.summary = summary;
  state.active = true;
  return saveState(state);
}

function getConversationContext(chatId, userId) {
  const state = loadState(chatId, userId);
  return {
    active: state.active,
    currentStage: state.currentStage,
    currentSessionId: state.currentSessionId,
    selectedLead: state.selectedLead,
    activePlanId: state.activePlanId,
    pendingQuestion: state.pendingQuestion,
    expectedAnswerType: state.expectedAnswerType,
    referencedItems: state.referencedItems,
    contactPath: state.contactPath,
    summary: state.summary,
    corrections: state.corrections.slice(-5),
  };
}

module.exports = {
  loadState,
  saveState,
  touchState,
  expireState,
  isActive,
  setPendingQuestion,
  clearPendingQuestion,
  setActivePlan,
  setStage,
  setSelectedLead,
  setDisplayedCandidates,
  setLastBotMessage,
  addCorrection,
  setSummary,
  getConversationContext,
  SESSION_TIMEOUT_MS,
};
