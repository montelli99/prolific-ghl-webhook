const https = require('https');
const p = JSON.stringify({ type: 'OpportunityCreate', id: 'test123', name: '123 Main St', monetaryValue: 50000 });
const hostname = process.env.GHL_WEBHOOK_HOST;
if (!hostname) {
  console.error('Set GHL_WEBHOOK_HOST to the Divinity Aligned Render webhook host before running this test.');
  process.exit(1);
}
const o = {
  hostname,
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
