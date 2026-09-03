'use strict';

// ppc-sales-dialer-transcript.cjs — Sales Dialer call transcript → GHL note
//
// Backfills Montelli's existing Sales Dialer calls into GHL notes and provides
// the live-path ingestion used by the sd.* webhook handlers.
//
// BOUNDARIES (locked):
//   - TRANSCRIPT → NOTE → CONTEXT REFRESH only.
//   - NEVER moves a GHL stage. NEVER changes assignment.
//   - Idempotent: one GHL note per (call_id, opportunity_id), enforced by the
//     ppc_sales_dialer_note_ingestion ledger + a GHL note-body marker check.
//   - No-answer / voicemail / failed calls are recorded but never get a
//     fabricated transcript note.
//
// Verified JustCall API surface (2026-09-03):
//   - GET /v2.1/sales_dialer/calls?agent_id=508588&per_page=100&page=N
//   - GET /v2.1/sales_dialer/calls/{id}
//   - GET /v2.1/calls_ai/{id}?platform=sales_dialer&fetch_transcription=true&...
//     (the `platform=sales_dialer` param is REQUIRED; without it the endpoint 404s)

require('dotenv').config();
const https = require('https');
const { neon } = require('@neondatabase/serverless');

const MONTELLI_AGENT_ID = '508588';
const PPC_LOCATION_ID = 'GDq92uruRngbi9mLGGrV';
const PPC_PIPELINE_ID = 'ril84XHGQleRgE0W0FKU';

const NOTE_MARKER = 'JUSTCALL SALES DIALER CALL — MONTELLI';

// Internal/business numbers (never seller phones). Inlined so this module is
// self-contained and deployable to Render (no cross-repo absolute path).
const INTERNAL_PHONE_NUMBERS = new Set([
  '15716012619', // Divinity Aligned JustCall outbound sender
  '16235263525', // automated lead-source number
  '15717126848', // Sales Dialer number
]);

function isInternalNumber(raw) {
  const d = digits(raw);
  if (!d) return false;
  const last10 = d.slice(-10);
  for (const internal of INTERNAL_PHONE_NUMBERS) {
    if (d === internal || last10 === internal.slice(-10)) return true;
  }
  return false;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function jcGet(path) {
  const K = process.env.JUSTCALL_API_KEY;
  const S = process.env.JUSTCALL_API_SECRET;
  return new Promise((resolve) => {
    const q = https.get('https://api.justcall.io/v2.1' + path, {
      headers: { 'Authorization': `${K}:${S}`, 'Accept': 'application/json' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, data: {} }); } });
    });
    q.on('error', (e) => resolve({ status: 0, data: { error: e.message } }));
    q.setTimeout(25000, () => { q.destroy(); resolve({ status: 0, data: { error: 'timeout' } }); });
  });
}

function ghlRequest(method, path, body) {
  const T = process.env.GHL_API_TOKEN || process.env.PPC_GHL_API_KEY || process.env.GHL_API_KEY;
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'services.leadconnectorhq.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + T,
        'Version': '2021-07-28',
        'Accept': 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, data: {} }); } });
    });
    req.on('error', (e) => resolve({ status: 0, data: { error: e.message } }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, data: { error: 'timeout' } }); });
    if (data) req.write(data);
    req.end();
  });
}

function digits(raw) { return String(raw || '').replace(/\D/g, ''); }

// ── DB ───────────────────────────────────────────────────────────────────────
function getDb() {
  return neon(process.env.PPC_AUTOMATION_DATABASE_URL || process.env.DATABASE_URL);
}

// ── Classification ───────────────────────────────────────────────────────────
// Returns one of the canonical classification codes.
function classifyCall(call) {
  const info = call.call_info || {};
  const type = String(info.type || '').toLowerCase();
  const answeredBy = String(info.call_answered_by || '').toLowerCase();
  const num = digits(call.contact_number || '');

  // Internal / test contacts.
  if (isInternalNumber(num)) return 'TEST_INTERNAL';
  if (/test|canary|synthetic/i.test(call.contact_name || '')) return 'TEST_INTERNAL';

  const answered = type === 'connected' && answeredBy.includes('human');
  if (answered) return 'ANSWERED';
  // Connected but not human → voicemail / answering machine. "Unclassified
  // Pickup" and "Machine Pickup" both land here (verified: their transcripts
  // are "leave your message" / "mailbox is full").
  if (type === 'connected') return 'VOICEMAIL';
  if (info.vmdrop) return 'VOICEMAIL';
  if (/unanswered|not connected|no status/.test(type)) return 'NO_ANSWER';
  if (/failed|blocked|restricted|cancelled|abandoned/.test(type)) return 'FAILED';
  return 'NO_ANSWER';
}

// ── Match to GHL opportunity ────────────────────────────────────────────────
// Resolve phone → contact → PPC opportunity. Returns { status, contact, opportunity }.
async function matchToOpportunity(phoneDigits) {
  if (!phoneDigits) return { status: 'UNMATCHED' };
  const cRes = await ghlRequest('GET', `/contacts/?locationId=${PPC_LOCATION_ID}&query=${encodeURIComponent(phoneDigits)}`);
  const contacts = cRes.data?.contacts || [];
  const contact = contacts.find((c) => digits(c.phone) === phoneDigits) || contacts[0] || null;
  if (!contact) return { status: 'UNMATCHED' };
  const oRes = await ghlRequest('GET', `/opportunities/search?location_id=${PPC_LOCATION_ID}&pipeline_id=${PPC_PIPELINE_ID}&contact_id=${contact.id}&limit=20`);
  const opps = (oRes.data?.opportunities || []).filter((o) => o.pipelineId === PPC_PIPELINE_ID || o.pipelineStageId);
  if (opps.length === 0) return { status: 'UNMATCHED', contact };
  if (opps.length === 1) return { status: 'MATCHED', contact, opportunity: opps[0] };
  return { status: 'AMBIGUOUS_NEEDS_REVIEW', contact, opportunities: opps };
}

// ── Transcript fetch ─────────────────────────────────────────────────────────
async function fetchTranscript(callId) {
  const res = await jcGet(`/calls_ai/${encodeURIComponent(callId)}?platform=sales_dialer&fetch_transcription=true&fetch_summary=false&fetch_ai_insights=false&fetch_action_items=false&fetch_smart_chapters=false`);
  if (res.status !== 200) {
    return { status: 'TRANSCRIPT_UNAVAILABLE', http_status: res.status, error: res.data?.message || null };
  }
  const data = res.data?.data || res.data || {};
  const segments = data.call_transcription || [];
  if (segments.length === 0) {
    return { status: 'TRANSCRIPT_PENDING', segment_count: 0 };
  }
  const transcript = segments.map((seg) => {
    const speaker = seg.speaker_name || seg.speaker_id || 'Speaker';
    const text = seg.sentence || seg.text || '';
    const start = seg.timestamp?.starttime ?? seg.start_time ?? '';
    return `[${start}s] ${speaker}: ${text}`;
  }).join('\n');
  return { status: 'TRANSCRIPT_READY', transcript, segments, call_summary: data.call_summary || '' };
}

// ── Wrong-number / refusal detection from transcript ────────────────────────
// A real human conversation that is actually a wrong number (or an explicit
// refusal) must NOT produce a "qualified" note against the matched opportunity.
// Returns a reason string or null.
function detectNonQualifying(transcriptText) {
  const t = String(transcriptText || '').toLowerCase();
  if (/wrong number|not the owner|not my property|don'?t own|hasn'?t had this number|flag (?:you|this) as (?:the )?wrong number/i.test(t)) {
    return 'WRONG_NUMBER';
  }
  if (/not interested|don'?t call|stop calling|take me off|do not contact/i.test(t)) {
    return 'REFUSAL';
  }
  return null;
}

// ── Structured summary (derived ONLY from transcript + metadata) ────────────
// Conservative: each field is either a tight, snippet-scoped match or
// NOT_DISCUSSED. Never dumps raw transcript into a summary field (the verbatim
// transcript is preserved separately). Never invents facts.
function buildSummary(call, transcriptText) {
  const t = String(transcriptText || '');
  const lines = [];
  const snippet = (re) => {
    const m = t.match(re);
    return m ? m[0].replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  };
  const field = (label, re) => {
    const v = re ? snippet(re) : null;
    lines.push(`${label}: ${v || 'NOT_DISCUSSED'}`);
  };

  field('Asking price', /(?:asking|want|looking for|price|sell for)\s*\$?\s*\d[\d,.]*\s*k?/i);
  field('Motivation', /(?:need|want|must|motivated|relocat|moving|divorce|probate|estate|inherited|tired of|landlord)[^.\n]{0,80}/i);
  field('Timeline', /\b(?:asap|immediately|right away|by (?:the )?(?:end of|next|this) [a-z]+)\b[^.\n]{0,40}/i);
  field('Occupancy', /\b(?:vacant|empty|occupied|tenant|rented|owner[- ]occupied|airbnb|short term rental)\b[^.\n]{0,40}/i);
  field('Property condition', /(?:needs (?:work|repairs|renovation|updates)|fixer|as-?is|tear ?down|rehab|gut ?job|down to the studs|everything is new|brand new|newly (?:renovated|remodeled))[^.\n]{0,60}/i);
  field('Repairs/issues', /(?:roof|hvac|foundation|plumbing|electrical|gut|renovat|rehab)[^.\n]{0,80}/i);
  field('Mortgage/liens', /(?:owe|mortgage|payoff|pay off|balance|lien)\s*(?:is|of)?\s*\$?\s*\d[\d,.]*/i);
  field('Free and clear', /(?:free and clear|paid off|no mortgage|own (?:it|the house) outright|no loan)/i);
  field('Rent', /(?:rents? for|rent is|rental income|rent)\s*\$?\s*\d[\d,.]*/i);
  field('Photos', /(?:will (?:send|text|email|get)[^.\n]{0,30}(?:photo|picture|pic)|send (?:the )?(?:photo|picture|pic)s?[^.\n]{0,30})/i);
  field('Callback/follow-up', /(?:call (?:me|back|you)|give (?:me|you) a call|get back to you|let you know)[^.\n]{0,60}/i);
  return lines.join('\n');
}

// ── Note body ────────────────────────────────────────────────────────────────
function buildNoteBody(call, transcriptText, summary) {
  const info = call.call_info || {};
  const dt = `${call.call_user_date || call.call_date || ''} ${call.call_user_time || call.call_time || ''}`.trim();
  const dur = info.friendly_duration || (info.duration ? `${info.duration}s` : '');
  const parts = [
    NOTE_MARKER,
    `Date/Time: ${dt}`,
    `Call ID: ${call.call_id}`,
    `Disposition: ${info.disposition || 'N/A'}`,
    `Duration: ${dur}`,
    '',
    'CALL SUMMARY:',
    summary,
    '',
    'NEXT ACTION:',
    '(see disposition / owner workflow)',
    '',
    'TRANSCRIPT:',
    transcriptText,
  ];
  return parts.join('\n');
}

// ── Idempotency ledger ───────────────────────────────────────────────────────
async function getIngestionRecord(db, callId, opportunityId) {
  if (opportunityId) {
    const rows = await db`SELECT * FROM ppc_sales_dialer_note_ingestion WHERE call_id = ${String(callId)} AND opportunity_id = ${opportunityId} LIMIT 1`;
    return rows.length ? rows[0] : null;
  }
  const rows = await db`SELECT * FROM ppc_sales_dialer_note_ingestion WHERE call_id = ${String(callId)} AND opportunity_id IS NULL LIMIT 1`;
  return rows.length ? rows[0] : null;
}

async function upsertIngestionRecord(db, rec) {
  const existing = await getIngestionRecord(db, rec.call_id, rec.opportunity_id || null);
  if (existing) {
    await db`
      UPDATE ppc_sales_dialer_note_ingestion SET
        call_sid = ${rec.call_sid ?? existing.call_sid},
        contact_id = ${rec.contact_id ?? existing.contact_id},
        agent_id = ${rec.agent_id ?? existing.agent_id},
        campaign_id = ${rec.campaign_id ?? existing.campaign_id},
        campaign_name = ${rec.campaign_name ?? existing.campaign_name},
        contact_number = ${rec.contact_number ?? existing.contact_number},
        contact_name = ${rec.contact_name ?? existing.contact_name},
        call_date = ${rec.call_date ?? existing.call_date},
        call_time = ${rec.call_time ?? existing.call_time},
        disposition = ${rec.disposition ?? existing.disposition},
        duration_seconds = ${rec.duration_seconds ?? existing.duration_seconds},
        recording_url = ${rec.recording_url ?? existing.recording_url},
        answered = ${rec.answered ?? existing.answered},
        transcript_status = ${rec.transcript_status ?? existing.transcript_status},
        match_status = ${rec.match_status ?? existing.match_status},
        ingestion_state = ${rec.ingestion_state ?? existing.ingestion_state},
        ghl_note_id = ${rec.ghl_note_id ?? existing.ghl_note_id},
        transcript_text = ${rec.transcript_text ?? existing.transcript_text},
        summary_text = ${rec.summary_text ?? existing.summary_text},
        error = ${rec.error ?? existing.error},
        updated_at = NOW()
      WHERE id = ${existing.id}
    `;
    return existing.id;
  }
  const rows = await db`
    INSERT INTO ppc_sales_dialer_note_ingestion (
      call_id, call_sid, opportunity_id, contact_id, agent_id, campaign_id,
      campaign_name, contact_number, contact_name, call_date, call_time,
      disposition, duration_seconds, recording_url, answered, transcript_status,
      match_status, ingestion_state, ghl_note_id, transcript_text, summary_text, error
    ) VALUES (
      ${rec.call_id}, ${rec.call_sid ?? null}, ${rec.opportunity_id ?? null}, ${rec.contact_id ?? null},
      ${rec.agent_id ?? null}, ${rec.campaign_id ?? null}, ${rec.campaign_name ?? null},
      ${rec.contact_number ?? null}, ${rec.contact_name ?? null}, ${rec.call_date ?? null},
      ${rec.call_time ?? null}, ${rec.disposition ?? null}, ${rec.duration_seconds ?? null},
      ${rec.recording_url ?? null}, ${rec.answered ?? null}, ${rec.transcript_status ?? null},
      ${rec.match_status ?? null}, ${rec.ingestion_state ?? null}, ${rec.ghl_note_id ?? null},
      ${rec.transcript_text ?? null}, ${rec.summary_text ?? null}, ${rec.error ?? null}
    )
    RETURNING id
  `;
  return rows[0].id;
}

// ── Check whether a GHL note already exists for this call (defense in depth) ──
async function noteAlreadyExists(contactId, callId) {
  const res = await ghlRequest('GET', `/contacts/${contactId}/notes`);
  const notes = res.data?.notes || [];
  return notes.some((n) => {
    const body = String(n.body || n.bodyText || '');
    return body.includes(NOTE_MARKER) && body.includes(`Call ID: ${callId}`);
  });
}

// ── Ingest a single Sales Dialer call ────────────────────────────────────────
// Returns a result object. Writes a GHL note only for answered calls with a
// ready transcript and a deterministic MATCHED opportunity.
async function ingestCall(call, db) {
  const callId = String(call.call_id);
  const info = call.call_info || {};
  const classification = classifyCall(call);
  const phoneDigits = digits(call.contact_number || '');
  const answered = classification === 'ANSWERED';

  const base = {
    call_id: callId,
    call_sid: call.call_sid || null,
    agent_id: String(call.agent_id || MONTELLI_AGENT_ID),
    campaign_id: call.campaign?.id ? String(call.campaign.id) : null,
    campaign_name: call.campaign?.name || null,
    contact_number: phoneDigits || null,
    contact_name: call.contact_name || null,
    call_date: call.call_user_date || call.call_date || null,
    call_time: call.call_user_time || call.call_time || null,
    disposition: info.disposition || null,
    duration_seconds: info.duration ? parseInt(info.duration, 10) : null,
    recording_url: info.recording || null,
    answered,
  };

  // Non-answered calls: record only, no transcript note. Use a state that
  // reflects "no note needed" rather than "unmatched".
  if (!answered) {
    const state = classification === 'TEST_INTERNAL' ? 'TEST_INTERNAL' : (classification === 'VOICEMAIL' ? 'VOICEMAIL' : 'NO_ANSWER');
    await upsertIngestionRecord(db, { ...base, transcript_status: 'TRANSCRIPT_UNAVAILABLE', match_status: null, ingestion_state: state });
    return { call_id: callId, classification, note_written: false, reason: classification };
  }

  // Answered: match to opportunity.
  const match = await matchToOpportunity(phoneDigits);
  if (match.status === 'UNMATCHED') {
    await upsertIngestionRecord(db, { ...base, transcript_status: 'TRANSCRIPT_PENDING', match_status: 'UNMATCHED', ingestion_state: 'UNMATCHED' });
    return { call_id: callId, classification, note_written: false, reason: 'UNMATCHED' };
  }
  if (match.status === 'AMBIGUOUS_NEEDS_REVIEW') {
    await upsertIngestionRecord(db, { ...base, contact_id: match.contact?.id || null, transcript_status: 'TRANSCRIPT_PENDING', match_status: 'AMBIGUOUS_NEEDS_REVIEW', ingestion_state: 'AMBIGUOUS' });
    return { call_id: callId, classification, note_written: false, reason: 'AMBIGUOUS_NEEDS_REVIEW' };
  }

  const opportunity = match.opportunity;
  const contact = match.contact;

  // Idempotency: already noted?
  const existing = await getIngestionRecord(db, callId, opportunity.id);
  if (existing && existing.ingestion_state === 'NOTE_WRITTEN') {
    return { call_id: callId, classification, note_written: false, reason: 'ALREADY_NOTED', ghl_note_id: existing.ghl_note_id };
  }

  // Fetch transcript.
  const t = await fetchTranscript(callId);
  if (t.status === 'TRANSCRIPT_UNAVAILABLE') {
    await upsertIngestionRecord(db, { ...base, contact_id: contact.id, opportunity_id: opportunity.id, transcript_status: 'TRANSCRIPT_UNAVAILABLE', match_status: 'MATCHED', ingestion_state: 'FAILED_RETRYABLE', error: t.error || `HTTP ${t.http_status}` });
    return { call_id: callId, classification, note_written: false, reason: 'TRANSCRIPT_UNAVAILABLE' };
  }
  if (t.status === 'TRANSCRIPT_PENDING') {
    await upsertIngestionRecord(db, { ...base, contact_id: contact.id, opportunity_id: opportunity.id, transcript_status: 'TRANSCRIPT_PENDING', match_status: 'MATCHED', ingestion_state: 'PENDING_TRANSCRIPT' });
    return { call_id: callId, classification, note_written: false, reason: 'TRANSCRIPT_PENDING' };
  }

  // Wrong-number / refusal: record the outcome, do NOT write a qualified note.
  const nonQual = detectNonQualifying(t.transcript);
  if (nonQual) {
    await upsertIngestionRecord(db, { ...base, contact_id: contact.id, opportunity_id: opportunity.id, transcript_status: 'TRANSCRIPT_READY', match_status: 'MATCHED', ingestion_state: nonQual, transcript_text: t.transcript, summary_text: nonQual, error: nonQual });
    return { call_id: callId, classification, note_written: false, reason: nonQual };
  }

  // Defense-in-depth: check GHL notes for an existing marker.
  const already = await noteAlreadyExists(contact.id, callId);
  if (already) {
    await upsertIngestionRecord(db, { ...base, contact_id: contact.id, opportunity_id: opportunity.id, transcript_status: 'TRANSCRIPT_READY', match_status: 'MATCHED', ingestion_state: 'NOTE_WRITTEN', transcript_text: t.transcript, summary_text: buildSummary(call, t.transcript) });
    return { call_id: callId, classification, note_written: false, reason: 'ALREADY_NOTED' };
  }

  // Build + write note.
  const summary = buildSummary(call, t.transcript);
  const noteBody = buildNoteBody(call, t.transcript, summary);
  const noteRes = await ghlRequest('POST', `/contacts/${contact.id}/notes`, { body: noteBody });
  if (noteRes.status < 200 || noteRes.status >= 300) {
    await upsertIngestionRecord(db, { ...base, contact_id: contact.id, opportunity_id: opportunity.id, transcript_status: 'TRANSCRIPT_READY', match_status: 'MATCHED', ingestion_state: 'FAILED_RETRYABLE', transcript_text: t.transcript, summary_text: summary, error: `GHL note write HTTP ${noteRes.status}` });
    return { call_id: callId, classification, note_written: false, reason: 'NOTE_WRITE_FAILED', http_status: noteRes.status };
  }
  const noteId = noteRes.data?.note?.id || noteRes.data?.id || null;
  await upsertIngestionRecord(db, { ...base, contact_id: contact.id, opportunity_id: opportunity.id, transcript_status: 'TRANSCRIPT_READY', match_status: 'MATCHED', ingestion_state: 'NOTE_WRITTEN', ghl_note_id: noteId, transcript_text: t.transcript, summary_text: summary });

  return { call_id: callId, classification, note_written: true, ghl_note_id: noteId, opportunity_id: opportunity.id, contact_id: contact.id };
}

// ── Fetch all Montelli Sales Dialer calls (paginated) ────────────────────────
async function fetchAllMontelliCalls() {
  const all = [];
  let page = 0;
  const MAX_PAGES = 50;
  while (page < MAX_PAGES) {
    const res = await jcGet(`/sales_dialer/calls?agent_id=${MONTELLI_AGENT_ID}&per_page=100&page=${page}`);
    if (res.status !== 200 || !Array.isArray(res.data?.data)) break;
    const batch = res.data.data;
    all.push(...batch);
    if (batch.length === 0) break;
    if (!res.data.next_page_link) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }
  return all;
}

// ── Live-path helper: fetch a single call by id and ingest it ───────────────
async function ingestCallById(callId) {
  const db = getDb();
  const res = await jcGet(`/sales_dialer/calls/${encodeURIComponent(callId)}`);
  if (res.status !== 200 || !res.data?.data) {
    return { call_id: String(callId), note_written: false, reason: 'CALL_FETCH_FAILED', http_status: res.status };
  }
  return ingestCall(res.data.data, db);
}

// ── Backfill entrypoint ──────────────────────────────────────────────────────
async function backfill() {
  const db = getDb();
  const calls = await fetchAllMontelliCalls();
  const results = [];
  for (const call of calls) {
    const r = await ingestCall(call, db);
    results.push(r);
    await new Promise((res) => setTimeout(res, 150));
  }
  return { total_scanned: calls.length, results };
}

module.exports = {
  MONTELLI_AGENT_ID,
  PPC_LOCATION_ID,
  PPC_PIPELINE_ID,
  NOTE_MARKER,
  classifyCall,
  matchToOpportunity,
  fetchTranscript,
  buildSummary,
  buildNoteBody,
  ingestCall,
  ingestCallById,
  fetchAllMontelliCalls,
  backfill,
  getDb,
};

// CLI: node ppc-sales-dialer-transcript.cjs [--dry-run]
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  (async () => {
    const db = getDb();
    const calls = await fetchAllMontelliCalls();
    console.log('=== PPC Sales Dialer Transcript → GHL Notes ===');
    console.log('Montelli calls scanned:', calls.length, dryRun ? '(DRY RUN — no writes)' : '');
    const results = [];
    for (const call of calls) {
      if (dryRun) {
        const info = call.call_info || {};
        const cls = classifyCall(call);
        const phoneDigits = digits(call.contact_number || '');
        const match = cls === 'ANSWERED' ? await matchToOpportunity(phoneDigits) : { status: 'n/a' };
        const t = cls === 'ANSWERED' && match.status === 'MATCHED' ? await fetchTranscript(call.call_id) : { status: 'n/a' };
        results.push({ call_id: call.call_id, name: call.contact_name, cls, match: match.status, transcript: t.status });
        console.log(`  call ${call.call_id} | ${call.contact_name} | ${cls} | match=${match.status} | transcript=${t.status}`);
      } else {
        const r = await ingestCall(call, db);
        results.push(r);
        console.log(`  call ${r.call_id} | ${r.classification} | ${r.note_written ? 'NOTE_WRITTEN' : r.reason}`);
      }
      await new Promise((res) => setTimeout(res, 150));
    }
    console.log('=== DONE ===');
    console.log(JSON.stringify(results, null, 2));
  })();
}
