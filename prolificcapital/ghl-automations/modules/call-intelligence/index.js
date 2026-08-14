'use strict';

const fs = require('fs');
const path = require('path');
const { CallJobStore } = require('./call-job-store');
const { RecordingFetcher } = require('./recording-fetcher');
const { createDefaultTranscriptionProvider } = require('./transcription-provider');
const { extractFacts } = require('./seller-fact-extractor');
const { mergeQualification } = require('./qualification-state');
const { computeMissing } = require('./missing-info-engine');
const { recommend } = require('./recommendation-engine');
const { buildRecommendedQuestions } = require('./recommended-questions');
const { JustCallIntegration } = require('../justcall-integration');

const QUALIFICATION_DIR = path.resolve(__dirname, '..', '..', 'data', 'runtime', 'call-intelligence-qualification');

function qualificationPath(opportunityId) {
  return path.join(QUALIFICATION_DIR, `${String(opportunityId)}.json`);
}

function loadQualification(opportunityId) {
  const file = qualificationPath(opportunityId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveQualification(opportunityId, state) {
  fs.mkdirSync(QUALIFICATION_DIR, { recursive: true });
  const file = qualificationPath(opportunityId);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, file);
  return state;
}

function buildInitialJob(input) {
  return {
    schemaVersion: 1,
    callId: String(input.callId),
    callSid: input.callSid || null,
    profile: input.profile,
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    phone: input.phone,
    property: input.property,
    recordingUrl: input.recordingUrl || null,
    status: 'pending',
    recordingStatus: 'pending',
    transcriptionStatus: 'pending',
    factExtractionStatus: 'pending',
    qualificationStatus: 'pending',
    attemptCount: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    transcript: null,
    facts: null,
    qualification: null,
    missing: null,
    recommendation: null,
    commitments: [],
    questions: [],
    readiness: null,
    transcriptSource: null,
  };
}

function resolveCallTranscriptSource(options = {}) {
  if (options.highLevelTranscript && options.highLevelTranscript.text) return { source: 'HIGHLEVEL_TRANSCRIPT_LINK', transcript: options.highLevelTranscript };
  if (options.providerTranscript && options.providerTranscript.state === 'PROVIDER_TRANSCRIPT_AVAILABLE' && options.providerTranscriptResult && options.providerTranscriptResult.status === 'ready' && options.providerTranscriptResult.text) {
    return { source: 'JUSTCALL_PROVIDER_TRANSCRIPT', transcript: options.providerTranscriptResult };
  }
  if (options.recordingStt && options.recordingStt.status === 'ready') return { source: 'RECORDING_STT', transcript: options.recordingStt };
  return { source: 'UNAVAILABLE', transcript: null };
}

async function processCompletedCall(input, options = {}) {
  const store = options.store || new CallJobStore(options.storeOptions);
  const fetcher = options.fetcher || new RecordingFetcher(options.fetcherOptions);
  const provider = options.provider || createDefaultTranscriptionProvider(options.providerOptions);
  const justcall = options.justcall || new JustCallIntegration();
  const existing = store.load(input.callId);
  if (existing && (existing.status === 'complete' || existing.status === 'failed')) return existing;

  return await store.withLock(input.callId, async () => {
    let record = existing || buildInitialJob(input);
    record = store.save(input.callId, { ...record, status: 'processing', updatedAt: new Date().toISOString(), attemptCount: Number(record.attemptCount || 0) + 1 });
    let downloaded = null;
    try {
      downloaded = await fetcher.fetch(input.callId, input.recordingUrl);
      const audio = fetcher.probe(downloaded.filePath);
      record = store.save(input.callId, { ...record, recordingStatus: 'downloaded', audio, updatedAt: new Date().toISOString() });

      const providerTranscript = await justcall.pollCallTranscript(input.callId, { scheduleMs: [0], sleep: async () => {} });
      let transcriptResult = null;
      let providerTranscriptResult = null;
      if (providerTranscript.state === 'PROVIDER_TRANSCRIPT_AVAILABLE') {
        providerTranscriptResult = {
          status: 'ready',
          provider: 'justcall_ai',
          model: 'calls_ai',
          language: 'en',
          text: providerTranscript.segments.map((segment) => segment.sentence || segment.text || '').join('\n').trim(),
          segments: providerTranscript.segments,
          speakers: [],
          speakerMode: 'inferred',
          durationSeconds: record.audio?.durationSeconds || 0,
          processedAt: new Date().toISOString(),
        };
      }
      const recordingTranscript = await provider.transcribe({ filePath: downloaded.filePath, mimeType: downloaded.mimeType, durationSeconds: record.audio?.durationSeconds || 0, callId: input.callId });
      const resolved = resolveCallTranscriptSource({ providerTranscript, providerTranscriptResult, recordingStt: recordingTranscript, highLevelTranscript: options.highLevelTranscript || null });
      transcriptResult = resolved.transcript;

      if (!transcriptResult || transcriptResult.status !== 'ready') {
        const failureReason = recordingTranscript?.reason || transcriptResult?.reason || providerTranscript.reason || 'TRANSCRIPTION_FAILED';
        const failed = store.save(input.callId, {
          ...record,
          status: 'failed',
          transcriptionStatus: 'failed',
          lastError: failureReason,
          providerTranscriptState: providerTranscript.state,
          transcriptSource: resolved.source,
          updatedAt: new Date().toISOString(),
        });
        return failed;
      }

      const facts = extractFacts(transcriptResult);
      const previousQualification = loadQualification(input.opportunityId) || {};
      const qualification = mergeQualification(previousQualification, facts, { propertyId: input.property, contactId: input.contactId, opportunityId: input.opportunityId, callId: input.callId });
      saveQualification(input.opportunityId, qualification);
      const missing = computeMissing(qualification);
      const stageContext = { stageName: input.stageName || null };
      const recommendation = recommend(facts, qualification, missing, stageContext);
      const questions = buildRecommendedQuestions(qualification, stageContext);
      const commitments = qualification.qualification?.commitments || [];
      const complete = store.save(input.callId, {
        ...record,
        status: 'complete',
        transcriptionStatus: 'complete',
        factExtractionStatus: 'complete',
        qualificationStatus: 'complete',
        transcript: transcriptResult,
        facts,
        qualification,
        missing,
        recommendation,
        questions,
        commitments,
        readiness: recommendation.state,
        providerTranscriptState: providerTranscript.state,
        transcriptSource: resolved.source,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      return complete;
    } catch (error) {
      const failed = store.save(input.callId, {
        ...record,
        status: 'failed',
        lastError: error.message,
        updatedAt: new Date().toISOString(),
      });
      return failed;
    } finally {
      if (downloaded?.filePath) fetcher.cleanup(downloaded.filePath);
      fetcher.cleanupExpired();
    }
  });
}

function reviewCall(callId, options = {}) {
  const store = options.store || new CallJobStore(options.storeOptions);
  return store.load(callId);
}

module.exports = { processCompletedCall, reviewCall, loadQualification, saveQualification, buildInitialJob, resolveCallTranscriptSource };
