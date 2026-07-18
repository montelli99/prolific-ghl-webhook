const https = require('https');
const p = JSON.stringify([
  { key: 'GHL_API_KEY', value: process.env.GHL_API_KEY || '', fromGroup: false },
  { key: 'GHL_LOCATION_ID', value: process.env.GHL_LOCATION_ID || '', fromGroup: false },
  { key: 'JUSTCALL_AUTH', value: process.env.JUSTCALL_AUTH || '', fromGroup: false },
  { key: 'TELNYX_KEY', value: process.env.TELNYX_KEY || '', fromGroup: false },
  { key: 'ELEVENLABS_KEY', value: process.env.ELEVENLABS_KEY || '', fromGroup: false }
]);
const o = {
  hostname: 'api.render.com',
  path: '/v1/services/srv-d87l6c1kh4rs73ap9srg',
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${process.env.RENDER_API_TOKEN || ''}`,
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
