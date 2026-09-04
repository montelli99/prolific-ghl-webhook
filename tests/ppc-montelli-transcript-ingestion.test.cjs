'use strict';

const assert = require('assert');
const test = require('node:test');
const { createMontelliTranscriptIngestion, normalizeAiWebhook } = require('../ppc-montelli-transcript-ingestion.cjs');

function fixture(type, id) {
  return {
    type,
    request_id: `event-${id}`,
    data: {
      id,
      agent_id: 508588,
      contact_number: '+1 (571) 555-0100',
      created_at: '2026-09-04T18:00:00Z',
      call_summary: 'Seller discussed the property.',
      call_transcription: [{ speaker_name: 'Seller', sentence: 'I own the property.', timestamp: { starttime: 1 } }],
    },
  };
}

function harness() {
  const rows = new Map();
  const notes = [];
  const store = {
    async persist(evidence) {
      let row = rows.get(evidence.call_id);
      if (!row) {
        row = { id: rows.size + 1, status: 'TRANSCRIPT_READY', evidence };
        rows.set(evidence.call_id, row);
      }
      return row;
    },
    async claim(id) {
      const row = [...rows.values()].find((item) => item.id === id);
      if (!row || row.status !== 'TRANSCRIPT_READY') return null;
      row.status = 'PROCESSING';
      return row;
    },
    async complete(id, noteId) {
      const row = [...rows.values()].find((item) => item.id === id);
      row.status = 'COMPLETED';
      row.ghl_note_id = noteId;
    },
    async fail() {},
  };
  const ghlRequest = async (method, path, body) => {
    if (path.startsWith('/opportunities/')) return { ok: true, data: { opportunity: { id: 'opp-1', contactId: 'contact-1', pipelineId: 'ril84XHGQleRgE0W0FKU' } } };
    if (method === 'GET' && path.endsWith('/notes')) return { ok: true, data: { notes } };
    if (method === 'POST' && path.endsWith('/notes')) {
      notes.push({ id: `note-${notes.length + 1}`, body: body.body });
      return { ok: true, data: { note: notes.at(-1) } };
    }
    throw new Error(`Unexpected GHL request: ${method} ${path}`);
  };
  const resolveOpportunity = async () => ({ status: 'MATCHED', contact: { id: 'contact-1' }, opportunity: { id: 'opp-1' } });
  return { ingestion: createMontelliTranscriptIngestion({ store, ghlRequest, resolveOpportunity }), rows, notes };
}

for (const type of ['jc.call_ai_generated', 'sd.call_ai_generated']) {
  test(`${type} uses webhook transcript and creates one idempotent note`, async () => {
    const { ingestion, rows, notes } = harness();
    const payload = fixture(type, type.startsWith('jc.') ? 'regular-1' : 'dialer-1');
    const normalized = normalizeAiWebhook(payload);
    assert.equal(normalized.summary, 'Seller discussed the property.');
    assert.match(normalized.transcript, /I own the property/);
    assert.equal((await ingestion.ingestAiWebhook(payload)).status, 'NOTE_WRITTEN');
    assert.equal((await ingestion.ingestAiWebhook(payload)).status, 'NOTE_WRITTEN');
    assert.equal(rows.size, 1);
    assert.equal(notes.length, 1);
  });
}

test('non-Montelli AI event is ignored without writes', async () => {
  const { ingestion, rows, notes } = harness();
  const payload = fixture('jc.call_ai_generated', 'student-1');
  payload.data.agent_id = 123;
  assert.equal((await ingestion.ingestAiWebhook(payload)).status, 'IGNORED_NON_MONTELLI_AGENT');
  assert.equal(rows.size, 0);
  assert.equal(notes.length, 0);
});

test('ambiguous property fails closed', async () => {
  const { ingestion, rows, notes } = harness();
  ingestion.ingestAiWebhook = createMontelliTranscriptIngestion({
    store: { persist: async () => { throw new Error('must not persist'); } },
    resolveOpportunity: async () => ({ status: 'AMBIGUOUS_PROPERTY' }),
  }).ingestAiWebhook;
  assert.equal((await ingestion.ingestAiWebhook(fixture('jc.call_ai_generated', 'ambiguous-1'))).status, 'AMBIGUOUS_PROPERTY');
  assert.equal(rows.size, 0);
  assert.equal(notes.length, 0);
});
