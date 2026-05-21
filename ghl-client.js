// ghl-client.js — Production GHL API v2 client
// Docs: https://marketplace.gohighlevel.com/docs/
// Auth: Private Integration Token (Bearer)
// Base: https://services.leadconnectorhq.com/

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const GHL_BASE = 'https://services.leadconnectorhq.com';

class GhlClient {
  constructor(apiKey, locationId) {
    this.apiKey = apiKey;
    this.locationId = locationId;
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    };
  }

  async _request(method, path, body = null) {
    const url = `${GHL_BASE}${path}`;
    const opts = { method, headers: { ...this.headers } };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GHL API ${res.status}: ${err.substring(0, 500)}`);
    }
    return res.json();
  }

  // ── Opportunities ──

  /** GET /opportunities/:id — fetch a single opportunity by GHL id */
  async getOpportunity(opportunityId) {
    return this._request('GET', `/opportunities/${opportunityId}`);
  }

  /** GET /opportunities/search?location_id=... — list all opportunities for location */
  async searchOpportunities(params = {}) {
    const qs = new URLSearchParams({ location_id: this.locationId, ...params }).toString();
    return this._request('GET', `/opportunities/search?${qs}`);
  }

  /** PUT /opportunities/:id — update opportunity stage/status */
  async updateOpportunity(opportunityId, data) {
    return this._request('PUT', `/opportunities/${opportunityId}`, data);
  }

  /** PUT /opportunities/:id/status — update opportunity status */
  async updateOpportunityStatus(opportunityId, status) {
    return this._request('PUT', `/opportunities/${opportunityId}/status`, { status });
  }

  // ── Pipelines ──

  /** GET /pipelines?locationId=... — get all pipelines and their stages for location */
  async getPipelines() {
    const qs = new URLSearchParams({ locationId: this.locationId }).toString();
    return this._request('GET', `/pipelines?${qs}`);
  }

  // ── Contacts ──

  /** GET /contacts/:id — fetch contact details (email, phone, name) */
  async getContact(contactId) {
    return this._request('GET', `/contacts/${contactId}`);
  }

  /** GET /contacts/?locationId=...&query=... — search contacts */
  async searchContacts(query) {
    const qs = new URLSearchParams({ locationId: this.locationId, query }).toString();
    return this._request('GET', `/contacts/?${qs}`);
  }

  // ── Users ──

  /** GET /users/?locationId=... — get users (to resolve assignedTo) */
  async getUsers() {
    const qs = new URLSearchParams({ locationId: this.locationId }).toString();
    return this._request('GET', `/users/?${qs}`);
  }

  // ── Calendars ──

  /** GET /calendars/events?locationId=... — get calendar events */
  async getCalendarEvents(params = {}) {
    const qs = new URLSearchParams({ locationId: this.locationId, ...params }).toString();
    return this._request('GET', `/calendars/events?${qs}`);
  }

  // ── Call Recordings ──

  /** GET /conversations/:id — get conversation including recording URL */
  async getConversation(conversationId) {
    return this._request('GET', `/conversations/${conversationId}`);
  }

  /** GET /conversations/search?locationId=... — search conversations */
  async searchConversations(params = {}) {
    const qs = new URLSearchParams({ locationId: this.locationId, ...params }).toString();
    return this._request('GET', `/conversations/search?${qs}`);
  }
}

module.exports = { GhlClient, GHL_BASE };
