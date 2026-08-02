'use strict';

const fs = require('fs');
const path = require('path');
const { GhlAuthoritativeHydrator } = require('../modules/ghl-authoritative-pipeline-hydrator');

function sha256(value) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const profile = args.find((a) => a.startsWith('--profile='))?.split('=')[1] || 'INVENTORY';
  const outDir = args.find((a) => a.startsWith('--out='))?.split('=')[1] || path.resolve(__dirname, '..', 'data', 'runtime', 'pipeline-hydration');
  const envPath = args.find((a) => a.startsWith('--env='))?.split('=')[1] || path.resolve(__dirname, '..', 'SECRETS.env');

  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }

  const hydrator = new GhlAuthoritativeHydrator({
    token: process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || process.env.GHL_TOKEN,
    locationId: process.env.GHL_LOCATION_ID,
    pipelineId: process.env.GHL_ATLAS_PIPELINE_ID || process.env.GHL_PIPELINE_ID || 'nSf3NXYVkt8X4PgW9aZ3',
    apiVersion: process.env.GHL_API_VERSION || '2021-07-28'
  });
  const { summary, records } = await hydrator.hydrate(profile);

  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(outDir, `ghl-pipeline-hydration-${profile.toLowerCase()}-${timestamp}.json`);
  const summaryPath = path.join(outDir, `ghl-pipeline-hydration-${profile.toLowerCase()}-${timestamp}-summary.json`);

  fs.writeFileSync(snapshotPath, JSON.stringify({ summary, records }, null, 2));
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const reportLines = [
    '# GHL Authoritative Pipeline Hydration Run',
    '',
    `- **Profile:** ${profile}`,
    `- **Timestamp:** ${summary.timestamp}`,
    `- **Total opportunities:** ${summary.total}`,
    `- **Elapsed ms:** ${summary.elapsedMs}`,
    `- **API calls:** ${summary.apiCalls}`,
    `- **Endpoint counts:** ${JSON.stringify(summary.endpointCounts)}`,
    `- **Classification counts:** ${JSON.stringify(summary.byClassification)}`,
    `- **Snapshot hash:** ${sha256(fs.readFileSync(snapshotPath))}`,
    `- **Snapshot path:** ${snapshotPath}`,
    '',
    '## Production effects',
    '',
    '- sends: 0',
    '- GHL writes: 0',
    '- stage movements: 0',
    ''
  ];

  const reportPath = path.join(outDir, `ghl-pipeline-hydration-${profile.toLowerCase()}-${timestamp}-report.md`);
  fs.writeFileSync(reportPath, reportLines.join('\n'));

  console.log(JSON.stringify({
    status: 'GHL_HYDRATION_RUN_COMPLETE',
    profile,
    summary,
    paths: { snapshot: snapshotPath, summary: summaryPath, report: reportPath }
  }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ status: 'GHL_HYDRATION_RUN_FAILED', error: e.message }));
  process.exit(1);
});
