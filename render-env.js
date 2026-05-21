const https = require('https');
const p = JSON.stringify([
  { key: 'ghl_api_key', value: 'pit-598ce224-4abf-4b4b-be79-7ee3c3bfd17f', fromGroup: false },
  { key: 'ghl_location_id', value: '61XPzSqRy7UKMwW9DeB8', fromGroup: false }
]);
const o = {
  hostname: 'api.render.com',
  path: '/v1/services/srv-d87l6c1kh4rs73ap9srg',
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer rnd_YB8uHPKZDJRDpC2yMAUXFzAPmLBV',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(p)
  }
};
const r = https.request(o, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log(res.statusCode, d.substring(0, 500)));
});
r.on('error', e => console.log(e.message));
r.write(p);
r.end();