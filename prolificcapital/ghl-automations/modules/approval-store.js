'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APPROVAL_STORE_DIR = path.resolve(__dirname, '..', 'data', 'production-approvals');

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

class ApprovalStore {
  constructor(config = {}) {
    this.storeDir = config.storeDir || APPROVAL_STORE_DIR;
    ensureDir(this.storeDir);
  }

  approvalPath(approvalId) {
    return path.join(this.storeDir, `${approvalId}.json`);
  }

  createApproval({ planId, planHash, selectedItems, ownerUserId, chatId, topicId, originatingMessageId, approvalText, policyVersion }) {
    if (!planId || !planHash) throw new Error('APPROVAL_REQUIRES_PLAN_ID_AND_HASH');
    if (!ownerUserId) throw new Error('APPROVAL_REQUIRES_OWNER_ID');
    if (!selectedItems || selectedItems.length === 0) throw new Error('APPROVAL_REQUIRES_SELECTED_ITEMS');

    const approvalId = `approval_${stableHash({ planId, planHash, ownerUserId, at: new Date().toISOString() }).slice(0, 16)}`;
    const filePath = this.approvalPath(approvalId);
    if (fs.existsSync(filePath)) throw new Error(`APPROVAL_ALREADY_EXISTS: ${approvalId}`);

    const approval = {
      approvalId,
      planId,
      planHash,
      selectedItems: selectedItems.sort((a, b) => a - b),
      ownerUserId: String(ownerUserId),
      chatId: String(chatId || ''),
      topicId: topicId || null,
      originatingMessageId: originatingMessageId || null,
      approvalTextHash: stableHash(approvalText || ''),
      policyVersion: policyVersion || 'OP-2026-08-02-v1',
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    };

    approval.approvalHash = stableHash(approval);
    atomicWrite(filePath, approval);

    const readback = readJson(filePath);
    if (!readback || readback.approvalHash !== approval.approvalHash) throw new Error('APPROVAL_READBACK_VERIFICATION_FAILED');

    return approval;
  }

  loadApproval(approvalId) {
    return readJson(this.approvalPath(approvalId));
  }

  findApprovalForPlan(planId) {
    ensureDir(this.storeDir);
    const files = fs.readdirSync(this.storeDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const approval = readJson(path.join(this.storeDir, f));
      if (approval && approval.planId === planId && approval.status === 'ACTIVE') return approval;
    }
    return null;
  }

  revokeApproval(approvalId, reason) {
    const approval = this.loadApproval(approvalId);
    if (!approval) throw new Error(`APPROVAL_NOT_FOUND: ${approvalId}`);
    approval.status = 'REVOKED';
    approval.revokedAt = new Date().toISOString();
    approval.revokedReason = reason || null;
    atomicWrite(this.approvalPath(approvalId), approval);
    return approval;
  }
}

module.exports = { ApprovalStore, APPROVAL_STORE_DIR };
