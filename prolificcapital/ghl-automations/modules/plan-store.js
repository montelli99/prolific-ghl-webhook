'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PLAN_STORE_DIR = path.resolve(__dirname, '..', 'data', 'production-plans');
const PLAN_STATUSES = Object.freeze([
  'PREVIEW_PENDING_APPROVAL',
  'APPROVED_PENDING_EXECUTION',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'SUPERSEDED',
]);

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

class PlanStore {
  constructor(config = {}) {
    this.storeDir = config.storeDir || PLAN_STORE_DIR;
    ensureDir(this.storeDir);
  }

  planPath(planId) {
    return path.join(this.storeDir, `${planId}.json`);
  }

  savePlan(plan) {
    if (!plan.planId || !plan.planHash) throw new Error('PLAN_REQUIRES_ID_AND_HASH');
    const filePath = this.planPath(plan.planId);
    if (fs.existsSync(filePath)) throw new Error(`PLAN_ALREADY_EXISTS: ${plan.planId}`);
    const computedHash = stableHash({
      planId: plan.planId,
      items: (plan.items || []).map(i => ({
        number: i.number,
        opportunityId: i.opportunityId,
        contactId: i.contactId,
        renderedMessage: i.renderedMessage,
      })),
      policyVersion: plan.policyVersion,
      templateId: plan.templateId,
      templateVersion: plan.templateVersion,
      createdAt: plan.createdAt,
    });
    if (computedHash !== plan.planHash) throw new Error(`PLAN_HASH_MISMATCH: expected ${computedHash}, got ${plan.planHash}`);
    atomicWrite(filePath, plan);
    const readback = readJson(filePath);
    if (!readback || readback.planHash !== plan.planHash) throw new Error('PLAN_READBACK_VERIFICATION_FAILED');
    return plan;
  }

  loadPlan(planId) {
    return readJson(this.planPath(planId));
  }

  updateStatus(planId, status, extra = {}) {
    if (!PLAN_STATUSES.includes(status)) throw new Error(`INVALID_PLAN_STATUS: ${status}`);
    const plan = this.loadPlan(planId);
    if (!plan) throw new Error(`PLAN_NOT_FOUND: ${planId}`);
    plan.status = status;
    plan.updatedAt = new Date().toISOString();
    Object.assign(plan, extra);
    atomicWrite(this.planPath(planId), plan);
    return plan;
  }

  supersedePlan(planId, reason) {
    const plan = this.loadPlan(planId);
    if (!plan) throw new Error(`PLAN_NOT_FOUND: ${planId}`);
    plan.status = 'SUPERSEDED';
    plan.supersededAt = new Date().toISOString();
    plan.supersededReason = reason;
    atomicWrite(this.planPath(planId), plan);
    return plan;
  }

  listPlans(filter = {}) {
    ensureDir(this.storeDir);
    const files = fs.readdirSync(this.storeDir).filter(f => f.endsWith('.json'));
    const plans = files.map(f => readJson(path.join(this.storeDir, f))).filter(Boolean);
    if (filter.status) return plans.filter(p => p.status === filter.status);
    if (filter.chatId) return plans.filter(p => String(p.chatId) === String(filter.chatId));
    return plans;
  }
}

module.exports = { PlanStore, PLAN_STORE_DIR, PLAN_STATUSES, stableHash };
