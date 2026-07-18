const https = require('https');

const payload = JSON.stringify({
  name: 'prolific-ghl-webhook',
  repo: 'https://github.com/montelli99/prolific-ghl-webhook',
  branch: 'master',
  type: 'web_service',
  ownerId: process.env.RENDER_OWNER_ID,
  autoDeploy: 'yes',
  serviceDetails: {
    env: 'node',
    envSpecificDetails: {
      runtime: 'node',
      buildCommand: 'npm install',
      startCommand: 'npm start',
      plan: 'free',
      region: 'oregon'
    },
    plan: 'free',
    region: 'oregon'
  },
  envVars: [
    { key: 'DATABASE_URL', value: process.env.DATABASE_URL || '' },
    { key: 'PORT', value: '3000' },
    { key: 'NODE_ENV', value: 'production' },
    { key: 'TELNYX_KEY', value: process.env.TELNYX_KEY || '' },
    { key: 'ELEVENLABS_KEY', value: process.env.ELEVENLABS_KEY || '' },
    { key: 'GHL_API_KEY', value: process.env.GHL_API_KEY || '' },
    { key: 'JUSTCALL_AUTH', value: process.env.JUSTCALL_AUTH || '' }
  ]
});

const options = {
  hostname: 'api.render.com',
  path: '/v1/services',
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
