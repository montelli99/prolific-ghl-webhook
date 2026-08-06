'use strict';
const { LocalSuppressionRegistry } = require('../modules/local-suppression-registry');
const { PlanStore } = require('../modules/plan-store');

const registry = new LocalSuppressionRegistry();
const store = new PlanStore();

// Tamara Harper - PRIOR_OUTREACH + DUPLICATE_HISTORY + PENDING_REPLY
registry.addEntry({
  phone: '+18006301727',
  type: 'PRIOR_OUTREACH',
  state: 'BLOCKED',
  source: 'CANARY_EXECUTION',
  sourceEventId: 'plan_694953d75b8ccc36:item:1:provider:582011269',
  scope: 'PIPELINE',
  evidence: { planId: 'plan_694953d75b8ccc36', itemNumber: 1, providerId: 582011269, body: 'Happy Thu, Tamara Harper!...' },
});
console.log('Tamara PRIOR_OUTREACH: BLOCKED');

registry.addEntry({
  phone: '+18006301727',
  type: 'DUPLICATE_HISTORY',
  state: 'BLOCKED',
  source: 'CANARY_EXECUTION',
  sourceEventId: 'plan_694953d75b8ccc36:item:1:provider:582011269',
  scope: 'PIPELINE',
  evidence: { planId: 'plan_694953d75b8ccc36', itemNumber: 1, providerId: 582011269 },
});
console.log('Tamara DUPLICATE_HISTORY: BLOCKED');

registry.addEntry({
  phone: '+18006301727',
  type: 'PENDING_REPLY',
  state: 'BLOCKED',
  source: 'CANARY_EXECUTION',
  sourceEventId: 'plan_694953d75b8ccc36:item:1:provider:582011269',
  scope: 'PIPELINE',
  evidence: { planId: 'plan_694953d75b8ccc36', itemNumber: 1, providerId: 582011269, awaitingReply: true },
});
console.log('Tamara PENDING_REPLY: BLOCKED (awaiting reply)');

// Sydney Tilford - PRIOR_OUTREACH + DUPLICATE_HISTORY + PENDING_REPLY
registry.addEntry({
  phone: '+13178445111',
  type: 'PRIOR_OUTREACH',
  state: 'BLOCKED',
  source: 'CANARY_EXECUTION',
  sourceEventId: 'plan_694953d75b8ccc36:item:3:provider:582011324',
  scope: 'PIPELINE',
  evidence: { planId: 'plan_694953d75b8ccc36', itemNumber: 3, providerId: 582011324, body: 'Happy Thu, Sydney Tilford!...' },
});
console.log('Sydney PRIOR_OUTREACH: BLOCKED');

registry.addEntry({
  phone: '+13178445111',
  type: 'DUPLICATE_HISTORY',
  state: 'BLOCKED',
  source: 'CANARY_EXECUTION',
  sourceEventId: 'plan_694953d75b8ccc36:item:3:provider:582011324',
  scope: 'PIPELINE',
  evidence: { planId: 'plan_694953d75b8ccc36', itemNumber: 3, providerId: 582011324 },
});
console.log('Sydney DUPLICATE_HISTORY: BLOCKED');

registry.addEntry({
  phone: '+13178445111',
  type: 'PENDING_REPLY',
  state: 'BLOCKED',
  source: 'CANARY_EXECUTION',
  sourceEventId: 'plan_694953d75b8ccc36:item:3:provider:582011324',
  scope: 'PIPELINE',
  evidence: { planId: 'plan_694953d75b8ccc36', itemNumber: 3, providerId: 582011324, awaitingReply: true },
});
console.log('Sydney PENDING_REPLY: BLOCKED (awaiting reply)');

// Fred McIntire - LANDLINE_CONFIRMED
registry.addEntry({
  phone: '+13172715959',
  type: 'PROVIDER_UNCERTAIN',
  state: 'BLOCKED',
  source: 'CANARY_EXECUTION',
  sourceEventId: 'plan_694953d75b8ccc36:item:2:landline',
  scope: 'PIPELINE',
  evidence: {
    planId: 'plan_694953d75b8ccc36',
    itemNumber: 2,
    classification: 'LANDLINE_CONFIRMED',
    carrierError: 'Trying to send an SMS to Landline Number, please check the number and try again.',
    smsIneligible: true,
  },
});
console.log('Fred PROVIDER_UNCERTAIN: BLOCKED (LANDLINE_CONFIRMED)');

// Reconcile plan
const plan = store.loadPlan('plan_694953d75b8ccc36');
plan.executionResults = [
  { number: 1, contactName: 'Tamara Harper', status: 'SENT', providerId: 582011269, deliveryStatus: 'delivered', cost: 0.05, timestamp: '2026-08-06T16:52:40Z' },
  { number: 2, contactName: 'Fred McIntire', status: 'FAILED_LANDLINE', carrierError: 'Trying to send an SMS to Landline Number', timestamp: '2026-08-06T16:52:43Z' },
  { number: 3, contactName: 'Sydney Tilford', status: 'SENT', providerId: 582011324, deliveryStatus: 'undelivered', cost: 0.05, timestamp: '2026-08-06T16:52:45Z' },
];
plan.productionEffects = { sends: 2, ghlWrites: 0, stageMovements: 0, failedAttempts: 1 };
plan.reconciledAt = new Date().toISOString();
plan.reconciliationHash = require('crypto').createHash('sha256').update(JSON.stringify(plan.executionResults)).digest('hex');
plan.status = 'COMPLETED';
plan.executable = false;

const fs = require('fs');
const path = require('path');
const filePath = store.planPath('plan_694953d75b8ccc36');
const tmp = filePath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(plan, null, 2) + '\n');
fs.renameSync(tmp, filePath);

const readback = JSON.parse(fs.readFileSync(filePath, 'utf8'));
console.log('Plan reconciled. Hash match:', readback.planHash === plan.planHash);
console.log('Reconciliation hash:', plan.reconciliationHash);
console.log('Status:', plan.status);
console.log('Sends:', plan.productionEffects.sends);
console.log('Failed:', plan.productionEffects.failedAttempts);
