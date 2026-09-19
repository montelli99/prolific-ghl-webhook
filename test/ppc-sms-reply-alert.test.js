'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { handleReplyAlert, verifyJustCall } = require('../ppc-sms-reply-alert');

const secret = 'test-secret';
function event({ line = '+15716012619', id = 'sms-1' } = {}) {
  const payload = { type: 'sms.received', request_id: 'request-1', webhook_url: 'https://example.test/webhook/justcall',
    data: { id, contact_number: '+15551234567', justcall_number: line,
      sms_date: '2026-09-19', sms_time: '10:00:00', sms_info: { body: 'Can I send photos tomorrow?' } } };
  const timestamp = new Date().toISOString();
  const material = `${secret}|${encodeURIComponent(payload.webhook_url)}|${payload.type}|${timestamp}`;
  const headers = { 'x-justcall-request-timestamp': timestamp,
    'x-justcall-signature': crypto.createHmac('sha256', secret).update(material).digest('hex') };
  return { payload, headers };
}

test('signed incoming reply alerts Pipeline once without seller or CRM writes', async () => {
  const { payload, headers } = event();
  const claimed = new Set();
  const sent = [];
  const deps = { justcallSecret: secret,
    ghlGet: async path => path.startsWith('/contacts/?') ?
      { contacts: [{ id: 'contact-1', name: 'Seller One', phone: '+15551234567' }] } :
      { opportunities: [{ id: 'opp-1', contactId: 'contact-1', pipelineId: 'ril84XHGQleRgE0W0FKU', status: 'open', name: '123 Main', assignedTo: 'PGfXxlXCRXs3hXN3Gq7R' }] },
    claim: async id => claimed.has(id) ? 'sent' : (claimed.add(id), 'claimed'),
    sendTelegram: async text => { sent.push(text); }, markSent: async () => {}, release: async () => {} };
  assert.equal((await handleReplyAlert(payload, headers, deps)).status, 'sent');
  assert.equal((await handleReplyAlert(payload, headers, deps)).status, 'duplicate');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Seller One/);
  assert.match(sent[0], /Can I send photos tomorrow/);
  assert.match(sent[0], /Assigned: Montelli; assignment source unverified/);
});

test('rejects unsigned events and ignores other JustCall lines', async () => {
  const { payload, headers } = event();
  assert.equal(verifyJustCall(payload, { ...headers, 'x-justcall-signature': 'a'.repeat(64) }, secret), false);
  const other = event({ line: '+15557654321' });
  const deps = { justcallSecret: secret, ghlGet: async () => { throw Error('must not look up'); } };
  assert.equal((await handleReplyAlert(other.payload, other.headers, deps)).status, 'not_montelli_line');
});
