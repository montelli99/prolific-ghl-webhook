'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

// Load env
const envFile = path.resolve(__dirname, '..', '..', 'secrets', '.env');
const content = fs.readFileSync(envFile, 'utf8');
const env = {};
for (const line of content.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}

const GHL_TOKEN = env.GHL_API_TOKEN || env.GHL_API_KEY;
const GHL_LOCATION = env.GHL_LOCATION_ID;
const JC_KEY = env.JUSTCALL_API_KEY;
const JC_SECRET = env.JUSTCALL_API_SECRET;
const SENDER_NUMBER = '+15716012619';

function ghlApi(method, ep, body) {
  return new Promise((resolve, reject) => {
    const u = new URL('https://services.leadconnectorhq.com' + ep);
    const opts = {
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + GHL_TOKEN, 'Version': '2021-07-28', 'Accept': 'application/json', 'Content-Type': 'application/json' }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, text: d.substring(0, 300) }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function jcApi(method, ep, body) {
  return new Promise((resolve, reject) => {
    const u = new URL('https://api.justcall.io' + ep);
    const auth = Buffer.from(JC_KEY + ':' + JC_SECRET).toString('base64');
    const opts = {
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json', 'Content-Type': 'application/json' }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, text: d.substring(0, 300) }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const { PlanStore } = require('../modules/plan-store');
  const store = new PlanStore();
  const plan = store.loadPlan('plan_694953d75b8ccc36');
  if (!plan) { console.log('PLAN NOT FOUND'); process.exit(1); }

  // Update status
  store.updateStatus('plan_694953d75b8ccc36', 'APPROVED_PENDING_EXECUTION', { executable: true });
  console.log('Status updated to APPROVED_PENDING_EXECUTION');

  const results = [];
  for (const item of plan.items) {
    console.log('\n--- Item ' + item.number + ': ' + item.contactName + ' ---');

    // Get real phone from GHL
    const contactRes = await ghlApi('GET', '/contacts/' + item.contactId);
    const contact = contactRes.data?.contact;
    const phone = contact?.phone || '';
    console.log('Phone:', phone);

    if (!phone) {
      results.push({ number: item.number, name: item.contactName, status: 'FAILED', reason: 'NO_PHONE' });
      continue;
    }

    // Send via JustCall
    store.updateStatus('plan_694953d75b8ccc36', 'EXECUTING');
    console.log('Sending to', phone, 'from', SENDER_NUMBER);
    console.log('Message:', item.renderedMessage);

    const sendRes = await jcApi('POST', '/v2.1/texts/new', {
      justcall_number: SENDER_NUMBER.replace(/\+/g, ''),
      contact_number: phone.replace(/\+/g, ''),
      body: item.renderedMessage,
    });

    console.log('JustCall response:', sendRes.status, JSON.stringify(sendRes.data).substring(0, 300));

    if (sendRes.status === 200 || sendRes.status === 201) {
      results.push({
        number: item.number,
        name: item.contactName,
        phone: phone.slice(0, 4) + '***' + phone.slice(-4),
        status: 'SENT',
        providerMessageId: sendRes.data?.id || sendRes.data?.message_id || null,
        timestamp: new Date().toISOString(),
      });
    } else {
      results.push({
        number: item.number,
        name: item.contactName,
        status: 'FAILED',
        reason: 'PROVIDER_ERROR',
        providerStatus: sendRes.status,
        providerResponse: sendRes.data || sendRes.text,
      });
    }

    // Rate limit between sends
    await new Promise(r => setTimeout(r, 2000));
  }

  // Update plan with results
  const allSent = results.every(r => r.status === 'SENT');
  store.updateStatus('plan_694953d75b8ccc36', allSent ? 'COMPLETED' : 'FAILED', {
    executionResults: results,
    productionEffects: {
      sends: results.filter(r => r.status === 'SENT').length,
      ghlWrites: 0,
      stageMovements: 0,
    },
    completedAt: new Date().toISOString(),
  });

  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('Status:', allSent ? 'COMPLETED' : 'FAILED');
  console.log('Sends:', results.filter(r => r.status === 'SENT').length);
  console.log('GHL writes: 0');
  console.log('Stage movements: 0');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
