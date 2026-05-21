const https = require('https');
const p = JSON.stringify({ type: 'OpportunityCreate', id: 'test123', name: '123 Main St', monetaryValue: 50000 });
const o = {
  hostname: 'prolific-ghl-webhook.onrender.com',
  path: '/webhook/ghl',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }
};
const r = https.request(o, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', d));
});
r.on('error', e => console.log('Error:', e.message));
r.write(p);
r.end();