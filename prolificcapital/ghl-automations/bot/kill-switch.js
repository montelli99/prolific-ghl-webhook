'use strict';

const fs = require('fs');
const path = require('path');

const KILL_SWITCH_PATH = path.resolve(__dirname, '..', 'data', 'telegram-outreach-dry-run', 'kill-switch.json');
const KILL_STATES = Object.freeze(['PAUSED', 'DRY_RUN_ONLY', 'CANARY_ALLOWED']);

function readKillSwitch() {
  try {
    const raw = fs.readFileSync(KILL_SWITCH_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return { state: 'PAUSED', liveSends: 0, productionWrites: 0, stageMovements: 0, workflowModifications: 0 };
  }
}

function writeKillSwitch(state, extra = {}) {
  const current = readKillSwitch();
  const updated = {
    state,
    updatedAt: new Date().toISOString(),
    liveSends: (current.liveSends || 0) + (extra.liveSends || 0),
    productionWrites: (current.productionWrites || 0) + (extra.productionWrites || 0),
    stageMovements: (current.stageMovements || 0) + (extra.stageMovements || 0),
    workflowModifications: (current.workflowModifications || 0) + (extra.workflowModifications || 0),
    ...extra,
  };
  fs.mkdirSync(path.dirname(KILL_SWITCH_PATH), { recursive: true });
  const tmp = KILL_SWITCH_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n');
  fs.renameSync(tmp, KILL_SWITCH_PATH);
  return updated;
}

function canSend(state) {
  return state === 'CANARY_ALLOWED';
}

function canSimulate(state) {
  return state === 'DRY_RUN_ONLY' || state === 'CANARY_ALLOWED';
}

function isPaused(state) {
  return state === 'PAUSED';
}

function transitionAllowed(from, to, userId, adminIds, ownerId) {
  const isOwner = String(userId) === String(ownerId);
  const isAdminUser = isOwner || (adminIds && adminIds.includes(String(userId)));
  if (!isAdminUser) return false;
  if (from === to) return true;
  if (to === 'PAUSED') return true;
  if (from === 'PAUSED' && to === 'DRY_RUN_ONLY') return true;
  if (from === 'DRY_RUN_ONLY' && to === 'CANARY_ALLOWED') return true;
  if (from === 'CANARY_ALLOWED' && to === 'PAUSED') return true;
  return false;
}

module.exports = {
  KILL_SWITCH_PATH,
  KILL_STATES,
  readKillSwitch,
  writeKillSwitch,
  canSend,
  canSimulate,
  isPaused,
  transitionAllowed,
};
