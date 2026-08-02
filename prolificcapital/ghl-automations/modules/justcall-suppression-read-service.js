'use strict';

const https = require('https');
const JUSTCALL_BASE = 'api.justcall.io';
const JUSTCALL_API_VERSION = 'v2.1';

class JustCallSuppressionReadService {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.JUSTCALL_API_KEY || '';
    this.apiSecret = config.apiSecret || process.env.JUSTCALL_API_SECRET || '';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiSecret);
  }

  _request(method, path) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: JUSTCALL_BASE, method, path,
        headers: { 'Authorization': `${this.apiKey}:${this.apiSecret}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      }, (res) => {
        let chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
          catch (e) { resolve({ status: res.statusCode, body: text, parseError: e.message }); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return digits;
  }

  async fetchBlacklist() {
    if (!this.isConfigured()) {
      return { ok: false, reason: 'NOT_CONFIGURED', blacklistedPhones: new Set(), completeness: 'UNKNOWN' };
    }
    try {
      const allPhones = new Set();
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await this._request('GET', `/${JUSTCALL_API_VERSION}/contacts/blacklist?per_page=100&page=${page}`);
        if (result.status !== 200) {
          return { ok: false, reason: `API_ERROR_${result.status}`, blacklistedPhones: allPhones, completeness: 'PARTIAL' };
        }
        const data = result.body?.data || [];
        for (const entry of data) {
          const phone = this.normalizePhone(entry.contact_number || entry.number || '');
          if (phone) allPhones.add(phone);
        }
        hasMore = data.length === 100;
        page++;
      }
      return { ok: true, reason: 'COMPLETE', blacklistedPhones: allPhones, completeness: 'COMPLETE', count: allPhones.size };
    } catch (e) {
      return { ok: false, reason: `REQUEST_ERROR: ${e.message}`, blacklistedPhones: new Set(), completeness: 'UNKNOWN' };
    }
  }

  async checkPhone(phone) {
    if (!this.isConfigured()) return { state: 'UNKNOWN', reason: 'NOT_CONFIGURED', source: 'JustCall blacklist' };
    try {
      const normalized = this.normalizePhone(phone);
      const blacklist = await this.fetchBlacklist();
      if (!blacklist.ok) return { state: 'UNKNOWN', reason: blacklist.reason, source: 'JustCall blacklist' };
      if (blacklist.blacklistedPhones.has(normalized)) {
        return { state: 'BLOCKED', reason: 'PHONE_IN_JUSTCALL_BLACKLIST', source: 'JustCall blacklist', checkedAt: new Date().toISOString() };
      }
      return { state: 'CLEAR', reason: 'NOT_IN_JUSTCALL_BLACKLIST', source: 'JustCall blacklist', checkedAt: new Date().toISOString() };
    } catch (e) {
      return { state: 'UNKNOWN', reason: `ERROR: ${e.message}`, source: 'JustCall blacklist' };
    }
  }

  async checkContactStatus(phone) {
    if (!this.isConfigured()) return { state: 'UNKNOWN', reason: 'NOT_CONFIGURED', source: 'JustCall contact status' };
    try {
      const normalized = this.normalizePhone(phone);
      const digits = normalized.replace(/\D/g, '');
      const searchNumber = digits.length >= 10 ? `+${digits.slice(-11)}` : normalized;
      const result = await this._request('GET', `/${JUSTCALL_API_VERSION}/contacts?contact_number=${encodeURIComponent(searchNumber)}`);
      if (result.status !== 200) return { state: 'UNKNOWN', reason: `API_ERROR_${result.status}`, source: 'JustCall contact status' };
      const contacts = result.body?.data || [];
      if (contacts.length === 0) return { state: 'CLEAR', reason: 'NO_JUSTCALL_CONTACT', source: 'JustCall contact status', checkedAt: new Date().toISOString() };
      const contact = contacts[0];
      const status = contact.status || {};
      if (status.blacklist || status.dnd || status.dnm) {
        return { state: 'BLOCKED', reason: 'JUSTCALL_CONTACT_STATUS_BLOCKED', source: 'JustCall contact status', details: status, checkedAt: new Date().toISOString() };
      }
      return { state: 'CLEAR', reason: 'JUSTCALL_CONTACT_CLEAR', source: 'JustCall contact status', checkedAt: new Date().toISOString() };
    } catch (e) {
      return { state: 'UNKNOWN', reason: `ERROR: ${e.message}`, source: 'JustCall contact status' };
    }
  }
}

module.exports = { JustCallSuppressionReadService };
