'use strict';
const fs = require('fs');
const https = require('https');

const env = Object.fromEntries(
  fs.readFileSync('C:/Users/mscott/AI_Workspace/prolificcapital/secrets/.env', 'utf8').split(/\r?\n/)
    .map(line => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(match => [match[1], match[2].replace(/^['"]|['"]$/g, '').trim()])
);
const token = env.GHL_API_TOKEN || env.GHL_API_KEY;

function ghlGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'services.leadconnectorhq.com',
      path: path,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Version: '2023-02-21' },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function main() {
  const locId = '61XPzSqRy7UKMwW9DeB8';
  console.log('Fetching workflows for location', locId, '...');
  const result = await ghlGet('/workflows/?locationId=' + locId + '&limit=100');
  console.log('Status:', result.status);
  if (result.body && result.body.workflows) {
    console.log('Count:', result.body.workflows.length);
    result.body.workflows.forEach((w, i) => {
      console.log((i+1) + '. [' + (w.status || '?') + '] ' + (w.name || 'unnamed') + ' (id=' + w.id + ')');
    });
  } else {
    console.log('Response:', JSON.stringify(result.body).substring(0, 500));
  }
}
main().catch(e => console.error('Error:', e.message));
