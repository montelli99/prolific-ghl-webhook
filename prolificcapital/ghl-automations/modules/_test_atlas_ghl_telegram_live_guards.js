#!/usr/bin/env node

'use strict';

const assert = require('assert');
const guards = require('./atlas-ghl-telegram-live-guards');
const { LEAD_ENTERED_STAGE_ID } = require('./kayla-course-spec');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

function opp(overrides = {}) {
  return {
    opportunityId: overrides.opportunityId || 'abcDEF1234567890',
    contactId: overrides.contactId || 'ZYXwv9876543210',
    propertyAddress: overrides.propertyAddress || '123 Main St, Dallas TX',
    contactName: overrides.contactName || 'Alice Agent',
    contactRole: overrides.contactRole || 'agent',
    stageId: overrides.stageId || LEAD_ENTERED_STAGE_ID,
    stageName: overrides.stageName || 'Lead Entered',
    phone: '+15555550123',
    tags: [],
    ...overrides,
  };
}

async function main() {
await test('1 accepts plausible real GHL ids', () => assert.equal(guards.hasRealGhlId('61XPzSqRy7UKMwW9DeB8'), true));
await test('2 rejects synthetic opportunity ids', () => assert.equal(guards.validateRealGhlIdentity(opp({ opportunityId: 'opp-a1' })).ok, false));
await test('3 rejects synthetic contact ids', () => assert.equal(guards.validateRealGhlIdentity(opp({ contactId: 'contact-a1' })).ok, false));
await test('4 detects DNC tags from GHL contact data', () => assert.deepEqual(guards.evaluateGhlComplianceLocks(opp({ tags: ['DNC'] })).errors, ['CONTACT_COMPLIANCE_LOCK']));
await test('5 detects wrong number tags from GHL contact data', () => assert.ok(guards.evaluateGhlComplianceLocks(opp({ tags: ['wrong-number'] })).errors.includes('WRONG_NUMBER_LOCK')));
await test('6 detects pending reply tags from GHL contact data', () => assert.ok(guards.evaluateGhlComplianceLocks(opp({ tags: ['pending reply'] })).errors.includes('CONVERSATION_CONTEXT_LOCK')));
await test('7 unknown timezone blocks canary', () => assert.equal(guards.evaluateCanaryWindow({ now: new Date('2026-07-31T16:00:00Z') }).ok, false));
await test('8 weekend blocks canary', () => assert.equal(guards.evaluateCanaryWindow({ now: new Date('2026-08-01T16:00:00Z'), timeZone: 'America/New_York' }).reason, 'WEEKEND_BLOCKS_CANARY'));
await test('9 local business window opens canary', () => assert.equal(guards.evaluateCanaryWindow({ now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }).ok, true));
await test('10 off-hours block canary', () => assert.equal(guards.evaluateCanaryWindow({ now: new Date('2026-07-31T02:00:00Z'), timeZone: 'America/New_York' }).reason, 'OUTSIDE_LOCAL_CANARY_WINDOW'));
await test('11 paused state blocks canary', () => assert.ok(guards.validateGhlCanaryPlan({ records: [opp()], timeZone: 'America/New_York', now: new Date('2026-07-31T16:00:00Z'), killSwitchState: 'PAUSED' }).errors.includes('CANARY_REQUIRES_CANARY_ALLOWED_STATE')));
await test('12 more than three blocks canary', () => assert.ok(guards.validateGhlCanaryPlan({ records: [opp({ opportunityId: 'a12345678', contactId: 'c12345678', propertyAddress: 'A' }), opp({ opportunityId: 'b12345678', contactId: 'd12345678', propertyAddress: 'B' }), opp({ opportunityId: 'e12345678', contactId: 'f12345678', propertyAddress: 'C' }), opp({ opportunityId: 'g12345678', contactId: 'h12345678', propertyAddress: 'D' })], timeZone: 'America/New_York', now: new Date('2026-07-31T16:00:00Z'), killSwitchState: 'CANARY_ALLOWED' }).errors.includes('CANARY_COUNT_EXCEEDS_THREE')));
await test('13 duplicate contacts block canary', () => assert.ok(guards.validateGhlCanaryPlan({ records: [opp({ opportunityId: 'a12345678', contactId: 'sameContact9', propertyAddress: 'A' }), opp({ opportunityId: 'b12345678', contactId: 'sameContact9', propertyAddress: 'B' })], timeZone: 'America/New_York', now: new Date('2026-07-31T16:00:00Z'), killSwitchState: 'CANARY_ALLOWED' }).errors.some(error => error.includes('CANARY_REQUIRES_DISTINCT_CONTACTS'))));
await test('14 duplicate properties block canary', () => assert.ok(guards.validateGhlCanaryPlan({ records: [opp({ opportunityId: 'a12345678', contactId: 'c12345678', propertyAddress: 'A' }), opp({ opportunityId: 'b12345678', contactId: 'd12345678', propertyAddress: 'A' })], timeZone: 'America/New_York', now: new Date('2026-07-31T16:00:00Z'), killSwitchState: 'CANARY_ALLOWED' }).errors.some(error => error.includes('CANARY_REQUIRES_DISTINCT_PROPERTIES'))));
await test('15 stage movement remains disabled until isolation is proven', () => assert.ok(guards.validateGhlCanaryPlan({ records: [opp()], timeZone: 'America/New_York', now: new Date('2026-07-31T16:00:00Z'), killSwitchState: 'CANARY_ALLOWED', allowStageMove: true }).errors.some(error => error.includes('STAGE_MOVE_DISABLED'))));
await test('16 valid GHL-only canary plan awaits Telegram approval', () => assert.equal(guards.validateGhlCanaryPlan({ records: [opp({ opportunityId: 'a12345678', contactId: 'c12345678', propertyAddress: 'A' }), opp({ opportunityId: 'b12345678', contactId: 'd12345678', propertyAddress: 'B' }), opp({ opportunityId: 'e12345678', contactId: 'f12345678', propertyAddress: 'C' })], timeZone: 'America/New_York', now: new Date('2026-07-31T16:00:00Z'), killSwitchState: 'CANARY_ALLOWED' }).status, 'ATLAS_TELEGRAM_KAYLA_CANARY_READY_AWAITING_TELEGRAM_APPROVAL'));
await test('17 valid guard performs zero sends and writes', () => { const result = guards.validateGhlCanaryPlan({ records: [opp()], timeZone: 'America/New_York', now: new Date('2026-07-31T16:00:00Z'), killSwitchState: 'CANARY_ALLOWED' }); assert.equal(result.liveSends, 0); assert.equal(result.productionWrites, 0); assert.equal(result.stageMovements, 0); });
await test('18 marker source is Telegram Atlas outreach', () => assert.equal(guards.buildTelegramOutreachMarker({ sessionId: 's', planHash: 'p', actionId: 'a', itemNumber: 1 }).source, guards.TELEGRAM_OUTREACH_SOURCE));
await test('19 marker idempotency is stable', () => assert.equal(guards.buildTelegramOutreachMarker({ sessionId: 's', planHash: 'p', actionId: 'a', itemNumber: 1 }).idempotencyKey, guards.buildTelegramOutreachMarker({ sessionId: 's', planHash: 'p', actionId: 'a', itemNumber: 1 }).idempotencyKey));
await test('20 manual live state is not canary state', () => assert.ok(guards.validateGhlCanaryPlan({ records: [opp()], timeZone: 'America/New_York', now: new Date('2026-07-31T16:00:00Z'), killSwitchState: 'MANUAL_LIVE_ALLOWED' }).errors.includes('CANARY_REQUIRES_CANARY_ALLOWED_STATE')));
console.log(`\n${passed}/20 tests passed`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
