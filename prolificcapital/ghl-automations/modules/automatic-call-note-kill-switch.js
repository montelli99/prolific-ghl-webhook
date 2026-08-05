'use strict';

const fs = require('fs');
const path = require('path');

const KILL_SWITCH_PATH = path.resolve(__dirname, '..', 'data', 'automatic-call-note-kill-switch.json');
const VALID_STATES = Object.freeze(['DISABLED', 'TEST_CONTACT_ONLY', 'PRODUCTION_ALLOWED']);

function readCallNoteKillSwitch() {
  try {
    const raw = fs.readFileSync(KILL_SWITCH_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!VALID_STATES.includes(parsed.state)) {
      return { state: 'DISABLED', updatedAt: new Date().toISOString(), reason: 'INVALID_STATE_RESET_TO_DEFAULT' };
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { state: 'DISABLED', updatedAt: new Date().toISOString(), automaticNotesCreated: 0, testNotesCreated: 0, productionNotesCreated: 0 };
    }
    return { state: 'DISABLED', updatedAt: new Date().toISOString(), reason: 'READ_ERROR_RESET_TO_DEFAULT', error: err.message };
  }
}

function writeCallNoteKillSwitch(state, extra = {}) {
  if (!VALID_STATES.includes(state)) {
    throw new Error(`INVALID_AUTOMATIC_CALL_NOTE_KILL_SWITCH_STATE: ${state}. Valid: ${VALID_STATES.join(', ')}`);
  }
  const current = readCallNoteKillSwitch();
  const dir = path.dirname(KILL_SWITCH_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = { ...current, state, updatedAt: new Date().toISOString(), ...extra };
  const tmp = KILL_SWITCH_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, KILL_SWITCH_PATH);
  return next;
}

function canCreateAutomaticNote(state) {
  return state === 'TEST_CONTACT_ONLY' || state === 'PRODUCTION_ALLOWED';
}

function canCreateProductionNote(state) {
  return state === 'PRODUCTION_ALLOWED';
}

function isAutomaticNotesDisabled(state) {
  return state === 'DISABLED';
}

module.exports = {
  AUTOMATIC_CALL_NOTE_KILL_SWITCH_PATH: KILL_SWITCH_PATH,
  AUTOMATIC_CALL_NOTE_KILL_STATES: VALID_STATES,
  readCallNoteKillSwitch,
  writeCallNoteKillSwitch,
  canCreateAutomaticNote,
  canCreateProductionNote,
  isAutomaticNotesDisabled,
};
