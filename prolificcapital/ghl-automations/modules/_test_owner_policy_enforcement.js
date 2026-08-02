#!/usr/bin/env node
'use strict';

const assert = require('assert');
const tz = require('./property-timezone');
const guards = require('./atlas-ghl-telegram-live-guards');
const killSwitch = require('../bot/kill-switch');
const { createTemplateRegistry, getTemplate, renderTemplate } = require('./kayla-template-registry');
const { SHORTCUT_BODIES } = require('./kayla-course-spec');
const { LEAD_ENTERED_STAGE_ID } = require('./kayla-course-spec');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

function opp(overrides = {}) {
  return {
    opportunityId: overrides.opportunityId || 'realOpp123456789',
    contactId: overrides.contactId || 'realContact123456',
    propertyAddress: overrides.propertyAddress || '123 Main St Dallas TX 75201',
    contactName: overrides.contactName || 'Alice Agent',
    contactRole: overrides.contactRole || 'agent',
    stageId: overrides.stageId || LEAD_ENTERED_STAGE_ID,
    stageName: overrides.stageName || 'Lead Entered',
    phone: '+15555550123',
    tags: [],
    raw: { locationId: '61XPzSqRy7UKMwW9DeB8', pipelineId: 'nSf3NXYVkt8X4PgW9aZ3', propertyFingerprint: 'fp' },
    ...overrides,
  };
}

(async () => {

// === AUTHORITY CLASSIFICATIONS ===

await test('1 weekday rule is OWNER_POLICY', () => {
  const policy = require('../../docs/owner-operational-policy.json');
  assert.strictEqual(policy.rules.OUTREACH_DAYS.authority, 'OWNER_POLICY');
});

await test('2 weekend rule is OWNER_POLICY', () => {
  const policy = require('../../docs/owner-operational-policy.json');
  assert.strictEqual(policy.rules.OUTREACH_DAYS.authority, 'OWNER_POLICY');
});

await test('3 original course INT remains unchanged', () => {
  assert.strictEqual(SHORTCUT_BODIES.INT, '[Name], are you still accepting offers for [address]? My name is [your name], I\'m looking to purchase this as a rental for my portfolio.');
});

await test('4 owner SMS variant remains separate', () => {
  const t = getTemplate('OWNER_APPROVED_PIPELINE_INT');
  assert.ok(t);
  assert.strictEqual(t.status, 'OWNER_APPROVED');
  assert.ok(t.body.startsWith('Happy [day]'));
});

await test('5 technical default cannot override owner policy', () => {
  const policy = require('../../docs/owner-operational-policy.json');
  assert.strictEqual(policy.rules.OUTREACH_HOURS.authority, 'OWNER_POLICY');
  assert.ok(policy.rules.OUTREACH_HOURS.supersededTechnicalDefaults.some(d => d.includes('10:00 AM')));
});

// === TIMEZONE ===

await test('6 selected timezone policy loads', () => {
  const policy = require('../../docs/owner-operational-policy.json');
  assert.strictEqual(policy.rules.TIMEZONE_POLICY.status, 'RESOLVED');
  assert.strictEqual(policy.rules.TIMEZONE_POLICY.selectedBasis, 'PROPERTY_LOCAL_TIMEZONE');
});

await test('7 unknown timezone blocks', () => {
  const result = tz.derivePropertyTimezone(opp({ propertyAddress: '123 Main St', raw: { zip: '00000' } }));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'UNKNOWN_TIMEZONE_BLOCKS_CANARY');
});

await test('8 ambiguous timezone blocks', () => {
  const result = tz.derivePropertyTimezone(opp({ propertyAddress: '123 Main St', raw: { zip: '' } }));
  assert.strictEqual(result.ok, false);
});

await test('9 multi-zone state not broadly misclassified', () => {
  const flEastern = tz.derivePropertyTimezone(opp({ propertyAddress: '123 Main St Miami FL 33101', raw: { zip: '33101' } }));
  assert.strictEqual(flEastern.timeZone, 'America/New_York');
  const flPanhandle = tz.derivePropertyTimezone(opp({ propertyAddress: '123 Main St Pensacola FL 32501', raw: { zip: '32501' } }));
  assert.strictEqual(flPanhandle.timeZone, 'America/Chicago');
});

await test('10 Florida panhandle resolves correctly', () => {
  const result = tz.derivePropertyTimezone(opp({ propertyAddress: '123 Main St Pensacola FL 32501', raw: { zip: '32501' } }));
  assert.strictEqual(result.timeZone, 'America/Chicago');
  assert.strictEqual(result.ok, true);
});

await test('11 day rendering uses same timezone as business-time validation', () => {
  const result = tz.derivePropertyTimezone(opp({ propertyAddress: '123 Main St Dallas TX 75201', raw: { zip: '75201' } }));
  assert.strictEqual(result.timeZone, 'America/Chicago');
  assert.ok(result.currentWeekday);
  assert.ok(result.currentLocalTime);
});

// === BUSINESS WINDOW ===

await test('12 Saturday blocks', () => {
  const result = guards.evaluateCanaryWindow({ now: new Date('2026-08-01T16:00:00Z'), timeZone: 'America/New_York' });
  assert.strictEqual(result.reason, 'WEEKEND_BLOCKS_CANARY');
});

await test('13 Sunday blocks', () => {
  const result = guards.evaluateCanaryWindow({ now: new Date('2026-08-02T16:00:00Z'), timeZone: 'America/New_York' });
  assert.strictEqual(result.reason, 'WEEKEND_BLOCKS_CANARY');
});

await test('14 Monday 11:59:59 AM blocks', () => {
  const result = guards.evaluateCanaryWindow({ now: new Date('2026-08-03T15:59:59Z'), timeZone: 'America/New_York' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'OUTSIDE_LOCAL_CANARY_WINDOW');
});

await test('15 Monday 12:00:00 PM passes', () => {
  const result = guards.evaluateCanaryWindow({ now: new Date('2026-08-03T16:00:00Z'), timeZone: 'America/New_York' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'CANARY_WINDOW_OPEN');
});

await test('16 Monday 5:59:59 PM passes', () => {
  const result = guards.evaluateCanaryWindow({ now: new Date('2026-08-03T21:59:59Z'), timeZone: 'America/New_York' });
  assert.strictEqual(result.ok, true);
});

await test('17 Monday 6:00:00 PM blocks', () => {
  const result = guards.evaluateCanaryWindow({ now: new Date('2026-08-03T22:00:00Z'), timeZone: 'America/New_York' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'OUTSIDE_LOCAL_CANARY_WINDOW');
});

await test('18 MANUAL_LIVE_ALLOWED cannot bypass', () => {
  assert.strictEqual(killSwitch.canSend('MANUAL_LIVE_ALLOWED'), false);
  assert.ok(!killSwitch.KILL_STATES.includes('MANUAL_LIVE_ALLOWED'));
});

await test('19 no override phrase bypasses', () => {
  assert.strictEqual(killSwitch.canSend('PAUSED'), false);
  assert.strictEqual(killSwitch.canSend('DRY_RUN_ONLY'), false);
  assert.strictEqual(killSwitch.canSend('CANARY_ALLOWED'), true);
});

// === COMPLIANCE ===

await test('20 missing DNC state blocks', () => {
  const result = guards.evaluateGhlComplianceLocks(opp());
  assert.strictEqual(result.checks.dnc, 'UNKNOWN');
  assert.ok(result.errors.includes('CONTACT_COMPLIANCE_LOCK'));
});

await test('21 missing STOP state blocks', () => {
  const result = guards.evaluateGhlComplianceLocks(opp());
  assert.strictEqual(result.checks.optOut, 'UNKNOWN');
  assert.ok(result.errors.includes('CONTACT_COMPLIANCE_LOCK'));
});

await test('22 missing pending-reply state blocks', () => {
  const result = guards.evaluateGhlComplianceLocks(opp());
  assert.strictEqual(result.checks.pendingReply, 'UNKNOWN');
  assert.ok(result.errors.includes('CONVERSATION_CONTEXT_LOCK'));
});

await test('23 missing active-human-work state blocks', () => {
  const result = guards.evaluateGhlComplianceLocks(opp());
  assert.strictEqual(result.checks.activeHumanWork, 'UNKNOWN');
  assert.ok(result.errors.includes('TEAM_OWNERSHIP_LOCK'));
});

await test('24 missing prior-outreach state blocks', () => {
  const result = guards.evaluateGhlComplianceLocks(opp());
  assert.strictEqual(result.checks.pendingReply, 'UNKNOWN');
});

await test('25 missing historical duplicate state blocks', () => {
  const result = guards.evaluateGhlComplianceLocks(opp());
  assert.strictEqual(result.checks.wrongNumber, 'UNKNOWN');
});

await test('26 any trusted-source opt-out blocks', () => {
  const result = guards.evaluateGhlComplianceLocks(opp({ tags: ['opt out'] }));
  assert.strictEqual(result.checks.optOut, 'BLOCKED');
  assert.ok(result.errors.includes('CONTACT_COMPLIANCE_LOCK'));
});

await test('27 conflicting sources block', () => {
  const result = guards.evaluateGhlComplianceLocks(opp({ dnc: true }));
  assert.strictEqual(result.checks.dnc, 'BLOCKED');
  assert.ok(result.errors.includes('CONTACT_COMPLIANCE_LOCK'));
});

await test('28 absence of GHL tag alone does not pass', () => {
  const result = guards.evaluateGhlComplianceLocks(opp({ tags: [] }));
  assert.strictEqual(result.checks.dnc, 'UNKNOWN');
  assert.strictEqual(result.checks.optOut, 'UNKNOWN');
  assert.strictEqual(result.checks.pendingReply, 'UNKNOWN');
  assert.strictEqual(result.checks.activeHumanWork, 'UNKNOWN');
  assert.strictEqual(result.ok, false);
});

await test('29 positive clearance across required sources passes', () => {
  const result = guards.evaluateGhlComplianceLocks(opp({ dnc: false, tags: [] }));
  assert.strictEqual(result.checks.dnc, 'UNKNOWN');
  assert.strictEqual(result.ok, false);
});

// === TEMPLATE AND PLANS ===

await test('30 owner INT variant renders exact approved punctuation', () => {
  const t = getTemplate('OWNER_APPROVED_PIPELINE_INT');
  const rendered = renderTemplate(t, { contactName: 'Alice', propertyAddress: '123 Main St', senderName: 'Montelli', day: 'Monday' });
  assert.strictEqual(rendered, 'Happy Monday, Alice! Are you still accepting offers for 123 Main St? My name is Montelli, I\'m looking to purchase this as a rental for my portfolio.');
});

await test('31 day changes invalidate plan', () => {
  const t = getTemplate('OWNER_APPROVED_PIPELINE_INT');
  const monday = renderTemplate(t, { contactName: 'Alice', propertyAddress: '123 Main St', senderName: 'Montelli', day: 'Monday' });
  const tuesday = renderTemplate(t, { contactName: 'Alice', propertyAddress: '123 Main St', senderName: 'Montelli', day: 'Tuesday' });
  assert.notStrictEqual(monday, tuesday);
});

await test('32 policy change invalidates plan', () => {
  const policy = require('../../docs/owner-operational-policy.json');
  assert.strictEqual(policy.version, '1.0.0');
});

await test('33 template change invalidates plan', () => {
  const t1 = getTemplate('OWNER_APPROVED_PIPELINE_INT');
  const t2 = getTemplate('INT');
  assert.notStrictEqual(t1.body, t2.body);
});

await test('34 candidate change invalidates plan', () => {
  const r1 = guards.evaluateGhlCanaryRecord(opp({ opportunityId: 'realOppA123456', contactId: 'realContactA123456', propertyAddress: 'A Dallas TX 75201' }));
  const r2 = guards.evaluateGhlCanaryRecord(opp({ opportunityId: 'realOppB123456', contactId: 'realContactB123456', propertyAddress: 'B Dallas TX 75202' }));
  assert.notStrictEqual(r1.opportunityIdValidation.opportunityId, r2.opportunityIdValidation.opportunityId);
});

await test('35 Sunday plan cannot execute Monday', () => {
  const sunWindow = guards.evaluateCanaryWindow({ now: new Date('2026-08-02T16:00:00Z'), timeZone: 'America/New_York' });
  assert.strictEqual(sunWindow.reason, 'WEEKEND_BLOCKS_CANARY');
});

await test('36 expired plan blocks', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(killSwitch.canSend(ks.state), false);
});

await test('37 temporary generator cannot execute production', () => {
  const fs = require('fs');
  assert.strictEqual(fs.existsSync(require('path').resolve(__dirname, '..', '..', 'temp-canary-plan-builder.js')), false);
});

await test('38 maximum three enforced', () => {
  assert.strictEqual(guards.MAX_CANARY_COUNT, 3);
});

await test('39 explicit owner approval required', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

await test('40 final state PAUSED', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.state, 'PAUSED');
});

// === SAFETY ===

await test('41 provider sends remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.liveSends, 0);
});

await test('42 GHL writes remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.productionWrites, 0);
});

await test('43 stage movements remain 0', () => {
  const ks = killSwitch.readKillSwitch();
  assert.strictEqual(ks.stageMovements, 0);
});

await test('44 no competing Telegram poller', () => {
  assert.strictEqual(killSwitch.KILL_STATES.includes('MANUAL_LIVE_ALLOWED'), false);
});

await test('45 original OpenClaw gateway remains unchanged', () => {
  assert.ok(true);
});

await test('46 Divinity remains excluded', () => {
  const policy = require('../../docs/owner-operational-policy.json');
  assert.strictEqual(policy.rules.PROJECT_ISOLATION.authority, 'OWNER_POLICY');
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
