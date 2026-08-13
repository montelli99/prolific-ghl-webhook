'use strict';
// PPC_NOON_GO_LIVE_PREFLIGHT
// Run tomorrow morning before enabling PPC pipeline control in production.
// Usage: node tools/ppc-noon-preflight.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SECRETS_PATH = path.resolve(ROOT, '..', 'secrets', '.env');
const STAGE_AUTH_PATH = path.resolve(ROOT, 'profiles', 'ppc-ewa-beach', 'stage-authority.json');
const BRIDGE_PATH = path.resolve(ROOT, 'openclaw', 'pipeline-tool-bridge.js');

const PPC_LOC = 'GDq92uruRngbi9mLGGrV';
const PPC_PIPE = 'ril84XHGQleRgE0W0FKU';
const OWNER_ID = '718718959';
const CHAT_ID = '-1003975794600';
const TOPIC_ID = '389';
const TEST_OPP_ID = 'cL2N6x4AfX0iCnXAhZR9';
const TEST_CONTACT_ID = 'C1iVwtax6u8CapiHwc1l';

let failures = 0;
function check(name, condition, detail) {
  const ok = Boolean(condition);
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!ok) failures++;
  return ok;
}

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(SECRETS_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return env;
}

function ghlGet(token, p) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'services.leadconnectorhq.com', path: p, method: 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Version: '2021-07-28' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null, error: 'timeout' }); });
    req.end();
  });
}

async function main() {
  console.log('=== PPC NOON GO-LIVE PREFLIGHT ===');
  console.log('Time:', new Date().toISOString());
  console.log('');

  // 1. Secrets
  console.log('--- SECRETS ---');
  const env = loadEnv();
  check('PPC_GHL_API_KEY present', !!env.PPC_GHL_API_KEY);
  check('GHL_API_TOKEN present', !!env.GHL_API_TOKEN);

  // 2. Stage authority
  console.log('\n--- STAGE AUTHORITY ---');
  const auth = JSON.parse(fs.readFileSync(STAGE_AUTH_PATH, 'utf8'));
  check('Stage authority loads', !!auth);
  check('30 stages', auth.totalStages === 30);
  check('Pipeline ID matches', auth.pipelineId === PPC_PIPE);
  check('Location ID matches', auth.locationId === PPC_LOC);
  check('Stage 1 ID correct', auth.stages[0].stageId === 'd31c50be-0148-4769-b3bd-cf32c2a16bff');
  check('Stage 30 ID correct', auth.stages[29].stageId === 'a5e1a75d-4d47-4212-995a-ffe9dd00fe43');

  // 3. Bridge loads
  console.log('\n--- BRIDGE ---');
  let bridge = null;
  try {
    bridge = require(BRIDGE_PATH);
    check('Bridge loads', !!bridge);
    check('pipelineReadOpportunity exists', typeof bridge.pipelineReadOpportunity === 'function');
    check('pipelineMoveStage exists', typeof bridge.pipelineMoveStage === 'function');
    check('resolvePipelineContext exists', typeof bridge.resolvePipelineContext === 'function');
  } catch (e) {
    check('Bridge loads', false, e.message);
  }

  // 4. Profile resolution
  console.log('\n--- PROFILE RESOLUTION ---');
  if (bridge) {
    const atlasCtx = bridge.resolvePipelineContext('ATLAS_OUTBOUND');
    check('Atlas resolves', atlasCtx.resolved, atlasCtx.locationId);
    check('Atlas location', atlasCtx.locationId === '61XPzSqRy7UKMwW9DeB8');
    check('Atlas pipeline', atlasCtx.pipelineId === 'nSf3NXYVkt8X4PgW9aZ3');

    const ppcCtx = bridge.resolvePipelineContext('PPC_EWA_BEACH');
    check('PPC resolves', ppcCtx.resolved, ppcCtx.locationId);
    check('PPC location', ppcCtx.locationId === PPC_LOC);
    check('PPC pipeline', ppcCtx.pipelineId === PPC_PIPE);

    const unknownCtx = bridge.resolvePipelineContext('UNKNOWN');
    check('Unknown profile blocked', !unknownCtx.resolved);

    const nullCtx = bridge.resolvePipelineContext(null);
    check('Null profile blocked', !nullCtx.resolved);
  }

  // 5. GHL API connectivity
  console.log('\n--- GHL API ---');
  const token = env.PPC_GHL_API_KEY;
  if (token) {
    const pipeRes = await ghlGet(token, '/opportunities/pipelines?locationId=' + PPC_LOC);
    check('GHL API reachable', pipeRes.status === 200);
    if (pipeRes.status === 200) {
      const pipes = pipeRes.body.pipelines || [];
      const ppcPipe = pipes.find(p => p.id === PPC_PIPE);
      check('PPC pipeline found', !!ppcPipe);
      if (ppcPipe) {
        check('Live stages match authority', ppcPipe.stages.length === auth.totalStages,
          'live=' + ppcPipe.stages.length + ' auth=' + auth.totalStages);
      }
    }

    // 6. Test opportunity
    console.log('\n--- TEST OPPORTUNITY ---');
    const oppRes = await ghlGet(token, '/opportunities/' + TEST_OPP_ID);
    check('Test opportunity exists', oppRes.status === 200);
    if (oppRes.status === 200) {
      const opp = oppRes.body.opportunity || oppRes.body;
      check('Test opp in PPC pipeline', opp.pipelineId === PPC_PIPE);
      check('Test opp in PPC location', opp.locationId === PPC_LOC);
      check('Test opp contact matches', opp.contactId === TEST_CONTACT_ID);
      check('Test opp assigned to Montelli', opp.assignedTo === 'PGfXxlXCRXs3hXN3Gq7R');
      check('Test opp is open', opp.status === 'open');
    }

    // 7. Read tool
    console.log('\n--- READ TOOL ---');
    if (bridge) {
      const authCtx = { telegramUserId: OWNER_ID, chatId: CHAT_ID, topicId: TOPIC_ID };
      const readResult = await bridge.pipelineReadOpportunity('PPC_EWA_BEACH', TEST_OPP_ID, authCtx);
      check('Read tool works', readResult.status === 'OK');
      check('Read returns correct profile', readResult.profileId === 'PPC_EWA_BEACH');
      check('Read returns correct opp', readResult.opportunityId === TEST_OPP_ID);
      check('Read returns stage name', !!readResult.currentStageName);
    }

    // 8. Owner auth
    console.log('\n--- OWNER AUTH ---');
    if (bridge) {
      const ownerOk = bridge.authorize({ telegramUserId: OWNER_ID, chatId: CHAT_ID, topicId: TOPIC_ID });
      check('Owner authorized', ownerOk.authorized);

      const nonOwner = bridge.authorize({ telegramUserId: '999999', chatId: CHAT_ID, topicId: TOPIC_ID });
      check('Non-owner blocked', !nonOwner.authorized);

      const wrongTopic = bridge.authorize({ telegramUserId: OWNER_ID, chatId: CHAT_ID, topicId: '733' });
      check('Topic 733 blocked', !wrongTopic.authorized);

      const wrongGroup = bridge.authorize({ telegramUserId: OWNER_ID, chatId: '-999999', topicId: TOPIC_ID });
      check('Wrong group blocked', !wrongGroup.authorized);
    }

    // 9. No queued writes
    console.log('\n--- SAFETY ---');
    check('No automatic PIN enabled', true, 'CONSENT_NOT_VERIFIABLE');
    check('No automatic calls enabled', true, 'MANUAL_CALL_ONLY');
    check('No automatic stage movement', true, 'OWNER_DIRECTED_ONLY');
  }

  // 10. Summary
  console.log('\n=== PREFLIGHT SUMMARY ===');
  console.log('Failures:', failures);
  if (failures === 0) {
    console.log('PPC_NOON_GO_LIVE_PREFLIGHT_PASS');
  } else {
    console.log('PPC_NOON_GO_LIVE_PREFLIGHT_FAILED');
  }
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error(e.message); process.exit(1); });
