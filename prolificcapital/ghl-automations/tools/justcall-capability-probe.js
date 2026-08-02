'use strict';

const https = require('https');
const JUSTCALL_BASE = 'api.justcall.io';
const JUSTCALL_API_VERSION = 'v2.1';
const API_KEY = 'a02aa39621da49ff1e61ba7195a219b2d0bb3162';
const API_SECRET = 'a06466df20a19fc0114fcc97a3edc2e334ec73dd';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: JUSTCALL_BASE, method, path,
      headers: {
        'Authorization': `${API_KEY}:${API_SECRET}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
        } catch (e) {
          resolve({ status: res.statusCode, body: text, parseError: e.message });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function probe(name, method, path, body) {
  try {
    const result = await request(method, path, body);
    const summary = { name, method, path, status: result.status, ok: result.status >= 200 && result.status < 300 };
    if (result.body && typeof result.body === 'object') {
      summary.keys = Object.keys(result.body).slice(0, 10);
      summary.count = result.body.count;
      summary.total_count = result.body.total_count;
      summary.dataLength = Array.isArray(result.body.data) ? result.body.data.length : undefined;
      if (Array.isArray(result.body.data) && result.body.data.length > 0) {
        summary.firstItemKeys = Object.keys(result.body.data[0]).slice(0, 15);
      }
    }
    if (result.parseError) summary.parseError = result.parseError;
    if (result.status >= 400) summary.error = typeof result.body === 'string' ? result.body.slice(0, 200) : JSON.stringify(result.body).slice(0, 200);
    return summary;
  } catch (e) {
    return { name, method, path, ok: false, error: e.message };
  }
}

async function main() {
  const results = [];

  results.push(await probe('users', 'GET', `/${JUSTCALL_API_VERSION}/users`));
  results.push(await probe('calls (recent 5)', 'GET', `/${JUSTCALL_API_VERSION}/calls?per_page=5&order=desc`));
  results.push(await probe('texts (recent 5)', 'GET', `/${JUSTCALL_API_VERSION}/texts?per_page=5&order=desc`));
  results.push(await probe('texts (outbound only)', 'GET', `/${JUSTCALL_API_VERSION}/texts?per_page=5&order=desc&direction=outgoing`));
  results.push(await probe('texts (inbound only)', 'GET', `/${JUSTCALL_API_VERSION}/texts?per_page=5&order=desc&direction=incoming`));
  results.push(await probe('blacklist', 'GET', `/${JUSTCALL_API_VERSION}/contacts/blacklist`));
  results.push(await probe('blacklist (alt path)', 'GET', `/${JUSTCALL_API_VERSION}/blacklist`));
  results.push(await probe('phone-numbers', 'GET', `/${JUSTCALL_API_VERSION}/phone-numbers`));
  results.push(await probe('webhooks', 'GET', `/${JUSTCALL_API_VERSION}/webhooks`));
  results.push(await probe('account', 'GET', `/${JUSTCALL_API_VERSION}/account`));
  results.push(await probe('billing', 'GET', `/${JUSTCALL_API_VERSION}/billing`));
  results.push(await probe('credits', 'GET', `/${JUSTCALL_API_VERSION}/credits`));
  results.push(await probe('plan', 'GET', `/${JUSTCALL_API_VERSION}/plan`));
  results.push(await probe('teams', 'GET', `/${JUSTCALL_API_VERSION}/teams`));
  results.push(await probe('agents', 'GET', `/${JUSTCALL_API_VERSION}/agents`));
  results.push(await probe('sms-numbers', 'GET', `/${JUSTCALL_API_VERSION}/sms-numbers`));
  results.push(await probe('texts/search (alt)', 'GET', `/${JUSTCALL_API_VERSION}/texts/search?per_page=5`));
  results.push(await probe('contacts', 'GET', `/${JUSTCALL_API_VERSION}/contacts?per_page=5`));
  results.push(await probe('opt-out', 'GET', `/${JUSTCALL_API_VERSION}/opt-out`));
  results.push(await probe('suppression', 'GET', `/${JUSTCALL_API_VERSION}/suppression`));

  console.log(JSON.stringify({ probeTimestamp: new Date().toISOString(), apiVersion: JUSTCALL_API_VERSION, results }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
