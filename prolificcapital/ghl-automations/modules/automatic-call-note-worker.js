'use strict';

const { JustCallIntegration } = require('./justcall-integration');
const { GhlCallNoteGateway, OWNER_CONTROLLED_TEST_CONTACT_ID } = require('./ghl-call-note-gateway');
const { verifyCallIdentity, normalizeProviderTranscript, sha256 } = require('./owner-controlled-transcript-note');
const { classifyGhlCallSync } = require('./ghl-call-sync-classifier');
const { readKillSwitch } = require('../bot/kill-switch');
const {
  readCallNoteKillSwitch,
  canCreateAutomaticNote,
  canCreateProductionNote,
  isAutomaticNotesDisabled,
} = require('./automatic-call-note-kill-switch');
const {
  computeIdempotencyKey,
  readJournalEntry,
  writeJournalEntry,
  isAlreadyProcessed,
  isWriteUncertain,
  readCursor,
  writeCursor,
} = require('./automatic-call-note-journal');
const policy = require('../docs/automatic-call-note-policy.json');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_PATH = path.resolve(__dirname, '..', 'data', 'automatic-call-note-worker.lock');
const COVERAGE_START_PATH = path.resolve(__dirname, '..', 'data', 'automatic-call-note-coverage-start.json');
const HEALTH_PATH = path.resolve(__dirname, '..', 'data', 'automatic-call-note-health.json');
const STALE_LOCK_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const LOOKBACK_MINUTES = 30;
const MAX_CALLS_PER_POLL = 10;
const NOTE_SCHEMA_VERSION = 'automatic-call-transcript-note-v1';
const PROVIDER = 'justcall';

const HEALTH_STATES = Object.freeze([
  'STOPPED',
  'STARTING',
  'READY_READ_ONLY',
  'READY_TEST_CONTACT_ONLY',
  'PAUSED_POLICY',
  'BLOCKED_AUTOMATION_ISOLATION',
  'BLOCKED_CREDENTIALS',
  'BLOCKED_CONFIG',
  'WRITE_UNCERTAIN',
  'DEGRADED_READS',
  'STOPPED_BY_OWNER',
]);

function readCoverageStart() {
  try {
    const raw = fs.readFileSync(COVERAGE_START_PATH, 'utf8');
    return JSON.parse(raw).coverageStartAt || null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return null;
  }
}

function writeCoverageStart(timestamp) {
  const dir = path.dirname(COVERAGE_START_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = COVERAGE_START_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ coverageStartAt: timestamp, setAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, COVERAGE_START_PATH);
}

function writeHealth(state, extra = {}) {
  if (!HEALTH_STATES.includes(state)) throw new Error(`INVALID_HEALTH_STATE: ${state}`);
  const dir = path.dirname(HEALTH_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = HEALTH_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ state, updatedAt: new Date().toISOString(), ...extra }, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, HEALTH_PATH);
}

function readHealth() {
  try {
    const raw = fs.readFileSync(HEALTH_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { state: 'STOPPED' };
    return { state: 'STOPPED', error: err.message };
  }
}

function validateStartupPreconditions() {
  const failures = [];

  const callNoteKs = readCallNoteKillSwitch();
  if (!callNoteKs || !callNoteKs.state) failures.push('CALL_NOTE_KILL_SWITCH_MISSING');
  else if (!['DISABLED', 'TEST_CONTACT_ONLY', 'PRODUCTION_ALLOWED'].includes(callNoteKs.state)) failures.push('CALL_NOTE_KILL_SWITCH_INVALID');

  try { JSON.parse(JSON.stringify(policy)); } catch (_) { failures.push('POLICY_PARSE_FAILED'); }
  if (policy.policyVersion !== '2026-08-05-v1') failures.push('POLICY_VERSION_MISMATCH');

  const env = parseEnv();
  if (!env.JUSTCALL_API_KEY || !env.JUSTCALL_API_SECRET) failures.push('JUSTCALL_CREDENTIALS_MISSING');
  const ghlToken = env.GHL_READ_TOKEN || env.GHL_PRIVATE_INTEGRATION_TOKEN || env.GHL_API_TOKEN || env.GHL_API_KEY;
  if (!ghlToken) failures.push('GHL_CREDENTIALS_MISSING');

  const journalDir = path.resolve(__dirname, '..', 'data', 'automatic-call-note-journal');
  try {
    if (!fs.existsSync(journalDir)) fs.mkdirSync(journalDir, { recursive: true });
    const testFile = path.join(journalDir, '.write-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
  } catch (_) { failures.push('JOURNAL_NOT_WRITABLE'); }

  const cursorDir = path.dirname(require('./automatic-call-note-journal').CURSOR_PATH);
  try {
    if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
    const testFile = path.join(cursorDir, '.write-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
  } catch (_) { failures.push('CURSOR_NOT_WRITABLE'); }

  const outreachKs = readKillSwitch();
  if (outreachKs.state !== 'PAUSED') failures.push('OUTREACH_NOT_PAUSED');

  return { ready: failures.length === 0, failures };
}

function parseEnv() {
  const file = 'C:/Users/mscott/AI_Workspace/prolificcapital/secrets/.env';
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .map(line => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map(match => [match[1], match[2].replace(/^['"]|['"]$/g, '').trim()])
  );
}

function acquireLock() {
  const dir = path.dirname(LOCK_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    const existing = fs.readFileSync(LOCK_PATH, 'utf8');
    const parsed = JSON.parse(existing);
    const age = Date.now() - (parsed.acquiredAt || 0);
    if (age < STALE_LOCK_MS) return null;
    fs.unlinkSync(LOCK_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') return null;
  }
  const lock = { pid: process.pid, acquiredAt: Date.now(), hostname: require('os').hostname() };
  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify(lock), { flag: 'wx' });
    return lock;
  } catch (_) {
    return null;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch (_) {}
}

function normalizeE164(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) digits = '1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

function evaluateEligibility({ call, identity, transcript, contact, opportunities, callNoteKs }) {
  const blocks = [];

  if (isAutomaticNotesDisabled(callNoteKs.state)) {
    blocks.push('AUTOMATIC_NOTES_DISABLED');
  }

  const senderNumber = call.justcall_number || call.from_number || '';
  const allowedSenders = policy.eligibility.allowedSenderNumbers || [];
  if (!allowedSenders.some(s => String(senderNumber).includes(s.replace(/\D/g, '')))) {
    blocks.push('SENDER_NOT_ALLOWED');
  }

  if (!policy.eligibility.allowedCallDirections.includes(identity.direction)) {
    blocks.push('DIRECTION_NOT_ALLOWED');
  }

  if (!policy.eligibility.allowedCallOutcomes.includes(identity.outcome)) {
    blocks.push('OUTCOME_NOT_ALLOWED');
  }

  if (identity.durationSeconds < policy.eligibility.minimumDurationSeconds) {
    blocks.push('DURATION_TOO_SHORT');
  }

  if (!transcript.rawText || transcript.segmentCount === 0) {
    blocks.push('TRANSCRIPT_NOT_AVAILABLE');
  }

  if (!contact) {
    blocks.push('NO_GHL_CONTACT');
  }

  if (contact && contact._multipleMatches) {
    blocks.push('MULTIPLE_GHL_CONTACTS');
  }

  if (contact && String(contact.id) === OWNER_CONTROLLED_TEST_CONTACT_ID) {
    if (!canCreateAutomaticNote(callNoteKs.state)) {
      blocks.push('TEST_CONTACT_BLOCKED_BY_KILL_SWITCH');
    }
  } else if (contact) {
    if (!canCreateProductionNote(callNoteKs.state)) {
      blocks.push('PRODUCTION_CONTACT_BLOCKED_BY_KILL_SWITCH');
    }
  }

  if (opportunities && opportunities.length === 0) {
    blocks.push('NO_OPPORTUNITY');
  }
  if (opportunities && opportunities.length > 1) {
    blocks.push('MULTIPLE_OPPORTUNITIES');
  }

  return {
    eligible: blocks.length === 0,
    blocks,
    contactIsTest: contact && String(contact.id) === OWNER_CONTROLLED_TEST_CONTACT_ID,
  };
}

function buildNoteBody({ callId, identity, transcript, contact, syncResult }) {
  const lines = [];

  lines.push('CALL TRANSCRIPT SUMMARY');
  lines.push('');
  lines.push('CALL REFERENCE');
  lines.push(`JustCall Call ID: ${callId}`);
  lines.push(`Direction: ${identity.direction}`);
  lines.push(`Outcome: ${identity.outcome}`);
  lines.push(`Duration: ${identity.durationSeconds}s`);
  lines.push(`Transcript Source: ${transcript.sourceType}`);
  lines.push(`Recording Available: ${identity.recordingAvailable ? 'Yes' : 'No'}`);
  if (syncResult && syncResult.matchingRecords && syncResult.matchingRecords.length > 0) {
    const taskRecord = syncResult.matchingRecords.find(r => r.type === 'task');
    if (taskRecord) lines.push(`GHL Auto-Sync Task: ${taskRecord.id || 'present'}`);
  }
  lines.push('');

  lines.push('KEY FACTS');
  lines.push('[Extracted from transcript - requires direct transcript evidence]');
  lines.push('');

  lines.push('FOLLOW-UP / OPEN ITEMS');
  lines.push('[Unanswered questions, explicit commitments, requested follow-up]');
  lines.push('');

  lines.push('TRANSCRIPT');
  lines.push(transcript.normalizedText || transcript.rawText || '[Transcript not available]');
  lines.push('');

  lines.push('PROVENANCE');
  lines.push(`Call ID: ${callId}`);
  lines.push(`Transcript Hash: ${transcript.providerTranscriptHash}`);
  lines.push(`Schema Version: ${NOTE_SCHEMA_VERSION}`);
  lines.push(`Idempotency Key: ${computeIdempotencyKey({
    provider: PROVIDER,
    callId: String(callId),
    transcriptHash: transcript.providerTranscriptHash,
    contactId: contact.id,
    schemaVersion: NOTE_SCHEMA_VERSION,
  })}`);

  return lines.join('\n');
}

async function processCall({ callId, justcall, ghl, callNoteKs }) {
  const idempotencyKey = computeIdempotencyKey({
    provider: PROVIDER,
    callId: String(callId),
    transcriptHash: 'PENDING',
    contactId: 'PENDING',
    schemaVersion: NOTE_SCHEMA_VERSION,
  });

  if (isAlreadyProcessed(idempotencyKey)) {
    return { state: 'ALREADY_PROCESSED', callId, reason: 'JOURNAL_ALREADY_PROCESSED' };
  }
  if (isWriteUncertain(idempotencyKey)) {
    return { state: 'WRITE_UNCERTAIN', callId, reason: 'PREVIOUS_WRITE_UNCERTAIN_NO_RETRY' };
  }

  writeJournalEntry({ idempotencyKey, state: 'DISCOVERED', callId, provider: PROVIDER });

  let call, ai;
  try {
    [call, ai] = await Promise.all([
      justcall.fetchCallDetails(callId),
      justcall.fetchCallAiData(callId),
    ]);
  } catch (err) {
    writeJournalEntry({ idempotencyKey, state: 'FAILED_READ_ONLY', callId, error: err.message });
    return { state: 'FAILED_READ_ONLY', callId, error: err.message };
  }

  const identity = verifyCallIdentity({ requestedCallId: callId, call, ai });
  if (identity.classification !== 'CALL_IDENTITY_VERIFIED') {
    writeJournalEntry({ idempotencyKey, state: 'FAILED_READ_ONLY', callId, reason: identity.classification });
    return { state: 'FAILED_READ_ONLY', callId, reason: identity.classification };
  }

  const transcript = normalizeProviderTranscript({ identity, ai, retrievedAt: new Date().toISOString() });
  if (!transcript.rawText || transcript.segmentCount === 0) {
    writeJournalEntry({ idempotencyKey, state: 'TRANSCRIPT_PENDING', callId });
    return { state: 'TRANSCRIPT_PENDING', callId };
  }

  writeJournalEntry({ idempotencyKey, state: 'TRANSCRIPT_READY', callId, transcriptHash: transcript.providerTranscriptHash });

  const contactNumber = call.contact_number || call.to_number || '';
  const normalizedPhone = normalizeE164(contactNumber);
  let contacts;
  try {
    contacts = await ghl.findContactsByPhone(normalizedPhone);
  } catch (err) {
    writeJournalEntry({ idempotencyKey, state: 'FAILED_READ_ONLY', callId, error: `Contact lookup failed: ${err.message}` });
    return { state: 'FAILED_READ_ONLY', callId, error: err.message };
  }

  if (!contacts || contacts.length === 0) {
    writeJournalEntry({ idempotencyKey, state: 'POLICY_BLOCKED', callId, reason: 'NO_GHL_CONTACT' });
    return { state: 'POLICY_BLOCKED', callId, reason: 'NO_GHL_CONTACT' };
  }
  if (contacts.length > 1) {
    writeJournalEntry({ idempotencyKey, state: 'POLICY_BLOCKED', callId, reason: 'MULTIPLE_GHL_CONTACTS', contactCount: contacts.length });
    return { state: 'POLICY_BLOCKED', callId, reason: 'MULTIPLE_GHL_CONTACTS' };
  }

  const contact = contacts[0];
  writeJournalEntry({ idempotencyKey, state: 'CONTACT_MATCHED', callId, contactId: contact.id });

  let opportunities = [];
  try {
    opportunities = await ghl.findOpportunitiesForContact(contact.id);
  } catch (_) {}

  const eligibility = evaluateEligibility({ call, identity, transcript, contact, opportunities, callNoteKs });
  if (!eligibility.eligible) {
    writeJournalEntry({ idempotencyKey, state: 'POLICY_BLOCKED', callId, reason: eligibility.blocks.join(', ') });
    return { state: 'POLICY_BLOCKED', callId, reason: eligibility.blocks.join(', ') };
  }

  let syncResult;
  try {
    const notes = await ghl.listContactNotes(contact.id);
    syncResult = classifyGhlCallSync({
      callId: String(callId),
      callSid: identity.callSid,
      endpointStatuses: { contact: 200, notes: 200, conversations: 200, tasks: 200, opportunities: 200 },
      notes: notes || [],
      messages: [],
      tasks: [],
      activities: [],
      providerTranscriptHash: transcript.providerTranscriptHash,
      providerTranscriptText: transcript.rawText,
      tags: [],
      lastCallOutcome: identity.outcome,
    });
  } catch (err) {
    writeJournalEntry({ idempotencyKey, state: 'FAILED_READ_ONLY', callId, error: `Sync inspection failed: ${err.message}` });
    return { state: 'FAILED_READ_ONLY', callId, error: err.message };
  }

  writeJournalEntry({ idempotencyKey, state: 'SYNC_INSPECTED', callId, duplicationClassification: syncResult.duplicationClassification });

  if (syncResult.duplicationClassification === 'WRITE_NOT_NEEDED_TRANSCRIPT_ALREADY_PRESENT' ||
      syncResult.duplicationClassification === 'WRITE_NOT_NEEDED_EQUIVALENT_STRUCTURED_NOTE_EXISTS') {
    writeJournalEntry({ idempotencyKey, state: 'ALREADY_PROCESSED', callId, reason: syncResult.duplicationClassification });
    return { state: 'ALREADY_PROCESSED', callId, reason: syncResult.duplicationClassification };
  }

  if (syncResult.duplicationClassification === 'WRITE_BLOCKED_UNCERTAIN_EXISTING_DATA') {
    writeJournalEntry({ idempotencyKey, state: 'POLICY_BLOCKED', callId, reason: 'UNCERTAIN_EXISTING_DATA' });
    return { state: 'POLICY_BLOCKED', callId, reason: 'UNCERTAIN_EXISTING_DATA' };
  }

  const finalIdempotencyKey = computeIdempotencyKey({
    provider: PROVIDER,
    callId: String(callId),
    transcriptHash: transcript.providerTranscriptHash,
    contactId: contact.id,
    schemaVersion: NOTE_SCHEMA_VERSION,
  });

  if (isAlreadyProcessed(finalIdempotencyKey)) {
    return { state: 'ALREADY_PROCESSED', callId, reason: 'FINAL_IDEMPOTENCY_CHECK' };
  }

  writeJournalEntry({ idempotencyKey: finalIdempotencyKey, state: 'WRITE_PENDING', callId, contactId: contact.id });

  const noteBody = buildNoteBody({ callId, identity, transcript, contact, syncResult });

  try {
    const writeResult = await ghl.createContactNote(contact.id, noteBody);
    writeJournalEntry({
      idempotencyKey: finalIdempotencyKey,
      state: 'WRITE_SUCCEEDED',
      callId,
      contactId: contact.id,
      noteId: writeResult.id || writeResult._id,
      noteBodyHash: sha256(noteBody),
    });
    return { state: 'WRITE_SUCCEEDED', callId, contactId: contact.id, noteId: writeResult.id || writeResult._id };
  } catch (err) {
    writeJournalEntry({
      idempotencyKey: finalIdempotencyKey,
      state: 'WRITE_UNCERTAIN',
      callId,
      contactId: contact.id,
      error: err.message,
    });
    return { state: 'WRITE_UNCERTAIN', callId, error: err.message };
  }
}

async function runPollCycle() {
  const lock = acquireLock();
  if (!lock) return { status: 'LOCKED_BY_ANOTHER_INSTANCE' };

  try {
    const preconditions = validateStartupPreconditions();
    if (!preconditions.ready) {
      writeHealth('BLOCKED_CONFIG', { failures: preconditions.failures });
      return { status: 'BLOCKED_CONFIG', failures: preconditions.failures };
    }

    const outreachKs = readKillSwitch();
    if (outreachKs.state !== 'PAUSED') {
      writeHealth('PAUSED_POLICY', { reason: 'OUTREACH_NOT_PAUSED', outreachState: outreachKs.state });
      return { status: 'BLOCKED_OUTREACH_NOT_PAUSED', outreachState: outreachKs.state };
    }

    const callNoteKs = readCallNoteKillSwitch();
    if (isAutomaticNotesDisabled(callNoteKs.state)) {
      writeHealth('PAUSED_POLICY', { reason: 'AUTOMATIC_NOTES_DISABLED' });
      return { status: 'DISABLED', callNoteState: callNoteKs.state };
    }

    const coverageStart = readCoverageStart();
    if (!coverageStart) {
      writeHealth('BLOCKED_CONFIG', { reason: 'COVERAGE_START_NOT_SET' });
      return { status: 'BLOCKED_COVERAGE_START_NOT_SET' };
    }

    const env = parseEnv();
    const token = env.GHL_READ_TOKEN || env.GHL_PRIVATE_INTEGRATION_TOKEN || env.GHL_API_TOKEN || env.GHL_API_KEY;
    const justcall = new JustCallIntegration({ apiKey: env.JUSTCALL_API_KEY, apiSecret: env.JUSTCALL_API_SECRET });
    const ghl = new GhlCallNoteGateway({
      token,
      locationId: '61XPzSqRy7UKMwW9DeB8',
      pipelineId: 'nSf3NXYVkt8X4PgW9aZ3',
      writeEnabled: canCreateAutomaticNote(callNoteKs.state),
      getSafetyState: () => canCreateAutomaticNote(callNoteKs.state) ? 'CANARY_ALLOWED' : 'PAUSED',
    });

    const cursor = readCursor();
    const lookbackStart = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

    let callsResult;
    try {
      callsResult = await justcall.listCalls({
        from_datetime: lookbackStart,
        call_direction: 'OUTGOING',
        sort: 'desc',
        order: 'created_at',
        per_page: MAX_CALLS_PER_POLL,
      });
    } catch (err) {
      writeHealth('DEGRADED_READS', { error: err.message });
      return { status: 'JUSTCALL_LIST_FAILED', error: err.message };
    }

    const calls = (callsResult.data || []).filter(c => {
      const callId = String(c.id || c.call_id || '');
      if (!callId) return false;
      const callCreatedAt = c.created_at || c.start_time || '';
      if (callCreatedAt && callCreatedAt < coverageStart) return false;
      if (cursor.lastProcessedCallId && callId === String(cursor.lastProcessedCallId)) return false;
      return true;
    });

    const healthState = callNoteKs.state === 'TEST_CONTACT_ONLY' ? 'READY_TEST_CONTACT_ONLY' : 'READY_READ_ONLY';
    writeHealth(healthState, { lastCycleAt: new Date().toISOString() });

    const results = [];
    for (const call of calls) {
      const callId = String(call.id || call.call_id);
      const result = await processCall({ callId, justcall, ghl, callNoteKs });
      results.push(result);
      if (result.state === 'WRITE_SUCCEEDED') {
        writeCursor({ ...cursor, lastProcessedCallId: callId, lastProcessedAt: new Date().toISOString(), totalProcessed: (cursor.totalProcessed || 0) + 1, totalWritten: (cursor.totalWritten || 0) + 1 });
      } else if (result.state === 'ALREADY_PROCESSED') {
        writeCursor({ ...cursor, lastProcessedCallId: callId, lastProcessedAt: new Date().toISOString(), totalProcessed: (cursor.totalProcessed || 0) + 1 });
      }
    }

    return { status: 'CYCLE_COMPLETE', callsProcessed: calls.length, results };
  } finally {
    releaseLock();
  }
}

function startWorker(options = {}) {
  const intervalMs = options.intervalMs || POLL_INTERVAL_MS;
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      await runPollCycle();
    } catch (err) {
      console.error('[automatic-call-note-worker] Cycle error:', err.message);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      tick();
      timer = setInterval(tick, intervalMs);
      return { status: 'STARTED', intervalMs };
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      releaseLock();
      return { status: 'STOPPED' };
    },
    async runOnce() {
      return runPollCycle();
    },
  };
}

module.exports = {
  runPollCycle,
  startWorker,
  processCall,
  evaluateEligibility,
  buildNoteBody,
  acquireLock,
  releaseLock,
  validateStartupPreconditions,
  readCoverageStart,
  writeCoverageStart,
  readHealth,
  writeHealth,
  HEALTH_STATES,
  LOCK_PATH,
  POLL_INTERVAL_MS,
  LOOKBACK_MINUTES,
  NOTE_SCHEMA_VERSION,
  PROVIDER,
};
