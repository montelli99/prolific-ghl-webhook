'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JOURNAL_DIR = path.resolve(__dirname, '..', 'data', 'automatic-call-note-journal');
const CURSOR_PATH = path.resolve(__dirname, '..', 'data', 'automatic-call-note-cursor.json');

const JOURNAL_STATES = Object.freeze([
  'DISCOVERED',
  'TRANSCRIPT_PENDING',
  'TRANSCRIPT_READY',
  'CONTACT_MATCHED',
  'POLICY_BLOCKED',
  'SYNC_INSPECTED',
  'WRITE_PENDING',
  'WRITE_SUCCEEDED',
  'WRITE_UNCERTAIN',
  'ALREADY_PROCESSED',
  'FAILED_READ_ONLY',
]);

function computeIdempotencyKey({ provider, callId, transcriptHash, contactId, schemaVersion }) {
  const input = [provider, String(callId), transcriptHash, contactId, schemaVersion].join(':');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function journalEntryPath(idempotencyKey) {
  if (!fs.existsSync(JOURNAL_DIR)) fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  return path.join(JOURNAL_DIR, `${idempotencyKey}.json`);
}

function readJournalEntry(idempotencyKey) {
  try {
    const raw = fs.readFileSync(journalEntryPath(idempotencyKey), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function writeJournalEntry(entry) {
  if (!entry.idempotencyKey) throw new Error('JOURNAL_ENTRY_REQUIRES_IDEMPOTENCY_KEY');
  if (!JOURNAL_STATES.includes(entry.state)) throw new Error(`INVALID_JOURNAL_STATE: ${entry.state}`);
  const filePath = journalEntryPath(entry.idempotencyKey);
  const tmp = filePath + '.tmp';
  const payload = { ...entry, updatedAt: new Date().toISOString() };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
  return payload;
}

function isAlreadyProcessed(idempotencyKey) {
  const entry = readJournalEntry(idempotencyKey);
  if (!entry) return false;
  return entry.state === 'WRITE_SUCCEEDED' || entry.state === 'ALREADY_PROCESSED';
}

function isWriteUncertain(idempotencyKey) {
  const entry = readJournalEntry(idempotencyKey);
  if (!entry) return false;
  return entry.state === 'WRITE_UNCERTAIN';
}

function readCursor() {
  try {
    const raw = fs.readFileSync(CURSOR_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { lastProcessedCallId: null, lastProcessedAt: null, totalProcessed: 0, totalWritten: 0 };
    }
    return { lastProcessedCallId: null, lastProcessedAt: null, totalProcessed: 0, totalWritten: 0, error: err.message };
  }
}

function writeCursor(cursor) {
  const dir = path.dirname(CURSOR_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = CURSOR_PATH + '.tmp';
  const payload = { ...cursor, updatedAt: new Date().toISOString() };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CURSOR_PATH);
  return payload;
}

function listJournalEntries() {
  if (!fs.existsSync(JOURNAL_DIR)) return [];
  return fs.readdirSync(JOURNAL_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(JOURNAL_DIR, f), 'utf8')); }
      catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

module.exports = {
  JOURNAL_DIR,
  CURSOR_PATH,
  JOURNAL_STATES,
  computeIdempotencyKey,
  readJournalEntry,
  writeJournalEntry,
  isAlreadyProcessed,
  isWriteUncertain,
  readCursor,
  writeCursor,
  listJournalEntries,
};
