'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JustCallIntegration } = require('./justcall-integration');

const CARD_STATES = Object.freeze({
  CCC_TEXT_REQUIRED: 'CCC_TEXT_REQUIRED',
  CCC_TEXT_SENT: 'CCC_TEXT_SENT',
  CONTACT_CARD_REQUIRED: 'CONTACT_CARD_REQUIRED',
  CONTACT_CARD_SENT: 'CONTACT_CARD_SENT',
  CONTACT_CARD_FAILED: 'CONTACT_CARD_FAILED',
  CONTACT_CARD_UNCERTAIN: 'CONTACT_CARD_UNCERTAIN',
});

const CARD_SPEC_PATH = path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json');
const VCF_ASSET_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'montelli-scott-divinity-aligned.vcf');
const EXPECTED_VCF_HASH = '77bbcbdab80a604d3161d0a898fd92e1832d258c7c91a41349a86a5d18f60065';
const PUBLIC_MEDIA_BASE_URL = process.env.CONTACT_CARD_MEDIA_BASE_URL || 'https://prolific-ghl-webhook-0b16.onrender.com';
const PUBLIC_VCF_PATH = '/assets/contact-cards/montelli-scott-divinity-aligned-v2.vcf';

class ContactCardDelivery {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.JUSTCALL_API_KEY || '';
    this.apiSecret = config.apiSecret || process.env.JUSTCALL_API_SECRET || '';
    this.fromNumber = config.fromNumber || process.env.JUSTCALL_FROM_NUMBER || '+15716012619';
    this.cardSpecPath = config.cardSpecPath || CARD_SPEC_PATH;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiSecret && this.fromNumber);
  }

  loadCardSpec() {
    if (!fs.existsSync(this.cardSpecPath)) return null;
    try {
      const spec = JSON.parse(fs.readFileSync(this.cardSpecPath, 'utf8'));
      const missing = this._missingFields(spec);
      if (missing.length > 0) {
        return { ...spec, _incomplete: true, _missingFields: missing };
      }
      return spec;
    } catch (e) {
      return null;
    }
  }

  _missingFields(spec) {
    const required = ['fullName', 'title', 'company', 'primaryPhone', 'email', 'website'];
    return required.filter(f => !spec.fields[f] || !spec.fields[f].value);
  }

  generateVCF(spec) {
    if (!spec || spec._incomplete) throw new Error('CONTACT_CARD_SPEC_INCOMPLETE');
    const f = spec.fields;
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    if (f.fullName) {
      const nameParts = String(f.fullName.value).trim().split(/\s+/);
      const lastName = nameParts.pop() || '';
      const firstName = nameParts.join(' ') || '';
      lines.push(`N:${lastName};${firstName};;;`);
      lines.push(`FN:${f.fullName.value}`);
    }
    if (f.company) lines.push(`ORG:${f.company.value}`);
    if (f.title) lines.push(`TITLE:${f.title.value}`);
    if (f.primaryPhone) lines.push(`TEL;TYPE=CELL,VOICE:${f.primaryPhone.value}`);
    if (f.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${f.email.value}`);
    if (f.website) lines.push(`URL:${f.website.value}`);
    lines.push('END:VCARD');
    return lines.join('\n');
  }

  async sendContactCard(recipientPhone, options = {}) {
    if (!this.isConfigured()) {
      return { ok: false, state: 'CONTACT_CARD_FAILED', reason: 'NOT_CONFIGURED' };
    }

    const spec = this.loadCardSpec();
    if (!spec) {
      return { ok: false, state: 'CONTACT_CARD_FAILED', reason: 'CARD_SPEC_NOT_FOUND' };
    }
    if (spec._incomplete) {
      return { ok: false, state: 'CONTACT_CARD_FAILED', reason: `CARD_SPEC_INCOMPLETE: missing ${spec._missingFields.join(', ')}` };
    }

    const vcf = this.generateVCF(spec);
    const vcfHash = crypto.createHash('sha256').update(vcf).digest('hex');
    if (vcfHash !== EXPECTED_VCF_HASH) {
      return { ok: false, state: 'CONTACT_CARD_FAILED', reason: `VCF_HASH_MISMATCH: expected ${EXPECTED_VCF_HASH.slice(0,16)}, got ${vcfHash.slice(0,16)}` };
    }

    const mediaUrl = `${PUBLIC_MEDIA_BASE_URL}${PUBLIC_VCF_PATH}`;

    const preflight = await this._mediaPreflight(mediaUrl, vcfHash);
    if (!preflight.ok) {
      return { ok: false, state: 'CONTACT_CARD_FAILED', reason: `MEDIA_PREFLIGHT_FAILED: ${preflight.reason}` };
    }

    const justcall = new JustCallIntegration({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      fromNumber: this.fromNumber,
    });

    try {
      const result = await justcall.sendContactCard(recipientPhone, mediaUrl, {
        from: this.fromNumber,
        body: options.body || 'Montelli contact card — tap the attached file to add my contact.',
      });

      if (!result || !result.messageId) {
        return { ok: false, state: 'CONTACT_CARD_UNCERTAIN', reason: 'NO_MESSAGE_ID', vcfHash: vcfHash.slice(0, 16) };
      }

      const providerDetail = await this._fetchProviderDetail(result.messageId);
      const isMms = providerDetail?.sms_info?.is_mms === 'yes' || providerDetail?.sms_info?.is_mms === 'Yes';
      const hasMedia = Array.isArray(providerDetail?.sms_info?.mms) && providerDetail.sms_info.mms.length > 0;

      if (!isMms || !hasMedia) {
        return {
          ok: false,
          state: 'CONTACT_CARD_TEST_TRANSPORT_FAILED',
          reason: 'DELIVERED_AS_TEXT_NOT_CONTACT_CARD',
          providerMessageId: String(result.messageId).slice(0, 16),
          vcfHash: vcfHash.slice(0, 16),
          providerDetail,
        };
      }

      return {
        ok: true,
        state: 'CONTACT_CARD_PROVIDER_DELIVERED_AWAITING_DEVICE_CONFIRMATION',
        providerMessageId: String(result.messageId).slice(0, 16),
        vcfHash: vcfHash.slice(0, 16),
        mediaUrl,
        sentAt: new Date().toISOString(),
        recipient: recipientPhone ? `${recipientPhone.slice(0, 4)}***${recipientPhone.slice(-4)}` : null,
        providerDetail,
      };
    } catch (e) {
      return { ok: false, state: 'CONTACT_CARD_FAILED', reason: `PROVIDER_ERROR: ${e.message}` };
    }
  }

  async _mediaPreflight(mediaUrl, expectedHash) {
    const https = require('https');
    const http = require('http');
    return new Promise((resolve) => {
      const client = mediaUrl.startsWith('https://') ? https : http;
      const req = client.get(mediaUrl, { timeout: 15000 }, (res) => {
        if (res.statusCode !== 200) {
          return resolve({ ok: false, reason: `HTTP_${res.statusCode}` });
        }
        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('text/vcard') && !contentType.includes('text/directory')) {
          return resolve({ ok: false, reason: `WRONG_CONTENT_TYPE: ${contentType}` });
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (!body.startsWith('BEGIN:VCARD')) {
            return resolve({ ok: false, reason: 'NOT_A_VCARD' });
          }
          if (!body.endsWith('END:VCARD\n') && !body.endsWith('END:VCARD')) {
            return resolve({ ok: false, reason: 'VCARD_NOT_TERMINATED' });
          }
          if (body.includes('<html') || body.includes('<!DOCTYPE')) {
            return resolve({ ok: false, reason: 'HTML_RESPONSE_NOT_VCARD' });
          }
          const actualHash = crypto.createHash('sha256').update(body).digest('hex');
          if (actualHash !== expectedHash) {
            return resolve({ ok: false, reason: `HASH_MISMATCH: expected ${expectedHash.slice(0,16)}, got ${actualHash.slice(0,16)}` });
          }
          resolve({ ok: true, hash: actualHash, contentType, size: body.length });
        });
      });
      req.on('error', (e) => resolve({ ok: false, reason: `FETCH_ERROR: ${e.message}` }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'TIMEOUT' }); });
    });
  }

  async _fetchProviderDetail(messageId) {
    if (!messageId) return null;
    const justcall = new JustCallIntegration({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      fromNumber: this.fromNumber,
    });
    try {
      const raw = await justcall._justcallRequest('GET', '/v2.1/texts/' + messageId, null, { retried: 0 });
      return raw?.data || raw;
    } catch (_) {
      return null;
    }
  }

  getReadiness() {
    const spec = this.loadCardSpec();
    if (!spec) return { ready: false, reason: 'CARD_SPEC_NOT_FOUND', state: 'CONTACT_CARD_REQUIRED' };
    if (spec._incomplete && spec._missingFields) {
      return { ready: false, reason: `CARD_SPEC_INCOMPLETE: missing ${spec._missingFields.join(', ')}`, state: 'CONTACT_CARD_REQUIRED', missingFields: spec._missingFields };
    }
    if (spec._incomplete && spec._missingRequiredFields) {
      return {
        ready: false,
        readyForSelfTest: true,
        reason: `MISSING_COURSE_REQUIRED: ${spec._missingRequiredFields.join(', ')}`,
        state: 'CONTACT_CARD_REQUIRED',
        missingRequiredFields: spec._missingRequiredFields,
        cardHash: spec.cardHash,
      };
    }
    return { ready: true, readyForSelfTest: true, reason: 'CARD_SPEC_COMPLETE', state: 'CONTACT_CARD_REQUIRED', cardHash: spec.cardHash };
  }
}

module.exports = { ContactCardDelivery, CARD_STATES };
