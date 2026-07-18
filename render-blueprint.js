const https = require('https');

const payload = JSON.stringify({
  repo: 'https://github.com/montelli99/prolific-ghl-webhook',
  branch: 'master',
  ownerId: process.env.RENDER_OWNER_ID,
  name: 'prolific-ghl-webhook'
});

const options = {
  hostname: 'api.render.com',
  path: '/v1/blueprints/apply',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.RENDER_API_TOKEN || ''}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', e => console.error('Error:', e.message));
req.write(payload);
req.end();
