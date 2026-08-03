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
      const missingRequired = (spec.missingRequiredFields || []).filter(f => {
        const field = spec.fields?.[f];
        return field && field.classification === 'COURSE_EXPLICIT_REQUIRED';
      });
      if (missing.length > 0) {
        return { ...spec, _incomplete: true, _missingFields: missing };
      }
      if (missingRequired.length > 0) {
        return { ...spec, _incomplete: true, _missingRequiredFields: missingRequired, _readyForSelfTest: true };
      }
      return spec;
    } catch (e) {
      return null;
    }
  }

  _missingFields(spec) {
    const required = ['fullName', 'title', 'company', 'primaryPhone'];
    return required.filter(f => !spec.fields[f] || !spec.fields[f].value);
  }

  generateVCF(spec) {
    if (!spec || spec._incomplete) throw new Error('CONTACT_CARD_SPEC_INCOMPLETE');
    const f = spec.fields;
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    if (f.fullName) lines.push(`FN:${f.fullName}`);
    if (f.title) lines.push(`TITLE:${f.title}`);
    if (f.company) lines.push(`ORG:${f.company}`);
    if (f.primaryPhone) lines.push(`TEL;TYPE=CELL:${f.primaryPhone}`);
    if (f.email) lines.push(`EMAIL:${f.email}`);
    if (f.website) lines.push(`URL:${f.website}`);
    if (f.businessAddress) lines.push(`ADR:;;${f.businessAddress}`);
    if (f.notes) lines.push(`NOTE:${f.notes}`);
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
    const vcfHash = crypto.createHash('sha256').update(vcf).digest('hex').slice(0, 16);

    const justcall = new JustCallIntegration({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      fromNumber: this.fromNumber,
    });

    try {
      const result = await justcall.sendSMS(recipientPhone, vcf, {
        from: this.fromNumber,
        mediaUrl: options.mediaUrl || undefined,
      });

      if (!result || !result.messageId) {
        return { ok: false, state: 'CONTACT_CARD_UNCERTAIN', reason: 'NO_MESSAGE_ID', vcfHash };
      }

      return {
        ok: true,
        state: 'CONTACT_CARD_SENT',
        providerMessageId: String(result.messageId).slice(0, 16),
        vcfHash,
        sentAt: new Date().toISOString(),
        recipient: recipientPhone ? `${recipientPhone.slice(0, 4)}***${recipientPhone.slice(-4)}` : null,
      };
    } catch (e) {
      return { ok: false, state: 'CONTACT_CARD_FAILED', reason: `PROVIDER_ERROR: ${e.message}` };
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
    return { ready: true, reason: 'CARD_SPEC_COMPLETE', state: 'CONTACT_CARD_REQUIRED', cardHash: spec.cardHash };
  }
}

module.exports = { ContactCardDelivery, CARD_STATES };
