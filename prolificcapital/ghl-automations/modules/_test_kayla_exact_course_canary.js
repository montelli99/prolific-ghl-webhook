#!/usr/bin/env node
'use strict';

const assert = require('assert');
const evidence = require('./kayla-course-evidence');
const roles = require('./kayla-role-classifier');
const tz = require('./property-timezone');
const sender = require('./atlas-sender-verification');
const guards = require('./atlas-ghl-telegram-live-guards');
const { createTemplateRegistry } = require('./kayla-template-registry');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
function opp(overrides = {}) { return { opportunityId: 'realOpp123456789', contactId: 'realContact123456', propertyAddress: '123 Main St Dallas TX 75201', contactName: 'Alice Agent', contactRole: 'agent', stageId: guards.TARGET.leadEnteredStageId, phone: '+15555550123', raw: { locationId: guards.TARGET.locationId, pipelineId: guards.TARGET.pipelineId, propertyFingerprint: 'fp' }, ...overrides }; }

(async () => {
await test('1 every production script has source', () => { for (const script of Object.values(evidence.SCRIPT_REGISTRY)) assert.ok(script.sourceFile && script.sourceLines && script.exactSourceWording); });
await test('2 unsupported script blocks', () => assert.equal(createTemplateRegistry().find(t => t.shortcutName === 'F50').status, 'COURSE_MISSING'));
await test('3 stage movement is course conflict', () => assert.equal(evidence.getCourseRule('STAGE1_EXIT_AFTER_INT').classification, 'COURSE_CONFLICT'));
await test('4 seller and agent scripts cannot substitute uncertain role', () => assert.equal(roles.roleCanReceiveProductionScript(roles.classifyRole(opp({ contactRole: '', contactName: 'Mystery' })), evidence.getProductionScript('INT')).ok, false));
await test('5 explicit role is confirmed', () => assert.equal(roles.classifyRole(opp({ contactRole: 'agent' })).level, 'CONFIRMED'));
await test('6 source listing agent infers high confidence', () => assert.equal(roles.classifyRole(opp({ contactRole: '', contactName: 'Alice Agent', raw: { listingAgent: 'Alice Agent' } })).level, 'HIGH_CONFIDENCE_INFERRED'));
await test('7 conflicting role evidence blocks', () => assert.equal(roles.classifyRole(opp({ contactRole: '', contactName: 'Alice Agent', raw: { sellerName: 'Alice Agent', listingAgent: 'Alice Agent' } })).level, 'CONFLICTING'));
await test('8 timezone derives from property address', () => assert.equal(tz.derivePropertyTimezone(opp()).timeZone, 'America/Chicago'));
await test('9 unknown timezone blocks', () => assert.equal(tz.derivePropertyTimezone(opp({ propertyAddress: '123 Main St' })).reason, 'UNKNOWN_TIMEZONE_BLOCKS_CANARY'));
await test('10 technical safety policy label exists', () => assert.ok(guards.evaluateGhlCanaryRecord(opp()).ruleTaxonomy.technicalSafetyPolicies.includes('PROPERTY_LOCAL_TIME_WINDOW')));
await test('11 DNC is compliance rule', () => assert.ok(guards.evaluateGhlCanaryRecord(opp()).ruleTaxonomy.legalOrComplianceRules.includes('DNC')));
await test('12 maximum-three rule is technical safety', () => assert.ok(guards.evaluateGhlCanaryRecord(opp()).ruleTaxonomy.technicalSafetyPolicies.includes('MAX_THREE_CANARY')));
await test('13 exact INT shortcut is approved', () => assert.equal(createTemplateRegistry().find(t => t.shortcutName === 'INT').status, 'APPROVED_BY_COURSE'));
await test('14 exact INT source appears', () => assert.equal(createTemplateRegistry().find(t => t.shortcutName === 'INT').source, 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md'));
await test('15 real IDs are required', () => assert.equal(guards.validateRealGhlIdentity(opp({ opportunityId: 'opp-a1' })).ok, false));
await test('16 provider sender is locked to 571/2619', () => assert.equal(sender.senderMatches('+15715552619'), true));
await test('17 other sender is rejected', () => assert.equal(sender.senderMatches('+15715550000'), false));
await test('18 no fourth action exists', () => assert.ok(guards.validateGhlCanaryPlan({ records: [opp({ opportunityId: 'realOppA123', contactId: 'realContactA123', propertyAddress: 'A Dallas TX 75201' }), opp({ opportunityId: 'realOppB123', contactId: 'realContactB123', propertyAddress: 'B Dallas TX 75202' }), opp({ opportunityId: 'realOppC123', contactId: 'realContactC123', propertyAddress: 'C Dallas TX 75203' }), opp({ opportunityId: 'realOppD123', contactId: 'realContactD123', propertyAddress: 'D Dallas TX 75204' })], killSwitchState: 'CANARY_ALLOWED', timeZone: 'America/Chicago', now: new Date('2026-07-31T16:00:00Z') }).errors.includes('CANARY_COUNT_EXCEEDS_THREE')));
await test('19 no stage movement occurs', () => assert.equal(guards.evaluateGhlCanaryRecord(opp()).stageMovements, 0));
await test('20 provider uncertainty policy is not course logic', () => assert.equal(guards.evaluateGhlCanaryRecord(opp()).ruleTaxonomy.courseRules.some(rule => /uncertain provider/i.test(rule.supportingText || '')), false));
await test('21 post-send next step is course-derived call after INT', () => assert.match(evidence.getCourseRule('INT_BEFORE_CALL').supportingText, /Call the client twice/));
await test('22 CCC requires call trigger', () => assert.match(evidence.getProductionScript('CCC').triggerCondition, /After every call/));
await test('23 NOA requires no-answer condition', () => assert.match(evidence.getProductionScript('NOA').triggerCondition, /two unanswered calls/));
await test('24 no unrelated CRM reference in new evidence registry', () => assert.doesNotMatch(JSON.stringify(evidence), /CRM project/i));
console.log(`\n${passed}/24 tests passed`);
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
