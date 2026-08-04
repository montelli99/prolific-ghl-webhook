'use strict';

const { sha256 } = require('./owner-controlled-transcript-note');

const SYNC_AWARE_NOTE_SCHEMA_VERSION = 'owner-controlled-transcript-note-v2-sync-aware';

function classifyGhlCallSync(input = {}) {
  const callId = String(input.callId || '');
  const callSid = String(input.callSid || '');
  const statuses = input.endpointStatuses || {};
  const requiredSurfaces = ['contact', 'notes', 'conversations', 'tasks', 'opportunities'];
  const visibilityComplete = requiredSurfaces.every(surface => Number(statuses[surface]) >= 200 && Number(statuses[surface]) < 300);
  const records = [
    ...(input.notes || []).map(record => ({ ...record, objectType: 'NOTE', content: String(record.body || '') })),
    ...(input.messages || []).map(record => ({ ...record, objectType: 'CONVERSATION_MESSAGE', content: String(record.body || record.content || '') })),
    ...(input.tasks || []).map(record => ({ ...record, objectType: 'TASK', content: `${record.title || ''}\n${record.body || ''}` })),
    ...(input.activities || []).map(record => ({ ...record, objectType: 'ACTIVITY', content: String(record.body || record.content || '') })),
  ];
  const matching = records.filter(record => exactIdentityMatch(record, callId, callSid));
  const evidence = matching.map(analyzeRecord);
  const transcriptRecords = evidence.filter(record => record.transcriptTextPresent);
  const equivalentNotes = evidence.filter(record => record.objectType === 'NOTE' && (record.equivalentNote === true || record.providerTranscriptHash === input.providerTranscriptHash));
  const metadataPresent = evidence.some(record => ['TASK', 'ACTIVITY', 'CONVERSATION_MESSAGE'].includes(record.objectType));
  const transcriptComparison = compareTranscriptRecords(transcriptRecords, input.providerTranscriptText || '');
  let duplicationClassification;
  if (!visibilityComplete) duplicationClassification = 'WRITE_BLOCKED_UNCERTAIN_EXISTING_DATA';
  else if (equivalentNotes.length) duplicationClassification = 'WRITE_NOT_NEEDED_EQUIVALENT_STRUCTURED_NOTE_EXISTS';
  else if (transcriptComparison === 'EXACT') duplicationClassification = 'WRITE_NOT_NEEDED_TRANSCRIPT_ALREADY_PRESENT';
  else if (metadataPresent) duplicationClassification = 'WRITE_SHOULD_BE_REDUCED';
  else duplicationClassification = 'WRITE_NEEDED';
  return {
    matchingRecords: evidence,
    visibilityComplete,
    statuses: {
      CALL_ACTIVITY: status(evidence.some(record => ['TASK', 'ACTIVITY', 'CONVERSATION_MESSAGE'].includes(record.objectType)), visibilityComplete),
      RECORDING_LINK: status(evidence.some(record => record.recordingUrlPresent), visibilityComplete),
      DISPOSITION_TAG: status(evidence.some(record => record.dispositionPresent) || (input.tags || []).some(tag => /disposition/i.test(tag)), visibilityComplete),
      LAST_CALL_OUTCOME: status(Boolean(input.lastCallOutcome) || evidence.some(record => record.lastCallOutcomePresent), visibilityComplete),
      TRANSCRIPT_TEXT: status(transcriptRecords.length > 0, visibilityComplete),
      TRANSCRIPT_LINK: status(evidence.some(record => record.transcriptLinkPresent), visibilityComplete),
      CALL_SUMMARY: status(evidence.some(record => record.summaryPresent), visibilityComplete),
      AI_ANALYSIS: status(evidence.some(record => record.analysisPresent), visibilityComplete),
    },
    transcriptComparison,
    duplicationClassification,
    productionEffects: { providerSends: 0, callsAutomaticallyPlaced: 0, smsSent: 0, ghlWrites: 0, stageMovements: 0 },
  };
}

function buildSyncAwarePreview(existingPreview, syncResult, syncRecord, now = new Date()) {
  if (!existingPreview?.previewId || syncResult?.duplicationClassification !== 'WRITE_SHOULD_BE_REDUCED') throw new Error('SYNC_AWARE_REVISED_PREVIEW_NOT_REQUIRED');
  const idempotencyKey = sha256({ callId: existingPreview.callId, transcriptHash: existingPreview.transcriptHash, contactId: existingPreview.testContactId, noteSchemaVersion: SYNC_AWARE_NOTE_SCHEMA_VERSION });
  const previewHash = sha256({ idempotencyKey, callId: existingPreview.callId, transcriptHash: existingPreview.transcriptHash, contactId: existingPreview.testContactId, noteSchemaVersion: SYNC_AWARE_NOTE_SCHEMA_VERSION, supersedesPreviewHash: existingPreview.previewHash });
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(new Date(now).getTime() + 15 * 60 * 1000).toISOString();
  const previewId = `call_note_preview_${sha256({ previewHash, createdAt }).slice(0, 20)}`;
  const facts = existingPreview.structuredFacts?.facts || [];
  const risks = existingPreview.riskFlags || [];
  const body = [
    'Owner-Controlled Call Transcript Test',
    `owner_controlled_transcript_note_key:${idempotencyKey}`,
    '',
    'TEST DISCLAIMER',
    '- Owner-controlled test',
    '- Not a production deal',
    '- No opportunity associated',
    '- No stage movement',
    '- No follow-up automation',
    '',
    'TRANSCRIPT PROVENANCE',
    `- JustCall call ID: ${existingPreview.callId}`,
    '- Transcript source: PROVIDER_TRANSCRIPT',
    `- Provider transcript hash: ${existingPreview.transcriptHash}`,
    `- Transcript retrieval timestamp: ${existingPreview.transcriptMetadata?.retrievedAt || '(not available)'}`,
    '',
    'ALREADY AUTO-SYNCED BY JUSTCALL TO GHL',
    `- GHL object: Completed task ${syncRecord.id}`,
    `- Direction: ${syncRecord.direction || 'OUTGOING'}`,
    `- Timestamp: ${syncRecord.timestamp}`,
    `- Duration: ${syncRecord.durationSeconds} seconds`,
    `- Recording link: ${syncRecord.recordingUrlPresent ? 'present in GHL task; URL omitted' : 'not present'}`,
    '- The metadata above is referenced for provenance and is not duplicated as a second activity.',
    '',
    'NOT AUTO-SYNCED BY JUSTCALL TO GHL',
    '- Provider transcript text',
    '- Transcript link',
    '- Call summary',
    '- AI analysis',
    '- Disposition tag',
    '- Last Call Outcome',
    '',
    'TRANSCRIPT',
    existingPreview.normalizedTranscript,
    '',
    'STRUCTURED FACTS',
    ...(facts.length ? facts.map(fact => `- ${fact.label}: ${fact.value} (evidence: "${fact.evidence}")`) : ['- None safely supported.']),
    '',
    'RISK FLAGS',
    ...(risks.length ? risks.map(flag => `- ${flag.code}: ${flag.detail}`) : ['- None identified.']),
    '',
    'PROVENANCE',
    `- Provider transcript hash: ${existingPreview.transcriptHash}`,
    `- Note-preview hash: ${previewHash}`,
    `- Call ID: ${existingPreview.callId}`,
    `- Test contact ID: ${existingPreview.testContactId}`,
    `- Supersedes preview ID: ${existingPreview.previewId}`,
    '',
    'PRODUCTION EFFECTS',
    '- Provider sends: 0',
    '- Calls automatically placed: 0',
    '- GHL writes before approval: 0',
    '- Stage movements: 0',
  ].join('\n');
  const {
    integrityHash: _integrityHash,
    updatedAt: _updatedAt,
    supersededAt: _supersededAt,
    supersededByPreviewId: _supersededByPreviewId,
    approvalId: _approvalId,
    ...basePreview
  } = existingPreview;
  return {
    ...basePreview,
    previewId,
    previewHash,
    noteBodyHash: sha256(body),
    idempotencyKey,
    noteSchemaVersion: SYNC_AWARE_NOTE_SCHEMA_VERSION,
    exactNoteBody: body,
    createdAt,
    expiresAt,
    status: 'NOTE_PREVIEW_PENDING_APPROVAL',
    supersedesPreviewId: existingPreview.previewId,
    supersedesPreviewHash: existingPreview.previewHash,
    approvalId: null,
    approvalInstruction: 'Approve the exact revised test note shown above.',
    ghlAutoSync: { classification: syncResult.duplicationClassification, record: sanitizeSyncRecord(syncRecord) },
    productionEffects: { providerSends: 0, callsAutomaticallyPlaced: 0, smsSent: 0, ghlWrites: 0, productionGhlWrites: 0, stageMovements: 0 },
  };
}

async function persistSyncAwarePreview({ previewStore, approvalStore, existingPreviewId, revisedPreview }) {
  if (!previewStore || !existingPreviewId || !revisedPreview?.previewId) throw new Error('SYNC_AWARE_PREVIEW_PERSISTENCE_INPUT_REQUIRED');
  return previewStore.withLock(existingPreviewId, async () => {
    const existing = previewStore.load(existingPreviewId);
    if (!existing || existing.status !== 'NOTE_PREVIEW_PENDING_APPROVAL') throw new Error('EXISTING_PREVIEW_NOT_ACTIVE');
    if (approvalStore) approvalStore.revokeForPreview(existingPreviewId);
    const artifact = previewStore.persist(revisedPreview);
    previewStore.update(existingPreviewId, { status: 'SUPERSEDED_GHL_AUTO_SYNC_METADATA', supersededByPreviewId: artifact.previewId, supersededAt: new Date().toISOString(), approvalInstruction: null });
    return artifact;
  });
}

function exactIdentityMatch(record, callId, callSid) {
  const searchable = `${record.content || ''}\n${JSON.stringify(record.meta || {})}`;
  const ids = [...searchable.matchAll(/\bCall ID:\s*(\d+)\b/gi)].map(match => match[1]);
  const sids = [...searchable.matchAll(/\bCA[a-f0-9]{20,}\b/gi)].map(match => match[0]);
  const uniqueIds = [...new Set(ids)];
  const uniqueSids = [...new Set(sids.map(sid => sid.toUpperCase()))];
  if (uniqueIds.length > 1 || uniqueSids.length > 1) return false;
  if (uniqueIds.some(id => id !== callId) || uniqueSids.some(sid => sid !== callSid.toUpperCase())) return false;
  if (uniqueIds.length || uniqueSids.length) return uniqueIds[0] === callId || uniqueSids[0] === callSid.toUpperCase();
  return false;
}

function analyzeRecord(record) {
  const content = String(record.content || '');
  const urls = content.match(/https?:\/\/\S+/gi) || [];
  const transcriptBody = extractLabeledBody(content, /(?:^|\n)(?:provider\s+)?transcript(?:\s+text)?\s*:\s*/i);
  const durationMatch = content.match(/Call Duration:\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+)s/i);
  return {
    objectType: record.objectType,
    id: record.id || null,
    source: record.source || 'JustCall (inferred from exact call record format)',
    timestamp: record.dueDate || record.dateAdded || record.timestamp || null,
    direction: /outgoing call/i.test(content) ? 'OUTGOING' : /incoming call/i.test(content) ? 'INCOMING' : null,
    status: record.completed === true ? 'COMPLETED' : record.status || null,
    durationSeconds: durationMatch ? Number(durationMatch[1] || 0) * 3600 + Number(durationMatch[2] || 0) * 60 + Number(durationMatch[3] || 0) : null,
    content: redactSensitiveContent(content),
    recordingUrlPresent: /call recording\s*:/i.test(content) && urls.length > 0,
    transcriptTextPresent: Boolean(transcriptBody),
    transcriptText: transcriptBody || null,
    transcriptLinkPresent: /transcript\s+(?:link|url)\s*:/i.test(content) && urls.length > 0,
    summaryPresent: /(?:^|\n)(?:call\s+)?summary\s*:/i.test(content),
    analysisPresent: /(?:^|\n)(?:ai\s+analysis|sentiment|call\s+score)\s*:/i.test(content),
    dispositionPresent: /(?:^|\n)disposition\s*:/i.test(content),
    lastCallOutcomePresent: /(?:^|\n)last call outcome\s*:/i.test(content),
    equivalentNote: record.equivalentNote === true,
    providerTranscriptHash: record.providerTranscriptHash || null,
    deterministicMatch: true,
  };
}

function extractLabeledBody(content, labelPattern) {
  const match = content.match(labelPattern);
  if (!match) return '';
  const rest = content.slice(match.index + match[0].length).trim();
  const candidate = rest.split(/\n(?=(?:transcript\s+(?:link|url)|(?:call\s+)?summary|ai\s+analysis|sentiment|call\s+score|disposition|last call outcome)\s*:)|\n[A-Z][A-Z _/-]{2,}\n/i)[0].trim();
  if (/^(?:transcript\s+(?:link|url)|(?:call\s+)?summary|ai\s+analysis|sentiment|call\s+score|disposition|last call outcome)\s*:/i.test(candidate)) return '';
  return candidate;
}

function compareTranscriptRecords(records, providerText) {
  if (!records.length) return 'ABSENT';
  const normalizedProvider = normalizeText(providerText);
  if (!normalizedProvider) return 'UNKNOWN';
  if (records.some(record => normalizeText(record.transcriptText) === normalizedProvider)) return 'EXACT';
  if (records.some(record => normalizedProvider.includes(normalizeText(record.transcriptText)) || normalizeText(record.transcriptText).includes(normalizedProvider))) return 'PARTIAL';
  return 'MISMATCHED';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function redactSensitiveContent(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[URL_OMITTED]')
    .replace(/\+?1?5718140891/g, '+1*******0891')
    .replace(/\+?1?5716012619/g, '+1*******2619');
}

function sanitizeSyncRecord(record = {}) {
  return {
    objectType: record.objectType || null,
    id: record.id || null,
    source: record.source || null,
    timestamp: record.timestamp || null,
    direction: record.direction || null,
    status: record.status || null,
    durationSeconds: record.durationSeconds ?? null,
    recordingUrlPresent: record.recordingUrlPresent === true,
    transcriptTextPresent: record.transcriptTextPresent === true,
    transcriptLinkPresent: record.transcriptLinkPresent === true,
    summaryPresent: record.summaryPresent === true,
    analysisPresent: record.analysisPresent === true,
    dispositionPresent: record.dispositionPresent === true,
    lastCallOutcomePresent: record.lastCallOutcomePresent === true,
    deterministicMatch: record.deterministicMatch === true,
  };
}

function status(present, known) {
  return present ? 'PRESENT' : known ? 'ABSENT' : 'UNKNOWN';
}

module.exports = { SYNC_AWARE_NOTE_SCHEMA_VERSION, buildSyncAwarePreview, classifyGhlCallSync, exactIdentityMatch, persistSyncAwarePreview };
