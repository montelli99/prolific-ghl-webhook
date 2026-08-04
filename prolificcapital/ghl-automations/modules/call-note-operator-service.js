'use strict';

const { CallNoteJournal } = require('./call-note-journal');

const COMMANDS = Object.freeze([
  ['SHOW_LAST_NOTES', /show me the notes from my last call/i],
  ['CHECK_LAST_SYNC', /did my last justcall call sync to ghl/i],
  ['TRANSCRIPTS_PENDING', /which calls are waiting for transcripts/i],
  ['REVIEW_REQUIRED', /which completed calls need note review/i],
  ['PREPARE_NOTES', /prepare the ghl notes from this call/i],
  ['WRITE_APPROVED', /write these approved notes to ghl/i],
  ['MISSING_INFORMATION', /what information did i miss/i],
  ['NEXT_ACTION', /what does kayla say i should do next/i],
  ['CONTACT_MADE_ELIGIBILITY', /did this call qualify for contact made/i],
  ['PROPOSED_STAGE_MOVE', /show the proposed stage move/i],
  ['RECONCILE_TODAY', /reconcile today'?s justcall calls with ghl/i],
  ['FAILED_TO_LOG', /which calls failed to log/i],
  ['DUPLICATE_OR_UNCERTAIN', /show duplicate or uncertain call records/i],
]);

function parseCallNoteCommand(text) {
  const match = COMMANDS.find(([, pattern]) => pattern.test(String(text || '').trim()));
  return match ? { type: match[0], text: String(text).trim() } : null;
}

class CallNoteOperatorService {
  constructor(options = {}) {
    this.journal = options.journal || new CallNoteJournal(options.journalOptions);
    this.processor = options.processor || null;
    this.approvalStore = options.approvalStore || this.processor?.approvalStore || null;
  }

  isCommand(text) {
    return Boolean(parseCallNoteCommand(text));
  }

  async handle(text, context = {}) {
    const command = parseCallNoteCommand(text);
    if (!command) return { reply: 'I did not recognize that call-note request.' };
    const records = this.journal.list().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const selected = context.callId ? records.find(record => String(record.callId) === String(context.callId)) : records[0];

    if (command.type === 'RECONCILE_TODAY') {
      if (!this.processor) return { reply: 'Read-only JustCall reconciliation is not configured in this runtime. No calls, messages, notes, or stages were changed.' };
      const result = await this.processor.reconcileRecentCalls(context);
      return { reply: `Read-only reconciliation inspected ${result.callsInspected} call(s). No GHL write or stage movement occurred.`, result };
    }
    if (command.type === 'WRITE_APPROVED') {
      if (!selected?.preparedWrite || !this.processor || !this.approvalStore) return { reply: 'No exact prepared call-note artifact is available for approval. No write occurred; remaining PAUSED.' };
      if (context.ownerContextVerified !== true) return { reply: 'Call-note approval denied because authenticated owner context is missing. No write occurred.' };
      const approval = this.approvalStore.createApproval(selected.preparedWrite, {
        authenticatedOwner: true,
        ownerUserId: context.telegramUserId,
        chatId: context.chatId,
        topicId: context.sourceTopicId,
        messageId: context.messageId,
      });
      const result = await this.processor.writeApprovedNote(selected.preparedWrite, { approvalId: approval.approvalId });
      return { reply: result.status === 'NOTE_WRITTEN' ? `Verified structured call note written once. Note ID: ${result.noteId || 'confirmed by marker readback'}. No stage movement occurred.` : `Call-note write did not complete: ${result.reason || result.status}. No stage movement occurred.`, result };
    }
    if (command.type === 'TRANSCRIPTS_PENDING') return listReply('Calls waiting for transcripts', records.filter(record => record.transcriptStatus === 'TRANSCRIPT_PENDING'));
    if (command.type === 'REVIEW_REQUIRED') return listReply('Completed calls requiring note review', records.filter(record => record.state === 'FAILED_MANUAL_REVIEW' || record.reviewQueue === 'CALL_NOTE_REVIEW_REQUIRED'));
    if (command.type === 'FAILED_TO_LOG') return listReply('Calls that failed to log', records.filter(record => ['FAILED_RETRYABLE', 'FAILED_MANUAL_REVIEW'].includes(record.state)));
    if (command.type === 'DUPLICATE_OR_UNCERTAIN') return listReply('Duplicate or uncertain call records', records.filter(record => ['DUPLICATE_ALREADY_PROCESSED', 'PARTIAL_WRITE_UNCERTAIN'].includes(record.state)));
    if (!selected) return { reply: 'No locally journaled JustCall call record matches this request. Run read-only reconciliation first.' };
    if (command.type === 'CHECK_LAST_SYNC') return { reply: `Call ${selected.callId}: ${selected.state}. GHL note ID: ${selected.noteId || 'not confirmed'}.` };
    if (command.type === 'SHOW_LAST_NOTES' || command.type === 'PREPARE_NOTES') return { reply: selected.notePreview || 'No structured note preview is stored for the selected call.' };
    if (command.type === 'MISSING_INFORMATION') return { reply: `Missing information: ${(selected.missingFacts || []).join(', ') || 'none recorded'}.` };
    if (command.type === 'NEXT_ACTION') return { reply: selected.nextAction || 'No deterministic next action is stored for the selected call.' };
    if (command.type === 'CONTACT_MADE_ELIGIBILITY' || command.type === 'PROPOSED_STAGE_MOVE') {
      return { reply: `Contact Made eligibility: ${selected.contactMadeEligible === true ? 'eligible for owner review' : 'not established'}. No stage movement occurred.` };
    }
    return { reply: 'The exact call is resolved, but note preparation requires configured read-only JustCall and GHL clients. No write occurred.' };
  }
}

function listReply(title, records) {
  if (!records.length) return { reply: `${title}: none.` };
  return { reply: `${title}:\n${records.map(record => `- ${record.callId}: ${record.state}`).join('\n')}` };
}

module.exports = { CallNoteOperatorService, parseCallNoteCommand, COMMANDS };
