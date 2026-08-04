'use strict';

const crypto = require('crypto');

const NOTE_VERSION = 'kayla-call-note-v1';
const ACTION_VERSION = 'course-guided-action-v1';

const MATCH_STATES = Object.freeze([
  'MATCHED_CONTACT_AND_OPPORTUNITY',
  'MATCHED_CONTACT_MULTIPLE_OPPORTUNITIES',
  'MATCHED_CONTACT_NO_OPPORTUNITY',
  'MULTIPLE_CONTACTS',
  'NO_CONTACT',
  'TEST_OR_NON_PRODUCTION',
  'UNKNOWN',
]);

const TRANSCRIPT_STATES = Object.freeze([
  'CALL_COMPLETED',
  'RECORDING_AVAILABLE',
  'TRANSCRIPT_PENDING',
  'TRANSCRIPT_AVAILABLE',
  'TRANSCRIPT_UNAVAILABLE',
  'TRANSCRIPT_FAILED',
  'NO_MEANINGFUL_CONVERSATION',
]);

const FACT_FIELDS = Object.freeze([
  'occupancy', 'monthlyRent', 'leaseStatus', 'leaseExpiration', 'roofAge', 'hvacAge',
  'utilities', 'taxes', 'insurance', 'conditionRepairs', 'listingFeedback', 'daysOnMarket',
  'offersReceived', 'sellerFlexibility', 'priceFlexibility', 'creativeFinanceOpenness',
  'otherProperties', 'timeline', 'motivation', 'accessShowingInformation',
]);

const FACT_EVIDENCE_TERMS = Object.freeze({
  occupancy: ['occupancy', 'occupied', 'vacant'], monthlyRent: ['rent'], leaseStatus: ['lease'], leaseExpiration: ['lease', 'expiration', 'expires'],
  roofAge: ['roof'], hvacAge: ['hvac', 'air conditioning', 'furnace'], utilities: ['utilities', 'utility'], taxes: ['tax', 'taxes'],
  insurance: ['insurance'], conditionRepairs: ['condition', 'repair'], listingFeedback: ['feedback'], daysOnMarket: ['days on market', 'dom'],
  offersReceived: ['offer'], sellerFlexibility: ['seller', 'flexible', 'flexibility'], priceFlexibility: ['price', 'flexible', 'flexibility'],
  creativeFinanceOpenness: ['creative', 'seller finance', 'subject to'], otherProperties: ['other properties', 'another property'],
  timeline: ['timeline', 'closing', 'sell by'], motivation: ['motivation', 'reason for selling'], accessShowingInformation: ['access', 'showing'],
});

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildTranscriptEvidence({ source, callId, text, recordingEvidence = null }) {
  const labels = {
    PROVIDER: 'PROVIDER_TRANSCRIPT_AVAILABLE',
    SYSTEM: 'SYSTEM_TRANSCRIPT_AVAILABLE',
    OWNER: 'OWNER_SUMMARY_AVAILABLE',
  };
  if (!labels[source] || !callId || !String(text || '').trim()) throw new Error('TRANSCRIPT_EVIDENCE_INVALID');
  if (source === 'SYSTEM') {
    const expectedBinding = recordingEvidence && stableHash({ callId: String(recordingEvidence.callId), recordingSha256: recordingEvidence.recordingSha256 });
    if (!recordingEvidence || String(recordingEvidence.callId) !== String(callId) || expectedBinding !== recordingEvidence.bindingHash) throw new Error('SYSTEM_TRANSCRIPT_RECORDING_BINDING_REQUIRED');
  }
  const recordingBindingHash = recordingEvidence?.bindingHash || null;
  return {
    state: labels[source],
    source,
    callId: String(callId),
    text: String(text),
    recordingEvidence: source === 'SYSTEM' ? { ...recordingEvidence } : null,
    recordingBindingHash,
    evidenceHash: stableHash({ source, callId: String(callId), text: String(text), recordingBindingHash }),
  };
}

function hashRecordingBytes(callId, bytes) {
  if (!callId || !Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('RECORDING_EVIDENCE_INVALID');
  const recordingSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return { callId: String(callId), byteLength: bytes.length, recordingSha256, bindingHash: stableHash({ callId: String(callId), recordingSha256 }) };
}

function normalizeE164(value, defaultCountryCode = '1') {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : '';
}

function maskPhone(value) {
  const phone = normalizeE164(value);
  return phone ? `${phone.slice(0, 3)}******${phone.slice(-2)}` : '(missing)';
}

function normalizeDirection(value) {
  const direction = String(value || '').toLowerCase();
  if (/out/.test(direction)) return 'OUTBOUND';
  if (/in/.test(direction)) return 'INBOUND';
  return 'UNKNOWN';
}

function normalizeCallRecord(raw = {}) {
  const callInfo = raw.call_info || {};
  const callDuration = raw.call_duration || {};
  const direction = normalizeDirection(raw.direction || raw.call_direction || callInfo.direction || raw.type);
  const callId = String(raw.id || raw.call_id || raw.callId || raw.call_sid || raw.sid || '');
  const from = normalizeE164(raw.from || raw.from_number || raw.justcall_number);
  const to = normalizeE164(raw.to || raw.to_number || raw.contact_number);
  const remotePhone = normalizeE164(raw.contact_number || raw.contactNumber || (direction === 'OUTBOUND' ? to : from));
  return {
    callId,
    direction,
    from,
    to,
    remotePhone,
    startedAt: raw.start_time || raw.started_at || raw.startTime || raw.date || raw.created_at || (raw.call_date && raw.call_time ? `${raw.call_date}T${raw.call_time}` : null),
    completedAt: raw.end_time || raw.completed_at || raw.endTime || raw.updated_at || (raw.call_date && raw.call_time ? `${raw.call_date}T${raw.call_time}` : null),
    durationSeconds: Number(raw.conversation_time || raw.duration || raw.duration_seconds || callDuration.conversation_time || callDuration.total_duration || 0),
    status: String(raw.status || raw.call_status || callInfo.type || '').toUpperCase(),
    disposition: String(raw.disposition || raw.call_disposition || callInfo.disposition || callInfo.missed_call_reason || '').trim(),
    recordingUrl: raw.recording_url || raw.recordingUrl || raw.recording || callInfo.recording || null,
    recordingStatus: raw.recording_status || (raw.recording_url || raw.recordingUrl || raw.recording || callInfo.recording ? 'AVAILABLE' : 'UNAVAILABLE'),
    participantRole: String(raw.participantRole || raw.participant_role || 'unknown').toLowerCase(),
    intendedPersonReached: raw.intendedPersonReached === true || raw.intended_person_reached === true,
    meaningfulConversation: raw.meaningfulConversation === true || raw.meaningful_conversation === true,
    attemptNumber: Math.max(1, Number(raw.attemptNumber || raw.attempt_number || 1)),
    locationId: raw.locationId || raw.location_id || null,
    raw,
  };
}

function normalizeTranscript(callId, ai = {}) {
  const sourceCallIds = [ai.callId, ai.call_id, ai.id].filter(value => value !== undefined && value !== null && String(value) !== '').map(String);
  const sourceCallId = sourceCallIds[0] || '';
  if (new Set(sourceCallIds).size > 1) {
    return { status: 'TRANSCRIPT_FAILED', reason: 'TRANSCRIPT_CALL_ID_CONFLICT', sourceCallId, segments: [], text: '' };
  }
  if (sourceCallId && callId && sourceCallId !== String(callId)) {
    return { status: 'TRANSCRIPT_FAILED', reason: 'TRANSCRIPT_CALL_ID_MISMATCH', sourceCallId, segments: [], text: '' };
  }
  const segments = ai.call_transcription || ai.transcriptSegments || ai.transcript || [];
  const normalized = Array.isArray(segments) ? segments.map((segment, index) => {
    if (typeof segment === 'string') return { index, speaker: 'unknown', text: segment };
    return {
      index,
      speaker: String(segment.speaker || segment.role || segment.speaker_id || 'unknown'),
      text: String(segment.text || segment.content || segment.sentence || ''),
      start: segment.start ?? segment.start_time ?? segment.timestamp?.starttime ?? null,
    };
  }).filter(segment => segment.text.trim()) : [];
  const providerStatus = String(ai.transcript_status || ai.status || '').toUpperCase();
  if (normalized.length > 0 && !sourceCallId) return { status: 'TRANSCRIPT_FAILED', reason: 'TRANSCRIPT_CALL_ID_MISSING', sourceCallId, segments: [], text: '' };
  if (normalized.length > 0) return { status: 'TRANSCRIPT_AVAILABLE', sourceCallId, segments: normalized, text: normalized.map(segment => segment.text).join('\n') };
  if (/FAIL|ERROR/.test(providerStatus)) return { status: 'TRANSCRIPT_FAILED', reason: providerStatus, sourceCallId, segments: [], text: '' };
  if (/UNAVAILABLE|NOT_AVAILABLE|DISABLED/.test(providerStatus)) return { status: 'TRANSCRIPT_UNAVAILABLE', reason: providerStatus, sourceCallId, segments: [], text: '' };
  return { status: 'TRANSCRIPT_PENDING', reason: providerStatus || 'AI_DATA_NOT_READY', sourceCallId, segments: [], text: '' };
}

function classifyConversation(call, transcript) {
  const providerEvidence = `${call.status} ${call.disposition}`.toLowerCase();
  const transcriptEvidence = String(transcript.text || '').toLowerCase();
  if (/no.?answer|missed|not.?answered|busy|failed/.test(providerEvidence)) return { outcome: 'NO_ANSWER', meaningful: false, intendedPersonReached: false };
  if (call.meaningfulConversation && call.intendedPersonReached && transcript.status === 'TRANSCRIPT_AVAILABLE') {
    return { outcome: 'ANSWERED_MEANINGFUL', meaningful: true, intendedPersonReached: true };
  }
  const evidence = `${providerEvidence} ${transcriptEvidence}`;
  if (/voicemail|voice mail|leave.*message|mailbox/.test(evidence)) return { outcome: 'VOICEMAIL', meaningful: false, intendedPersonReached: false };
  if (/automated attendant|press \d|ivr|phone tree/.test(evidence)) return { outcome: 'AUTOMATED_ATTENDANT', meaningful: false, intendedPersonReached: false };
  if (/wrong (person|party|number)|not .*you.*looking for/.test(evidence)) return { outcome: 'WRONG_PARTY', meaningful: false, intendedPersonReached: false };
  if (/answered|completed/.test(call.status.toLowerCase())) return { outcome: 'ANSWERED_UNVERIFIED', meaningful: false, intendedPersonReached: call.intendedPersonReached };
  return { outcome: 'UNKNOWN', meaningful: false, intendedPersonReached: false };
}

function validateExtractedFacts(candidates = {}, transcriptText = '', requiredFields = FACT_FIELDS) {
  const facts = {};
  const rejected = [];
  const haystack = String(transcriptText || '').toLowerCase();
  for (const field of FACT_FIELDS) {
    const candidate = candidates[field];
    if (!candidate || typeof candidate !== 'object') continue;
    const value = candidate.value;
    const evidence = String(candidate.evidence || '').trim();
    const normalizedValue = String(value ?? '').trim().toLowerCase();
    const normalizedEvidence = evidence.toLowerCase();
    const terms = FACT_EVIDENCE_TERMS[field] || [field.toLowerCase()];
    const fieldBound = candidate.field === field && evidenceBindsValue(normalizedEvidence, normalizedValue, terms);
    if (!normalizedValue || !evidence || !haystack.includes(normalizedEvidence) || !fieldBound) {
      rejected.push({ field, reason: 'VALUE_NOT_SUPPORTED_BY_TRANSCRIPT_EVIDENCE' });
      continue;
    }
    facts[field] = { value, evidence, confidence: 'TRANSCRIPT_QUOTE_VERIFIED' };
  }
  return { facts, rejected, missing: requiredFields.filter(field => !facts[field]) };
}

function validateCommitments(candidates = {}, transcriptText = '') {
  const validated = {};
  const haystack = String(transcriptText || '').toLowerCase();
  for (const field of ['montelli', 'contact', 'documents', 'dates', 'followUp']) {
    const candidate = candidates[field];
    if (!candidate || typeof candidate !== 'object') continue;
    const value = String(candidate.value || '').trim();
    const evidence = String(candidate.evidence || '').trim();
    if (value && evidence && candidate.field === field && haystack.includes(evidence.toLowerCase()) && evidenceBindsValue(evidence.toLowerCase(), value.toLowerCase(), [field.toLowerCase(), field === 'followUp' ? 'follow up' : field])) validated[field] = value;
  }
  return validated;
}

function evidenceBindsValue(evidence, value, terms) {
  return String(evidence || '').split(/[.;,\n]|\b(?:and|but|while|whereas|however)\b/).some(clause => {
    const normalized = clause.trim();
    return normalized.includes(value) && terms.some(term => normalized.includes(term)) && !/\b(unknown|not known|not provided|didn'?t discuss|no information)\b/.test(normalized);
  });
}

function buildCallNote(input) {
  const { call, match, transcript, conversation, extraction, nextAction, summary, commitments = {} } = input;
  const transcriptEvidence = validateNoteTranscriptEvidence(call, transcript, input.transcriptEvidence);
  if (String(transcriptEvidence.callId) !== String(call.callId)) throw new Error('NOTE_TRANSCRIPT_CALL_ID_MISMATCH');
  const provenanceSource = transcriptEvidence.source === 'SYSTEM'
    ? 'Approved system transcription of call-ID-bound recording; not a JustCall provider transcript'
    : transcriptEvidence.source === 'OWNER'
      ? 'Owner-provided summary; not a transcript'
      : transcriptEvidence.source === 'PROVIDER'
        ? 'JustCall verified call record and AI transcript endpoint'
        : 'JustCall verified call metadata; no transcript used';
  const marker = `justcall_call_id:${call.callId}`;
  const factLines = FACT_FIELDS.map(field => `- ${field}: ${extraction.facts[field]?.value ?? '(not provided)'}`);
  const commitmentsLines = [
    `- Montelli: ${commitments.montelli || '(none identified)'}`,
    `- Contact: ${commitments.contact || '(none identified)'}`,
    `- Documents: ${commitments.documents || '(none identified)'}`,
    `- Dates/times: ${commitments.dates || '(none identified)'}`,
    `- Follow-up: ${commitments.followUp || '(not established)'}`,
  ];
  const lines = [
    'KAYLA CALL NOTES - JUSTCALL VERIFIED',
    marker,
    '',
    `Property address: ${match.propertyAddress || '(not resolved)'}`,
    `Opportunity ID: ${match.opportunityId || '(not resolved)'}`,
    `Contact: ${match.contactName || '(not resolved)'}`,
    `Contact role: ${match.contactRole || call.participantRole || 'unknown'}`,
    `Contact phone: ${maskPhone(call.remotePhone)}`,
    `Call direction: ${call.direction}`,
    `JustCall call ID: ${call.callId}`,
    `Call date/time: ${call.completedAt || call.startedAt || '(unknown)'}`,
    `Property-local time: ${input.propertyLocalTime || '(unknown)'}`,
    `Duration: ${call.durationSeconds}s`,
    `Call outcome: ${conversation.outcome}`,
    `Transcript status: ${transcript.status}`,
    `Recording status: ${call.recordingStatus}`,
    `Note generation version: ${NOTE_VERSION}`,
    `Course-guided action version: ${ACTION_VERSION}`,
    '',
    'CALL SUMMARY',
    summary || '(No factual summary available.)',
    '',
    'CONTACT OUTCOME',
    `- Intended person reached: ${conversation.intendedPersonReached ? 'yes' : 'no/unverified'}`,
    `- Participant role: ${match.contactRole || call.participantRole || 'unknown'}`,
    `- Meaningful conversation: ${conversation.meaningful ? 'yes' : 'no'}`,
    `- Call attempt: ${call.attemptNumber}`,
    '',
    'PROPERTY FACTS COLLECTED',
    ...factLines,
    '',
    'MISSING REQUIRED INFORMATION',
    ...(extraction.missing.length ? extraction.missing.map(field => `- ${field}`) : ['- none']),
    '',
    'COMMITMENTS AND FOLLOW-UPS',
    ...commitmentsLines,
    '',
    'COURSE-GUIDED NEXT ACTION',
    `- Exact next action: ${nextAction.exactNextAction}`,
    `- Course rule: ${nextAction.courseRule?.id || 'COURSE_GUIDED_NEXT_ACTION'}`,
    `- Approval requirement: ${nextAction.approvalRequirement || 'NONE'}`,
    `- Blocked downstream actions: ${(nextAction.remainsBlocked || []).join(', ') || 'none'}`,
    '',
    'TRANSCRIPT/RECORDING PROVENANCE',
    `- Source: ${provenanceSource}`,
    `- Call ID: ${call.callId}`,
    `- Transcript retrieved: ${input.transcriptRetrievedAt || '(not available)'}`,
    `- Recording: ${call.recordingUrl ? 'available in provider; link omitted from note by policy' : 'not available'}`,
    `- Confidence: ${transcriptEvidence.source === 'PROVIDER' ? 'CALL_ID_VERIFIED' : transcriptEvidence.source === 'SYSTEM' ? 'CALL_ID_BOUND_RECORDING' : transcriptEvidence.source === 'OWNER' ? 'OWNER_PROVIDED' : 'METADATA_ONLY'}`,
    '',
    'Raw transcript omitted by policy.',
  ];
  const body = lines.join('\n');
  return { heading: lines[0], marker, body, noteVersion: NOTE_VERSION, bodyHash: stableHash(body) };
}

function validateNoteTranscriptEvidence(call, transcript, supplied) {
  if (!supplied) {
    if (transcript.status === 'TRANSCRIPT_AVAILABLE') {
      if (!transcript.sourceCallId || String(transcript.sourceCallId) !== String(call.callId)) throw new Error('NOTE_PROVIDER_TRANSCRIPT_CALL_ID_UNVERIFIED');
      return buildTranscriptEvidence({ source: 'PROVIDER', callId: call.callId, text: transcript.text });
    }
    return { source: 'METADATA', state: transcript.status, callId: String(call.callId) };
  }
  if (String(supplied.callId) !== String(call.callId)) throw new Error('NOTE_TRANSCRIPT_CALL_ID_MISMATCH');
  if (supplied.source !== 'PROVIDER') throw new Error('NOTE_FALLBACK_TRANSCRIPT_NOT_AUTHORIZED');
  if (transcript.status !== 'TRANSCRIPT_AVAILABLE' || String(transcript.sourceCallId) !== String(call.callId) || supplied.text !== transcript.text) {
    throw new Error('NOTE_PROVIDER_TRANSCRIPT_EVIDENCE_MISMATCH');
  }
  const rebuilt = buildTranscriptEvidence({
    source: supplied.source,
    callId: supplied.callId,
    text: supplied.text,
  });
  if (rebuilt.state !== supplied.state || rebuilt.evidenceHash !== supplied.evidenceHash || rebuilt.recordingBindingHash !== supplied.recordingBindingHash) {
    throw new Error('NOTE_TRANSCRIPT_EVIDENCE_INVALID');
  }
  return rebuilt;
}

module.exports = {
  NOTE_VERSION,
  ACTION_VERSION,
  MATCH_STATES,
  TRANSCRIPT_STATES,
  FACT_FIELDS,
  stableHash,
  buildTranscriptEvidence,
  hashRecordingBytes,
  normalizeE164,
  maskPhone,
  normalizeCallRecord,
  normalizeTranscript,
  classifyConversation,
  validateExtractedFacts,
  validateCommitments,
  buildCallNote,
};
