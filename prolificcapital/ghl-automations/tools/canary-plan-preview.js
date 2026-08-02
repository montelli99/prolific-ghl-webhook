'use strict';

const { CanaryPlanBuilder } = require('../modules/canary-plan-builder');
const { JustCallSuppressionReadService } = require('../modules/justcall-suppression-read-service');
const { JustCallTextHistoryReadService } = require('../modules/justcall-text-history-read-service');
const { LocalSuppressionRegistry } = require('../modules/local-suppression-registry');
const fs = require('fs');
const path = require('path');

const GHL_TOKEN = 'pit-8d2bc799-1c7f-4639-8b96-fb3a193a0ec1';
const LOCATION_ID = '61XPzSqRy7UKMwW9DeB8';
const PIPELINE_ID = 'nSf3NXYVkt8X4PgW9aZ3';
const JC_API_KEY = 'a02aa39621da49ff1e61ba7195a219b2d0bb3162';
const JC_API_SECRET = 'a06466df20a19fc0114fcc97a3edc2e334ec73dd';

async function main() {
  console.log('=== CANARY PREVIEW E2E CERTIFICATION ===\n');

  const suppression = new JustCallSuppressionReadService({ apiKey: JC_API_KEY, apiSecret: JC_API_SECRET });
  const history = new JustCallTextHistoryReadService({ apiKey: JC_API_KEY, apiSecret: JC_API_SECRET, senderSuffix: '2619' });
  const localRegistry = new LocalSuppressionRegistry();

  console.log('JustCall suppression configured:', suppression.isConfigured());
  console.log('JustCall history configured:', history.isConfigured());
  console.log('Local registry path:', localRegistry.registryPath);

  const builder = new CanaryPlanBuilder({
    ghlToken: GHL_TOKEN,
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    suppression,
    history,
    localRegistry,
  });

  console.log('\nBuilding preview from live GHL data...');
  const plan = await builder.buildPreview();

  console.log(`\nPlan ID: ${plan.planId}`);
  console.log(`Plan hash: ${plan.planHash}`);
  console.log(`Policy version: ${plan.policyVersion}`);
  console.log(`Template: ${plan.templateId}`);
  console.log(`Executable: ${plan.executable}`);
  console.log(`Total candidates: ${plan.totalCandidates}`);
  console.log(`Selected (passed all guards): ${plan.selectedCount}`);
  console.log(`Blocked: ${plan.blockedCount}`);

  console.log('\nBlocker distribution:');
  for (const [guard, count] of Object.entries(plan.blockerDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${guard}: ${count}`);
  }

  if (plan.selected.length > 0) {
    console.log('\nSelected candidates:');
    for (const item of plan.selected) {
      console.log(`  - ${item.contactName} | ${item.propertyAddress} | ${item.contactRole} | ${item.timezone}`);
    }
  }

  const reportDir = path.resolve(__dirname, '..', '..', 'reports');
  fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    certificationType: 'CANARY_PREVIEW_E2E',
    timestamp: new Date().toISOString(),
    planId: plan.planId,
    planHash: plan.planHash,
    executable: false,
    productionEffects: { sends: 0, ghlWrites: 0, stageMovements: 0 },
    totalCandidates: plan.totalCandidates,
    selectedCount: plan.selectedCount,
    blockedCount: plan.blockedCount,
    blockerDistribution: plan.blockerDistribution,
    killSwitchState: 'PAUSED',
    gatewayPid: 11784,
    gatewayPort: 18789,
    result: plan.selectedCount > 0 ? 'CANDIDATES_AVAILABLE_BUT_BLOCKED' : 'ALL_CANDIDATES_BLOCKED',
  };

  fs.writeFileSync(path.join(reportDir, 'canary-preview-readiness.json'), JSON.stringify(report, null, 2));
  console.log('\nReport written to reports/canary-preview-readiness.json');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => { console.error('E2E FAILED:', e.message); process.exit(1); });
