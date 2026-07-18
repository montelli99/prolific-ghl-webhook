const https = require('https');
const p = JSON.stringify({ name: 'atlas_ghl' });
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
  res.on('end', () => console.log(res.statusCode, d));
});
r.on('error', e => console.log(e.message));
r.write(p);
r.end();
