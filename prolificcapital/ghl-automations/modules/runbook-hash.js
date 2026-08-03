'use strict';

const crypto = require('crypto');

const INTEGRITY_FIELDS = Object.freeze([
  'instructionId',
  'version',
  'supersedes',
  'ownerUserId',
  'groupId',
  'topicId',
  'retrievalPhrase',
  'status',
  'policyVersion',
  'naturalTriggers',
  'automaticPreparationFlow',
  'providerReadinessConfirmation',
  'reviewFlow',
  'approvalFlow',
  'executionFlow',
  'prohibitions',
  'cancellationBehavior',
  'recoveryBehavior',
  'warnings',
]);

function sortKeysDeep(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted;
}

function canonicalizeRunbook(runbook) {
  if (!runbook || typeof runbook !== 'object') {
    throw new Error('RUNBOOK_MUST_BE_OBJECT');
  }
  const projection = {};
  for (const field of INTEGRITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(runbook, field)) {
      projection[field] = runbook[field];
    }
  }
  return sortKeysDeep(projection);
}

function serializeCanonical(runbook) {
  return JSON.stringify(canonicalizeRunbook(runbook));
}

function computeRunbookHash(runbook) {
  return crypto.createHash('sha256').update(serializeCanonical(runbook)).digest('hex');
}

function verifyRunbookHash(runbook) {
  if (!runbook || typeof runbook !== 'object') return { ok: false, reason: 'RUNBOOK_MISSING' };
  if (!runbook.canonicalHash || typeof runbook.canonicalHash !== 'string') {
    return { ok: false, reason: 'MISSING_CANONICAL_HASH' };
  }
  const computed = computeRunbookHash(runbook);
  return {
    ok: computed === runbook.canonicalHash,
    computed,
    declared: runbook.canonicalHash,
  };
}

module.exports = {
  INTEGRITY_FIELDS,
  canonicalizeRunbook,
  serializeCanonical,
  computeRunbookHash,
  verifyRunbookHash,
};
