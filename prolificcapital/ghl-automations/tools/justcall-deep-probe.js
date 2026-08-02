'use strict';

const https = require('https');
const JUSTCALL_BASE = 'api.justcall.io';
const API_KEY = 'a02aa39621da49ff1e61ba7195a219b2d0bb3162';
const API_SECRET = 'a06466df20a19fc0114fcc97a3edc2e334ec73dd';

function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: JUSTCALL_BASE, method, path,
      headers: { 'Authorization': `${API_KEY}:${API_SECRET}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (e) { resolve({ status: res.statusCode, body: text }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const results = {};

  const texts = await request('GET', '/v2.1/texts?per_page=3&order=desc');
  results.textsSample = texts.body?.data?.slice(0, 3).map(t => ({
    id: t.id, direction: t.direction, contact_number: t.contact_number,
    justcall_number: t.justcall_number, sms_date: t.sms_date, sms_time: t.sms_time,
    hasBody: 'body' in t, hasStatus: 'status' in t, hasDelivery: 'delivery_status' in t,
    allKeys: Object.keys(t),
  })) || [];

  if (texts.body?.data?.[0]?.id) {
    const detail = await request('GET', `/v2.1/texts/${texts.body.data[0].id}`);
    results.textDetail = { status: detail.status, keys: detail.body?.data ? Object.keys(detail.body.data) : Object.keys(detail.body || {}), hasBody: 'body' in (detail.body?.data || detail.body || {}) };
  }

  const phones = await request('GET', '/v2.1/phone-numbers');
  results.phoneNumbers = phones.body?.data?.map(p => ({
    id: p.id, number: p.justcall_number, friendly: p.friendly_number,
    lineName: p.justcall_line_name, type: p.number_type,
    smsCompliance: p.sms_compliance, capabilities: p.capabilities,
    status: p.current_status, businessReg: p.business_registration,
  })) || [];

  const contacts = await request('GET', '/v2.1/contacts?per_page=3');
  results.contactsSample = contacts.body?.data?.slice(0, 3).map(c => ({
    id: c.id, name: c.name, contact_number: c.contact_number,
    status: c.status, status_updated_at: c.status_updated_at,
    allKeys: Object.keys(c),
  })) || [];

  const blacklist = await request('GET', '/v2.1/contacts/blacklist?per_page=100');
  results.blacklist = { count: blacklist.body?.count, total: blacklist.body?.total_count, dataLength: blacklist.body?.data?.length };

  const webhooks = await request('GET', '/v2.1/webhooks');
  results.webhooks = { count: webhooks.body?.count, data: webhooks.body?.data };

  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
