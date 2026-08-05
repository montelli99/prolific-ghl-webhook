'use strict';
const { processCall } = require('../modules/automatic-call-note-worker');
const { readCallNoteKillSwitch } = require('../modules/automatic-call-note-kill-switch');
const { JustCallIntegration } = require('../modules/justcall-integration');
const { GhlCallNoteGateway } = require('../modules/ghl-call-note-gateway');
const fs = require('fs');

async function main() {
  const env = Object.fromEntries(
    fs.readFileSync('C:/Users/mscott/AI_Workspace/prolificcapital/secrets/.env', 'utf8').split(/\r?\n/)
      .map(line => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map(match => [match[1], match[2].replace(/^['"]|['"]$/g, '').trim()])
  );
  const token = env.GHL_READ_TOKEN || env.GHL_PRIVATE_INTEGRATION_TOKEN || env.GHL_API_TOKEN || env.GHL_API_KEY;
  const callNoteKs = readCallNoteKillSwitch();
  console.log('Call-note kill switch:', callNoteKs.state);

  const justcall = new JustCallIntegration({ apiKey: env.JUSTCALL_API_KEY, apiSecret: env.JUSTCALL_API_SECRET });
  const ghl = new GhlCallNoteGateway({
    token,
    locationId: '61XPzSqRy7UKMwW9DeB8',
    pipelineId: 'nSf3NXYVkt8X4PgW9aZ3',
    writeEnabled: false,
    getSafetyState: () => 'PAUSED',
  });

  console.log('Processing call 400683713 (read-only)...');
  const result = await processCall({ callId: '400683713', justcall, ghl, callNoteKs });
  console.log('Result:', JSON.stringify(result, null, 2));
}
main().catch(e => console.error('Error:', e.message));
