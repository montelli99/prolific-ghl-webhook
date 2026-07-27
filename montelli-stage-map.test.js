const assert = require('node:assert/strict');
const test = require('node:test');
const { MONTELLI_STAGE_MAP, normalizeMontelliStageValue } = require('./montelli-stage-map');

test('keeps valid UUID values unchanged', () => {
  const id = '934c4c52-4b22-457a-8d10-55ab6600fdee';
  assert.deepEqual(normalizeMontelliStageValue(id), { stageId: id, normalized: false, reason: 'uuid' });
  assert.equal(MONTELLI_STAGE_MAP[id], 'CONTACT_MADE');
});

test('normalizes exact stage names to UUID values', () => {
  assert.deepEqual(normalizeMontelliStageValue('Lead Entered'), {
    stageId: '7067148a-2ee8-4e5b-93c8-31e0253fea68',
    normalized: true,
    reason: 'stage_name',
  });
});

test('normalizes exact Offer Ready stage name to UUID values', () => {
  assert.deepEqual(normalizeMontelliStageValue('Offer Ready'), {
    stageId: '3da698e7-aba8-4d4a-b14b-7742f7b44ac7',
    normalized: true,
    reason: 'stage_name',
  });
});

test('does not silently map unknown stage names', () => {
  assert.deepEqual(normalizeMontelliStageValue('Some Unknown Stage'), {
    stageId: 'Some Unknown Stage',
    normalized: false,
    reason: 'unknown',
  });
});

test('does not silently map empty values', () => {
  assert.deepEqual(normalizeMontelliStageValue(''), { stageId: '', normalized: false, reason: 'empty' });
});

test('does not map non-Montelli legacy stage names', () => {
  assert.deepEqual(normalizeMontelliStageValue('Offer Ready to be Sent to Seller'), {
    stageId: 'Offer Ready to be Sent to Seller',
    normalized: false,
    reason: 'unknown',
  });
});
