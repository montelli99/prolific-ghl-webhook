const https = require('https');
const p = JSON.stringify({ locationId: '' });
const o = {
  hostname: 'services.leadconnectorhq.com',
  path: '/locations/',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer pit-b777a352-9cb7-4303-82bb-78758d7c4198',
    'Content-Type': 'application/json',
    'Version': '2021-07-28'
  }
};
const r = https.request(o, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', d.substring(0, 1000));
  });
});
r.on('error', e => console.log('Error:', e.message));
r.end();