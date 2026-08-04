// _test_justcall_integration.js
// Verifies justcall-integration.js against OFFICIAL JustCall v2.1 API spec
// (developer.justcall.io/reference) and the dynamic-webhook-signatures spec.

const assert = require('assert');
const { JustCallIntegration, _dedupeKey, _alreadyProcessed, JUSTCALL_API_VERSION } = require('./justcall-integration');

const JC_API_KEY = 'ea39089c40790e9dc7a080ec95e849b8fa0fa5fb';
const JC_API_SECRET = 'ea39089c40790e9dc7a080ec95e849b8fa0fa5fb';
const JC_URL = 'https://webhook.site/3bcea770-370a-4b09-8b66-426f687e08a4';
const JC_TYPE = 'call.completed';
const JC_TS = '2024-03-21 17:08:22';
const JC_EXPECTED_SIG = '56761bae5b27a784a3ddd2af828bc5def7176bc0a8650199b04c737bd39bbecf';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      return ret.then(
        () => { console.log(`  ✅ ${name}`); passed++; },
        (e) => { console.log(`  ❌ ${name}: ${e.message}`); failed++; }
      );
    }
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('JustCall Integration Tests (v2.1 API, API key/secret auth)');
console.log('====================================================\n');

test('JUSTCALL_API_VERSION === "v2.1"', () => {
  assert.strictEqual(JUSTCALL_API_VERSION, 'v2.1');
});

console.log('Signature Verification (per official JustCall spec):');

test('verifyWebhookSignature accepts valid signature', () => {
  const jc = new JustCallIntegration({
    apiKey: JC_API_KEY,
    apiSecret: JC_API_SECRET,
    webhookUrl: JC_URL,
    allowHistoricalWebhookSignatures: true,
    whitelistedEvents: [JC_TYPE, 'call.ai_report'],
  });
  const headers = {
    'x-justcall-signature': JC_EXPECTED_SIG,
    'x-justcall-signature-version': 'v1',
    'x-justcall-request-timestamp': JC_TS,
  };
  const body = { type: JC_TYPE, data: {} };
  assert.strictEqual(jc.verifyWebhookSignature(headers, body), true);
});

test('verifyWebhookSignature rejects bad signature', () => {
  const jc = new JustCallIntegration({
    apiKey: JC_API_KEY,
    apiSecret: JC_API_SECRET,
    webhookUrl: JC_URL,
    allowHistoricalWebhookSignatures: true,
    whitelistedEvents: [JC_TYPE],
  });
  const headers = {
    'x-justcall-signature': '0'.repeat(64),
    'x-justcall-signature-version': 'v1',
    'x-justcall-request-timestamp': JC_TS,
  };
  assert.strictEqual(jc.verifyWebhookSignature(headers, { type: JC_TYPE, data: {} }), false);
});

test('verifyWebhookSignature rejects missing headers', () => {
  const jc = new JustCallIntegration({
    apiKey: JC_API_KEY,
    apiSecret: JC_API_SECRET,
    webhookUrl: JC_URL,
    allowHistoricalWebhookSignatures: true,
  });
  assert.strictEqual(jc.verifyWebhookSignature({}, { type: 'x' }), false);
});

test('verifyWebhookSignature rejects mismatched type', () => {
  const jc = new JustCallIntegration({
    apiKey: JC_API_KEY,
    apiSecret: JC_API_SECRET,
    webhookUrl: JC_URL,
    whitelistedEvents: [JC_TYPE, 'call.ai_report'],
  });
  const headers = {
    'x-justcall-signature': JC_EXPECTED_SIG,
    'x-justcall-signature-version': 'v1',
    'x-justcall-request-timestamp': JC_TS,
  };
  assert.strictEqual(jc.verifyWebhookSignature(headers, { type: 'call.incoming', data: {} }), false);
});

test('verifyWebhookSignature fails closed if no apiKey', () => {
  const jc = new JustCallIntegration({ webhookUrl: JC_URL });
  assert.strictEqual(jc.verifyWebhookSignature({ 'x-justcall-signature': 'x' }, { type: 'y' }), false);
});

test('verifyWebhookSignature fails closed if no webhookUrl', () => {
  const jc = new JustCallIntegration({ apiKey: JC_API_KEY, apiSecret: JC_API_SECRET });
  assert.strictEqual(jc.verifyWebhookSignature({ 'x-justcall-signature': 'x' }, { type: 'y' }), false);
});

console.log('\nDedupe:');

test('dedupe: same id+type dedupes', () => {
  const a = _dedupeKey({ type: 'call.ai_report', data: { id: 999, call_sid: 'CA' } });
  const b = _dedupeKey({ type: 'call.ai_report', data: { id: 999, call_sid: 'CA' } });
  assert.strictEqual(a, b);
  _alreadyProcessed(a);
  assert.strictEqual(_alreadyProcessed(b), true);
});

test('dedupe: different id does not dedupe', () => {
  const a = _dedupeKey({ type: 'call.ai_report', data: { id: 1 } });
  const b = _dedupeKey({ type: 'call.ai_report', data: { id: 2 } });
  assert.notStrictEqual(a, b);
});

console.log('\nAI Coaching Handler:');

test('handleCallAiReport prepares coaching without writing GHL', async () => {
  const notes = [];
  const jc = new JustCallIntegration({
    apiKey: 'fake',
    apiSecret: 'fake',
    addNote: async (oppId, note) => { notes.push({ oppId, note }); },
    findOpportunityByCallId: async (callId) => {
      if (callId === 17863) return { opportunityId: 'opp_xyz', contactId: 'c_1', name: 'Robert' };
      return null;
    },
  });
  const payload = {
    type: 'call.ai_report',
    data: {
      id: 17863,
      call_sid: 'CA',
      contact_name: 'Robert',
      justcall_ai: {
        call_score: 93,
        manual_call_score: 94,
        customer_sentiment: 'Positive',
        call_summary: 'Customer showed interest in a 4-bed rental in Atlanta.',
        tags: ['interested'],
        call_score_parameters: {
          dead_air_time: 30, filler_word: 4, de_escalation: 5, empathy: 5,
          talk_listen_ratio: 4, greetings: 4, words_per_minute: 9,
          monologue_duration: 20, call_etiquette: 4, customer_sentiment_score: 5,
        },
        call_transcription: [
          { speaker: 'agent', text: 'Hi, this is John with Prolific.', start: 0 },
          { speaker: 'customer', text: 'Hi John, what are you offering?', start: 5 },
        ],
      },
    },
  };
  const result = await jc.handleCallAiReport(payload);
  assert.strictEqual(result.callScore, 93);
  assert.strictEqual(result.opportunityId, 'opp_xyz');
  assert.strictEqual(notes.length, 0);
  assert.ok(result.preparedNote.includes('JUSTCALL AI COACHING'));
  assert.ok(result.preparedNote.includes('Score: 93/100'));
  assert.ok(result.preparedNote.includes('Raw transcript omitted by policy'));
});

test('handleCallAiReport dedupes by (id, type)', async () => {
  const jc = new JustCallIntegration({
    apiKey: 'fake', apiSecret: 'fake',
    addNote: async () => {},
    findOpportunityByCallId: async () => null,
  });
  const payload = { type: 'call.ai_report', data: { id: 555, justcall_ai: { call_score: 50 } } };
  const r1 = await jc.handleCallAiReport(payload);
  const r2 = await jc.handleCallAiReport(payload);
  assert.ok(r1.action.includes('no matching'));
  assert.ok(r2.action.includes('duplicate'));
});

console.log('\nOutbound API (v2.1 paths):');

test('sendSMS builds correct POST /v2.1/texts/new payload', () => {
  let captured = null;
  const jc = new JustCallIntegration({ apiKey: 'fake_key', apiSecret: 'fake_secret', fromNumber: '+12707647176' });
  jc._justcallRequest = async (method, path, body) => {
    captured = { method, path, body };
    return { data: { id: 'sms_123' } };
  };
  const tm = require('./template-merge');
  const orig = tm.fillTemplate;
  tm.fillTemplate = (s) => s || '';
  return jc.sendSMS('+15551234567', 'Hi {{firstName}}', { context: { firstName: 'Bob' } }).then(() => {
    tm.fillTemplate = orig;
    assert.strictEqual(captured.method, 'POST');
    assert.strictEqual(captured.path, '/v2.1/texts/new');
    assert.strictEqual(captured.body.to, '+15551234567');
    assert.strictEqual(captured.body.from, '+12707647176');
  });
});

test('placeCall: v2.1 has no user-place-call endpoint — throws clear error', async () => {
  const jc = new JustCallIntegration({ apiKey: 'fake', apiSecret: 'fake' });
  let err = null;
  try { await jc.placeCall('+15551234567'); } catch (e) { err = e; }
  assert.ok(err, 'expected error');
  assert.ok(err.message.includes('voice-agents/calls') || err.message.includes('dialer'),
    'error should mention voice-agents or dialer: ' + err.message);
});

test('pullAndAttachCoaching uses the separate coaching client', () => {
  let fetchedPath = null;
  let noteOpp = null;
  let noteBody = null;
  const jc = new JustCallIntegration({ apiKey: 'fake', apiSecret: 'fake' });
  jc.fetchCallCoachingData = async (id) => {
    fetchedPath = id;
    return {
      call_score: 88,
      customer_sentiment: 'Neutral',
      call_summary: 'Decent call',
      call_score_parameters: { empathy: 4, talk_listen_ratio: 3 },
      call_transcription: [{ speaker: 'agent', text: 'Hello' }],
    };
  };
  jc.addNote = async (oppId, note) => { noteOpp = oppId; noteBody = note; };
  return jc.pullAndAttachCoaching(12345, 'opp_abc').then((res) => {
    assert.strictEqual(fetchedPath, 12345);
    assert.strictEqual(noteOpp, null);
    assert.strictEqual(res.score, 88);
    assert.ok(res.preparedNote.includes('JUSTCALL AI COACHING'));
    assert.ok(res.preparedNote.includes('Empathy: 4/5'));
  });
});

test('Auth header is built as raw "api_key:api_secret" per official JustCall doc', () => {
  const jc = new JustCallIntegration({ apiKey: 'a', apiSecret: 'b' });
  assert.strictEqual(jc._basicAuthHeader(), 'a:b');
});

test('isConfigured requires both apiKey and apiSecret', () => {
  assert.strictEqual(new JustCallIntegration({}).isConfigured(), false);
  assert.strictEqual(new JustCallIntegration({ apiKey: 'x' }).isConfigured(), false);
  assert.strictEqual(new JustCallIntegration({ apiSecret: 'x' }).isConfigured(), false);
  assert.strictEqual(new JustCallIntegration({ apiKey: 'x', apiSecret: 'y' }).isConfigured(), true);
});

console.log('\n---');
console.log(`Passed: ${passed}, Failed: ${failed}`);
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 200);
