'use strict';

const { sha256 } = require('./owner-controlled-transcript-note');

class OwnerControlledTranscriptNoteWriter {
  constructor(options = {}) {
    this.previewStore = options.previewStore;
    this.approvalStore = options.approvalStore;
    this.ghl = options.ghl;
    this.readTranscriptEvidence = options.readTranscriptEvidence;
    this.getSafetyState = options.getSafetyState || (() => 'PAUSED');
    this.allowTestNoteWrite = options.allowTestNoteWrite === true;
    this.testContactId = String(options.testContactId || '');
    this.verifyWriteIsolation = options.verifyWriteIsolation || (async () => ({ verified: false }));
    this.verifyExternalEffects = options.verifyExternalEffects || (async () => ({ verified: false }));
  }

  async write(previewId, approvalId) {
    try {
      return await this.previewStore.withLock(previewId, () => this._write(previewId, approvalId));
    } catch (error) {
      if (error.message === 'NOTE_PREVIEW_WRITE_LOCKED') return blocked(error.message);
      throw error;
    }
  }

  async _write(previewId, approvalId) {
    if (!this.allowTestNoteWrite) return blocked('TEST_NOTE_WRITES_DISABLED');
    if (this.getSafetyState() !== 'PAUSED') return blocked('TEST_NOTE_REQUIRES_PAUSED_STATE');
    const preview = this.previewStore?.load(previewId);
    if (!preview) return blocked('NOTE_PREVIEW_REQUIRED');
    if (preview.status === 'NOTE_WRITTEN') return { status: 'ALREADY_PROCESSED_NO_WRITE', noteId: preview.noteId || null, productionEffects: zeroEffects() };
    if (preview.status === 'WRITE_UNCERTAIN') return blocked('UNCERTAIN_WRITE_REQUIRES_MANUAL_RECONCILIATION');
    if (preview.status !== 'NOTE_PREVIEW_PENDING_APPROVAL') return blocked('NOTE_PREVIEW_NOT_ACTIVE');
    if (new Date(preview.expiresAt) <= new Date()) return blocked('NOTE_PREVIEW_EXPIRED');
    if (preview.testContactId !== this.testContactId) return blocked('EXACT_TEST_CONTACT_REQUIRED');
    const approval = this.approvalStore?.load(approvalId);
    if (!this.approvalStore?.verify(approval, preview)) return blocked('EXACT_TEST_NOTE_APPROVAL_REQUIRED');
    const currentTranscript = await this.readTranscriptEvidence(preview.callId);
    if (currentTranscript?.sourceType !== 'TRANSCRIPT_PROVIDER_API' || currentTranscript.callId !== preview.callId || currentTranscript.transcriptHash !== preview.transcriptHash) return blocked('TRANSCRIPT_HASH_CHANGED');

    const contactBefore = await this.ghl.getContact(this.testContactId);
    if (!isExactTestContact(contactBefore, this.testContactId)) return blocked('TEST_CONTACT_IDENTITY_CHANGED');
    const opportunitiesBefore = await this.ghl.findOpportunitiesForContact(this.testContactId);
    if (opportunitiesBefore.length !== 0) return blocked('UNEXPECTED_OPPORTUNITY_ATTACHED');
    const notesBefore = await this.ghl.listContactNotes(this.testContactId);
    const marker = `owner_controlled_transcript_note_key:${preview.idempotencyKey}`;
    const matchingBefore = notesBefore.filter(note => hasExactLine(note.body, marker));
    if (matchingBefore.length === 1 && sha256(String(matchingBefore[0].body || '')) === preview.noteBodyHash) {
      this.previewStore.update(previewId, { status: 'NOTE_WRITTEN', noteId: matchingBefore[0].id || null, reconciliation: 'EXISTING_EXACT_NOTE' });
      return { status: 'ALREADY_PROCESSED_NO_WRITE', noteId: matchingBefore[0].id || null, preNoteCount: notesBefore.length, postNoteCount: notesBefore.length, productionEffects: zeroEffects() };
    }
    if (matchingBefore.length !== 0) return blocked('DUPLICATE_NOTE_UNCERTAINTY');
    const isolation = await this.verifyWriteIsolation({ preview, contact: contactBefore, opportunities: opportunitiesBefore, notes: notesBefore });
    if (isolation?.verified !== true || isolation.providerSends !== 0 || isolation.calls !== 0 || isolation.sms !== 0 || isolation.tasks !== 0 || isolation.workflows !== 0 || isolation.stageMovements !== 0) return blocked('TEST_NOTE_AUTOMATION_ISOLATION_NOT_VERIFIED');
    if (new Date(preview.expiresAt) <= new Date() || new Date(approval.expiresAt) <= new Date()) return blocked('NOTE_PREVIEW_EXPIRED');
    if (this.getSafetyState() !== 'PAUSED') return blocked('TEST_NOTE_REQUIRES_PAUSED_STATE');

    const contactFingerprint = fingerprintContact(contactBefore);
    let created;
    try {
      created = await this.ghl.createOwnerControlledTestNote(this.testContactId, preview.exactNoteBody, {
        previewId: preview.previewId,
        previewHash: preview.previewHash,
        noteBodyHash: preview.noteBodyHash,
        callId: preview.callId,
        transcriptHash: preview.transcriptHash,
        approval,
      });
    } catch (error) {
      if (error.writeUncertain === true) this.previewStore.update(previewId, { status: 'WRITE_UNCERTAIN', reason: error.message });
      return blocked(error.writeUncertain === true ? 'GHL_WRITE_UNCERTAIN' : error.message);
    }

    let notesAfter;
    try {
      notesAfter = await this.ghl.listContactNotes(this.testContactId);
    } catch (error) {
      this.previewStore.update(previewId, { status: 'WRITE_UNCERTAIN', reason: `POSTWRITE_READBACK_FAILED:${error.message}` });
      return { status: 'GHL_WRITE_UNCERTAIN', preNoteCount: notesBefore.length, productionEffects: { ...zeroEffects(), ghlWrites: 1 } };
    }
    const matchingAfter = notesAfter.filter(note => hasExactLine(note.body, marker) && sha256(String(note.body || '')) === preview.noteBodyHash);
    let contactAfter;
    let opportunitiesAfter;
    try {
      [contactAfter, opportunitiesAfter] = await Promise.all([
        this.ghl.getContact(this.testContactId),
        this.ghl.findOpportunitiesForContact(this.testContactId),
      ]);
    } catch (error) {
      this.previewStore.update(previewId, { status: 'WRITE_UNCERTAIN', reason: `POSTWRITE_SCOPE_READBACK_FAILED:${error.message}` });
      return { status: 'GHL_WRITE_UNCERTAIN', preNoteCount: notesBefore.length, postNoteCount: notesAfter.length, productionEffects: { ...zeroEffects(), ghlWrites: 1 } };
    }
    const externalEffects = await this.verifyExternalEffects({ preview, contactBefore, contactAfter, notesBefore, notesAfter, opportunitiesAfter });
    if (matchingAfter.length !== 1 || notesAfter.length !== notesBefore.length + 1 || fingerprintContact(contactAfter) !== contactFingerprint || opportunitiesAfter.length !== 0 || externalEffects?.verified !== true || externalEffects.providerSends !== 0 || externalEffects.calls !== 0 || externalEffects.sms !== 0 || externalEffects.tasks !== 0 || externalEffects.workflows !== 0 || externalEffects.stageMovements !== 0) {
      this.previewStore.update(previewId, { status: 'WRITE_UNCERTAIN', reason: 'POSTWRITE_VERIFICATION_FAILED' });
      return { status: 'GHL_WRITE_UNCERTAIN', preNoteCount: notesBefore.length, postNoteCount: notesAfter.length, productionEffects: { ...zeroEffects(), ghlWrites: 1 } };
    }
    const noteId = matchingAfter[0].id || created?.id || null;
    this.previewStore.update(previewId, { status: 'NOTE_WRITTEN', noteId, preNoteCount: notesBefore.length, postNoteCount: notesAfter.length, reconciledAt: new Date().toISOString() });
    this.approvalStore.consume(approvalId, noteId);
    return { status: 'NOTE_WRITTEN', noteId, preNoteCount: notesBefore.length, postNoteCount: notesAfter.length, productionEffects: { ...zeroEffects(), ghlWrites: 1 } };
  }
}

function isExactTestContact(contact, contactId) {
  const tags = contact?.tags || [];
  return String(contact?.id) === String(contactId) && ['owner_controlled_test', 'call_note_certification', 'do_not_contact_prospect'].every(tag => tags.includes(tag));
}

function fingerprintContact(contact) {
  return sha256(contact);
}

function hasExactLine(body, marker) {
  return String(body || '').split(/\r?\n/).some(line => line.trim() === marker);
}

function zeroEffects() {
  return { providerSends: 0, callsAutomaticallyPlaced: 0, smsSent: 0, ghlWrites: 0, productionGhlWrites: 0, stageMovements: 0 };
}

function blocked(reason) {
  return { status: 'JUSTCALL_TRANSCRIPT_NOTE_WRITE_BLOCKED', reason, productionEffects: zeroEffects() };
}

module.exports = { OwnerControlledTranscriptNoteWriter, fingerprintContact, hasExactLine, isExactTestContact, zeroEffects };
