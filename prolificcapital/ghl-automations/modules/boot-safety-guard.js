'use strict';

const fs = require('fs');
const path = require('path');

const KILL_SWITCH_PATH = path.resolve(__dirname, '..', 'data', 'telegram-outreach-dry-run', 'kill-switch.json');
const BOOT_LOG_DIR = path.resolve(__dirname, '..', '..', 'logs', 'boot');
const LOCK_FILE = path.resolve(__dirname, '..', 'data', 'runtime', 'gateway.lock');
const RECOVERY_QUEUE_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'recovery-queue.json');

const STATES = {
  READY_PAUSED: 'READY_PAUSED',
  READY_DEGRADED_PAUSED: 'READY_DEGRADED_PAUSED',
  RECOVERY_REQUIRED_PAUSED: 'RECOVERY_REQUIRED_PAUSED',
  GATEWAY_DOWN: 'GATEWAY_DOWN',
  DUPLICATE_PROCESS_BLOCKED: 'DUPLICATE_PROCESS_BLOCKED',
};

function nowIso() { return new Date().toISOString(); }

function readKillSwitch() {
  try {
    return JSON.parse(fs.readFileSync(KILL_SWITCH_PATH, 'utf8'));
  } catch (_) {
    return { state: 'PAUSED', liveSends: 0, productionWrites: 0, stageMovements: 0 };
  }
}

function writeKillSwitch(state, extra = {}) {
  const current = readKillSwitch();
  const updated = {
    state,
    updatedAt: nowIso(),
    liveSends: (current.liveSends || 0) + (extra.liveSends || 0),
    productionWrites: (current.productionWrites || 0) + (extra.productionWrites || 0),
    stageMovements: (current.stageMovements || 0) + (extra.stageMovements || 0),
    workflowModifications: (current.workflowModifications || 0) + (extra.workflowModifications || 0),
    ...extra,
  };
  fs.mkdirSync(path.dirname(KILL_SWITCH_PATH), { recursive: true });
  const tmp = KILL_SWITCH_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n');
  fs.renameSync(tmp, KILL_SWITCH_PATH);
  return updated;
}

function forcePause() {
  const current = readKillSwitch();
  if (current.state === 'PAUSED') {
    return { forced: false, previousState: 'PAUSED', currentState: 'PAUSED' };
  }
  const previousState = current.state;
  writeKillSwitch('PAUSED', { reason: 'STARTUP_FORCED_PAUSE', previousState });
  return { forced: true, previousState, currentState: 'PAUSED' };
}

function inspectRecoveryQueue() {
  const items = [];
  const previewPath = path.resolve(__dirname, '..', 'data', 'runtime', 'contact-card-self-test-preview.json');
  const approvalPath = path.resolve(__dirname, '..', 'data', 'runtime', 'contact-card-self-test-approval.json');
  const resultPath = path.resolve(__dirname, '..', 'data', 'runtime', 'contact-card-self-test-result.json');
  const planDir = path.resolve(__dirname, '..', 'data', 'production-plans');
  const approvalDir = path.resolve(__dirname, '..', 'data', 'production-approvals');

  if (fs.existsSync(previewPath)) {
    try {
      const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
      items.push({ type: 'CONTACT_CARD_PREVIEW', status: 'REQUIRES_FRESHNESS_REVALIDATION', previewId: preview.previewId, createdAt: preview.createdAt });
    } catch (_) {}
  }

  if (fs.existsSync(approvalPath)) {
    try {
      const approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8'));
      items.push({ type: 'CONTACT_CARD_APPROVAL', status: 'OWNER_REVIEW_REQUIRED_AFTER_RESTART', approvalId: approval.approvalId, approvedAt: approval.approvedAt });
    } catch (_) {}
  }

  if (fs.existsSync(resultPath)) {
    try {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      if (result.state === 'CONTACT_CARD_PROVIDER_DELIVERED_AWAITING_DEVICE_CONFIRMATION') {
        items.push({ type: 'CONTACT_CARD_RESULT', status: 'AWAITING_DEVICE_CONFIRMATION', providerMessageId: result.providerMessageId, sentAt: result.sentAt });
      }
    } catch (_) {}
  }

  if (fs.existsSync(planDir)) {
    const plans = fs.readdirSync(planDir).filter(f => f.endsWith('.json'));
    for (const planFile of plans) {
      try {
        const plan = JSON.parse(fs.readFileSync(path.join(planDir, planFile), 'utf8'));
        if (plan.status === 'APPROVED_PENDING_EXECUTION' || plan.status === 'EXECUTING') {
          items.push({ type: 'CANARY_PLAN', status: plan.status === 'EXECUTING' ? 'INTERRUPTED_EXECUTION' : 'OWNER_REVIEW_REQUIRED_AFTER_RESTART', planId: plan.planId, planFile });
        }
      } catch (_) {}
    }
  }

  if (fs.existsSync(approvalDir)) {
    const approvals = fs.readdirSync(approvalDir).filter(f => f.endsWith('.json'));
    for (const approvalFile of approvals) {
      try {
        const approval = JSON.parse(fs.readFileSync(path.join(approvalDir, approvalFile), 'utf8'));
        if (approval.status === 'APPROVED' && !approval.executed) {
          items.push({ type: 'CANARY_APPROVAL', status: 'OWNER_REVIEW_REQUIRED_AFTER_RESTART', approvalId: approval.approvalId, approvalFile });
        }
      } catch (_) {}
    }
  }

  return items;
}

function writeRecoveryQueue(items) {
  fs.mkdirSync(path.dirname(RECOVERY_QUEUE_PATH), { recursive: true });
  const queue = {
    createdAt: nowIso(),
    items,
    count: items.length,
    instructions: 'All items require owner review. No automatic execution or retry.',
  };
  const tmp = RECOVERY_QUEUE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2) + '\n');
  fs.renameSync(tmp, RECOVERY_QUEUE_PATH);
  return queue;
}

function acquireLock(pid, port) {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (existing.pid && existing.pid !== pid) {
        try { process.kill(existing.pid, 0); return { ok: false, reason: 'LOCK_HELD_BY_LIVE_PROCESS', existingPid: existing.pid }; }
        catch (_) { /* stale lock */ }
      }
    } catch (_) { /* corrupt lock */ }
  }
  const lock = { pid, port, acquiredAt: nowIso(), hostname: require('os').hostname() };
  const tmp = LOCK_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lock, null, 2) + '\n');
  fs.renameSync(tmp, LOCK_FILE);
  return { ok: true, lock };
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
}

function bootLog(entry) {
  fs.mkdirSync(BOOT_LOG_DIR, { recursive: true });
  const logFile = path.join(BOOT_LOG_DIR, `boot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(logFile, JSON.stringify(entry, null, 2) + '\n');
}

function runBootSequence(pid, port) {
  const lock = acquireLock(pid, port);
  if (!lock.ok) return { status: STATES.DUPLICATE_PROCESS_BLOCKED, lock };

  const pauseResult = forcePause();
  const recoveryItems = inspectRecoveryQueue();
  const recoveryQueue = writeRecoveryQueue(recoveryItems);

  const entry = {
    bootId: `${Date.now()}-${pid}`,
    timestamp: nowIso(),
    hostname: require('os').hostname(),
    pid,
    port,
    nodeVersion: process.version,
    pauseResult,
    recoveryQueue,
    status: recoveryItems.length > 0 ? STATES.RECOVERY_REQUIRED_PAUSED : STATES.READY_PAUSED,
  };

  bootLog(entry);
  return { ...entry, lock };
}

module.exports = {
  STATES,
  KILL_SWITCH_PATH,
  LOCK_FILE,
  RECOVERY_QUEUE_PATH,
  readKillSwitch,
  writeKillSwitch,
  forcePause,
  inspectRecoveryQueue,
  writeRecoveryQueue,
  acquireLock,
  releaseLock,
  bootLog,
  runBootSequence,
};
