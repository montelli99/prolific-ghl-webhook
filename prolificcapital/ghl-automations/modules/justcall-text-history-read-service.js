'use strict';

const https = require('https');
const JUSTCALL_BASE = 'api.justcall.io';
const JUSTCALL_API_VERSION = 'v2.1';

class JustCallTextHistoryReadService {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.JUSTCALL_API_KEY || '';
    this.apiSecret = config.apiSecret || process.env.JUSTCALL_API_SECRET || '';
    this.senderSuffix = config.senderSuffix || '2619';
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

  async fetchTextHistory(phone, options = {}) {
    if (!this.isConfigured()) {
      return { ok: false, reason: 'NOT_CONFIGURED', outboundHistory: 'UNKNOWN', pendingReply: 'UNKNOWN', deliveryState: 'UNKNOWN' };
    }
    try {
      const normalized = this.normalizePhone(phone);
      const digits = normalized.replace(/\D/g, '');
      const searchNumber = digits.length >= 10 ? `+${digits.slice(-11)}` : normalized;
      const maxPages = options.maxPages || 5;
      const perPage = options.perPage || 100;

      const allTexts = [];
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= maxPages) {
        const result = await this._request('GET', `/${JUSTCALL_API_VERSION}/texts?per_page=${perPage}&page=${page}&order=desc`);
        if (result.status !== 200) {
          return { ok: false, reason: `API_ERROR_${result.status}`, outboundHistory: 'UNKNOWN', pendingReply: 'UNKNOWN', deliveryState: 'UNKNOWN', texts: allTexts };
        }
        const data = result.body?.data || [];
        const relevant = data.filter(t => {
          const contactNum = this.normalizePhone(t.contact_number || '');
          const justcallNum = this.normalizePhone(t.justcall_number || '');
          return contactNum === normalized || justcallNum === normalized;
        });
        allTexts.push(...relevant);
        hasMore = data.length === perPage && page < maxPages;
        page++;
      }

      const outbound = allTexts.filter(t => String(t.direction || '').toLowerCase() === 'outgoing');
      const inbound = allTexts.filter(t => String(t.direction || '').toLowerCase() === 'incoming');
      const senderTexts = outbound.filter(t => {
        const num = this.normalizePhone(t.justcall_number || '');
        return num.includes(this.senderSuffix);
      });

      const outboundHistory = senderTexts.length > 0 ? 'PRIOR_SEND_FOUND' : outbound.length > 0 ? 'PRIOR_SEND_FOUND' : 'CLEAR_NO_PRIOR_SEND';
      const pendingReply = inbound.length > 0 ? 'INBOUND_REPLY_REQUIRES_HUMAN' : 'CLEAR';

      let deliveryState = 'NOT_APPLICABLE';
      if (senderTexts.length > 0) {
        const latest = senderTexts[0];
        const ds = String(latest.delivery_status || '').toLowerCase();
        if (ds === 'delivered') deliveryState = 'DELIVERED';
        else if (ds === 'accepted' || ds === 'sent') deliveryState = 'ACCEPTED';
        else if (ds === 'failed' || ds === 'undelivered') deliveryState = 'FAILED';
        else deliveryState = 'UNKNOWN';
      }

      return {
        ok: true,
        reason: 'COMPLETE',
        outboundHistory,
        pendingReply,
        deliveryState,
        outboundCount: outbound.length,
        inboundCount: inbound.length,
        senderOutboundCount: senderTexts.length,
        latestOutboundAt: senderTexts[0] ? `${senderTexts[0].sms_date}T${senderTexts[0].sms_time}` : null,
        latestInboundAt: inbound[0] ? `${inbound[0].sms_date}T${inbound[0].sms_time}` : null,
        paginationComplete: !hasMore,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { ok: false, reason: `REQUEST_ERROR: ${e.message}`, outboundHistory: 'UNKNOWN', pendingReply: 'UNKNOWN', deliveryState: 'UNKNOWN' };
    }
  }
}

module.exports = { JustCallTextHistoryReadService };
