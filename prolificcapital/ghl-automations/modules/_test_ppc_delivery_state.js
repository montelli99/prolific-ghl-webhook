'use strict';

const { DELIVERY_STATES, resolveDeliveryState } = require('./delivery-state-resolver');

let pass = 0, fail = 0;
const results = [];

function test(name, fn) {
  try { fn(); pass++; results.push(`  PASS ${name}`); }
  catch (e) { fail++; results.push(`  FAIL ${name}: ${e.message}`); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'mismatch'}: expected ${b}, got ${a}`); }

function isCallReady(state) {
  return state === DELIVERY_STATES.DELIVERED;
}

// ─── PROVIDER_ACCEPTED != DELIVERED ───────────────────────────
test('1 PROVIDER_ACCEPTED → DELIVERY_PENDING', () => {
  const r = resolveDeliveryState({ providerId: 'msg_123', accepted: true });
  assertEq(r.state, DELIVERY_STATES.PROVIDER_ACCEPTED);
  assertEq(r.terminal, false);
  assertEq(r.reason, 'PROVIDER_ACCEPTED_AWAITING_STATUS');
});

test('2 PROVIDER_ACCEPTED → NOT CALL_READY', () => {
  const r = resolveDeliveryState({ providerId: 'msg_123', accepted: true });
  assert(!isCallReady(r.state), 'PROVIDER_ACCEPTED must not be CALL_READY');
});

test('3 DELIVERED → CALL_READY', () => {
  const r = resolveDeliveryState({ providerId: 'msg_123', deliveryStatus: 'delivered' });
  assertEq(r.state, DELIVERY_STATES.DELIVERED);
  assert(isCallReady(r.state), 'DELIVERED must be CALL_READY');
  assertEq(r.terminal, true);
});

test('4 UNDELIVERED → NOT CALL_READY', () => {
  const r = resolveDeliveryState({ providerId: 'msg_123', deliveryStatus: 'undelivered' });
  assertEq(r.state, DELIVERY_STATES.UNDELIVERED);
  assert(!isCallReady(r.state), 'UNDELIVERED must not be CALL_READY');
});

test('5 FAILED_LANDLINE → NOT CALL_READY', () => {
  const r = resolveDeliveryState({ providerId: 'msg_123', carrierError: 'landline detected' });
  assertEq(r.state, DELIVERY_STATES.FAILED_LANDLINE);
  assert(!isCallReady(r.state), 'FAILED_LANDLINE must not be CALL_READY');
  assertEq(r.smsEligible, false);
});

test('6 FAILED_INVALID_NUMBER → NOT CALL_READY', () => {
  const r = resolveDeliveryState({ providerId: 'msg_123', carrierError: 'invalid number' });
  assertEq(r.state, DELIVERY_STATES.FAILED_INVALID_NUMBER);
  assert(!isCallReady(r.state), 'FAILED_INVALID_NUMBER must not be CALL_READY');
});

test('7 FAILED_CARRIER → NOT CALL_READY', () => {
  const r = resolveDeliveryState({ providerId: 'msg_123', carrierError: 'carrier blocked' });
  assertEq(r.state, DELIVERY_STATES.FAILED_CARRIER);
  assert(!isCallReady(r.state), 'FAILED_CARRIER must not be CALL_READY');
});

test('8 UNCERTAIN_RESULT → NOT CALL_READY', () => {
  const r = resolveDeliveryState({});
  assertEq(r.state, DELIVERY_STATES.UNCERTAIN_RESULT);
  assert(!isCallReady(r.state), 'UNCERTAIN_RESULT must not be CALL_READY');
});

test('9 no provider response → UNCERTAIN', () => {
  const r = resolveDeliveryState({});
  assertEq(r.state, DELIVERY_STATES.UNCERTAIN_RESULT);
  assertEq(r.reason, 'NO_PROVIDER_RESPONSE');
});

test('10 provider message ID alone never means delivered', () => {
  const r = resolveDeliveryState({ providerId: 'msg_456' });
  assertEq(r.state, DELIVERY_STATES.PROVIDER_ACCEPTED);
  assert(!isCallReady(r.state), 'provider ID alone must not mean delivered');
  assertEq(r.reason, 'PROVIDER_ACCEPTED_AWAITING_STATUS');
});

test('11 no auto call in any first-canary state', () => {
  const states = [
    resolveDeliveryState({}),
    resolveDeliveryState({ providerId: 'x' }),
    resolveDeliveryState({ providerId: 'x', deliveryStatus: 'delivered' }),
    resolveDeliveryState({ providerId: 'x', deliveryStatus: 'undelivered' }),
    resolveDeliveryState({ providerId: 'x', carrierError: 'landline' }),
    resolveDeliveryState({ providerId: 'x', carrierError: 'invalid number' }),
    resolveDeliveryState({ providerId: 'x', carrierError: 'carrier error' }),
  ];
  for (const s of states) {
    assert(!s.autoCall, `${s.state} must not trigger auto call`);
  }
});

test('12 DELIVERED is terminal', () => {
  const r = resolveDeliveryState({ providerId: 'x', deliveryStatus: 'delivered' });
  assertEq(r.terminal, true);
});

test('13 FAILED_LANDLINE is terminal', () => {
  const r = resolveDeliveryState({ providerId: 'x', carrierError: 'landline' });
  assertEq(r.terminal, true);
});

test('14 FAILED_INVALID_NUMBER is terminal', () => {
  const r = resolveDeliveryState({ providerId: 'x', carrierError: 'invalid number' });
  assertEq(r.terminal, true);
});

test('15 PROVIDER_ACCEPTED is not terminal', () => {
  const r = resolveDeliveryState({ providerId: 'x' });
  assertEq(r.terminal, false);
});

test('16 UNDELIVERED is not terminal', () => {
  const r = resolveDeliveryState({ providerId: 'x', deliveryStatus: 'undelivered' });
  assertEq(r.terminal, false);
});

test('17 DELIVERED sets waitingForReply', () => {
  const r = resolveDeliveryState({ providerId: 'x', deliveryStatus: 'delivered' });
  assertEq(r.waitingForReply, true);
});

test('18 PROVIDER_ACCEPTED does not set waitingForReply', () => {
  const r = resolveDeliveryState({ providerId: 'x' });
  assertEq(r.waitingForReply, false);
});

console.log('\n=== delivery state certification tests ===');
results.forEach(r => console.log(r));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
