'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.resolve(__dirname, '..', 'data', 'call-note-journal');
const STATES = Object.freeze([
  'NOT_PROCESSED', 'PROCESSING', 'NOTE_WRITTEN', 'PARTIAL_WRITE_UNCERTAIN',
  'FAILED_RETRYABLE', 'FAILED_MANUAL_REVIEW', 'DUPLICATE_ALREADY_PROCESSED',
]);

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function idempotencyKey({ locationId, contactId, opportunityId, callId }) {
  if (!locationId || !contactId || !opportunityId || !callId) throw new Error('CALL_NOTE_IDEMPOTENCY_COMPONENT_MISSING');
  return `justcall_call_note:${locationId}:${contactId}:${opportunityId}:${callId}`;
}

class CallNoteJournal {
  constructor(options = {}) {
    this.dir = options.dir || DEFAULT_DIR;
    this.lockStaleMs = options.lockStaleMs || 5 * 60 * 1000;
  }

  recordPath(key) {
    return path.join(this.dir, `${hash(key).slice(0, 32)}.json`);
  }

  load(key) {
    const file = this.recordPath(key);
    if (!fs.existsSync(file)) return null;
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { integrityHash, ...payload } = record;
    return integrityHash && hash(payload) === integrityHash ? record : { state: 'FAILED_MANUAL_REVIEW', reason: 'JOURNAL_INTEGRITY_FAILED', key };
  }

  transition(key, state, data = {}, options = {}) {
    if (!STATES.includes(state)) throw new Error(`INVALID_CALL_NOTE_STATE: ${state}`);
    const existing = this.load(key);
    if (existing?.reason === 'JOURNAL_INTEGRITY_FAILED') throw new Error('CALL_NOTE_JOURNAL_INTEGRITY_FAILED');
    if (options.expectedState && (existing?.state || 'NOT_PROCESSED') !== options.expectedState) {
      throw new Error(`CALL_NOTE_STATE_CONFLICT: expected ${options.expectedState}, got ${existing?.state || 'NOT_PROCESSED'}`);
    }
    const payload = {
      ...(existing || {}),
      key,
      state,
      updatedAt: new Date().toISOString(),
      attempts: Number(existing?.attempts || 0) + (state === 'PROCESSING' ? 1 : 0),
      ...data,
    };
    delete payload.integrityHash;
    const record = { ...payload, integrityHash: hash(payload) };
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.recordPath(key);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, file);
    return record;
  }

  async withLock(key, fn) {
    fs.mkdirSync(this.dir, { recursive: true });
    const lockPath = `${this.recordPath(key)}.lock`;
    let descriptor;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        descriptor = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        break;
      } catch (_) {
        if (attempt === 0 && this._staleLock(lockPath)) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
        throw new Error('CALL_NOTE_PROCESSING_LOCKED');
      }
    }
    try {
      return await fn();
    } finally {
      fs.closeSync(descriptor);
      fs.rmSync(lockPath, { force: true });
    }
  }

  _staleLock(lockPath) {
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > this.lockStaleMs) return true;
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (!lock.pid) return false;
      try { process.kill(Number(lock.pid), 0); return false; }
      catch (error) { return error.code === 'ESRCH'; }
    } catch (_) {
      return false;
    }
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter(file => file.endsWith('.json')).map(file => {
      const record = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8'));
      return this.load(record.key);
    }).filter(Boolean);
  }
}

module.exports = { CallNoteJournal, STATES, DEFAULT_DIR, idempotencyKey };
