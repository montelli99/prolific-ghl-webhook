'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NOTE_SCHEMA_VERSION = 'owner-controlled-transcript-note-v1';
const APPROVAL_LANGUAGE = 'Approve the exact test note shown above.';
const DEFAULT_PREVIEW_DIR = path.resolve(__dirname, '..', 'data', 'call-note-previews');
const DEFAULT_APPROVAL_DIR = path.resolve(__dirname, '..', 'data', 'call-note-test-approvals');

function sha256(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
}

function verifyCallIdentity({ requestedCallId, call, ai }) {
  const callIds = collectIds(call);
  const aiIds = collectIds(ai);
  if (!requestedCallId || callIds.length === 0 || aiIds.length === 0) return identityConflict('CALL_ID_MISSING');
  if (new Set(callIds).size !== 1 || new Set(aiIds).size !== 1) return identityConflict('CALL_ID_ALIAS_CONFLICT');
  if (callIds[0] !== String(requestedCallId) || aiIds[0] !== String(requestedCallId)) return identityConflict('CALL_ID_MISMATCH');
  if (call.call_sid && ai.call_sid && String(call.call_sid) !== String(ai.call_sid)) return identityConflict('CALL_SID_MISMATCH');
  const direction = String(call.call_info?.direction || call.direction || '').toUpperCase();
  const outcome = String(call.call_info?.type || call.status || '').toUpperCase();
  const durationSeconds = Number(call.call_duration?.total_duration ?? call.duration ?? call.duration_seconds);
  if (direction !== 'OUTGOING') return identityConflict('CALL_DIRECTION_MISMATCH');
  if (outcome !== 'ANSWERED') return identityConflict('CALL_OUTCOME_MISMATCH');
  if (!Number.isFinite(durationSeconds) || durationSeconds !== 32) return identityConflict('CALL_DURATION_MISMATCH');
  if (!call.call_info?.recording && !call.recording_url && !call.recording) return identityConflict('CALL_RECORDING_MISSING');
  const segments = Array.isArray(ai.call_transcription) ? ai.call_transcription : [];
  if (segments.length === 0 || !segments.some(segment => String(segment?.sentence ?? segment?.text ?? '').trim())) return identityConflict('TRANSCRIPT_EMPTY');
  let previousEnd = 0;
  for (const segment of segments) {
    const start = Number(segment?.timestamp?.starttime ?? segment?.start ?? 0);
    const end = Number(segment?.timestamp?.endtime ?? segment?.end ?? start);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end < start || end > durationSeconds) return identityConflict('TRANSCRIPT_TIMESTAMP_MISMATCH');
    previousEnd = end;
  }
  return {
    classification: 'CALL_IDENTITY_VERIFIED',
    callId: String(requestedCallId),
    callSid: call.call_sid || ai.call_sid || null,
    direction,
    outcome,
    durationSeconds,
    recordingAvailable: true,
    callTimestamp: `${call.call_date}T${call.call_time}Z`,
  };
}

function normalizeProviderTranscript({ identity, ai, retrievedAt, annotations = [] }) {
  if (identity?.classification !== 'CALL_IDENTITY_VERIFIED') throw new Error('CALL_IDENTITY_VERIFIED_REQUIRED');
  const rawSegments = ai.call_transcription.map((segment, index) => ({
    index,
    speakerId: String(segment.speaker_id || ''),
    speakerLabel: String(segment.speaker_name || segment.speaker_id || 'UNKNOWN_SPEAKER'),
    sentence: String(segment.sentence ?? segment.text ?? ''),
    start: Number(segment.timestamp?.starttime ?? segment.start ?? 0),
    end: Number(segment.timestamp?.endtime ?? segment.end ?? 0),
  }));
  const providerTranscriptHash = sha256(rawSegments);
  const normalizedSegments = rawSegments.filter(segment => segment.sentence.trim()).map(segment => {
    let text = segment.sentence.trim();
    for (const annotation of annotations) {
      if (annotation.type === 'UNCLEAR' && text.includes(annotation.phrase)) text = text.replace(annotation.phrase, `${annotation.phrase} [UNCLEAR]`);
    }
    return { ...segment, sentence: text };
  });
  if (normalizedSegments.length === 0) throw new Error('TRANSCRIPT_EMPTY');
  const rawText = rawSegments.map(renderSegment).join('\n');
  const normalizedText = normalizedSegments.map(renderSegment).join('\n');
  const normalizationDiff = [];
  if (rawSegments.length !== normalizedSegments.length) normalizationDiff.push(`Removed ${rawSegments.length - normalizedSegments.length} empty transport segment(s).`);
  for (const annotation of annotations) normalizationDiff.push(`${annotation.type}: "${annotation.phrase}" - ${annotation.reason}`);
  if (normalizationDiff.length === 0) normalizationDiff.push('No wording changes; only transport normalization applied.');
  return {
    source: 'PROVIDER_TRANSCRIPT',
    sourceType: 'TRANSCRIPT_PROVIDER_API',
    provider: 'JustCall',
    callId: identity.callId,
    callSid: identity.callSid,
    recordingAvailable: identity.recordingAvailable,
    segmentCount: normalizedSegments.length,
    providerTranscriptHash,
    normalizedTranscriptHash: sha256(normalizedSegments),
    retrievedAt,
    endpointClass: 'CALLS_AI_API',
    queryFlags: {
      fetch_transcription: true,
      fetch_summary: false,
      fetch_ai_insights: false,
      fetch_action_items: false,
      fetch_smart_chapters: false,
    },
    speakerLabels: [...new Set(normalizedSegments.map(segment => segment.speakerLabel))],
    language: ai.language || ai.transcript_language || 'NOT_PROVIDED_BY_PROVIDER',
    direction: identity.direction,
    outcome: identity.outcome,
    durationSeconds: identity.durationSeconds,
    rawText,
    normalizedText,
    normalizationDiff,
    annotations,
  };
}

function validateStructuredFacts(candidates = [], transcriptText = '') {
  const facts = [];
  const rejected = [];
  for (const candidate of candidates) {
    const evidence = String(candidate.evidence || '').trim();
    if (!candidate.label || !String(candidate.value || '').trim() || !evidence || !transcriptText.includes(evidence)) {
      rejected.push({ label: candidate.label || '(missing)', reason: 'TRANSCRIPT_EVIDENCE_REQUIRED' });
      continue;
    }
    facts.push({ label: candidate.label, value: candidate.value, evidence, confidence: 'DIRECT_PROVIDER_TRANSCRIPT_EVIDENCE' });
  }
  return { facts, rejected };
}

function buildTestNotePreview(input) {
  const { identity, transcript, contact, ownerId, context = {}, facts = [], riskFlags = [], now = new Date(), ttlMs = 15 * 60 * 1000 } = input;
  if (identity?.classification !== 'CALL_IDENTITY_VERIFIED' || transcript?.source !== 'PROVIDER_TRANSCRIPT') throw new Error('VERIFIED_PROVIDER_TRANSCRIPT_REQUIRED');
  if (!contact?.id || String(contact.id) !== String(input.testContactId)) throw new Error('EXACT_TEST_CONTACT_REQUIRED');
  if ((input.associatedOpportunities || []).length !== 0) throw new Error('UNEXPECTED_OPPORTUNITY_ATTACHED');
  const requiredTags = ['owner_controlled_test', 'call_note_certification', 'do_not_contact_prospect'];
  if (!requiredTags.every(tag => (contact.tags || []).includes(tag))) throw new Error('TEST_CONTACT_TAGS_REQUIRED');
  const validatedFacts = validateStructuredFacts(facts, transcript.rawText);
  const idempotencyKey = sha256({ callId: identity.callId, transcriptHash: transcript.providerTranscriptHash, contactId: contact.id, noteSchemaVersion: NOTE_SCHEMA_VERSION });
  const previewHash = sha256({ idempotencyKey, callId: identity.callId, transcriptHash: transcript.providerTranscriptHash, contactId: contact.id, noteSchemaVersion: NOTE_SCHEMA_VERSION });
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(new Date(now).getTime() + ttlMs).toISOString();
  const previewId = `call_note_preview_${sha256({ previewHash, createdAt }).slice(0, 20)}`;
  const body = [
    'Owner-Controlled Call Transcript Test',
    `owner_controlled_transcript_note_key:${idempotencyKey}`,
    '',
    'CALL METADATA',
    `- JustCall call ID: ${identity.callId}`,
    `- Direction: ${identity.direction}`,
    `- Outcome: ${identity.outcome}`,
    `- Duration: ${identity.durationSeconds} seconds`,
    `- Recording available: yes`,
    `- Transcript source: PROVIDER_TRANSCRIPT`,
    `- Transcript retrieval timestamp: ${transcript.retrievedAt}`,
    '',
    'TEST DISCLAIMER',
    '- Owner-controlled test',
    '- Not a production deal',
    '- No opportunity associated',
    '- No stage movement',
    '- No follow-up automation',
    '',
    'TRANSCRIPT',
    transcript.normalizedText,
    '',
    'STRUCTURED FACTS',
    ...(validatedFacts.facts.length ? validatedFacts.facts.map(fact => `- ${fact.label}: ${fact.value} (evidence: "${fact.evidence}")`) : ['- None safely supported.']),
    '',
    'RISK FLAGS',
    ...(riskFlags.length ? riskFlags.map(flag => `- ${flag.code}: ${flag.detail}`) : ['- None identified.']),
    ...validatedFacts.rejected.map(fact => `- UNSUPPORTED_FACT_REJECTED: ${fact.label}`),
    '',
    'PROVENANCE',
    `- Provider transcript hash: ${transcript.providerTranscriptHash}`,
    `- Note-preview hash: ${previewHash}`,
    `- Call ID: ${identity.callId}`,
    `- Test contact ID: ${contact.id}`,
    '',
    'PRODUCTION EFFECTS',
    '- Provider sends: 0',
    '- Calls automatically placed: 0',
    '- GHL writes before approval: 0',
    '- Stage movements: 0',
  ].join('\n');
  return {
    previewId,
    previewHash,
    noteBodyHash: sha256(body),
    idempotencyKey,
    noteSchemaVersion: NOTE_SCHEMA_VERSION,
    ownerId: String(ownerId),
    context: { channel: context.channel || 'LOCAL_OWNER_SESSION', chatId: context.chatId || null, topicId: context.topicId || null, sessionId: context.sessionId || null },
    testContactId: String(contact.id),
    callId: identity.callId,
    transcriptHash: transcript.providerTranscriptHash,
    exactNoteBody: body,
    rawProviderTranscript: transcript.rawText,
    normalizedTranscript: transcript.normalizedText,
    normalizationDiff: transcript.normalizationDiff,
    transcriptMetadata: withoutTranscriptText(transcript),
    structuredFacts: validatedFacts,
    riskFlags,
    createdAt,
    expiresAt,
    status: 'NOTE_PREVIEW_PENDING_APPROVAL',
    approvalInstruction: APPROVAL_LANGUAGE,
    productionEffects: { providerSends: 0, callsAutomaticallyPlaced: 0, smsSent: 0, ghlWrites: 0, productionGhlWrites: 0, stageMovements: 0 },
  };
}

class TranscriptNotePreviewStore {
  constructor(options = {}) {
    this.dir = options.dir || DEFAULT_PREVIEW_DIR;
  }

  persist(preview) {
    fs.mkdirSync(this.dir, { recursive: true });
    const payload = { ...preview };
    const artifact = { ...payload, integrityHash: sha256(payload) };
    fs.writeFileSync(this.path(preview.previewId), JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
    return artifact;
  }

  load(previewId) {
    const file = this.path(previewId);
    if (!fs.existsSync(file)) return null;
    const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { integrityHash, ...payload } = artifact;
    if (!integrityHash || sha256(payload) !== integrityHash) throw new Error('NOTE_PREVIEW_INTEGRITY_FAILED');
    return artifact;
  }

  update(previewId, changes) {
    const current = this.load(previewId);
    if (!current) throw new Error('NOTE_PREVIEW_NOT_FOUND');
    const { integrityHash: _ignored, ...existing } = current;
    const payload = { ...existing, ...changes, updatedAt: new Date().toISOString() };
    const artifact = { ...payload, integrityHash: sha256(payload) };
    const file = this.path(previewId);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, file);
    return artifact;
  }

  async withLock(previewId, operation) {
    fs.mkdirSync(this.dir, { recursive: true });
    const lock = `${this.path(previewId)}.lock`;
    let descriptor;
    try {
      descriptor = fs.openSync(lock, 'wx');
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    } catch {
      throw new Error('NOTE_PREVIEW_WRITE_LOCKED');
    }
    try {
      return await operation();
    } finally {
      fs.closeSync(descriptor);
      fs.rmSync(lock, { force: true });
    }
  }

  path(previewId) {
    return path.join(this.dir, `${previewId}.json`);
  }
}

class TranscriptNoteApprovalStore {
  constructor(options = {}) {
    this.dir = options.dir || DEFAULT_APPROVAL_DIR;
    this.signingSecret = options.signingSecret || '';
    this.ownerId = String(options.ownerId || '');
    this.verifyOwnerContext = options.verifyOwnerContext || (() => false);
  }

  approve(preview, approvalText, context = {}) {
    if (!this.signingSecret) throw new Error('TEST_NOTE_APPROVAL_SECRET_REQUIRED');
    if (String(approvalText || '').trim() !== APPROVAL_LANGUAGE) throw new Error('EXACT_TEST_NOTE_APPROVAL_LANGUAGE_REQUIRED');
    if (this.verifyOwnerContext(context) !== true || String(context.ownerId) !== this.ownerId || String(preview.ownerId) !== this.ownerId) throw new Error('TEST_NOTE_OWNER_IDENTITY_REQUIRED');
    if (new Date(preview.expiresAt) <= new Date()) throw new Error('NOTE_PREVIEW_EXPIRED');
    const payload = {
      approvalId: `test_note_approval_${sha256({ previewId: preview.previewId, messageId: context.messageId, createdAt: new Date().toISOString() }).slice(0, 20)}`,
      previewId: preview.previewId,
      previewHash: preview.previewHash,
      noteBodyHash: preview.noteBodyHash,
      callId: preview.callId,
      transcriptHash: preview.transcriptHash,
      testContactId: preview.testContactId,
      ownerId: this.ownerId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt: preview.expiresAt,
    };
    const approval = { ...payload, integrityHash: hmac(payload, this.signingSecret) };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${approval.approvalId}.json`), JSON.stringify(approval, null, 2) + '\n', { flag: 'wx' });
    return approval;
  }

  verify(approval, preview) {
    if (!approval || !this.signingSecret || approval.status !== 'ACTIVE' || new Date(approval.expiresAt) <= new Date()) return false;
    const { integrityHash, ...payload } = approval;
    if (hmac(payload, this.signingSecret) !== integrityHash) return false;
    return approval.previewId === preview.previewId && approval.previewHash === preview.previewHash && approval.noteBodyHash === preview.noteBodyHash && approval.callId === preview.callId && approval.transcriptHash === preview.transcriptHash && approval.testContactId === preview.testContactId && approval.ownerId === preview.ownerId;
  }

  load(approvalId) {
    const file = path.join(this.dir, `${approvalId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  consume(approvalId, noteId) {
    const current = this.load(approvalId);
    if (!current || !['ACTIVE', 'RESERVED'].includes(current.status) || !verifyApprovalIntegrity(current, this.signingSecret)) throw new Error('TEST_NOTE_APPROVAL_NOT_ACTIVE');
    const { integrityHash: _ignored, ...existing } = current;
    const payload = { ...existing, status: 'CONSUMED', noteId: noteId || null, consumedAt: new Date().toISOString() };
    const approval = { ...payload, integrityHash: hmac(payload, this.signingSecret) };
    const file = path.join(this.dir, `${approvalId}.json`);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(approval, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, file);
    return approval;
  }

  reserve(approval, expected = {}) {
    if (!approval?.approvalId) throw new Error('TEST_NOTE_APPROVAL_NOT_ACTIVE');
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${approval.approvalId}.json`);
    const lock = `${file}.lock`;
    let descriptor;
    try {
      descriptor = fs.openSync(lock, 'wx');
      const current = this.load(approval.approvalId);
      if (!current || current.status !== 'ACTIVE' || !verifyApprovalIntegrity(current, this.signingSecret)) throw new Error('TEST_NOTE_APPROVAL_NOT_ACTIVE');
      if (current.integrityHash !== approval.integrityHash || current.previewId !== expected.previewId || current.previewHash !== expected.previewHash || current.noteBodyHash !== expected.noteBodyHash || current.callId !== expected.callId || current.transcriptHash !== expected.transcriptHash || current.testContactId !== expected.testContactId) throw new Error('TEST_NOTE_APPROVAL_SCOPE_MISMATCH');
      const { integrityHash: _ignored, ...existing } = current;
      const payload = { ...existing, status: 'RESERVED', reservedAt: new Date().toISOString() };
      const reserved = { ...payload, integrityHash: hmac(payload, this.signingSecret) };
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(reserved, null, 2) + '\n', { flag: 'wx' });
      fs.renameSync(temporary, file);
      return reserved;
    } finally {
      if (descriptor !== undefined) {
        fs.closeSync(descriptor);
        fs.rmSync(lock, { force: true });
      }
    }
  }
}

function verifyApprovalIntegrity(approval, secret) {
  if (!approval || !secret || !approval.integrityHash) return false;
  const { integrityHash, ...payload } = approval;
  const expected = hmac(payload, secret);
  const actualBuffer = Buffer.from(String(integrityHash), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function collectIds(value = {}) {
  return [value.id, value.call_id, value.callId].filter(item => item !== undefined && item !== null && String(item) !== '').map(String);
}

function identityConflict(reason) {
  return { classification: 'CALL_IDENTITY_CONFLICT', reason };
}

function renderSegment(segment) {
  return `[${formatTime(segment.start)}-${formatTime(segment.end)}] ${segment.speakerLabel}: ${segment.sentence}`;
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function withoutTranscriptText(transcript) {
  const { rawText: _raw, normalizedText: _normalized, ...metadata } = transcript;
  return metadata;
}

module.exports = {
  APPROVAL_LANGUAGE,
  DEFAULT_APPROVAL_DIR,
  DEFAULT_PREVIEW_DIR,
  NOTE_SCHEMA_VERSION,
  TranscriptNoteApprovalStore,
  TranscriptNotePreviewStore,
  buildTestNotePreview,
  normalizeProviderTranscript,
  sha256,
  validateStructuredFacts,
  verifyApprovalIntegrity,
  verifyCallIdentity,
};
