'use strict';

const https = require('https');
const { normalizeE164 } = require('./call-note-schema');
const { ATLAS_FIELD_IDS } = require('./ghl-authoritative-pipeline-hydrator');
const OWNER_CONTROLLED_TEST_CONTACT_ID = 'PSVc2FuuA0dqyaQPXqOE';

class GhlCallNoteGateway {
  constructor(options = {}) {
    this.token = options.token || '';
    this.locationId = options.locationId || '';
    this.pipelineId = options.pipelineId || '';
    this.baseUrl = options.baseUrl || 'https://services.leadconnectorhq.com';
    this.apiVersion = options.apiVersion || '2023-02-21';
    this.writeEnabled = options.writeEnabled === true;
    this.ownerControlledTestNoteWritesEnabled = options.ownerControlledTestNoteWritesEnabled === true;
    if (options.ownerControlledTestContactId && String(options.ownerControlledTestContactId) !== OWNER_CONTROLLED_TEST_CONTACT_ID) throw new Error('OWNER_CONTROLLED_TEST_CONTACT_CONFIGURATION_REFUSED');
    this.ownerControlledTestContactId = OWNER_CONTROLLED_TEST_CONTACT_ID;
    this.ownerControlledTestApprovalSecret = options.ownerControlledTestApprovalSecret || '';
    this.ownerControlledTestOwnerId = String(options.ownerControlledTestOwnerId || '');
    this.ownerControlledTestApprovalStore = options.ownerControlledTestApprovalStore || null;
    this.getSafetyState = options.getSafetyState || (() => require('../bot/kill-switch').readKillSwitch().state);
    this.transport = options.transport || this._transport.bind(this);
  }

  async findContactsByPhone(phone, locationId = this.locationId) {
    const normalized = normalizeE164(phone);
    if (!normalized || locationId !== this.locationId) return [];
    const rows = await this._collect(`/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(normalized)}&limit=100`, body => body.contacts || body.data || []);
    return rows.filter(contact => normalizeE164(contact.phone) === normalized && (contact.locationId || contact.location_id) === locationId);
  }

  async findOpportunitiesByContacts(contactIds, pipelineId = this.pipelineId) {
    if (pipelineId !== this.pipelineId || contactIds.length === 0) return [];
    const rows = await this._collect(`/opportunities/search?location_id=${encodeURIComponent(this.locationId)}&pipeline_id=${encodeURIComponent(pipelineId)}&limit=100`, body => body.opportunities || body.data || []);
    const normalizedContactIds = new Set(contactIds.map(String));
    const linked = rows.filter(opportunity => normalizedContactIds.has(String(opportunity.contactId || opportunity.contact?.id)));
    const resolved = [];
    for (const opportunity of linked) {
      let detail = opportunity;
      if (!opportunity.recordClass) {
        const body = await this._request('GET', `/opportunities/${encodeURIComponent(opportunity.id || opportunity.opportunityId)}`);
        detail = body.opportunity || body;
      }
      resolved.push({ ...opportunity, ...detail, recordClass: classifyOpportunity(detail) });
    }
    return resolved;
  }

  async findContactNotes(contactId, marker) {
    const rows = await this._collect(`/contacts/${encodeURIComponent(contactId)}/notes?limit=100`, body => body.notes || body.data || []);
    return rows.filter(note => String(note.body || '').split(/\r?\n/).some(line => line.trim() === marker));
  }

  async getContact(contactId) {
    const body = await this._request('GET', `/contacts/${encodeURIComponent(contactId)}`);
    return body.contact || body;
  }

  async listContactNotes(contactId) {
    return this._collect(`/contacts/${encodeURIComponent(contactId)}/notes/`, body => body.notes || body.data || []);
  }

  async findOpportunitiesForContact(contactId) {
    const rows = await this._collect(`/opportunities/search?location_id=${encodeURIComponent(this.locationId)}&contact_id=${encodeURIComponent(contactId)}&limit=100`, body => body.opportunities || body.data || []);
    return rows.filter(opportunity => String(opportunity.contactId || opportunity.contact?.id) === String(contactId));
  }

  async createContactNote(contactId, noteBody) {
    if (!this.writeEnabled) throw new Error('GHL_CALL_NOTE_WRITES_DISABLED');
    if (this.getSafetyState() !== 'CANARY_ALLOWED') throw new Error('KILL_SWITCH_BLOCKS_GHL_NOTE_WRITE');
    return this._request('POST', `/contacts/${encodeURIComponent(contactId)}/notes`, { body: noteBody });
  }

  async createOwnerControlledTestNote(contactId, noteBody, authorization = {}) {
    if (!this.ownerControlledTestNoteWritesEnabled || String(contactId) !== this.ownerControlledTestContactId) throw new Error('OWNER_CONTROLLED_TEST_NOTE_WRITE_DISABLED');
    if (this.getSafetyState() !== 'PAUSED') throw new Error('OWNER_CONTROLLED_TEST_NOTE_REQUIRES_PAUSED');
    if (!authorization.previewId || !authorization.previewHash || !authorization.noteBodyHash || !authorization.callId || !authorization.transcriptHash || !authorization.approval) throw new Error('OWNER_CONTROLLED_TEST_NOTE_AUTHORIZATION_INVALID');
    if (require('./owner-controlled-transcript-note').sha256(String(noteBody || '')) !== authorization.noteBodyHash) throw new Error('OWNER_CONTROLLED_TEST_NOTE_BODY_MISMATCH');
    const { verifyApprovalIntegrity } = require('./owner-controlled-transcript-note');
    const approval = authorization.approval;
    if (!verifyApprovalIntegrity(approval, this.ownerControlledTestApprovalSecret) || approval.status !== 'ACTIVE' || new Date(approval.expiresAt) <= new Date()) throw new Error('OWNER_CONTROLLED_TEST_APPROVAL_INVALID');
    if (approval.ownerId !== this.ownerControlledTestOwnerId || approval.previewId !== authorization.previewId || approval.previewHash !== authorization.previewHash || approval.noteBodyHash !== authorization.noteBodyHash || approval.callId !== authorization.callId || approval.transcriptHash !== authorization.transcriptHash || approval.testContactId !== String(contactId)) throw new Error('OWNER_CONTROLLED_TEST_APPROVAL_SCOPE_MISMATCH');
    if (!this.ownerControlledTestApprovalStore) throw new Error('OWNER_CONTROLLED_TEST_APPROVAL_STORE_REQUIRED');
    this.ownerControlledTestApprovalStore.reserve(approval, { previewId: authorization.previewId, previewHash: authorization.previewHash, noteBodyHash: authorization.noteBodyHash, callId: authorization.callId, transcriptHash: authorization.transcriptHash, testContactId: String(contactId) });
    return this._request('POST', `/contacts/${encodeURIComponent(contactId)}/notes`, { body: noteBody }, { ownerControlledTestWrite: true });
  }

  async _collect(initialPath, extract) {
    const rows = [];
    let pathname = initialPath;
    for (let page = 0; pathname && page < 25; page++) {
      const body = await this._request('GET', pathname);
      const items = extract(body);
      if (!Array.isArray(items)) throw new Error('GHL_CALL_NOTE_PAGINATION_INVALID');
      rows.push(...items);
      const next = body.nextPageUrl || body.next_page_link || body.meta?.nextPageUrl || body.meta?.next_page_link || '';
      if (!next) {
        if (items.length === 100) throw new Error('GHL_CALL_NOTE_PAGINATION_INCOMPLETE');
        return rows;
      }
      const parsed = new URL(next, this.baseUrl);
      pathname = `${parsed.pathname}${parsed.search}`;
    }
    if (pathname) throw new Error('GHL_CALL_NOTE_PAGINATION_LIMIT_EXCEEDED');
    return rows;
  }

  async _request(method, pathname, body, options = {}) {
    if (!this.token) throw new Error('GHL_CALL_NOTE_TOKEN_REQUIRED');
    if (!['GET', 'POST'].includes(method)) throw new Error(`GHL_CALL_NOTE_METHOD_REFUSED: ${method}`);
    if (method === 'POST' && !this.writeEnabled && options.ownerControlledTestWrite !== true) throw new Error('GHL_CALL_NOTE_WRITES_DISABLED');
    if (options.ownerControlledTestWrite === true && this.getSafetyState() !== 'PAUSED') throw new Error('OWNER_CONTROLLED_TEST_NOTE_REQUIRES_PAUSED');
    const response = await this.transport({ method, url: `${this.baseUrl}${pathname}`, body, headers: { Authorization: `Bearer ${this.token}`, Version: this.apiVersion, Accept: 'application/json', 'Content-Type': 'application/json' } });
    if (response.status >= 400) throw Object.assign(new Error(`GHL_CALL_NOTE_REQUEST_FAILED_${response.status}: ${method} ${pathname}`), { status: response.status, writeUncertain: method === 'POST' });
    return response.body || {};
  }

  _transport({ method, url, body, headers }) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const data = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: parsed.hostname, path: `${parsed.pathname}${parsed.search}`, method, headers: { ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }, timeout: 15000 }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: text ? JSON.parse(text) : {} }); }
          catch { reject(Object.assign(new Error('GHL_CALL_NOTE_INVALID_JSON'), { writeUncertain: method === 'POST' })); }
        });
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('GHL_CALL_NOTE_TIMEOUT'), { writeUncertain: method === 'POST' })));
      req.on('error', error => reject(Object.assign(error, { writeUncertain: method === 'POST' })));
      if (data) req.write(data);
      req.end();
    });
  }
}

function classifyOpportunity(opportunity = {}) {
  if (/\b(test|demo|sandbox|qa|canary)\b/i.test(String(opportunity.name || ''))) return 'TEST_OR_NON_PRODUCTION';
  const fields = opportunity.customFields || opportunity.customField || [];
  const required = new Set([ATLAS_FIELD_IDS.sourceRowId, ATLAS_FIELD_IDS.importBatchId, ATLAS_FIELD_IDS.atlasSource]);
  const present = new Set((Array.isArray(fields) ? fields : []).filter(field => String(field.fieldValue ?? field.fieldValueString ?? field.value ?? '').trim()).map(field => field.id || field.fieldKey));
  required.add(ATLAS_FIELD_IDS.propertyFingerprint);
  return [...required].every(id => present.has(id)) ? 'PRODUCTION' : 'UNKNOWN';
}

module.exports = { GhlCallNoteGateway, OWNER_CONTROLLED_TEST_CONTACT_ID, classifyOpportunity };
