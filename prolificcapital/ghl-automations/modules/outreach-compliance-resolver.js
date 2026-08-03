'use strict';

const { evaluateGhlComplianceLocks } = require('./atlas-ghl-telegram-live-guards');
const { normalizeOpportunity } = require('./telegram-outreach-dry-run');
const { classifyRole, roleCanReceiveProductionScript } = require('./kayla-role-classifier');
const { getProductionScript } = require('./kayla-course-evidence');
const { derivePropertyTimezone } = require('./property-timezone');
const { evaluateCanaryWindow } = require('./atlas-ghl-telegram-live-guards');

const GUARD_NAMES = Object.freeze([
  'DNC', 'STOP_OPT_OUT', 'WRONG_NUMBER', 'PENDING_REPLY',
  'ACTIVE_HUMAN_WORK', 'PRIOR_OUTREACH', 'DUPLICATE_HISTORY', 'PROVIDER_UNCERTAINTY',
]);

const PASSING_STATES = new Set(['CLEAR', 'NOT_APPLICABLE_NO_PRIOR_CONTACT', 'CLEAR_NO_PRIOR_OUTREACH']);
const BLOCKING_STATES = new Set(['BLOCKED', 'UNKNOWN', 'WAITING_FOR_REPLY']);

function resolveCompliance(record, context = {}) {
  const {
    justcallSuppression,
    justcallHistory,
    localRegistry,
    executionJournal,
    allRecords = [],
    now = new Date(),
    policyVersion = 'OP-2026-08-02-v1',
  } = context;

  const normalized = normalizeOpportunity(record);
  const ghlLocks = evaluateGhlComplianceLocks(record);
  const phone = normalized.phone || '';
  const roleEvidence = classifyRole(record);
  const script = getProductionScript('INT');
  const roleScript = roleCanReceiveProductionScript(roleEvidence, script);
  const timezone = derivePropertyTimezone(record, { now });
  const window = evaluateCanaryWindow({ now, timeZone: timezone.timeZone });

  const guards = {};

  guards.DNC = resolveGuard('DNC', [
    { source: 'GHL_TAGS', state: ghlLocks.checks.dnc === 'BLOCKED' ? 'BLOCKED' : ghlLocks.checks.dnc === 'CLEAR' ? 'CLEAR' : 'UNKNOWN' },
    justcallSuppression ? { source: 'JUSTCALL_BLACKLIST', state: justcallSuppression.dnc || 'UNKNOWN' } : null,
    justcallSuppression ? { source: 'JUSTCALL_CONTACT_STATUS', state: justcallSuppression.contactDnd || 'UNKNOWN' } : null,
    localRegistry ? { source: 'LOCAL_REGISTRY', state: localRegistry.dnc || 'UNKNOWN' } : null,
  ]);

  guards.STOP_OPT_OUT = resolveGuard('STOP_OPT_OUT', [
    { source: 'GHL_TAGS', state: ghlLocks.checks.optOut === 'BLOCKED' ? 'BLOCKED' : ghlLocks.checks.optOut === 'CLEAR' ? 'CLEAR' : 'UNKNOWN' },
    justcallSuppression ? { source: 'JUSTCALL_BLACKLIST', state: justcallSuppression.optOut || 'UNKNOWN' } : null,
    localRegistry ? { source: 'LOCAL_REGISTRY', state: localRegistry.optOut || 'UNKNOWN' } : null,
  ]);

  guards.WRONG_NUMBER = resolveGuard('WRONG_NUMBER', [
    { source: 'GHL_TAGS', state: ghlLocks.checks.wrongNumber === 'BLOCKED' ? 'BLOCKED' : ghlLocks.checks.wrongNumber === 'CLEAR' ? 'CLEAR' : 'UNKNOWN' },
    localRegistry ? { source: 'LOCAL_REGISTRY', state: localRegistry.wrongNumber || 'UNKNOWN' } : null,
  ]);

  guards.PENDING_REPLY = resolveGuard('PENDING_REPLY', [
    { source: 'GHL_TAGS', state: ghlLocks.checks.pendingReply === 'BLOCKED' ? 'BLOCKED' : ghlLocks.checks.pendingReply === 'CLEAR' ? 'CLEAR' : 'UNKNOWN' },
    justcallHistory ? { source: 'JUSTCALL_HISTORY', state: justcallHistory.pendingReply || 'UNKNOWN' } : null,
    localRegistry ? { source: 'LOCAL_REGISTRY', state: localRegistry.pendingReply || 'UNKNOWN' } : null,
  ]);

  guards.ACTIVE_HUMAN_WORK = resolveGuard('ACTIVE_HUMAN_WORK', [
    { source: 'GHL_TAGS', state: ghlLocks.checks.activeHumanWork === 'BLOCKED' ? 'BLOCKED' : ghlLocks.checks.activeHumanWork === 'CLEAR' ? 'CLEAR' : 'UNKNOWN' },
    localRegistry ? { source: 'LOCAL_REGISTRY', state: localRegistry.activeHumanWork || 'UNKNOWN' } : null,
  ]);

  guards.PRIOR_OUTREACH = resolveGuard('PRIOR_OUTREACH', [
    justcallHistory ? { source: 'JUSTCALL_HISTORY', state: justcallHistory.outboundHistory === 'PRIOR_SEND_FOUND' ? 'BLOCKED' : justcallHistory.outboundHistory === 'CLEAR_NO_PRIOR_SEND' ? 'CLEAR' : 'UNKNOWN' } : null,
    executionJournal ? { source: 'EXECUTION_JOURNAL', state: executionJournal.priorOutreach || 'UNKNOWN' } : null,
    localRegistry ? { source: 'LOCAL_REGISTRY', state: localRegistry.priorOutreach || 'UNKNOWN' } : null,
  ]);

  guards.DUPLICATE_HISTORY = resolveGuard('DUPLICATE_HISTORY', [
    executionJournal ? { source: 'EXECUTION_JOURNAL', state: executionJournal.duplicate || 'UNKNOWN' } : null,
    localRegistry ? { source: 'LOCAL_REGISTRY', state: localRegistry.duplicate || 'UNKNOWN' } : null,
  ]);

  guards.PROVIDER_UNCERTAINTY = resolveGuard('PROVIDER_UNCERTAINTY', [
    justcallHistory ? { source: 'JUSTCALL_HISTORY', state: justcallHistory.deliveryState === 'FAILED' ? 'BLOCKED' : justcallHistory.deliveryState === 'UNKNOWN' ? 'UNKNOWN' : 'CLEAR' } : null,
    localRegistry ? { source: 'LOCAL_REGISTRY', state: localRegistry.providerUncertain || 'UNKNOWN' } : null,
  ]);

  const allPassed = GUARD_NAMES.every(name => PASSING_STATES.has(guards[name].state));
  const anyBlocked = GUARD_NAMES.some(name => BLOCKING_STATES.has(guards[name].state));
  const anyUnknown = GUARD_NAMES.some(name => guards[name].state === 'UNKNOWN');

  return {
    schema: 'outreach-compliance-resolver-v1',
    passed: allPassed,
    blocked: anyBlocked,
    unknown: anyUnknown,
    guards,
    timezone: { timeZone: timezone.timeZone, ok: timezone.ok, windowOk: window.ok, windowReason: window.reason },
    role: { role: roleEvidence.role, level: roleEvidence.level, scriptOk: roleScript.ok },
    policyVersion,
    checkedAt: now.toISOString(),
    phone: phone ? `${phone.slice(0, 4)}***${phone.slice(-4)}` : null,
  };
}

function resolveGuard(name, sources) {
  const validSources = sources.filter(Boolean);
  const states = validSources.map(s => s.state);
  const uniqueStates = [...new Set(states)];

  if (uniqueStates.includes('BLOCKED') || uniqueStates.includes('WAITING_FOR_REPLY')) {
    const blockedSources = validSources.filter(s => s.state === 'BLOCKED' || s.state === 'WAITING_FOR_REPLY');
    return { state: 'BLOCKED', sources: validSources, evidence: blockedSources, blockerCode: `${name}_BLOCKED` };
  }

  if (uniqueStates.length > 1) {
    return { state: 'UNKNOWN', sources: validSources, evidence: validSources, blockerCode: `${name}_CONFLICTING_SOURCES` };
  }

  if (PASSING_STATES.has(uniqueStates[0])) {
    return { state: uniqueStates[0], sources: validSources, evidence: validSources, blockerCode: null };
  }

  return { state: 'UNKNOWN', sources: validSources, evidence: [], blockerCode: `${name}_UNKNOWN` };
}

module.exports = { GUARD_NAMES, resolveCompliance, resolveGuard };
