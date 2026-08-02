'use strict';

const { GhlAuthoritativeHydrator } = require('../modules/ghl-authoritative-pipeline-hydrator');
const { normalizeOpportunity, classifyRole } = require('../modules/telegram-outreach-dry-run');
const { derivePropertyTimezone } = require('../modules/property-timezone');

const GHL_TOKEN = 'pit-8d2bc799-1c7f-4639-8b96-fb3a193a0ec1';
const LOCATION_ID = '61XPzSqRy7UKMwW9DeB8';
const PIPELINE_ID = 'nSf3NXYVkt8X4PgW9aZ3';

async function main() {
  const hydrator = new GhlAuthoritativeHydrator({ token: GHL_TOKEN, locationId: LOCATION_ID, pipelineId: PIPELINE_ID });
  console.log('Hydrating...');
  const hydration = await hydrator.hydrate('CANARY');
  const records = hydration.records || [];
  console.log(`Total records: ${records.length}`);
  console.log(`Summary:`, JSON.stringify(hydration.summary, null, 2));

  const production = records.filter(r => (r.classification || {}).recordClass === 'PRODUCTION');
  console.log(`Production: ${production.length}`);

  let noPhone = 0, noName = 0, noAddress = 0, wrongStage = 0, wrongRole = 0, noTz = 0, passed = 0;
  const sampleBlocked = [];

  for (const record of production.slice(0, 20)) {
    const normalized = normalizeOpportunity(record);
    const reasons = [];
    if (!normalized.phone) reasons.push('noPhone');
    if (!normalized.contactName) reasons.push('noName');
    if (!normalized.propertyAddress) reasons.push('noAddress');
    if (normalized.currentStageId !== '7067148a-2ee8-4e5b-93c8-31e0253fea68') reasons.push(`wrongStage=${normalized.currentStageId}`);
    const timezone = derivePropertyTimezone(record, { now: new Date() });
    if (!timezone.ok) reasons.push('noTz');
    const roleEvidence = classifyRole(record);
    if (!['agent', 'owner', 'broker'].includes(roleEvidence.role)) reasons.push(`wrongRole=${roleEvidence.role}`);

    if (reasons.length > 0) {
      sampleBlocked.push({ name: normalized.contactName, phone: normalized.phone ? 'yes' : 'no', stage: normalized.currentStageId, role: roleEvidence.role, reasons });
    } else {
      passed++;
    }
  }

  console.log(`\nFirst 20 production records:`);
  for (const b of sampleBlocked.slice(0, 10)) {
    console.log(`  ${b.name} | phone=${b.phone} | stage=${b.stage} | role=${b.role} | reasons: ${b.reasons.join(', ')}`);
  }
  console.log(`Passed: ${passed}`);

  if (production.length > 0) {
    const r = production[0];
    console.log('\nSample record structure:');
    console.log('  opportunity keys:', Object.keys(r.opportunity || {}));
    console.log('  contact keys:', Object.keys(r.contact || {}));
    console.log('  opportunity.id:', r.opportunity?.id);
    console.log('  opportunity.pipelineStageId:', r.opportunity?.pipelineStageId);
    console.log('  contact.phone:', r.contact?.phone);
    console.log('  contact.fullName:', r.contact?.fullName);
    console.log('  contact.firstName:', r.contact?.firstName);
    console.log('  opportunity.name:', r.opportunity?.name);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
