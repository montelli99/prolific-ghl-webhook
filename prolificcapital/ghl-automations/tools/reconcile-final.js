'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PlanStore } = require('../modules/plan-store');
const { resolveDeliveryState, countDelivered, countProviderAccepted } = require('../modules/delivery-state-resolver');

const store = new PlanStore();
const plan = store.loadPlan('plan_694953d75b8ccc36');

// Resolve delivery states
const tamara = resolveDeliveryState({
  providerId: 582011269,
  deliveryStatus: 'delivered',
  cost: 0.05,
});
const sydney = resolveDeliveryState({
  providerId: 582011324,
  deliveryStatus: 'undelivered',
  cost: 0.05,
});
const fred = resolveDeliveryState({
  carrierError: 'Trying to send an SMS to Landline Number, please check the number and try again.',
});

const results = [tamara, fred, sydney];

plan.executionResults = [
  {
    number: 1,
    contactName: 'Tamara Harper',
    providerId: 582011269,
    deliveryState: tamara.state,
    terminal: tamara.terminal,
    waitingForReply: tamara.waitingForReply,
    cost: 0.05,
    timestamp: '2026-08-06T16:52:40Z',
    body: "Happy Thu, Tamara Harper! Are you still accepting offers for 7117 Manker St, Indianapolis IN 46227? My name is Montelli, I'm looking to purchase this as a rental for my portfolio.",
  },
  {
    number: 2,
    contactName: 'Fred McIntire',
    providerId: null,
    deliveryState: fred.state,
    terminal: fred.terminal,
    waitingForReply: fred.waitingForReply,
    smsEligible: fred.smsEligible,
    carrierError: fred.carrierError,
    cost: 0.00,
    timestamp: '2026-08-06T16:52:43Z',
  },
  {
    number: 3,
    contactName: 'Sydney Tilford',
    providerId: 582011324,
    deliveryState: sydney.state,
    terminal: sydney.terminal,
    waitingForReply: sydney.waitingForReply,
    manualNumberValidationRequired: sydney.manualNumberValidationRequired,
    cost: 0.05,
    timestamp: '2026-08-06T16:52:45Z',
    body: "Happy Thu, Sydney Tilford! Are you still accepting offers for 418 N Centennial St, Indianapolis IN 46222? My name is Montelli, I'm looking to purchase this as a rental for my portfolio.",
  },
];

plan.productionEffects = {
  providerAttempts: 3,
  providerAccepted: countProviderAccepted(results),
  delivered: countDelivered(results),
  undelivered: 1,
  failedLandline: 1,
  ghlWrites: 0,
  stageMovements: 0,
};
plan.status = 'COMPLETED_WITH_PARTIAL_DELIVERY';
plan.executable = false;
plan.reconciledAt = new Date().toISOString();
plan.reconciliationHash = crypto.createHash('sha256').update(JSON.stringify(plan.executionResults)).digest('hex');

const filePath = store.planPath('plan_694953d75b8ccc36');
const tmp = filePath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(plan, null, 2) + '\n');
fs.renameSync(tmp, filePath);

const readback = JSON.parse(fs.readFileSync(filePath, 'utf8'));
console.log('Plan reconciled:', plan.status);
console.log('Hash match:', readback.planHash === plan.planHash);
console.log('Reconciliation hash:', plan.reconciliationHash);
console.log('Delivered:', plan.productionEffects.delivered);
console.log('Undelivered:', plan.productionEffects.undelivered);
console.log('Failed landline:', plan.productionEffects.failedLandline);
console.log('Provider accepted:', plan.productionEffects.providerAccepted);
console.log('Provider attempts:', plan.productionEffects.providerAttempts);
