// Daily call reminder generator for Montelli's pipeline
const { STAGES } = require('./workflow-config');

const LEAD_ENTERED_ID = '0651d634-1b58-4039-9908-03c4077c88cb';

async function buildDailyCallList() {
  // This will be called by the cron job each morning
  const https = require('https');
  return new Promise((resolve, reject) => {
    const o = {
      hostname: 'services.leadconnectorhq.com',
      path: '/opportunities/search?location_id=61XPzSqRy7UKMwW9DeB8',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer pit-598ce224-4abf-4b4b-be79-7ee3c3bfd17f',
        'Version': '2021-07-28'
      }
    };
    const r = https.request(o, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const j = JSON.parse(d || '{}');
        const leads = (j.opportunities || []).filter(op => op.pipelineStageId === LEAD_ENTERED_ID);
        resolve(leads);
      });
    });
    r.on('error', reject);
    r.end();
  });
}

module.exports = { buildDailyCallList, LEAD_ENTERED_ID };