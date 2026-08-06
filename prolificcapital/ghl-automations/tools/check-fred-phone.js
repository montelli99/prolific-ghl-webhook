'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

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

const token = env.GHL_API_TOKEN || env.GHL_API_KEY;

function ghlGet(ep) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'services.leadconnectorhq.com', path: ep,
      headers: { 'Authorization': 'Bearer ' + token, 'Version': '2021-07-28', 'Accept': 'application/json' }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ text: d.substring(0, 500) }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // Fred McIntire contact
  const contactRes = await ghlGet('/contacts/H2B2QyA3JmG0XxzjB2pg');
  const c = contactRes.contact;
  console.log('Name:', c.firstName, c.lastName);
  console.log('Phone:', c.phone);
  console.log('Email:', c.email);
  console.log('Type:', c.type);
  console.log('Tags:', JSON.stringify(c.tags));
  console.log('Custom fields:', JSON.stringify(c.customFields, null, 2));

  // Also check the opportunity for any additional phone data
  const oppRes = await ghlGet('/opportunities/Y9s3qTQrdmxMdHLtFtJU');
  const opp = oppRes.opportunity;
  console.log('\nOpportunity:', opp?.name);
  console.log('Opp custom fields:', JSON.stringify(opp?.customFields, null, 2));
  console.log('Opp all keys:', Object.keys(opp || {}).join(', '));
}

main().catch(e => console.error(e));
