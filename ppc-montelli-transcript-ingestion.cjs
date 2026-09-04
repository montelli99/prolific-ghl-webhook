'use strict';

const crypto = require('crypto');
const https = require('https');
const { neon } = require('@neondatabase/serverless');

const MONTELLI_AGENT_ID = '508588';
const PPC_LOCATION_ID = 'GDq92uruRngbi9mLGGrV';
const PPC_PIPELINE_ID = 'ril84XHGQleRgE0W0FKU';
const TABLE = 'ppc_montelli_transcript_ingestions';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function transcriptText(value) {
  if (!Array.isArray(value)) return String(value || '').trim();
  return value.map((segment) => {
    const start = segment.timestamp?.starttime ?? segment.start_time ?? '';
    const speaker = segment.speaker_name || segment.speaker || segment.speaker_id || 'Speaker';
    const text = segment.sentence || segment.text || segment.message || '';
    return `[${start}s] ${speaker}: ${text}`;
  }).join('\n').trim();
}

function normalizeAiWebhook(payload) {
  const type = payload?.type || payload?.event;
  if (type !== 'jc.call_ai_generated' && type !== 'sd.call_ai_generated') return null;
  const data = payload.data || {};
  const callId = String(data.call_id || data.id || '').trim();
  const transcript = transcriptText(data.call_transcription || data.transcription);
  return {
    event_type: type,
    event_id: String(payload.request_id || payload.event_id || `${type}:${callId}`),
    call_id: callId,
    call_family: type === 'sd.call_ai_generated' ? 'SALES_DIALER' : 'REGULAR',
    agent_id: String(data.agent_id || data.agent?.id || ''),
    phone: digits(data.contact_number || data.phone || data.to_number || data.from_number || data.call_info?.contact_number || data.contact?.phone),
    call_at: data.created_at || data.call_datetime || data.call_at || null,
    call_direction: data.call_info?.direction || data.direction || null,
    transcript,
    summary: String(data.call_summary || data.summary || '').trim() || null,
    received_at: new Date().toISOString(),
    payload_hash: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}

function requestGhl(method, path, body) {
  const token = process.env.PPC_GHL_API_KEY || process.env.GHL_API_TOKEN || process.env.GHL_API_KEY;
  return new Promise((resolve) => {
    const encoded = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'services.leadconnectorhq.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
        ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = JSON.parse(raw); } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
      });
    });
    req.on('error', (error) => resolve({ ok: false, status: 0, data: { error: error.message } }));
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (encoded) req.write(encoded);
    req.end();
  });
}

async function resolveExactPpcOpportunity(phone, ghlRequest = requestGhl) {
  const contactsResponse = await ghlRequest('GET', `/contacts/?locationId=${PPC_LOCATION_ID}&query=${encodeURIComponent(phone)}`);
  if (!contactsResponse.ok) return { status: 'GHL_CONTACT_READ_FAILED' };
  const exactContacts = (contactsResponse.data?.contacts || []).filter((contact) => digits(contact.phone) === phone);
  if (exactContacts.length !== 1) return { status: exactContacts.length ? 'AMBIGUOUS_CONTACT' : 'CONTACT_NOT_FOUND' };
  const contact = exactContacts[0];
  const opportunitiesResponse = await ghlRequest('GET', `/opportunities/search?location_id=${PPC_LOCATION_ID}&contact_id=${contact.id}&limit=100`);
  if (!opportunitiesResponse.ok) return { status: 'GHL_OPPORTUNITY_READ_FAILED' };
  const opportunities = (opportunitiesResponse.data?.opportunities || []).filter((opportunity) => opportunity.pipelineId === PPC_PIPELINE_ID);
  if (opportunities.length !== 1) return { status: opportunities.length ? 'AMBIGUOUS_PROPERTY' : 'PPC_OPPORTUNITY_NOT_FOUND', contact };
  return { status: 'MATCHED', contact, opportunity: opportunities[0] };
}

function createNeonStore() {
  const db = neon(process.env.PPC_AUTOMATION_DATABASE_URL || process.env.DATABASE_URL);
  return {
    async persist(evidence, match) {
      await db`CREATE TABLE IF NOT EXISTS ppc_montelli_transcript_ingestions (
        id BIGSERIAL PRIMARY KEY, idempotency_key TEXT NOT NULL, call_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL, contact_id TEXT NOT NULL, call_family TEXT NOT NULL,
        sales_platform TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'TRANSCRIPT_READY', attempts INTEGER NOT NULL DEFAULT 0,
        retry_at TIMESTAMPTZ, last_error TEXT, processed_at TIMESTAMPTZ, call_at TIMESTAMPTZ,
        call_phone TEXT, call_direction TEXT, call_agent TEXT, transcript TEXT, transcript_fetched_at TIMESTAMPTZ,
        summary TEXT, evidence_source TEXT, webhook_event_id TEXT, webhook_received_at TIMESTAMPTZ,
        webhook_payload_hash TEXT, provider_verified BOOLEAN NOT NULL DEFAULT FALSE,
        ghl_note_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await db`ALTER TABLE ppc_montelli_transcript_ingestions ADD COLUMN IF NOT EXISTS summary TEXT`;
      await db`ALTER TABLE ppc_montelli_transcript_ingestions ADD COLUMN IF NOT EXISTS evidence_source TEXT`;
      await db`ALTER TABLE ppc_montelli_transcript_ingestions ADD COLUMN IF NOT EXISTS webhook_event_id TEXT`;
      await db`ALTER TABLE ppc_montelli_transcript_ingestions ADD COLUMN IF NOT EXISTS webhook_received_at TIMESTAMPTZ`;
      await db`ALTER TABLE ppc_montelli_transcript_ingestions ADD COLUMN IF NOT EXISTS webhook_payload_hash TEXT`;
      await db`ALTER TABLE ppc_montelli_transcript_ingestions ADD COLUMN IF NOT EXISTS ghl_note_id TEXT`;
      await db`CREATE UNIQUE INDEX IF NOT EXISTS idx_ppc_montelli_transcript_ingestions_idempotency ON ppc_montelli_transcript_ingestions (idempotency_key)`;
      const key = `${evidence.call_id}:${match.opportunity.id}`;
      await db`INSERT INTO ppc_montelli_transcript_ingestions (
        idempotency_key, call_id, opportunity_id, contact_id, call_family, sales_platform, status,
        call_at, call_phone, call_direction, call_agent, transcript, transcript_fetched_at, summary,
        evidence_source, webhook_event_id, webhook_received_at, webhook_payload_hash, provider_verified
      ) VALUES (
        ${key}, ${evidence.call_id}, ${match.opportunity.id}, ${match.contact.id}, ${evidence.call_family}, 'JUSTCALL', 'TRANSCRIPT_READY',
        ${evidence.call_at}, ${evidence.phone}, ${evidence.call_direction}, ${evidence.agent_id}, ${evidence.transcript},
        ${evidence.received_at}, ${evidence.summary}, 'WEBHOOK', ${evidence.event_id}, ${evidence.received_at}, ${evidence.payload_hash}, TRUE
      ) ON CONFLICT (idempotency_key) DO NOTHING`;
      const rows = await db`SELECT * FROM ppc_montelli_transcript_ingestions WHERE idempotency_key = ${key} LIMIT 1`;
      return rows[0];
    },
    async claim(id) {
      const rows = await db`UPDATE ppc_montelli_transcript_ingestions SET status = 'PROCESSING', attempts = attempts + 1, updated_at = NOW()
        WHERE id = ${id} AND status IN ('TRANSCRIPT_READY', 'PENDING', 'RETRY_PENDING') RETURNING *`;
      return rows[0] || null;
    },
    async complete(id, noteId) {
      await db`UPDATE ppc_montelli_transcript_ingestions SET status = 'COMPLETED', ghl_note_id = ${noteId}, processed_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = ${id}`;
    },
    async fail(id, error) {
      await db`UPDATE ppc_montelli_transcript_ingestions SET status = 'RETRY_PENDING', retry_at = NOW() + INTERVAL '1 minute', last_error = ${error}, updated_at = NOW() WHERE id = ${id}`;
    },
  };
}

function buildNote(evidence, match) {
  const marker = `[MONTELLI TRANSCRIPT call=${evidence.call_id} opportunity=${match.opportunity.id}]`;
  return {
    marker,
    body: `${marker}\n\nCall family: ${evidence.call_family}\nSales platform: JUSTCALL\nEvidence source: WEBHOOK${evidence.summary ? `\n\nSummary:\n${evidence.summary}` : ''}\n\nTranscript:\n${evidence.transcript}`,
  };
}

function createMontelliTranscriptIngestion(options = {}) {
  const ghlRequest = options.ghlRequest || requestGhl;
  const resolveOpportunity = options.resolveOpportunity || ((phone) => resolveExactPpcOpportunity(phone, ghlRequest));
  const store = options.store || createNeonStore();
  return {
    async ingestAiWebhook(payload) {
      const evidence = normalizeAiWebhook(payload);
      if (!evidence) return { status: 'IGNORED_EVENT' };
      if (evidence.agent_id !== MONTELLI_AGENT_ID) return { status: 'IGNORED_NON_MONTELLI_AGENT' };
      if (!evidence.call_id || !evidence.phone || !evidence.transcript) return { status: 'INVALID_AI_WEBHOOK_EVIDENCE' };
      const match = await resolveOpportunity(evidence.phone);
      if (match.status !== 'MATCHED') return { status: match.status };
      const row = await store.persist(evidence, match);
      if (row.status === 'COMPLETED') return { status: 'NOTE_WRITTEN', duplicate: true, note_id: row.ghl_note_id || null };
      const claimed = await store.claim(row.id);
      if (!claimed) return { status: 'TRANSCRIPT_READY', duplicate: true };
      const currentOpportunity = await ghlRequest('GET', `/opportunities/${match.opportunity.id}`);
      const opportunity = currentOpportunity.data?.opportunity || currentOpportunity.data;
      if (!currentOpportunity.ok || opportunity.contactId !== match.contact.id || opportunity.pipelineId !== PPC_PIPELINE_ID) {
        await store.fail(row.id, 'GHL_OPPORTUNITY_CONTACT_OR_PIPELINE_MISMATCH');
        return { status: 'GHL_OPPORTUNITY_CONTACT_OR_PIPELINE_MISMATCH' };
      }
      const note = buildNote(evidence, match);
      const notesResponse = await ghlRequest('GET', `/contacts/${match.contact.id}/notes`);
      if (!notesResponse.ok) {
        await store.fail(row.id, `GHL_NOTE_READ_FAILED_HTTP_${notesResponse.status}`);
        return { status: 'GHL_NOTE_READ_FAILED' };
      }
      const existing = (notesResponse.data?.notes || []).find((item) => String(item.body || item.note || '').includes(note.marker));
      if (existing) {
        await store.complete(row.id, existing.id || null);
        return { status: 'NOTE_WRITTEN', duplicate: true, note_id: existing.id || null };
      }
      const created = await ghlRequest('POST', `/contacts/${match.contact.id}/notes`, { body: note.body });
      if (!created.ok) {
        await store.fail(row.id, `GHL_NOTE_WRITE_FAILED_HTTP_${created.status}`);
        return { status: 'GHL_NOTE_WRITE_FAILED' };
      }
      const noteId = created.data?.note?.id || created.data?.id || null;
      await store.complete(row.id, noteId);
      return { status: 'NOTE_WRITTEN', duplicate: false, note_id: noteId, opportunity_id: match.opportunity.id };
    },
  };
}

module.exports = {
  MONTELLI_AGENT_ID,
  PPC_LOCATION_ID,
  PPC_PIPELINE_ID,
  TABLE,
  digits,
  transcriptText,
  normalizeAiWebhook,
  resolveExactPpcOpportunity,
  buildNote,
  createMontelliTranscriptIngestion,
};
