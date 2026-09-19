'use strict';

const crypto = require('node:crypto');

const PPC_LOCATION_ID = 'GDq92uruRngbi9mLGGrV';
const PPC_PIPELINE_ID = 'ril84XHGQleRgE0W0FKU';
const MONTELLI_USER_ID = 'PGfXxlXCRXs3hXN3Gq7R';
const MONTELLI_LINE = '15716012619';
const PIPELINE_CHAT_ID = '-1003975794600';
const PIPELINE_THREAD_ID = 389;
const digits = value => String(value || '').replace(/\D/g, '');

function verifyJustCall(payload, headers, secret, now = Date.now()) {
  if (!secret || !payload || payload.type !== 'sms.received' || !payload.webhook_url) return false;
  const supplied = String(headers['x-justcall-signature'] || '');
  const timestamp = String(headers['x-justcall-request-timestamp'] || '');
  if (!/^[a-f0-9]{64}$/i.test(supplied) || !timestamp) return false;
  const at = Date.parse(timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`);
  if (!Number.isFinite(at) || Math.abs(now - at) > 24 * 60 * 60_000) return false;
  const material = `${secret}|${encodeURIComponent(payload.webhook_url)}|${payload.type}|${timestamp}`;
  const expected = crypto.createHmac('sha256', secret).update(material).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
}

function replyIdentity(payload) {
  const data = payload.data || {};
  const phone = digits(data.contact_number || data.from_number || data.from);
  const line = digits(data.justcall_number || data.to_number || data.to);
  const eventId = String(data.id || payload.request_id || '');
  if (!eventId || !/^1?[2-9]\d{9}$/.test(phone) || line !== MONTELLI_LINE) return null;
  return { eventId, phone: phone.length === 10 ? `1${phone}` : phone,
    body: String(data.sms_info?.body || data.body || '').trim().slice(0, 1000),
    mediaCount: Array.isArray(data.sms_info?.mms) ? data.sms_info.mms.length : 0,
    receivedAt: [data.sms_date, data.sms_time].filter(Boolean).join(' ') || new Date().toISOString() };
}

async function resolvePpcReply(phone, ghlGet) {
  const result = await ghlGet(`/contacts/?locationId=${PPC_LOCATION_ID}&query=%2B${phone}`);
  const contacts = (result.contacts || []).filter(contact => {
    const actual = digits(contact.phone);
    return actual === phone || actual === phone.slice(1);
  });
  const matches = [];
  for (const contact of contacts) {
    const found = await ghlGet(`/opportunities/search?location_id=${PPC_LOCATION_ID}&pipeline_id=${PPC_PIPELINE_ID}&contact_id=${encodeURIComponent(contact.id)}&limit=100`);
    for (const opp of found.opportunities || []) {
      if (opp.pipelineId === PPC_PIPELINE_ID && (opp.contactId || opp.contact?.id) === contact.id && opp.status === 'open') matches.push({ contact, opp });
    }
  }
  return matches;
}

function formatAlert(reply, matches) {
  const leadLines = matches.map(({ contact, opp }) => {
    const owner = opp.assignedTo === MONTELLI_USER_ID ? 'Montelli' : opp.assignedTo ? `another user (${opp.assignedTo})` : 'unassigned';
    return `• ${String(contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`).trim() || 'Seller'} — ${String(opp.name || 'property not named').slice(0, 160)}\n  Assigned: ${owner}; assignment source unverified\n  CRM: https://app.gohighlevel.com/v2/location/${PPC_LOCATION_ID}/contacts/detail/${contact.id}`;
  });
  return [matches.length ? 'New seller reply on your JustCall line' : 'Unmatched incoming text on your JustCall line',
    `From: +${reply.phone}`, `Received: ${reply.receivedAt}`,
    `Message: ${reply.body || (reply.mediaCount ? `[${reply.mediaCount} media attachment(s)]` : '[empty body]')}`,
    matches.length ? leadLines.join('\n') : 'No open PPC opportunity matched this phone. Review the thread before replying.',
    'Reply is for review. No seller text was sent by this alert.'].join('\n\n').slice(0, 3900);
}

async function handleReplyAlert(payload, headers, deps) {
  if (!verifyJustCall(payload, headers, deps.justcallSecret, deps.now?.() ?? Date.now())) return { status: 'invalid_signature' };
  const reply = replyIdentity(payload);
  if (!reply) return { status: 'not_montelli_line' };
  const matches = await resolvePpcReply(reply.phone, deps.ghlGet);
  const claimed = await deps.claim(reply.eventId);
  if (claimed === 'sent') return { status: 'duplicate' };
  if (claimed !== 'claimed') throw new Error('Reply alert already pending; retry later');
  try {
    await deps.sendTelegram(formatAlert(reply, matches));
    await deps.markSent(reply.eventId);
    return { status: 'sent', matches: matches.length };
  } catch (error) {
    await deps.release(reply.eventId);
    throw error;
  }
}

module.exports = { verifyJustCall, replyIdentity, resolvePpcReply, formatAlert, handleReplyAlert,
  PPC_LOCATION_ID, PIPELINE_CHAT_ID, PIPELINE_THREAD_ID };
