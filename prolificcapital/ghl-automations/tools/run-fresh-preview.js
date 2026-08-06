'use strict';
const fs = require('fs');
const path = require('path');

const envFile = path.resolve(__dirname, '..', '..', 'secrets', '.env');
const content = fs.readFileSync(envFile, 'utf8');
const lines = content.split('\n');
const env = {};
for (const line of lines) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[k] = v;
}
for (const [k, v] of Object.entries(env)) {
  process.env[k] = v;
}

const { CanaryPlanBuilder } = require('../modules/canary-plan-builder');

async function main() {
  try {
    const builder = new CanaryPlanBuilder({
      ghlToken: env.GHL_API_TOKEN || env.GHL_API_KEY,
      locationId: env.GHL_LOCATION_ID,
      pipelineId: env.GHL_ATLAS_PIPELINE_ID,
    });

    console.log('Starting fresh hydration...');
    const plan = await builder.buildPreview({
      now: new Date(),
      ownerId: '718718959',
      chatId: '-1003975794600',
      topicId: 389,
      runbookId: 'runbook_supervised_canary_v2',
      runbookHash: '9126b05e2c39d2ee6d8fb35ed2ad065a95969badf316c65124b74315ff17b750',
      preferredOpportunityIds: ['u55xfxyQmNrt8n0NNphS', 'cl4dSDHuMe770NhUQT0c'],
      maxItems: 2,
    });

    console.log('Plan ID:', plan.planId);
    console.log('Plan Hash:', plan.planHash);
    console.log('Status:', plan.status);
    console.log('Total candidates:', plan.totalCandidates);
    console.log('Selected:', plan.selectedCount);
    console.log('Blocked:', plan.blockedCount);
    console.log('Blocker distribution:', JSON.stringify(plan.blockerDistribution, null, 2));
    console.log('Items:', JSON.stringify(plan.items.map(function(i) {
      return {
        name: i.contactName,
        address: i.propertyAddress,
        recipientType: i.recipientType,
        recipientConfidence: i.recipientConfidence,
        message: i.renderedMessage,
        tz: i.timezone,
        weekday: i.localWeekday,
        time: i.localTime,
        guards: Object.fromEntries(Object.entries(i.guardEvidence).map(function(e) { return [e[0], e[1].state]; })),
      };
    }), null, 2));
    console.log('Source snapshot:', JSON.stringify(plan.sourceSnapshot, null, 2));
    console.log('Warnings:', JSON.stringify(plan.warnings));
  } catch (e) {
    console.error('Error:', e.message);
    if (e.code) console.error('Code:', e.code);
    if (e.details) console.error('Details:', JSON.stringify(e.details));
  }
}

main();
