const https = require('https');

const payload = JSON.stringify({
  name: 'prolific-ghl-webhook',
  repo: 'https://github.com/montelli99/prolific-ghl-webhook',
  branch: 'master',
  type: 'web_service',
  ownerId: 'tea-d08al6c9c44c73bo86bg',
  autoDeploy: 'yes',
  serviceDetails: {
    env: 'node',
    envSpecificDetails: {
      runtime: 'node',
      buildCommand: 'npm install',
      startCommand: 'node server.js',
      plan: 'free',
      region: 'oregon'
    },
    plan: 'free',
    region: 'oregon'
  },
  envVars: [
    { key: 'DATABASE_URL', value: 'postgresql://neondb_owner:npg_k2RUfn9gacAe@ep-wandering-thunder-ahesitw4-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require' },
    { key: 'PORT', value: '3000' },
    { key: 'NODE_ENV', value: 'production' }
  ]
});

const options = {
  hostname: 'api.render.com',
  path: '/v1/services',
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