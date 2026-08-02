'use strict';

const https = require('https');

const ATLAS_FIELD_IDS = {
  propertyAddress: 'e42a8Riv9ljjd96nsYth',
  normalizedAddress: '6oDNJgfuKflDgS0fPsuz',
  street: 'N9k8B1Eb9yCVY9t18X99',
  city: '04ZDfCUio59HYRtaXp84',
  state: '9f50Xt7Uw8rdDRY0oWDi',
  zip: '9TrSain4Y6OB60Nvi7B3',
  propertyFingerprint: 'FP9PrUN1rudLi4IEw1mo',
  sourceRowId: 'bNUaLqPpKB2IY7nMx1Gh',
  importBatchId: '7Qk4VP3Uvi7W3NViBHxM',
  atlasSource: 'k198PybZpHpw7xvJyShQ',
  listingPrice: 'BF27QFffcBYyFicATmQG',
  squareFeet: 'DebNF41orJXBk778HHIn',
  pricePerSqft: '99d9lvtzQelTxcSxBgL1',
  propertyType: 'R0yVRrmzWRuYbZvLqmuQ',
  ownership: 'JzvYZ6sEP9Y8dLrip7KQ',
  mlsStatus: 'i6woEmjcZmzVx0tM6mRj',
  leadTypes: 'AQpmT5bILW6RrCJj8WIw',
  listingUrl: 'UsBUF2NyOiPwPBzs9zbA',
  mlsId: 'IeSrwyB7Qw6QBMAmhc6Y',
  brokerage: 'HNjy4oAdFEUNAsxpvt5o'
};

const STAGE_BY_ID = {
  '7067148a-2ee8-4e5b-93c8-31e0253fea68': 'Lead Entered',
  '934c4c52-4b22-457a-8d10-55ab6600fdee': 'Contact Made',
  '3da698e7-aba8-4d4a-b14b-7742f7b44ac7': 'Offer Ready',
  'eef16a9b-8ca9-43b7-9cad-fb9c352b560d': 'Offer Sent',
  'd5375376-26dc-4dc3-9b06-f55178f8a23b': 'Offer Received',
  '83f2c0df-a9c5-44fe-b42f-46ed60274e66': 'Gain Feedback',
  'b82940e0-e55c-4359-98e6-35cb22e065ab': 'No Answer',
  '8dc3463c-8a45-41a1-a305-2013527b1bd8': 'Seller Declined',
  'a7a5c7ac-3933-4c68-bfce-b81eaacf622e': 'Active Negotiation',
  'e6480e04-1b0f-4f79-af96-7cf5fb634ac5': 'Terms Agreed',
  '1e97ae23-78a6-4698-919f-ba0d6a0e08c6': 'Awaiting Title',
  'f0b739d5-f270-410c-b9e9-bce2e26a53ff': 'Contract Out',
  '645611af-ae9a-4dfc-aba9-8bfff08dc79a': 'Under Contract',
  'b68f7087-559d-470b-9ddf-d1452f4b027e': 'UC Another Buyer',
  '129094e2-ea70-49c1-a670-b599ee25ba3f': 'Sent to Buyers',
  'b7ab06be-9a28-40a2-9dc9-6697fc09a836': 'Inspection Complete',
  '49142ba4-2360-49ca-9a86-6223dc847440': 'Appraisal Complete',
  '36993fe3-cfc3-4651-99d6-3146627869a3': 'JV Sent',
  '6eb610d7-31f2-4380-ab03-fd0c2f771e8b': 'JV Signed',
  '6f97e402-288e-417a-b561-65a8287e5653': 'Wire Setup',
  'e446607c-2d2c-4664-b0cd-96f9de0584e1': 'Closing Date'
};

const KNOWN_TEST_ADDRESSES = ['11411 Huggins St, Leesburg FL 34788'];

class GhlAuthoritativeHydrator {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://services.leadconnectorhq.com';
    this.token = options.token;
    this.locationId = options.locationId;
    this.pipelineId = options.pipelineId;
    this.apiVersion = options.apiVersion || '2021-07-28';
    this.concurrency = Math.max(1, Math.min(10, options.concurrency || 5));
    this.minSpacingMs = options.minSpacingMs || 100;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs || 20000;
    this.lastCallTime = 0;
    this.requestLog = [];
    if (!this.token) throw new Error('GHL_AUTHORITATIVE_HYDRATOR_TOKEN_REQUIRED');
    if (!this.locationId) throw new Error('GHL_AUTHORITATIVE_HYDRATOR_LOCATION_REQUIRED');
    if (!this.pipelineId) throw new Error('GHL_AUTHORITATIVE_HYDRATOR_PIPELINE_REQUIRED');
  }

  static fromEnv(env = process.env, prefix = 'GHL_') {
    return new GhlAuthoritativeHydrator({
      token: env[`${prefix}TOKEN`] || env.GHL_TOKEN,
      locationId: env[`${prefix}LOCATION_ID`] || env.GHL_LOCATION_ID,
      pipelineId: env[`${prefix}PIPELINE_ID`] || env.GHL_PIPELINE_ID,
      apiVersion: env[`${prefix}API_VERSION`] || env.GHL_API_VERSION || '2021-07-28'
    });
  }

  async _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async _request(path) {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.minSpacingMs) {
      await this._sleep(this.minSpacingMs - elapsed);
    }
    this.lastCallTime = Date.now();

    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${path}`);
      const req = https.request({
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Version: this.apiVersion,
          Accept: 'application/json'
        },
        timeout: this.timeoutMs
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let body;
          try {
            body = data ? JSON.parse(data) : {};
          } catch (e) {
            body = { _parseError: e.message, _raw: data.slice(0, 500) };
          }
          this.requestLog.push({ method: 'GET', path, status: res.statusCode, timestamp: new Date().toISOString() });
          resolve({ status: res.statusCode, body, headers: res.headers || {} });
        });
      });
      req.on('timeout', () => req.destroy(new Error(`timeout: ${path}`)));
      req.on('error', reject);
      req.end();
    });
  }

  async _retry(fn, context) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        const status = e.status || (e.message && e.message.match(/\b(\d{3})\b/)?.[1]);
        if (status === '429' || status === 429) {
          await this._sleep(Math.min(30000, 1000 * 2 ** attempt));
        } else if (attempt < this.maxRetries) {
          await this._sleep(1000 * (attempt + 1));
        }
      }
    }
    const err = new Error(`${context}: ${lastError.message}`);
    err.originalError = lastError;
    throw err;
  }

  async _batches(items, fn) {
    const results = [];
    for (let i = 0; i < items.length; i += this.concurrency) {
      const batch = items.slice(i, i + this.concurrency);
      const batchResults = await Promise.all(batch.map(fn));
      results.push(...batchResults);
    }
    return results;
  }

  async getAllOpportunities() {
    const all = [];
    let page = 0;
    let path = `/opportunities/search?location_id=${encodeURIComponent(this.locationId)}&pipeline_id=${encodeURIComponent(this.pipelineId)}&limit=100`;
    while (path) {
      page += 1;
      const res = await this._retry(() => this._request(path), `opportunity search page ${page}`);
      if (res.status >= 400) throw new Error(`search failed ${res.status}: ${JSON.stringify(res.body)}`);
      const rows = res.body.opportunities || [];
      all.push(...rows);
      const next = res.body.meta?.nextPageUrl;
      if (!next) break;
      const nextUrl = new URL(next);
      path = `${nextUrl.pathname}${nextUrl.search}`;
    }
    return all;
  }

  async getOpportunityDirect(id) {
    const res = await this._retry(() => this._request(`/opportunities/${id}`), `direct opportunity ${id}`);
    if (res.status === 200) {
      return { available: true, status: 'AVAILABLE', data: res.body.opportunity || res.body, responseKeys: Object.keys(res.body) };
    }
    if (res.status === 401 || res.status === 403) {
      return { available: false, status: 'AUTH_REQUIRED', error: res.body, statusCode: res.status };
    }
    return { available: false, status: 'UNAVAILABLE', error: res.body, statusCode: res.status };
  }

  async getContactDirect(id) {
    const res = await this._retry(() => this._request(`/contacts/${id}`), `direct contact ${id}`);
    if (res.status === 200) {
      return { available: true, status: 'AVAILABLE', data: res.body.contact || res.body, responseKeys: Object.keys(res.body) };
    }
    if (res.status === 401 || res.status === 403) {
      return { available: false, status: 'AUTH_REQUIRED', error: res.body, statusCode: res.status };
    }
    if (res.status === 404) {
      return { available: false, status: 'NOT_FOUND', error: res.body, statusCode: res.status };
    }
    return { available: false, status: 'READ_FAILED', error: res.body, statusCode: res.status };
  }

  async getContactNotes(id) {
    const res = await this._retry(() => this._request(`/contacts/${id}/notes`), `contact notes ${id}`);
    if (res.status === 200) {
      return { available: true, status: 'AVAILABLE', data: res.body.notes || [], responseKeys: Object.keys(res.body) };
    }
    if (res.status === 404) {
      return { available: false, status: 'API_NOT_SUPPORTED', error: res.body, statusCode: res.status };
    }
    if (res.status === 401 || res.status === 403) {
      return { available: false, status: 'AUTH_REQUIRED', error: res.body, statusCode: res.status };
    }
    return { available: false, status: 'READ_FAILED', error: res.body, statusCode: res.status };
  }

  async getOpportunityNotes(id) {
    const res = await this._retry(() => this._request(`/opportunities/${id}/notes`), `opportunity notes ${id}`);
    if (res.status === 200) {
      return { available: true, status: 'AVAILABLE', data: res.body.notes || [], responseKeys: Object.keys(res.body) };
    }
    if (res.status === 404) {
      return { available: false, status: 'API_NOT_SUPPORTED', error: res.body, statusCode: res.status };
    }
    if (res.status === 401 || res.status === 403) {
      return { available: false, status: 'AUTH_REQUIRED', error: res.body, statusCode: res.status };
    }
    return { available: false, status: 'READ_FAILED', error: res.body, statusCode: res.status };
  }

  static unwrapContact(responseBody) {
    if (responseBody == null) return { contact: null, shape: 'NULL', unwrapped: false };
    if (responseBody.contact) return { contact: responseBody.contact, shape: 'CONTACT_WRAPPER_V1', unwrapped: true };
    if (responseBody.id || responseBody.firstName || responseBody.email || responseBody.phone) {
      return { contact: responseBody, shape: 'DIRECT_CONTACT_V1', unwrapped: true };
    }
    return { contact: responseBody, shape: 'UNKNOWN', unwrapped: false, warning: 'contact response did not match known shapes' };
  }

  static extractCustomField(entity, fieldId) {
    const fields = entity.customFields || entity.customField || [];
    if (!Array.isArray(fields)) return { value: null, present: false, raw: null, sourceShape: 'NO_FIELDS' };
    const field = fields.find((f) => f.id === fieldId || f.fieldKey === fieldId);
    if (!field) return { value: null, present: false, raw: null, sourceShape: 'FIELD_MISSING' };
    const raw = field.fieldValue ?? field.fieldValueString ?? field.fieldValueNumber ?? field.value ?? field.field_value ?? null;
    return { value: raw, present: raw !== null && raw !== '', raw: field, sourceShape: field.fieldValue !== undefined ? 'FIELD_VALUE' : field.fieldValueString !== undefined ? 'FIELD_VALUE_STRING' : field.fieldValueNumber !== undefined ? 'FIELD_VALUE_NUMBER' : 'UNKNOWN_SHAPE' };
  }

  static classifyRecord(record) {
    const oppName = String(record.opportunity?.name || '');
    const address = String(record.atlas?.propertyAddress || oppName);
    const fullName = String(record.contact?.fullName || '');
    const email = String(record.contact?.email || '');
    const atlas = record.atlas?.isAtlasValid === true;

    let classification = 'UNKNOWN';
    let confidence = 'LOW';
    const reasonCodes = [];
    const evidence = [];
    let recommendedDisposition = 'NEEDS_OWNER_REVIEW';

    if (KNOWN_TEST_ADDRESSES.some((a) => address.toLowerCase().includes(a.toLowerCase()))) {
      classification = 'LIVE_WALK';
      confidence = 'HIGH';
      reasonCodes.push('KNOWN_TEST_ADDRESS');
      evidence.push(`address matches known live-walk/test address: ${address}`);
      recommendedDisposition = 'ARCHIVE_RECOMMENDED';
    } else if (/\b(?:test|qa|demo|sandbox|live_walk|smoke|e2e|canary)\b/i.test(oppName)) {
      classification = 'LEGACY_TEST';
      confidence = 'HIGH';
      reasonCodes.push('OPPORTUNITY_NAME_TEST_MARKER');
      evidence.push(`opportunity name contains test marker: "${oppName}"`);
      recommendedDisposition = 'ARCHIVE_RECOMMENDED';
    } else if (/example\.com|test@|qa@|demo@|sandbox@/i.test(`${email} ${fullName}`)) {
      classification = 'LEGACY_TEST';
      confidence = 'HIGH';
      reasonCodes.push('CONTACT_TEST_MARKER');
      evidence.push(`contact email/name contains test marker`);
      recommendedDisposition = 'DELETE_REQUIRES_OWNER_DECISION';
    } else if (atlas) {
      classification = 'PRODUCTION';
      confidence = 'HIGH';
      reasonCodes.push('ATLAS_MARKERS_PRESENT');
      evidence.push('Atlas source-row marker, import batch ID, property fingerprint, and Atlas source field are present');
      recommendedDisposition = 'KEEP';
    } else {
      reasonCodes.push('NO_ATLAS_MARKERS');
      evidence.push('no Atlas source-row marker, import batch ID, property fingerprint, or Atlas source field');
      recommendedDisposition = 'NEEDS_OWNER_REVIEW';
    }

    return {
      recordClass: classification,
      confidence,
      reasonCodes,
      evidence,
      recommendedDisposition
    };
  }

  async hydrate(profile = 'INVENTORY') {
    const startTime = Date.now();
    if (!['INVENTORY', 'PRIORITIZATION', 'CANARY'].includes(profile)) throw new Error(`unsupported hydration profile: ${profile}`);

    const searchRows = await this.getAllOpportunities();

    const directOppResults = await this._batches(searchRows.map((r) => r.id), (id) => this.getOpportunityDirect(id).then((r) => ({ id, result: r })));
    const directOppById = new Map(directOppResults.map((r) => [r.id, r.result]));

    const contactIds = [...new Set(searchRows.map((r) => r.contactId).filter(Boolean))];
    const directContactResults = await this._batches(contactIds, (id) => this.getContactDirect(id).then((r) => ({ id, result: r })));
    const directContactById = new Map(directContactResults.map((r) => [r.id, r.result]));

    let contactNotesById = new Map();
    let oppNotesById = new Map();
    if (profile === 'PRIORITIZATION' || profile === 'CANARY') {
      const contactNotesResults = await this._batches(contactIds, (id) => this.getContactNotes(id).then((r) => ({ id, result: r })));
      contactNotesById = new Map(contactNotesResults.map((r) => [r.id, r.result]));

      const oppNotesResults = await this._batches(searchRows.map((r) => r.id), (id) => this.getOpportunityNotes(id).then((r) => ({ id, result: r })));
      oppNotesById = new Map(oppNotesResults.map((r) => [r.id, r.result]));
    }

    const records = [];
    for (const row of searchRows) {
      const oppResult = directOppById.get(row.id) || { available: false, status: 'UNAVAILABLE' };
      const opp = oppResult.available ? oppResult.data : row;

      const contactId = row.contactId || opp.contactId;
      const contactResult = contactId ? (directContactById.get(contactId) || { available: false, status: 'UNAVAILABLE' }) : { available: false, status: 'NO_CONTACT_ID' };
      const contactUnwrap = GhlAuthoritativeHydrator.unwrapContact(contactResult.available ? { contact: contactResult.data } : null);
      const contact = contactUnwrap.contact || {};

      const atlasFields = {};
      const atlasMarkers = {};
      let atlasValid = false;
      for (const [name, fieldId] of Object.entries(ATLAS_FIELD_IDS)) {
        const extracted = GhlAuthoritativeHydrator.extractCustomField(opp, fieldId);
        atlasFields[name] = { value: extracted.value, present: extracted.present, sourceShape: extracted.sourceShape };
        if (extracted.present) {
          atlasMarkers[name] = extracted.value;
          if (['sourceRowId', 'importBatchId', 'atlasSource'].includes(name)) atlasValid = true;
        }
      }

      const record = {
        opportunity: {
          id: row.id,
          name: row.name,
          pipelineId: row.pipelineId || opp.pipelineId,
          pipelineStageId: row.pipelineStageId || opp.pipelineStageId,
          stageName: STAGE_BY_ID[row.pipelineStageId || opp.pipelineStageId] || null,
          status: row.status || opp.status,
          contactId,
          createdAt: opp.createdAt,
          updatedAt: opp.updatedAt,
          lastStatusChangeAt: opp.lastStatusChangeAt || null,
          lastStageChangeAt: opp.lastStageChangeAt || null,
          assignedTo: row.assignedTo || opp.assignedTo || null,
          source: row.source || opp.source || null,
          internalSource: opp.internalSource || null,
          customFields: Object.fromEntries((opp.customFields || []).map((f) => [f.id, { type: f.type, fieldValue: f.fieldValue, fieldValueString: f.fieldValueString, fieldValueNumber: f.fieldValueNumber }]))
        },
        contact: {
          availability: contactResult.status,
          id: contactId || null,
          firstName: contact.firstName || null,
          lastName: contact.lastName || null,
          fullName: contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || null,
          email: contact.email || null,
          phone: contact.phone || null,
          companyName: contact.companyName || null,
          tags: Array.isArray(contact.tags) ? contact.tags : [],
          rawShapeVersion: contactUnwrap.shape,
          notes: profile !== 'INVENTORY' ? { status: (contactNotesById.get(contactId) || {}).status || 'UNAVAILABLE', count: ((contactNotesById.get(contactId) || {}).data || []).length } : { status: 'SKIPPED_BY_PROFILE', count: 0 }
        },
        opportunityNotes: profile !== 'INVENTORY' ? { status: (oppNotesById.get(row.id) || {}).status || 'UNAVAILABLE', count: ((oppNotesById.get(row.id) || {}).data || []).length } : { status: 'SKIPPED_BY_PROFILE', count: 0 },
        atlas: {
          isAtlasValid: atlasValid,
          sourceRow: atlasFields.sourceRowId.value,
          sourceId: atlasFields.atlasSource.value,
          fingerprint: atlasFields.propertyFingerprint.value,
          markers: atlasMarkers,
          fields: atlasFields,
          evidence: atlasValid ? ['Atlas marker fields present'] : ['No Atlas marker fields present']
        },
        apiCoverage: {
          opportunitySearch: 'AVAILABLE',
          opportunityDirect: oppResult.status,
          contactDirect: contactResult.status,
          contactNotes: profile === 'INVENTORY' ? 'SKIPPED_BY_PROFILE' : ((contactNotesById.get(contactId) || {}).status || 'UNAVAILABLE'),
          opportunityNotes: profile === 'INVENTORY' ? 'SKIPPED_BY_PROFILE' : ((oppNotesById.get(row.id) || {}).status || 'UNAVAILABLE'),
          contactTasks: 'API_NOT_SUPPORTED',
          timeline: 'API_NOT_SUPPORTED',
          conversations: 'API_NOT_SUPPORTED'
        }
      };

      record.classification = GhlAuthoritativeHydrator.classifyRecord(record);
      records.push(record);
    }

    const summary = {
      total: records.length,
      byClassification: records.reduce((acc, r) => { acc[r.classification.recordClass] = (acc[r.classification.recordClass] || 0) + 1; return acc; }, {}),
      apiCalls: this.requestLog.length,
      endpointCounts: this.requestLog.reduce((acc, r) => { acc[r.path.split('?')[0].replace(/\/{id}$/, '/{id}')] = (acc[r.path.split('?')[0].replace(/\/{id}$/, '/{id}')] || 0) + 1; return acc; }, {}),
      elapsedMs: Date.now() - startTime,
      profile,
      timestamp: new Date().toISOString()
    };

    return { summary, records };
  }
}

module.exports = { GhlAuthoritativeHydrator, ATLAS_FIELD_IDS, STAGE_BY_ID };
