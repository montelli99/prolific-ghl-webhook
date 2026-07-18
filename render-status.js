const https = require('https');
const o = {
  hostname: 'api.render.com',
  path: '/v1/services/srv-d87l6c1kh4rs73ap9srg',
  method: 'GET',
  headers: { 'Authorization': `Bearer ${process.env.RENDER_API_TOKEN || ''}` }
};
const r = https.request(o, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const j = JSON.parse(d || '{}');
    console.log('Status:', j.service && j.service.status);
    console.log('URL:', j.service && j.service.serviceDetails && j.service.serviceDetails.url);
    console.log('Updated:', j.service && j.service.updatedAt);
  });
});
r.on('error', e => console.log(e.message));
r.end();
