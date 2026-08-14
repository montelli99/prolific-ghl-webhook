#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CallJobStore } = require('./call-intelligence/call-job-store');
const { RecordingFetcher } = require('./call-intelligence/recording-fetcher');
const { extractFacts } = require('./call-intelligence/seller-fact-extractor');
const { mergeQualification } = require('./call-intelligence/qualification-state');
const { computeMissing } = require('./call-intelligence/missing-info-engine');
const { recommend } = require('./call-intelligence/recommendation-engine');
const { buildRecommendedQuestions } = require('./call-intelligence/recommended-questions');
const { processCompletedCall, reviewCall, resolveCallTranscriptSource } = require('./call-intelligence');

let passed = 0;
let failed = 0;
const tempDirs = [];

async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-intelligence-'));
  tempDirs.push(dir);
  return dir;
}

(async () => {
  await test('1 job store is idempotent by call id', () => {
    const store = new CallJobStore({ dir: tempDir() });
    store.save('1', { callId: '1', status: 'pending' });
    assert.strictEqual(store.load('1').callId, '1');
  });

  await test('2 extraction detects DNC', () => {
    const facts = extractFacts({ text: 'Please stop calling me about this property.' });
    assert.strictEqual(facts.dnc, true);
  });

  await test('3 extraction detects wrong number', () => {
    const facts = extractFacts({ text: 'You have the wrong number.' });
    assert.strictEqual(facts.wrongNumber, true);
  });

  await test('4 extraction keeps ambiguous mortgage as needs confirmation', () => {
    const facts = extractFacts({ text: 'I owe around one fifty on it.' });
    assert.strictEqual(facts.mortgageBalance.status, 'NEEDS_CONFIRMATION');
  });

  await test('5 extraction detects callback request', () => {
    const facts = extractFacts({ text: 'Call me Friday after 3.' });
    assert.strictEqual(facts.callbackRequested, true);
  });

  await test('6 qualification merge preserves known facts', () => {
    const state = mergeQualification({}, { timeline: { status: 'KNOWN', value: '30 days' }, askingPrice: { status: 'KNOWN', value: 225000 }, occupancy: { status: 'KNOWN', value: 'vacant' }, mortgageBalance: { status: 'UNKNOWN', value: null }, propertyCondition: { status: 'UNKNOWN', value: [] }, motivation: { status: 'UNKNOWN', value: [] }, decisionMakers: { status: 'UNKNOWN', value: [] }, callbackRequested: false, preferredCallbackTime: null, creativeFinanceInterest: { status: 'UNKNOWN', value: null }, promises: [] }, { callId: '1', opportunityId: 'opp' });
    assert.strictEqual(state.qualification.askingPrice.value, 225000);
  });

  await test('7 conflicting occupancy is surfaced', () => {
    const prev = { qualification: { occupancy: { status: 'KNOWN', value: 'vacant', sourceCallId: '1' } } };
    const next = mergeQualification(prev, { occupancy: { status: 'KNOWN', value: 'tenant_occupied' }, askingPrice: { status: 'UNKNOWN', value: null }, timeline: { status: 'UNKNOWN', value: null }, mortgageBalance: { status: 'UNKNOWN', value: null }, propertyCondition: { status: 'UNKNOWN', value: [] }, motivation: { status: 'UNKNOWN', value: [] }, decisionMakers: { status: 'UNKNOWN', value: [] }, callbackRequested: false, preferredCallbackTime: null, creativeFinanceInterest: { status: 'UNKNOWN', value: null }, promises: [] }, { callId: '2', opportunityId: 'opp' });
    assert.strictEqual(next.qualification.occupancy.status, 'CONFLICTING');
  });

  await test('8 missing info identifies critical fields', () => {
    const missing = computeMissing({ qualification: { motivation: { status: 'UNKNOWN' }, timeline: { status: 'UNKNOWN' }, askingPrice: { status: 'KNOWN' }, occupancy: { status: 'UNKNOWN' }, propertyCondition: { status: 'UNKNOWN' }, decisionMakers: { status: 'UNKNOWN' } } });
    assert.ok(missing.missingCritical.includes('motivation'));
  });

  await test('9 recommendation uses DNC override', () => {
    const result = recommend({ dnc: true }, {}, { missingCritical: [], missingBeforeOffer: [], missingImportant: [], needsConfirmation: [], conflicts: [] });
    assert.strictEqual(result.recommendedAction, 'dnc');
  });

  await test('10 recommendation uses wrong-number override', () => {
    const result = recommend({ dnc: false, wrongNumber: true }, {}, { missingCritical: [], missingBeforeOffer: [], missingImportant: [], needsConfirmation: [], conflicts: [] });
    assert.strictEqual(result.recommendedAction, 'wrong_number_remediation');
  });

  await test('11 recording fetcher cleanup removes expired files', () => {
    const dir = tempDir();
    const fetcher = new RecordingFetcher({ tempDir: dir, now: () => Date.now() + 2 * 60 * 60 * 1000, ttlMs: 1000 });
    const file = path.join(dir, 'old.wav');
    fs.writeFileSync(file, 'x');
    const removed = fetcher.cleanupExpired();
    assert.strictEqual(removed.length, 1);
  });

  await test('12 processing returns failed when STT provider is not configured', async () => {
    const dir = tempDir();
    const store = new CallJobStore({ dir: path.join(dir, 'jobs') });
    const fetcher = { fetch: async () => ({ filePath: path.join(dir, 'audio.wav'), mimeType: 'audio/x-wav' }), probe: () => ({ decodable: true, durationSeconds: 29.3 }), cleanup: () => {}, cleanupExpired: () => [] };
    fs.writeFileSync(path.join(dir, 'audio.wav'), 'audio');
    const provider = { transcribe: async () => ({ status: 'failed', reason: 'STT_PROVIDER_NOT_CONFIGURED' }) };
    const justcall = { pollCallTranscript: async () => ({ state: 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE', reason: 'CALLS_AI_TRANSCRIPT_ACCESS_DENIED' }) };
    const result = await processCompletedCall({ profile: 'PPC_EWA_BEACH', callId: '404292464', contactId: 'c1', opportunityId: 'o1', phone: '+15718140891', property: '123 Main', recordingUrl: 'https://recording.example' }, { store, fetcher, provider, justcall });
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.lastError, 'STT_PROVIDER_NOT_CONFIGURED');
  });

  await test('13 processing is idempotent after failure', async () => {
    const dir = tempDir();
    const store = new CallJobStore({ dir: path.join(dir, 'jobs') });
    store.save('404', { callId: '404', status: 'failed', lastError: 'x' });
    const result = await processCompletedCall({ profile: 'PPC_EWA_BEACH', callId: '404', contactId: 'c1', opportunityId: 'o1', phone: '+1', property: '123', recordingUrl: 'https://recording.example' }, { store, fetcher: {}, provider: {}, justcall: {} });
    assert.strictEqual(result.status, 'failed');
  });

  await test('14 reviewCall returns saved job', () => {
    const store = new CallJobStore({ dir: tempDir() });
    store.save('777', { callId: '777', status: 'pending' });
    assert.strictEqual(reviewCall('777', { store }).callId, '777');
  });

  await test('15 processing succeeds with provider transcript', async () => {
    const dir = tempDir();
    const store = new CallJobStore({ dir: path.join(dir, 'jobs') });
    const fetcher = { fetch: async () => ({ filePath: path.join(dir, 'audio.wav'), mimeType: 'audio/x-wav' }), probe: () => ({ decodable: true, durationSeconds: 29.3 }), cleanup: () => {}, cleanupExpired: () => [] };
    fs.writeFileSync(path.join(dir, 'audio.wav'), 'audio');
    const provider = { transcribe: async () => ({ status: 'failed', reason: 'unused' }) };
    const justcall = { pollCallTranscript: async () => ({ state: 'PROVIDER_TRANSCRIPT_AVAILABLE', segments: [{ sentence: 'The property is vacant and I want two twenty-five for it. Call me Friday after 3 and I will talk to my wife.' }] }) };
    const result = await processCompletedCall({ profile: 'PPC_EWA_BEACH', callId: '405', contactId: 'c1', opportunityId: 'o1', phone: '+15718140891', property: '123 Main', recordingUrl: 'https://recording.example', stageName: 'Called Once, No Answer' }, { store, fetcher, provider, justcall, highLevelTranscript: null });
    assert.strictEqual(result.status, 'complete');
    assert.strictEqual(result.facts.occupancy.value, 'vacant');
    assert.ok(result.questions.length > 0);
    assert.ok(result.commitments.length > 0);
  });

  await test('16 transcript text is stored but no audio persists', async () => {
    const dir = tempDir();
    const store = new CallJobStore({ dir: path.join(dir, 'jobs') });
    const audioPath = path.join(dir, 'audio.wav');
    fs.writeFileSync(audioPath, 'audio');
    const fetcher = { fetch: async () => ({ filePath: audioPath, mimeType: 'audio/x-wav' }), probe: () => ({ decodable: true, durationSeconds: 29.3 }), cleanup: (file) => fs.rmSync(file, { force: true }), cleanupExpired: () => [] };
    const provider = { transcribe: async () => ({ status: 'ready', provider: 'openai', model: 'gpt-4o-mini-transcribe', text: 'Call me Friday after 3.', segments: [], speakers: [], speakerMode: 'none', durationSeconds: 29.3, processedAt: new Date().toISOString() }) };
    const justcall = { pollCallTranscript: async () => ({ state: 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE' }) };
    const result = await processCompletedCall({ profile: 'PPC_EWA_BEACH', callId: '406', contactId: 'c1', opportunityId: 'o1', phone: '+15718140891', property: '123 Main', recordingUrl: 'https://recording.example', stageName: 'Called Once, No Answer' }, { store, fetcher, provider, justcall });
    assert.strictEqual(result.status, 'complete');
    assert.strictEqual(fs.existsSync(audioPath), false);
  });

  await test('17 low confidence price remains needs confirmation', () => {
    const facts = extractFacts({ text: 'I owe one fifty and I am open to creative terms.' });
    assert.strictEqual(facts.mortgageBalance.status, 'NEEDS_CONFIRMATION');
    assert.strictEqual(facts.creativeFinanceInterest.value, true);
  });

  await test('18 missing critical fields keep readiness partial', () => {
    const result = recommend({ dnc: false, wrongNumber: false }, {}, { missingCritical: ['motivation'], missingBeforeOffer: [], missingImportant: [], needsConfirmation: [], conflicts: [] });
    assert.strictEqual(result.state, 'NEEDS_MORE_INFO');
  });

  await test('19 extraction captures market status and decision maker', () => {
    const facts = extractFacts({ text: 'It is listed with an agent and my spouse needs to approve the sale.' });
    assert.ok(facts.marketStatus.value.includes('listed_with_agent'));
    assert.ok(facts.decisionMakers.value.includes('spouse'));
  });

  await test('20 extraction captures property attributes and condition', () => {
    const facts = extractFacts({ text: 'It is a 4 bed 2 bath rental, about 1600 square feet, and the roof and HVAC are older.' });
    assert.strictEqual(facts.bedrooms.value, 4);
    assert.strictEqual(facts.bathrooms.value, 2);
    assert.strictEqual(facts.squareFootage.value, 1600);
    assert.ok(facts.propertyCondition.value.includes('roof mentioned'));
  });

  await test('21 missing info separates before-offer and important gaps', () => {
    const missing = computeMissing({ qualification: { motivation: { status: 'KNOWN' }, timeline: { status: 'KNOWN' }, askingPrice: { status: 'KNOWN' }, occupancy: { status: 'KNOWN' }, propertyCondition: { status: 'KNOWN' }, decisionMakers: { status: 'KNOWN' }, mortgageBalance: { status: 'UNKNOWN' }, marketStatus: { status: 'UNKNOWN' }, callback: { status: 'UNKNOWN' } } });
    assert.ok(missing.missingBeforeOffer.includes('mortgageBalance'));
    assert.ok(missing.missingImportant.includes('propertyType'));
  });

  await test('22 recommended questions prioritize unresolved critical facts', () => {
    const questions = buildRecommendedQuestions({ qualification: { mortgageBalance: { status: 'UNKNOWN' }, decisionMakers: { status: 'UNKNOWN' }, occupancy: { status: 'KNOWN', value: 'vacant' }, propertyCondition: { status: 'KNOWN', value: ['roof mentioned'] } } }, { stageName: 'Called Once, No Answer' });
    assert.ok(questions.some((q) => /mortgage|payoff/i.test(q)));
    assert.ok(questions.some((q) => /approve/i.test(q)));
  });

  await test('23 multi-property state remains isolated by opportunity', () => {
    const first = mergeQualification({}, { askingPrice: { status: 'KNOWN', value: 200000 }, occupancy: { status: 'KNOWN', value: 'vacant' }, timeline: { status: 'UNKNOWN', value: null }, mortgageBalance: { status: 'UNKNOWN', value: null }, propertyCondition: { status: 'UNKNOWN', value: [] }, motivation: { status: 'UNKNOWN', value: [] }, decisionMakers: { status: 'UNKNOWN', value: [] }, creativeFinanceInterest: { status: 'UNKNOWN', value: null }, promises: [] }, { callId: '1', opportunityId: 'prop-1', propertyId: 'prop-1' });
    const second = mergeQualification({}, { askingPrice: { status: 'KNOWN', value: 325000 }, occupancy: { status: 'KNOWN', value: 'tenant_occupied' }, timeline: { status: 'UNKNOWN', value: null }, mortgageBalance: { status: 'UNKNOWN', value: null }, propertyCondition: { status: 'UNKNOWN', value: [] }, motivation: { status: 'UNKNOWN', value: [] }, decisionMakers: { status: 'UNKNOWN', value: [] }, creativeFinanceInterest: { status: 'UNKNOWN', value: null }, promises: [] }, { callId: '2', opportunityId: 'prop-2', propertyId: 'prop-2' });
    assert.strictEqual(first.qualification.askingPrice.value, 200000);
    assert.strictEqual(second.qualification.askingPrice.value, 325000);
    assert.strictEqual(first.qualification.occupancy.value, 'vacant');
    assert.strictEqual(second.qualification.occupancy.value, 'tenant_occupied');
  });

  await test('24 recommendation returns callback state when requested', () => {
    const result = recommend({ dnc: false, wrongNumber: false, callbackRequested: true, preferredCallbackTime: 'friday after 3' }, {}, { missingCritical: [], missingBeforeOffer: [], missingImportant: [], needsConfirmation: [], conflicts: [] });
    assert.strictEqual(result.state, 'CALLBACK_SCHEDULED');
  });

  await test('25 recommendation returns data conflict state', () => {
    const result = recommend({ dnc: false, wrongNumber: false }, {}, { missingCritical: [], missingBeforeOffer: [], missingImportant: [], needsConfirmation: ['occupancy'], conflicts: ['occupancy'] });
    assert.strictEqual(result.state, 'DATA_CONFLICT');
  });

  await test('26 qualification merge tracks commitments', () => {
    const state = mergeQualification({}, { askingPrice: { status: 'UNKNOWN', value: null }, timeline: { status: 'UNKNOWN', value: null }, occupancy: { status: 'UNKNOWN', value: null }, mortgageBalance: { status: 'UNKNOWN', value: null }, propertyCondition: { status: 'UNKNOWN', value: [] }, motivation: { status: 'UNKNOWN', value: [] }, decisionMakers: { status: 'UNKNOWN', value: [] }, creativeFinanceInterest: { status: 'UNKNOWN', value: null }, promises: [{ party: 'seller', type: 'send_photos', description: 'Seller said they would send photos' }] }, { callId: '26', opportunityId: 'opp-26', propertyId: 'prop-26' });
    assert.strictEqual(state.qualification.commitments.length, 1);
  });

  await test('27 transcript source prefers HighLevel transcript link', () => {
    const resolved = resolveCallTranscriptSource({ highLevelTranscript: { status: 'ready', text: 'Transcript from link' }, providerTranscript: { state: 'PROVIDER_TRANSCRIPT_AVAILABLE' }, recordingStt: { status: 'ready', text: 'fallback' } });
    assert.strictEqual(resolved.source, 'HIGHLEVEL_TRANSCRIPT_LINK');
  });

  await test('28 transcript source falls back to provider transcript', () => {
    const resolved = resolveCallTranscriptSource({ providerTranscript: { state: 'PROVIDER_TRANSCRIPT_AVAILABLE' }, providerTranscriptResult: { status: 'ready', text: 'provider' }, recordingStt: { status: 'ready', text: 'fallback' } });
    assert.strictEqual(resolved.source, 'JUSTCALL_PROVIDER_TRANSCRIPT');
  });

  await test('29 transcript source falls back to recording STT', () => {
    const resolved = resolveCallTranscriptSource({ providerTranscript: { state: 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE' }, recordingStt: { status: 'ready', text: 'fallback' } });
    assert.strictEqual(resolved.source, 'RECORDING_STT');
  });

  await test('30 transcript source can be unavailable', () => {
    const resolved = resolveCallTranscriptSource({ providerTranscript: { state: 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE' }, recordingStt: { status: 'failed' } });
    assert.strictEqual(resolved.source, 'UNAVAILABLE');
  });

  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed}/${passed + failed} tests passed`);
  if (failed > 0) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
