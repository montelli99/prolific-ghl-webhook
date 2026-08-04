'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.resolve(__dirname, '..', 'data', 'call-note-approvals');

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
}

class CallNoteApprovalStore {
  constructor(options = {}) {
    this.dir = options.dir || DEFAULT_DIR;
    this.ownerUserId = String(options.ownerUserId || '718718959');
    this.chatId = String(options.chatId || '-1003975794600');
    this.topicId = String(options.topicId || '389');
    this.signingSecret = options.signingSecret || '';
    this.ttlMs = options.ttlMs || 15 * 60 * 1000;
  }

  createApproval(prepared, context = {}) {
    if (!this.signingSecret) throw new Error('CALL_NOTE_APPROVAL_SIGNING_SECRET_REQUIRED');
    if (context.authenticatedOwner !== true || String(context.ownerUserId) !== this.ownerUserId || String(context.chatId) !== this.chatId || String(context.topicId) !== this.topicId) throw new Error('CALL_NOTE_APPROVAL_CONTEXT_DENIED');
    if (!prepared?.approvalScope?.scopeHash || !prepared?.note?.bodyHash) throw new Error('CALL_NOTE_PREPARED_SCOPE_REQUIRED');
    const approvalId = `call_note_approval_${hash({ scopeHash: prepared.approvalScope.scopeHash, messageId: context.messageId, at: new Date().toISOString() }).slice(0, 20)}`;
    const payload = {
      approvalId,
      actionType: 'WRITE_GHL_CALL_NOTE',
      scopeHash: prepared.approvalScope.scopeHash,
      noteHash: prepared.note.bodyHash,
      callId: prepared.call.callId,
      contactId: prepared.match.contactId,
      opportunityId: prepared.match.opportunityId,
      ownerUserId: this.ownerUserId,
      chatId: this.chatId,
      topicId: this.topicId,
      originatingMessageId: context.messageId || null,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    };
    const approval = { ...payload, integrityHash: sign(payload, this.signingSecret) };
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.path(approvalId);
    fs.writeFileSync(file, JSON.stringify(approval, null, 2) + '\n', { flag: 'wx' });
    return approval;
  }

  verify(approvalId, prepared) {
    const approval = this.load(approvalId);
    if (!approval || approval.status !== 'ACTIVE' || new Date(approval.expiresAt) <= new Date()) return null;
    if (approval.actionType !== 'WRITE_GHL_CALL_NOTE' || approval.scopeHash !== prepared.approvalScope?.scopeHash || approval.noteHash !== prepared.note?.bodyHash) return null;
    if (String(approval.callId) !== String(prepared.call?.callId) || approval.contactId !== prepared.match?.contactId || approval.opportunityId !== prepared.match?.opportunityId) return null;
    return approval;
  }

  consume(approvalId, noteId) {
    const approval = this.load(approvalId);
    if (!approval || approval.status !== 'ACTIVE') throw new Error('CALL_NOTE_APPROVAL_NOT_ACTIVE');
    const payload = { ...approval, status: 'CONSUMED', consumedAt: new Date().toISOString(), noteId: noteId || null };
    delete payload.integrityHash;
    const consumed = { ...payload, integrityHash: sign(payload, this.signingSecret) };
    this._atomicWrite(this.path(approvalId), consumed);
    return consumed;
  }

  load(approvalId) {
    const file = this.path(approvalId);
    if (!fs.existsSync(file)) return null;
    const approval = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { integrityHash, ...payload } = approval;
    if (!this.signingSecret || !integrityHash) return null;
    const expected = sign(payload, this.signingSecret);
    const actualBuffer = Buffer.from(integrityHash, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer) ? approval : null;
  }

  path(approvalId) {
    return path.join(this.dir, `${approvalId}.json`);
  }

  _atomicWrite(file, value) {
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, file);
  }
}

module.exports = { CallNoteApprovalStore, DEFAULT_DIR };
