const https = require('https');

const options = {
  hostname: 'api.render.com',
  path: '/v1/users/me',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${process.env.RENDER_API_TOKEN || ''}`
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
req.end();
