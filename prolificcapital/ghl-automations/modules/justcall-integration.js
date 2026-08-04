// =============================================================
// justcall-integration.js — Atlas JustCall AI Coaching Puller
// =============================================================
// Built: 2026-06-05
// Sources of truth (JustCall official docs):
//   - developer.justcall.io/reference (gated, v2.1 API)
//   - developer.justcall.io/docs/call-events
//   - developer.justcall.io/docs/dynamic-webhook-signatures
//   - help.justcall.io/en/articles/5834119-gohighlevel-integration-with-justcall
//   - help.justcall.io/en/articles/11325561-configuring-highlevel-integration-settings-in-justcall
//
// IMPORTANT (corrected 2026-06-05 07:14 EDT):
//   The current JustCall REST API is v2.1, not v1. Base URL is
//   `https://api.justcall.io/v2.1/`. The earlier v1 endpoints return
//   404. Auth uses the raw `api_key:api_secret` value in Authorization.
//   (Verified live: GET /v2.1/users returns Montelli Scott account.)
//
// Purpose: The JustCall ↔ GHL native integration auto-syncs calls, SMS,
// voicemails, transcripts, and dispositions to the GHL CONTACT timeline.
// That is the OFFICIAL, DOCUMENTED path and is what JustCall recommends.
//
// What this module DOES add (what JustCall's native integration does not):
//   - Read-only fetch of JustCall AI data. GHL call-note writes are handled only
//     by justcall-ghl-call-note-processor after exact matching and approval.
//
// Pipeline: nSf3NXYVkt8X4PgW9aZ3 (Montelli / Atlas-Managed) — only
//
// ENV REQUIRED:
//   JUSTCALL_API_KEY         — JustCall API key (used as Basic auth username)
//   JUSTCALL_API_SECRET      — JustCall API secret (used as Basic auth password)
//   JUSTCALL_FROM_NUMBER     — outbound caller ID (e.g. +12707647176)
//
// OPTIONAL:
//   JUSTCALL_WEBHOOK_URL     — for webhook-driven delivery
//
// =============================================================

const https = require('https');
const crypto = require('crypto');
const { fillTemplate } = require('./template-merge');

const JUSTCALL_BASE = 'api.justcall.io';
const JUSTCALL_API_VERSION = 'v2.1';
const MAX_RETRIES = parseInt(process.env.JUSTCALL_MAX_RETRIES || '3', 10);
const SIGNATURE_VERSION = 'v1';
const TRANSCRIPT_CERTIFICATION_STATES = Object.freeze([
  'CALL_FOUND',
  'RECORDING_FOUND',
  'TRANSCRIPT_VISIBLE_IN_UI',
  'TRANSCRIPT_PROVIDER_API',
  'TRANSCRIPT_BROWSER_READ',
  'TRANSCRIPT_SYSTEM_GENERATED',
]);
const TRANSCRIPT_OPERATIONAL_STATES = Object.freeze([
  'PROVIDER_TRANSCRIPT_PENDING',
  'PROVIDER_TRANSCRIPT_AVAILABLE',
  'PROVIDER_TRANSCRIPT_NOT_GENERATED',
  'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE',
  'NOTE_PREVIEW_PENDING_APPROVAL',
  'NOTE_WRITTEN',
  'TRANSCRIPT_CERTIFICATION_BLOCKED',
]);

// In-memory dedupe
const _seenEventKeys = new Set();
const DEDUPE_MAX = 10000;
function _dedupeKey(payload) {
  const type = payload?.type || 'unknown';
  const id = payload?.data?.id || payload?.data?.call_sid || payload?.data?.sid || null;
  const fallback = payload?.request_id || crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
  return `${type}:${id || fallback}`;
}
function _alreadyProcessed(key) {
  if (_seenEventKeys.has(key)) return true;
  _seenEventKeys.add(key);
  if (_seenEventKeys.size > DEDUPE_MAX) {
    const arr = Array.from(_seenEventKeys);
    _seenEventKeys.clear();
    arr.slice(-DEDUPE_MAX / 2).forEach(k => _seenEventKeys.add(k));
  }
  return false;
}

// =============================================================
// JustCallIntegration CLASS
// =============================================================
class JustCallIntegration {
  /**
   * @param {object} config
   * @param {string} [config.apiKey]            — Basic auth username
   * @param {string} [config.apiSecret]         — Basic auth password
   * @param {string} [config.webhookUrl]        — registered webhook URL
   * @param {string[]} [config.whitelistedEvents]
   * @param {string} [config.fromNumber]
   * @param {function} [config.addNote]         — (oppId, note) => Promise
   * @param {function} [config.findOpportunityByCallId]
   * @param {object} [config.templateContext]
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.JUSTCALL_API_KEY || '';
    this.apiSecret = config.apiSecret || process.env.JUSTCALL_API_SECRET || '';
    this.webhookUrl = config.webhookUrl || process.env.JUSTCALL_WEBHOOK_URL || '';
    this.fromNumber = config.fromNumber || process.env.JUSTCALL_FROM_NUMBER || '';
    this.whitelistedEvents = new Set(config.whitelistedEvents || ['call.completed', 'call.updated', 'jc.call_ai_generated', 'call.ai_report']);
    this.addNote = config.addNote || (async () => {});
    this.findOpportunityByCallId = config.findOpportunityByCallId || (async () => null);
    this.templateContext = config.templateContext || {};
    this.webhookMaxAgeMs = config.webhookMaxAgeMs ?? 5 * 60 * 1000;
    this.allowHistoricalWebhookSignatures = config.allowHistoricalWebhookSignatures === true;
    this.now = config.now || (() => new Date());
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiSecret);
  }

  describe() {
    return {
      apiKeySet: Boolean(this.apiKey),
      apiSecretSet: Boolean(this.apiSecret),
      webhookUrlSet: Boolean(this.webhookUrl),
      fromNumber: this.fromNumber,
      whitelistedEvents: Array.from(this.whitelistedEvents),
      apiBase: `https://${JUSTCALL_BASE}/${JUSTCALL_API_VERSION}`,
      primaryUse: 'JustCall AI coaching → GHL opportunity timeline',
      maxRetries: MAX_RETRIES,
    };
  }

  // -------------------------------------------------------------
  // INTERNAL: Build auth header from key+secret
  //
  // Per the official JustCall auth doc (developer.justcall.io/reference/authentication):
  //   "Authorization: api_key:api_secret"
  // It's a RAW colon-joined string, NOT Basic-base64 (the Stitchflow
  // article was wrong). Verified live 2026-06-05 with the saved key
  // against the v2.1 API.
  // -------------------------------------------------------------
  _basicAuthHeader() {
    return `${this.apiKey}:${this.apiSecret}`;
  }

  // -------------------------------------------------------------
  // WEBHOOK SIGNATURE (per JustCall dynamic-signature spec v1)
  // -------------------------------------------------------------
  /**
   * Verify a JustCall webhook signature.
   * Spec: HMAC-SHA256( `${secret}|${url_encode(webhook_url)}|${type}|${x-justcall-request-timestamp}`, secret )
   */
  verifyWebhookSignature(headers, body) {
    if (!this.apiSecret) {
      console.warn('[JustCall] no apiSecret; rejecting');
      return false;
    }
    if (!this.webhookUrl) {
      console.warn('[JustCall] verifyWebhookSignature: no JUSTCALL_WEBHOOK_URL configured');
      return false;
    }
    const sigHeader = headers['x-justcall-signature'];
    const tsHeader = headers['x-justcall-request-timestamp'];
    const versionHeader = headers['x-justcall-signature-version'];
    if (!sigHeader || !tsHeader || !body?.type) return false;
    if (versionHeader && versionHeader !== SIGNATURE_VERSION) return false;
    const timestamp = Date.parse(tsHeader);
    if (!Number.isFinite(timestamp)) return false;
    if (!this.allowHistoricalWebhookSignatures && Math.abs(this.now().getTime() - timestamp) > this.webhookMaxAgeMs) return false;

    const encodedUrl = encodeURIComponent(this.webhookUrl);
    const payloadStr = `${this.apiSecret}|${encodedUrl}|${body.type}|${tsHeader}`;
    const expected = crypto.createHmac('sha256', this.apiSecret).update(payloadStr, 'utf8').digest('hex');
    const sigBuf = Buffer.from(sigHeader, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  // -------------------------------------------------------------
  // INBOUND (optional): CALL AI REPORT webhook
  // -------------------------------------------------------------
  /**
   * Handle a `call.ai_report` event from JustCall.
   * JustCall's native GHL integration already syncs the call to the
   * CONTACT timeline. This handler additionally writes the AI coaching
   * to the OPPORTUNITY timeline.
   */
  async handleCallAiReport(payload) {
    const event = payload?.type || 'call.ai_report';
    if (!this.whitelistedEvents.has(event)) {
      return { event, action: 'skipped (event not whitelisted)' };
    }
    const key = _dedupeKey(payload);
    if (_alreadyProcessed(key)) {
      return { event, key, action: 'skipped (duplicate)' };
    }

    const data = payload?.data || {};
    const callId = data.id || data.call_sid;
    if (!callId) throw new Error('handleCallAiReport: payload.data.id missing');

    const ai = data.justcall_ai || {};
    const opp = await this.findOpportunityByCallId(callId);

    const report = {
      type: 'call_ai_report',
      event,
      callId,
      callScore: ai.call_score,
      manualCallScore: ai.manual_call_score,
      customerSentiment: ai.customer_sentiment,
      callSummary: ai.call_summary,
      tags: ai.tags || [],
      callMoments: ai.call_moments || [],
      callScoreParameters: ai.call_score_parameters || {},
      transcriptSegments: ai.call_transcription || [],
      receivedAt: new Date().toISOString(),
    };

    if (!opp?.opportunityId) {
      this.templateContext.lastAiReport = report;
      return { ...report, action: 'logged (no matching opportunity)' };
    }

    this.templateContext.lastAiReport = report;
    return { ...report, opportunityId: opp.opportunityId, preparedNote: this._formatAiReportNote(report, opp), action: 'prepared for guarded call-note processor; no GHL write' };
  }

  // -------------------------------------------------------------
  // OUTBOUND: PULL AI COACHING ON DEMAND
  // -------------------------------------------------------------
  /**
   * Fetch a single call's details from JustCall.
   * v2.1 endpoint: GET /v2.1/calls/{id}
   * Use ?fetch_ai_data=true to include AI insights in the response.
   * @param {string|number} callId
   * @returns {Promise<object>}
   */
  async fetchCallDetails(callId, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('JustCallIntegration.fetchCallDetails: API key/secret not configured');
    }
    const suffix = options.includeAi === true ? '?fetch_ai_data=true' : '';
    const raw = await this._justcallRequest('GET', `/${JUSTCALL_API_VERSION}/calls/${encodeURIComponent(callId)}${suffix}`, null, { retried: 0 });
    return raw?.data || raw;
  }

  /**
   * Fetch only a call's transcript from the v2.1 Calls AI endpoint.
   * Non-transcription fields default to true and require AI Review Assist on
   * Team/Pro, so each must be disabled explicitly.
   * @param {string|number} callId
   * @returns {Promise<object>}
   */
  async fetchCallAiData(callId) {
    if (!this.isConfigured()) {
      throw new Error('JustCallIntegration.fetchCallAiData: API key/secret not configured');
    }
    const query = 'fetch_transcription=true&fetch_summary=false&fetch_ai_insights=false&fetch_action_items=false&fetch_smart_chapters=false';
    const raw = await this._justcallRequest('GET', `/${JUSTCALL_API_VERSION}/calls_ai/${encodeURIComponent(callId)}?${query}`, null, { retried: 0 });
    return raw?.data || raw;
  }

  async fetchCallCoachingData(callId) {
    if (!this.isConfigured()) {
      throw new Error('JustCallIntegration.fetchCallCoachingData: API key/secret not configured');
    }
    const query = 'fetch_transcription=false&fetch_summary=true&fetch_ai_insights=true&fetch_action_items=true&fetch_smart_chapters=true';
    const raw = await this._justcallRequest('GET', `/${JUSTCALL_API_VERSION}/calls_ai/${encodeURIComponent(callId)}?${query}`, null, { retried: 0 });
    return raw?.data || raw;
  }

  async pollCallTranscript(callId, options = {}) {
    const scheduleMs = options.scheduleMs || [0, 5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const checked = [];
    let call;
    try {
      call = await this.fetchCallDetails(callId);
    } catch (error) {
      if (error.status === 401 || error.status === 403) return { state: 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE', reason: 'CALL_DETAIL_AUTH_FAILED', callId: String(callId), checked };
      return { state: 'TRANSCRIPT_CERTIFICATION_BLOCKED', reason: 'CALL_DETAIL_READ_FAILED', callId: String(callId), checked };
    }
    const callIds = [call?.id, call?.call_id, call?.callId].filter(value => value !== undefined && value !== null && String(value) !== '').map(String);
    if (new Set(callIds).size > 1) return { state: 'TRANSCRIPT_CERTIFICATION_BLOCKED', reason: 'CALL_ID_CONFLICT', callId: String(callId), checked };
    if (callIds.length === 0 || callIds[0] !== String(callId)) return { state: 'TRANSCRIPT_CERTIFICATION_BLOCKED', reason: callIds.length ? 'CALL_ID_MISMATCH' : 'CALL_ID_MISSING', callId: String(callId), checked };
    const recordingAvailable = Boolean(call?.call_info?.recording || call?.recording_url || call?.recordingUrl);
    const certifications = ['CALL_FOUND', ...(recordingAvailable ? ['RECORDING_FOUND'] : [])];
    for (const delayMs of scheduleMs) {
      if (delayMs > 0) await sleep(delayMs);
      const checkedAt = new Date().toISOString();
      try {
        const ai = await this.fetchCallAiData(callId);
        const nestedAi = ai?.justcall_ai;
        const nestedSegments = nestedAi?.call_transcription;
        const nestedCallIds = [nestedAi?.id, nestedAi?.call_id, nestedAi?.callId].filter(value => value !== undefined && value !== null && String(value) !== '').map(String);
        if (Array.isArray(nestedSegments) && nestedSegments.length && nestedCallIds.length === 0) {
          return { state: 'TRANSCRIPT_CERTIFICATION_BLOCKED', reason: 'AI_CALL_ID_MISSING', callId: String(callId), recordingAvailable, certifications, endpointClass: 'CALLS_AI_API', checked };
        }
        const aiCallIds = [ai?.id, ai?.call_id, ai?.callId, ...nestedCallIds].filter(value => value !== undefined && value !== null && String(value) !== '').map(String);
        const aiCallId = aiCallIds[0];
        if (new Set(aiCallIds).size > 1) return { state: 'TRANSCRIPT_CERTIFICATION_BLOCKED', reason: 'AI_CALL_ID_CONFLICT', callId: String(callId), recordingAvailable, certifications, endpointClass: 'CALLS_AI_API', checked };
        if (!aiCallId || aiCallId !== String(callId)) return { state: 'TRANSCRIPT_CERTIFICATION_BLOCKED', reason: aiCallId ? 'AI_CALL_ID_MISMATCH' : 'AI_CALL_ID_MISSING', callId: String(callId), recordingAvailable, certifications, endpointClass: 'CALLS_AI_API', checked };
        const segments = ai?.call_transcription || nestedSegments || [];
        checked.push({ checkedAt, state: segments.length ? 'PROVIDER_TRANSCRIPT_AVAILABLE' : 'PROVIDER_TRANSCRIPT_PENDING', segmentCount: segments.length });
        if (segments.length) return { state: 'PROVIDER_TRANSCRIPT_AVAILABLE', callId: String(callId), recordingAvailable, certifications: [...certifications, 'TRANSCRIPT_PROVIDER_API'], endpointClass: 'CALLS_AI_API', segments, checked };
      } catch (error) {
        const message = String(error.message || '');
        if (error.status === 403 && /AI Review Assist add-on/i.test(message)) {
          checked.push({ checkedAt, state: 'TRANSCRIPT_CERTIFICATION_BLOCKED', segmentCount: 0 });
          return { state: 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE', reason: 'CALLS_AI_TRANSCRIPT_ACCESS_DENIED', callId: String(callId), recordingAvailable, certifications, endpointClass: 'CALLS_AI_API', checked };
        }
        if (error.status === 401) return { state: 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE', reason: 'AUTH_FAILED', callId: String(callId), recordingAvailable, checked };
        if (error.status === 403) return { state: 'PROVIDER_TRANSCRIPT_NOT_API_ACCESSIBLE', reason: 'RESOURCE_ACCESS_OR_VALIDATION_DENIED', callId: String(callId), recordingAvailable, checked };
        if (error.status !== 404) return { state: 'TRANSCRIPT_CERTIFICATION_BLOCKED', reason: 'TRANSCRIPT_READ_FAILED', callId: String(callId), recordingAvailable, checked };
        checked.push({ checkedAt, state: 'PROVIDER_TRANSCRIPT_PENDING', segmentCount: 0 });
      }
    }
    return { state: 'PROVIDER_TRANSCRIPT_NOT_GENERATED', reason: 'BOUNDED_POLLING_EXHAUSTED', callId: String(callId), recordingAvailable, checked };
  }

  /**
   * Pull AI coaching and write to the opportunity timeline.
   * @param {string|number} callId
   * @param {string} opportunityId
   */
  async pullAndAttachCoaching(callId, opportunityId) {
    if (!this.isConfigured()) {
      throw new Error('pullAndAttachCoaching: API key/secret not configured');
    }
    let ai = null;
    let callMeta = null;
    try {
      ai = await this.fetchCallCoachingData(callId);
    } catch (e) {
      // Fallback: try fetching the call itself with fetch_ai_data=true
      callMeta = await this.fetchCallDetails(callId, { includeAi: true });
      ai = callMeta?.justcall_ai || callMeta?.ai_data || null;
    }
    if (!ai) {
      return { callId, opportunityId, action: 'no AI data yet (try again in 30s)' };
    }
    const note = this._formatAiReportNote(
      {
        callId,
        callScore: ai.call_score,
        manualCallScore: ai.manual_call_score,
        customerSentiment: ai.customer_sentiment,
        callSummary: ai.call_summary,
        tags: ai.tags || [],
        callScoreParameters: ai.call_score_parameters || {},
        transcriptSegments: ai.call_transcription || [],
        receivedAt: new Date().toISOString(),
      },
      { name: callMeta?.contact_name, opportunityId }
    );
    return {
      callId,
      opportunityId,
      score: ai.call_score,
      summary: ai.call_summary,
      segments: (ai.call_transcription || []).length,
      preparedNote: note,
      action: 'prepared for guarded call-note processor; no GHL write',
    };
  }

  /**
   * List recent calls.
   * v2.1 endpoint: GET /v2.1/calls
   * @param {object} [params]
   * @param {string} [params.from_datetime]
   * @param {string} [params.to_datetime]
   * @param {string} [params.contact_number]
   * @param {string} [params.justcall_number]
   * @param {number} [params.agent_id]
   * @param {string} [params.call_direction] 'incoming' | 'outgoing'
   * @param {string} [params.sort] 'id' (default) | etc
   * @param {string} [params.order] 'desc' (default) | 'asc'
   * @param {number} [params.per_page] 1-100
   * @param {boolean} [params.fetch_queue_data]
   * @param {boolean} [params.fetch_ai_data]
   * @returns {Promise<{count, total_count, current_page, per_page, data: Array}>}
   */
  async listCalls(params = {}) {
    if (!this.isConfigured()) {
      throw new Error('JustCallIntegration.listCalls: API key/secret not configured');
    }
    const qs = new URLSearchParams(params).toString();
    const path = `/${JUSTCALL_API_VERSION}/calls${qs ? `?${qs}` : ''}`;
    const raw = await this._justcallRequest('GET', path, null, { retried: 0 });
    return raw;
  }

  /**
   * List the current JustCall users (agents) in the account.
   * v2.1 endpoint: GET /v2.1/users
   * @param {object} [params]
   * @returns {Promise<{count, total_count, data: Array}>}
   */
  async listUsers(params = {}) {
    if (!this.isConfigured()) {
      throw new Error('JustCallIntegration.listUsers: API key/secret not configured');
    }
    const qs = new URLSearchParams(params).toString();
    const path = `/${JUSTCALL_API_VERSION}/users${qs ? `?${qs}` : ''}`;
    return await this._justcallRequest('GET', path, null, { retried: 0 });
  }

  // -------------------------------------------------------------
  // OUTBOUND: SMS / CALL
  // -------------------------------------------------------------
  /**
   * Send an SMS via JustCall.
   * v2.1 endpoint: POST /v2.1/texts/new
   * @param {string} to
   * @param {string} body
   * @param {object} [options]
   */
  async sendSMS(to, body, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('JustCallIntegration.sendSMS: API key/secret not configured');
    }
    const from = options.from || this.fromNumber;
    const context = { ...this.templateContext, ...(options.context || {}) };
    const filledBody = body ? fillTemplate(body, context) : '';
    const payload = {
      from,
      to,
      justcall_number: from.replace(/\+/g, ''),
      contact_number: to.replace(/\+/g, ''),
      body: filledBody,
      media_url: options.mediaUrl || undefined,
    };
    const raw = await this._justcallRequest('POST', `/${JUSTCALL_API_VERSION}/texts/new`, payload, { retried: 0 });
    return { messageId: raw?.data?.id || raw?.id, body: filledBody, to, from, raw };
  }

  /**
   * Send an MMS with a media attachment via JustCall.
   * v2.1 endpoint: POST /v2.1/texts/new
   * @param {string} to
   * @param {string} body - short accompanying text (NOT the media content)
   * @param {string} mediaUrl - public HTTPS URL to the media file
   * @param {object} [options]
   */
  async sendMMS(to, body, mediaUrl, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('JustCallIntegration.sendMMS: API key/secret not configured');
    }
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      throw new Error('JustCallIntegration.sendMMS: mediaUrl is required');
    }
    if (!mediaUrl.startsWith('https://')) {
      throw new Error('JustCallIntegration.sendMMS: mediaUrl must be HTTPS');
    }
    if (body && body.includes('BEGIN:VCARD')) {
      throw new Error('JustCallIntegration.sendMMS: body must not contain VCF content');
    }
    const from = options.from || this.fromNumber;
    const context = { ...this.templateContext, ...(options.context || {}) };
    const filledBody = body ? fillTemplate(body, context) : '';
    const payload = {
      from,
      to,
      justcall_number: from.replace(/\+/g, ''),
      contact_number: to.replace(/\+/g, ''),
      body: filledBody,
      media_url: mediaUrl,
      restrict_once: options.restrictOnce || 'No',
    };
    const raw = await this._justcallRequest('POST', `/${JUSTCALL_API_VERSION}/texts/new`, payload, { retried: 0 });
    const firstItem = Array.isArray(raw?.data) ? raw.data[0] : raw?.data;
    return { messageId: firstItem?.id || raw?.id, body: filledBody, to, from, mediaUrl, raw };
  }

  /**
   * Send a contact card (vCard) as an MMS attachment.
   * Requires a verified public HTTPS media URL pointing to the VCF.
   * @param {string} to
   * @param {string} mediaUrl - public HTTPS URL to the .vcf file
   * @param {object} [options]
   */
  async sendContactCard(to, mediaUrl, options = {}) {
    const body = options.body || 'Montelli contact card — tap the attached file to add my contact.';
    return this.sendMMS(to, body, mediaUrl, options);
  }

  /**
   * Place an outbound call. v2.1 endpoint for voice-agent calls:
   *   POST /v2.1/voice-agents/calls
   * Body: { dynamic_variables: [], has_consent: bool, ... }
   * (For non-AI outbound dialing, JustCall's UI dialer is recommended;
   * the public REST API for "place a call as a user" is not exposed in v2.1.)
   */
  async placeCall(to, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('JustCallIntegration.placeCall: API key/secret not configured');
    }
    // v2.1 does not expose a "place call as user" REST endpoint. The
    // closest is /v2.1/voice-agents/calls (AI agent) or using the
    // JustCall web/desktop dialer. We surface a clear error.
    throw new Error('JustCall v2.1 REST API does not expose a user-placed call endpoint. Use the JustCall web/desktop dialer, or configure a JustCall AI Voice Agent and use POST /v2.1/voice-agents/calls instead. to=' + to);
  }

  // -------------------------------------------------------------
  // INTERNAL: HTTPS request to JustCall v2.1 API
  // -------------------------------------------------------------
  _justcallRequest(method, path, body, options = {}) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = https.request(
        {
          host: JUSTCALL_BASE,
          method,
          path,
          timeout: 20000,
          headers: {
            'Authorization': this._basicAuthHeader(),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          },
        },
        (res) => {
          let chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode === 429 && (options.retried || 0) < MAX_RETRIES) {
              const backoffMs = 500 * Math.pow(2, options.retried);
              setTimeout(() => {
                this._justcallRequest(method, path, body, { retried: (options.retried || 0) + 1 })
                  .then(resolve, reject);
              }, backoffMs);
              return;
            }
            if (res.statusCode >= 400) {
              const error = new Error(`JustCall ${method} ${path} → ${res.statusCode}: ${text}`);
              error.status = res.statusCode;
              return reject(error);
            }
            try { resolve(text ? JSON.parse(text) : {}); }
            catch (e) { reject(new Error(`JustCall ${method} ${path}: invalid JSON: ${text}`)); }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(`JustCall ${method} ${path}: timeout`)));
      if (data) req.write(data);
      req.end();
    });
  }

  // -------------------------------------------------------------
  // INTERNAL HELPERS
  // -------------------------------------------------------------
  _formatAiReportNote(report, opp) {
    const params = report.callScoreParameters || {};
    return [
      `=== JUSTCALL AI COACHING ===`,
      `Call ID: ${report.callId}`,
      `Analyzed: ${report.receivedAt}`,
      ``,
      `Score: ${report.callScore || 'pending'}/100 (manual: ${report.manualCallScore || 'n/a'})`,
      `Customer Sentiment: ${report.customerSentiment || 'n/a'}`,
      `Tags: ${(report.tags || []).join(', ') || '(none)'}`,
      ``,
      `--- Score Breakdown ---`,
      `Dead air: ${params.dead_air_time || 0}s | Filler words: ${params.filler_word || 0}`,
      `De-escalation: ${params.de_escalation || 0}/5 | Empathy: ${params.empathy || 0}/5`,
      `Talk/Listen: ${params.talk_listen_ratio || 0}/5 | Greetings: ${params.greetings || 0}/5`,
      `WPM: ${params.words_per_minute || 0} | Monologue: ${params.monologue_duration || 0}s`,
      `Etiquette: ${params.call_etiquette || 0}/5 | Customer sentiment: ${params.customer_sentiment_score || 0}/5`,
      ``,
      report.callSummary ? `--- AI Summary ---\n${report.callSummary}\n` : '',
      `Transcript segments available: ${(report.transcriptSegments || []).length}`,
      `Raw transcript omitted by policy.`,
      ``,
      `Opportunity: ${opp.name || opp.opportunityId || 'unknown'}`,
    ].filter(Boolean).join('\n');
  }

  _flattenTranscript(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return '(transcript not yet ready — pull again in 30s)';
    return segments.map(s => {
      if (typeof s === 'string') return s;
      const speaker = s.speaker || s.role || '?';
      const text = s.text || s.content || '';
      const ts = s.start !== undefined ? `[${Math.floor(s.start)}s]` : '';
      return `${ts} ${speaker}: ${text}`;
    }).join('\n');
  }
}

// =============================================================
// EXPRESS HANDLER FACTORY (optional webhook receiver)
// =============================================================
function createJustCallWebhookHandler(deps) {
  const jc = new JustCallIntegration(deps);
  return async function justCallWebhookHandler(req, res) {
    if (!jc.verifyWebhookSignature(req.headers, req.body)) {
      return res.status(401).json({ ok: false, error: 'invalid signature' });
    }
    const event = req.body?.type || 'unknown';
    if (!jc.whitelistedEvents.has(event)) {
      return res.status(202).json({ ok: true, action: 'skipped (event not whitelisted)', event });
    }
    try {
      const result = event === 'call.ai_report' || event === 'jc.call_ai_generated'
        ? await jc.handleCallAiReport(req.body)
        : { action: 'no handler for event', event };
      return res.status(200).json({ ok: true, event, result });
    } catch (err) {
      console.error('[JustCall] Webhook handler error:', err);
      return res.status(503).json({ ok: false, error: err.message });
    }
  };
}

module.exports = {
  JustCallIntegration,
  createJustCallWebhookHandler,
  SIGNATURE_VERSION,
  JUSTCALL_API_VERSION,
  TRANSCRIPT_CERTIFICATION_STATES,
  TRANSCRIPT_OPERATIONAL_STATES,
  _dedupeKey,
  _alreadyProcessed,
};
