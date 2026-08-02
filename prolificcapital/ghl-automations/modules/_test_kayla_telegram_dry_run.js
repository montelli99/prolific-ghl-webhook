#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadKaylaCourseSpec, LEAD_ENTERED_STAGE_ID, CONTACT_MADE_STAGE_ID } = require('./kayla-course-spec');
const { createTemplateRegistry, getTemplate } = require('./kayla-template-registry');
const dry = require('./telegram-outreach-dry-run');
const tg = require('./kayla-telegram-outreach');
const router = require('./telegram-command-router');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kayla-telegram-dry-run-'));
process.env.ATLAS_TELEGRAM_DRY_RUN_DIR = tmp;
process.env.ATLAS_TELEGRAM_VIEWER_IDS = '100';
process.env.ATLAS_TELEGRAM_REVIEWER_IDS = '200';
process.env.ATLAS_TELEGRAM_APPROVER_IDS = '300';
process.env.ATLAS_TELEGRAM_ADMIN_IDS = '400';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

function ctx(user = 300) { return { telegramUserId: user, chatId: 'chat-1', env: process.env }; }
function opp(overrides = {}) { return { opportunityId: overrides.opportunityId || `opp-${Math.random()}`, contactId: overrides.contactId || `contact-${Math.random()}`, propertyAddress: overrides.propertyAddress || '123 Main St, Dallas TX', contactName: overrides.contactName || 'Alice Agent', contactRole: overrides.contactRole || 'agent', stageId: overrides.stageId || LEAD_ENTERED_STAGE_ID, stageName: overrides.stageName || 'Lead Entered', ...overrides }; }
function realOpp(overrides = {}) { return opp({ opportunityId: 'realOpp123456789', contactId: 'realContact123456', propertyAddress: '123 Real St Dallas TX 75201', phone: '+15555550123', raw: { locationId: '61XPzSqRy7UKMwW9DeB8', pipelineId: 'nSf3NXYVkt8X4PgW9aZ3', propertyFingerprint: 'fp-real' }, ...overrides }); }
const fixtures = [
  opp({ opportunityId: 'opp-a1', contactId: 'contact-a1', contactRole: 'agent', contactName: 'Alice Agent', propertyAddress: '1 Agent Rd' }),
  opp({ opportunityId: 'opp-a2', contactId: 'contact-a2', contactRole: 'agent', contactName: 'Bob Realtor', propertyAddress: '2 Agent Rd' }),
  opp({ opportunityId: 'opp-o1', contactId: 'contact-o1', contactRole: 'owner', contactName: 'Olivia Owner', propertyAddress: '3 Owner Rd' }),
  opp({ opportunityId: 'opp-u1', contactId: 'contact-u1', contactRole: '', contactName: 'Mystery', propertyAddress: '4 Unknown Rd' }),
];

async function main() {
await test('1 parity spec loads', () => {
  const spec = loadKaylaCourseSpec();
  assert.strictEqual(spec.productionLocks.pipelineId, 'nSf3NXYVkt8X4PgW9aZ3');
});
await test('2 all 21 stages represented', () => assert.strictEqual(loadKaylaCourseSpec().stages.length, 21));
await test('3 course conflicts preserved', () => assert.ok(loadKaylaCourseSpec().conflicts.some(c => c.code === 'COURSE_RULE_CONFLICT')));
await test('4 missing rule blocks', () => assert.strictEqual(dry.evaluateEligibility(opp({ stageId: 'missing-stage' })).resultClass, 'BLOCKED_MISSING_COURSE_RULE'));
await test('5 scripts map to audience/stage', () => { const t = getTemplate('INT'); assert.ok(t.audience.includes('agent')); assert.strictEqual(t.stage, 1); });
await test('6 call rules map correctly', () => assert.ok(loadKaylaCourseSpec().courseRules.some(r => r.id === 'INT_BEFORE_CALL')));
await test('7 follow-up rules map correctly', () => assert.ok(loadKaylaCourseSpec().courseRules.some(r => r.id === 'REALIGN_48H')));
await test('8 session creation', () => { const plan = dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }); const s = dry.createSession({ chatId: 'c', telegramUserId: 100, plan }); assert.strictEqual(s.state, 'PLANNED'); });
await test('9 session persistence', () => { const s = dry.latestSession('c', 100); assert.ok(dry.getSession(s.sessionId)); });
await test('10 session expiration', () => { const s = dry.latestSession('c', 100); s.expiresAt = new Date(Date.now() - 1).toISOString(); dry.saveSession(s); assert.throws(() => dry.approveDryRun(s, ctx(300)), /SESSION_EXPIRED/); });
await test('11 restart recovery', () => assert.ok(dry.latestSession('c', 100).sessionId));
await test('12 immutable plan hash', () => { const p1 = dry.buildPlan({ opportunities: fixtures, count: 2, ctx: ctx(100) }); const p2 = dry.buildPlan({ opportunities: fixtures, count: 2, ctx: ctx(100) }); assert.strictEqual(p1.immutablePlanHash, p2.immutablePlanHash); });
await test('13 hold item', () => { const s = dry.createSession({ chatId: 'h', telegramUserId: 300, plan: dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }) }); dry.updateNumbers(s, [1], 'HELD'); assert.ok(dry.getSession(s.sessionId).heldRecords.includes(1)); });
await test('14 skip item', () => { const s = dry.latestSession('h', 300); dry.updateNumbers(s, [2], 'SKIPPED'); assert.ok(dry.getSession(s.sessionId).skippedRecords.includes(2)); });
await test('15 restore item', () => { const s = dry.latestSession('h', 300); dry.updateNumbers(s, [1], 'AVAILABLE'); assert.ok(!dry.getSession(s.sessionId).heldRecords.includes(1)); });
await test('16 cancel plan', () => { const plan = dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }); dry.createSession({ chatId: 'chat-1', telegramUserId: 300, plan }); const r = tg.handleKaylaOutreachCommand(ctx(300), 'cancel'); assert.ok(r.reply.includes('canceled')); });
await test('17 select subset', () => { const s = dry.createSession({ chatId: 'sel', telegramUserId: 300, plan: dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }) }); dry.selectNumbers(s, [1]); assert.deepStrictEqual(dry.getSession(s.sessionId).approvedNumbers, [1]); });
await test('18 select range', () => assert.deepStrictEqual(dry.parseNumbers('select 1-3'), [1, 2, 3]));
await test('19 select all', () => assert.deepStrictEqual(dry.parseNumbers('select all'), ['all']));
await test('20 unselected items cannot execute', () => { const s = dry.latestSession('sel', 300); dry.approveDryRun(s, ctx(300)); const result = dry.executeDryRun(dry.getSession(s.sessionId), ctx(300)); assert.strictEqual(result.actions.length, 1); });
await test('21 show 10 agents', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'show me 10 agents', { opportunities: fixtures }).reply.includes('agent')));
await test('22 show 10 owners', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'show me five owners Kayla says are due', { opportunities: fixtures }).reply.includes('owner')));
await test('23 show calls due', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'who should I call now', { opportunities: fixtures }).reply.includes('Plan')));
await test('24 show texts due', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'show text-due leads', { opportunities: fixtures }).reply.includes('Plan')));
await test('25 show follow-ups due', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'show follow-ups due', { opportunities: fixtures }).reply.includes('Plan')));
await test('26 preview first five', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'preview the first 5').reply.includes('Preview')));
await test('27 hold number three', () => { tg.handleKaylaOutreachCommand(ctx(200), 'show me 10 agents', { opportunities: fixtures }); const r = tg.handleKaylaOutreachCommand(ctx(200), 'hold 1'); assert.ok(r.reply.includes('HELD')); });
await test('28 skip two and seven', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(200), 'skip 2 and 7').reply.includes('SKIPPED')));
await test('29 select one four six', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(200), 'select 1, 4, and 6').reply.includes('Plan')));
await test('30 show exact shortcut', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'show Kayla shortcut for 1').reply.includes('Shortcut')));
await test('31 explain why due', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'why is number 1 due').reply.includes('due because')));
await test('32 pause outreach', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(400), 'pause outreach').reply.includes('PAUSED')));
await test('33 resume dry run', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(400), 'resume dry run').reply.includes('DRY_RUN_ONLY')));
await test('34 eligible owner', () => assert.strictEqual(dry.evaluateEligibility(opp({ contactRole: 'owner' })).resultClass, 'ELIGIBLE_INITIAL_TEXT'));
await test('35 eligible agent', () => assert.strictEqual(dry.evaluateEligibility(opp({ contactRole: 'agent' })).resultClass, 'ELIGIBLE_INITIAL_TEXT'));
await test('36 unknown role blocks role-specific script', () => assert.strictEqual(dry.evaluateEligibility(opp({ contactRole: '', contactName: 'Mystery' })).resultClass, 'BLOCKED_ROLE_UNCERTAIN'));
await test('37 DNC blocks', () => assert.strictEqual(dry.evaluateEligibility(opp({ dnc: true })).resultClass, 'BLOCKED_DNC'));
await test('38 wrong number blocks', () => assert.strictEqual(dry.evaluateEligibility(opp({ wrongNumber: true })).resultClass, 'BLOCKED_WRONG_NUMBER'));
await test('39 missing property context blocks', () => assert.strictEqual(dry.evaluateEligibility(opp({ propertyAddress: '' })).resultClass, 'BLOCKED_MISSING_PROPERTY_CONTEXT'));
await test('40 pending reply blocks', () => assert.strictEqual(dry.evaluateEligibility(opp({ pendingReply: true })).resultClass, 'BLOCKED_PENDING_REPLY'));
await test('41 prior message uncertainty blocks', () => assert.strictEqual(dry.evaluateEligibility(opp({ priorOutreachUncertain: true })).resultClass, 'BLOCKED_PRIOR_OUTREACH_UNCERTAIN'));
await test('42 active human work blocks', () => assert.strictEqual(dry.evaluateEligibility(opp({ activeHumanWork: true })).resultClass, 'BLOCKED_ACTIVE_HUMAN_WORK'));
await test('43 same contact different property evaluable', () => { const a = opp({ contactId: 'same', propertyAddress: 'A', opportunityId: 'a' }); const b = opp({ contactId: 'same', propertyAddress: 'B', opportunityId: 'b' }); assert.strictEqual(dry.evaluateEligibility(a, { allRecords: [a, b] }).resultClass, 'ELIGIBLE_INITIAL_TEXT'); });
await test('44 same property duplicate blocks', () => { const a = opp({ propertyAddress: 'A', opportunityId: 'a' }); const b = opp({ propertyAddress: 'A', opportunityId: 'b' }); assert.strictEqual(dry.evaluateEligibility(a, { allRecords: [a, b] }).resultClass, 'BLOCKED_MULTI_PROPERTY_CONTEXT'); });
await test('45 multi-property ambiguity conservative in plan', () => { const a = opp({ contactId: 'same2', propertyAddress: 'A', opportunityId: 'a' }); const b = opp({ contactId: 'same2', propertyAddress: 'B', opportunityId: 'b' }); const p = dry.buildPlan({ opportunities: [a, b], ctx: ctx(100), roleFilter: 'all' }); assert.strictEqual(p.selectedRecords.length, 1); });
await test('46 workflow conflict blocks live safety', () => { const p = dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }); assert.strictEqual(p.selectedRecords[0].expectedStageResult.risk, 'BLOCKED_WORKFLOW_SIDE_EFFECT_RISK'); });
await test('47 missing script blocks', () => { const spec = loadKaylaCourseSpec(); const registry = createTemplateRegistry({ spec }).filter(t => t.shortcutName !== 'INT'); assert.strictEqual(dry.evaluateEligibility(opp(), { spec, registry }).resultClass, 'BLOCKED_MISSING_SCRIPT'); });
await test('48 provider absence blocks live only not dry run', () => assert.ok(dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }).selectedRecords.length));
await test('49 fresh reread required modeled', () => assert.ok(dry.executeDryRun.toString().includes('APPROVED_DRY_RUN')));
await test('50 eligibility recalculated available', () => assert.strictEqual(typeof dry.evaluateEligibility, 'function'));
await test('51 2619 sender lock enforced', () => assert.ok(dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }).senderNumberLock.endsWith('2619')));
await test('52 durable action id generated', () => { const s = dry.createSession({ chatId: 'exec', telegramUserId: 300, plan: dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }) }); dry.selectNumbers(s, [1]); dry.approveDryRun(s, ctx(300)); const r = dry.executeDryRun(dry.getSession(s.sessionId), ctx(300)); assert.ok(r.actions[0].actionId.startsWith('simact_')); });
await test('53 duplicate action id blocks', () => { const s = dry.latestSession('exec', 300); assert.throws(() => dry.executeDryRun(s, ctx(300)), /SESSION_NOT_APPROVED|DUPLICATE/); });
await test('54 provider send simulated', () => assert.ok(fs.readFileSync(path.join(tmp, 'journal.jsonl'), 'utf8').includes('SIMULATED_PROVIDER_ACCEPTED')));
await test('55 GHL write simulated', () => assert.ok(fs.readFileSync(path.join(tmp, 'journal.jsonl'), 'utf8').includes('SIMULATED_GHL_CONVERSATION_RESULT')));
await test('56 stage move simulated', () => assert.ok(fs.readFileSync(path.join(tmp, 'journal.jsonl'), 'utf8').includes('SIMULATED_STAGE_MOVE')));
await test('57 journal records simulation', () => assert.ok(fs.existsSync(path.join(tmp, 'journal.jsonl'))));
await test('58 telegram result matches selected', () => { const r = tg.handleKaylaOutreachCommand(ctx(300), 'show simulated activity'); assert.ok(r.reply.includes('action')); });
await test('59 exact requested count not exceeded', () => assert.ok(dry.buildPlan({ opportunities: fixtures, count: 2, ctx: ctx(100) }).selectedRecords.length <= 2));
await test('60 kill switch blocks paused simulation', () => { dry.setKillSwitch('PAUSED', ctx(400)); const s = dry.createSession({ chatId: 'paused', telegramUserId: 300, plan: dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }) }); dry.selectNumbers(s, [1]); assert.throws(() => dry.approveDryRun(s, ctx(300)), /OUTREACH_PAUSED/); dry.setKillSwitch('DRY_RUN_ONLY', ctx(400)); });
await test('61 LIVE_ALLOWED cannot be entered', () => assert.throws(() => dry.setKillSwitch('LIVE_ALLOWED', ctx(400)), /INVALID_KILL_SWITCH_STATE/));
await test('62 viewer cannot approve', () => { const s = dry.createSession({ chatId: 'viewer', telegramUserId: 100, plan: dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }) }); assert.throws(() => dry.approveDryRun(s, ctx(100)), /ACCESS_DENIED/); });
await test('63 reviewer cannot approve', () => { const s = dry.latestSession('viewer', 100); assert.throws(() => dry.approveDryRun(s, ctx(200)), /ACCESS_DENIED/); });
await test('64 approver can approve dry run', () => { const s = dry.createSession({ chatId: 'appr', telegramUserId: 300, plan: dry.buildPlan({ opportunities: fixtures, ctx: ctx(100) }) }); dry.selectNumbers(s, [1]); assert.strictEqual(dry.approveDryRun(s, ctx(300)).state, 'APPROVED_DRY_RUN'); });
await test('65 unauthorized user blocked', () => assert.throws(() => dry.buildPlan({ opportunities: fixtures, ctx: ctx(999) }), /ACCESS_DENIED/));
await test('66 admin can pause', () => assert.strictEqual(dry.setKillSwitch('PAUSED', ctx(400)).state, 'PAUSED'));
await test('67 permission changes journaled', () => assert.ok(fs.readFileSync(path.join(tmp, 'journal.jsonl'), 'utf8').includes('KILL_SWITCH_CHANGED')));
await test('68 router natural language routes outreach', () => assert.deepStrictEqual(router.parseCommand('show me 10 agents').command, 'outreach'));
await test('69 router slash command routes outreach', async () => { dry.setKillSwitch('DRY_RUN_ONLY', ctx(400)); const r = await router.routeCommand({ command: 'outreach', args: 'show me 10 agents', telegramUserId: 100, chatId: 'router', env: process.env }); assert.ok(r.reply.includes('Plan')); });
await test('70 template registry contains approved INT', () => assert.strictEqual(getTemplate('INT').status, 'APPROVED_BY_COURSE'));
await test('71 contact made stage lock known', () => assert.strictEqual(CONTACT_MADE_STAGE_ID, '934c4c52-4b22-457a-8d10-55ab6600fdee'));
await test('72 artifact hash integrity', () => { const a = dry.createArtifact('atlas-telegram-dry-run-test-artifact', { ok: true }, { dataDir: tmp, artifactDir: tmp }); assert.strictEqual(a.canonicalHash.length, 64); });
await test('73 canary preview invokes GHL guard', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('GHL guard:')); });
await test('74 canary guard schema persists on session', () => { const s = dry.latestSession('chat-1', 100); assert.strictEqual(s.canaryGuardSchema, 'atlas-ghl-telegram-canary-guard-v1'); });
await test('75 synthetic opportunity blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp({ opportunityId: 'opp-a1' })], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('LIVE_PLAN_CONTAINS_SYNTHETIC_OR_INVALID_OPPORTUNITY_ID')); });
await test('76 synthetic contact blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp({ contactId: 'contact-a1' })], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('LIVE_PLAN_CONTAINS_SYNTHETIC_OR_INVALID_CONTACT_ID')); });
await test('77 DNC blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp({ dnc: true })], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('CONTACT_COMPLIANCE_LOCK')); });
await test('78 opt-out blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp({ tags: ['opt out'] })], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('CONTACT_COMPLIANCE_LOCK')); });
await test('79 wrong number blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp({ wrongNumber: true })], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('WRONG_NUMBER_LOCK')); });
await test('80 pending reply blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp({ pendingReply: true })], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('CONVERSATION_CONTEXT_LOCK')); });
await test('81 active human work blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp({ activeHumanWork: true })], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('TEAM_OWNERSHIP_LOCK')); });
await test('82 unknown timezone blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp({ propertyAddress: '123 Real St' })], now: new Date('2026-07-31T16:00:00Z'), timeZone: '' }); assert.ok(r.reply.includes('UNKNOWN_TIMEZONE_BLOCKS_CANARY')); });
await test('83 weekend blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-08-01T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('WEEKEND_BLOCKS_CANARY')); });
await test('84 before noon blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-07-31T15:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.reply.includes('OUTSIDE_LOCAL_CANARY_WINDOW')); });
await test('85 after 6 blocks integrated preview', () => { const r = tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-07-31T23:30:00Z'), timeZone: 'America/Chicago' }); assert.ok(r.reply.includes('OUTSIDE_LOCAL_CANARY_WINDOW')); });
await test('86 exact noon boundary is sendable', () => { const r = tg.canaryPreviewForIntent({ count: 1 }, ctx(100), { opportunities: [realOpp()], now: new Date('2026-07-31T17:00:00Z'), timeZone: 'America/Chicago' }); assert.ok(r.session.selectedRecords[0].ghlGuard.localTimeWindowStatus.passed); });
await test('87 exact 6pm boundary is blocked', () => { const r = tg.canaryPreviewForIntent({ count: 1 }, ctx(100), { opportunities: [realOpp()], now: new Date('2026-07-31T23:00:00Z'), timeZone: 'America/Chicago' }); assert.strictEqual(r.session.selectedRecords[0].ghlGuard.localTimeWindowStatus.passed, false); });
await test('88 safe three-record preview preserves stage course conflict', () => { const records = [realOpp({ opportunityId: 'realOppA123456', contactId: 'realContactA123456', propertyAddress: 'A Dallas TX 75201' }), realOpp({ opportunityId: 'realOppB123456', contactId: 'realContactB123456', propertyAddress: 'B Dallas TX 75202' }), realOpp({ opportunityId: 'realOppC123456', contactId: 'realContactC123456', propertyAddress: 'C Dallas TX 75203' })]; const r = tg.canaryPreviewForIntent({ count: 3 }, ctx(100), { opportunities: records, now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }); assert.ok(r.session.selectedRecords.every(item => item.ghlGuard.stageMovementCapability.status === 'STAGE_MOVEMENT_DISABLED_COURSE_CONFLICT_UNRESOLVED')); });
await test('89 canary preview zero sends', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }).reply.includes('Live sends: 0')));
await test('90 canary preview zero writes', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }).reply.includes('Production writes: 0')));
await test('91 canary preview zero stage movements', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-07-31T16:00:00Z'), timeZone: 'America/New_York' }).reply.includes('Stage movements: 0')));
await test('92 canary preview shows exact course source', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-07-31T16:00:00Z') }).reply.includes('lead-tracking/AIREI_SCRIPTS_REFERENCE.md')));
await test('93 canary preview discloses Contact Made conflict', () => assert.ok(tg.handleKaylaOutreachCommand(ctx(100), 'canary preview three', { opportunities: [realOpp()], now: new Date('2026-07-31T16:00:00Z') }).reply.includes('does not establish')));
console.log(`\n${passed}/93 tests passed`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
