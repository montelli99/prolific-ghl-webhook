const https = require('https');

const payload = JSON.stringify({
  repo: 'https://github.com/montelli99/prolific-ghl-webhook',
  branch: 'master',
  ownerId: 'tea-d08al6c9c44c73bo86bg',
  name: 'prolific-ghl-webhook'
});

const options = {
  hostname: 'api.render.com',
  path: '/v1/blueprints/apply',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer rnd_YB8uHPKZDJRDpC2yMAUXFzAPmLBV',
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