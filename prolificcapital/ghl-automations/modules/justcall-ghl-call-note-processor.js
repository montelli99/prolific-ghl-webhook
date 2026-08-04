'use strict';

const {
  normalizeCallRecord,
  normalizeTranscript,
  classifyConversation,
  validateExtractedFacts,
  validateCommitments,
  buildCallNote,
  stableHash,
} = require('./call-note-schema');
const { MATCHED, matchCallToGhl } = require('./call-contact-opportunity-matcher');
const { CallNoteJournal, idempotencyKey } = require('./call-note-journal');
const { evaluateOpportunity } = require('./course-guided-action-engine');

const REQUIRED_AGENT_FACTS = Object.freeze(['roofAge', 'hvacAge', 'occupancy', 'utilities', 'listingFeedback']);
const REQUIRED_SELLER_FACTS = Object.freeze(['roofAge', 'hvacAge', 'occupancy', 'utilities']);

class JustCallGhlCallNoteProcessor {
  constructor(options = {}) {
    this.justcall = options.justcall;
    this.ghl = options.ghl;
    this.journal = options.journal || new CallNoteJournal(options.journalOptions);
    this.locationId = options.locationId;
    this.pipelineId = options.pipelineId;
    this.allowNoteWrites = options.allowNoteWrites === true;
    this.autoLogStructuredNotes = options.autoLogStructuredNotes === true;
    this.rawTranscriptPolicy = options.rawTranscriptPolicy || 'OMIT_FROM_GHL_NOTE';
    this.getSafetyState = options.getSafetyState || (() => require('../bot/kill-switch').readKillSwitch().state);
    this.approvalStore = options.approvalStore || null;
  }

  async inspectCall(callId, options = {}) {
    const rawCall = options.callRecord || await this.justcall.fetchCallDetails(callId);
    const call = normalizeCallRecord(rawCall);
    if (!call.callId) return blocked('CALL_NOTE_REVIEW_REQUIRED', 'JUSTCALL_CALL_ID_MISSING', { call });
    if (String(call.callId) !== String(callId)) return blocked('CALL_NOTE_REVIEW_REQUIRED', 'CALL_RECORD_ID_MISMATCH', { call });
    if (call.locationId && call.locationId !== this.locationId) return blocked('CALL_NOTE_REVIEW_REQUIRED', 'CALL_LOCATION_MISMATCH', { call });
    if (!isCompleted(call)) return blocked('CALL_NOTE_REVIEW_REQUIRED', 'CALL_NOT_COMPLETED', { call, transcriptStatus: 'CALL_COMPLETED' });

    const aiResult = await this._loadAiData(call, options);
    const transcript = normalizeTranscript(call.callId, aiResult.data);
    const conversation = classifyConversation(call, transcript);
    const contacts = options.contacts || await this.ghl.findContactsByPhone(call.remotePhone, this.locationId);
    const contactIds = contacts.map(contact => contact.id || contact.contactId).filter(Boolean);
    const opportunities = options.opportunities || await this.ghl.findOpportunitiesByContacts(contactIds, this.pipelineId);
    const match = matchCallToGhl({ call, contacts, opportunities, locationId: this.locationId, pipelineId: this.pipelineId });

    if (match.status !== MATCHED) {
      return blocked('CALL_NOTE_REVIEW_REQUIRED', match.status, { call, transcript, conversation, match });
    }

    const requiredFacts = /agent|broker/i.test(match.contactRole) ? REQUIRED_AGENT_FACTS : REQUIRED_SELLER_FACTS;
    const extraction = validateExtractedFacts(options.extractedFacts || {}, transcript.text, requiredFacts);
    const next = calculateNextAction(call, match, conversation, extraction, options.currentOperatorState);
    const key = idempotencyKey({ locationId: this.locationId, contactId: match.contactId, opportunityId: match.opportunityId, callId: call.callId });
    const prior = this.journal.load(key);

    if (prior?.state === 'NOTE_WRITTEN') {
      return { status: 'DUPLICATE_ALREADY_PROCESSED', key, call, match, transcript, conversation, nextAction: next.queueItem, journal: prior, productionEffects: zeroEffects() };
    }

    const transcriptReady = transcript.status === 'TRANSCRIPT_AVAILABLE';
    const metadataOnly = !conversation.meaningful && ['NO_ANSWER', 'VOICEMAIL', 'AUTOMATED_ATTENDANT', 'WRONG_PARTY'].includes(conversation.outcome);
    if (!transcriptReady && !metadataOnly) {
      return blocked(transcript.status, transcript.reason || transcript.status, { key, call, match, transcript, conversation, nextAction: next.queueItem });
    }
    if (conversation.outcome === 'ANSWERED_UNVERIFIED') {
      return blocked('CALL_NOTE_REVIEW_REQUIRED', 'MEANINGFUL_HUMAN_CONTACT_NOT_VERIFIED', { key, call, match, transcript, conversation, nextAction: next.queueItem });
    }

    const summary = objectiveSummary(call, conversation, extraction);
    const note = buildCallNote({
      call,
      match,
      transcript,
      conversation,
      extraction,
      nextAction: next.queueItem,
      summary,
      commitments: validateCommitments(options.commitments || {}, transcript.text),
      propertyLocalTime: options.propertyLocalTime,
      transcriptRetrievedAt: aiResult.retrievedAt,
    });
    const reviewRequired = !this.autoLogStructuredNotes || !conversation.meaningful || extraction.rejected.length > 0;
    return {
      status: reviewRequired ? 'CALL_NOTE_REVIEW_REQUIRED' : 'READY_TO_WRITE',
      reason: reviewRequired ? 'OWNER_POLICY_OR_EXTRACTION_REVIEW_REQUIRED' : 'AUTO_LOG_POLICY_VERIFIED',
      key,
      call,
      match,
      transcript,
      conversation,
      extraction,
      note,
      nextAction: next.queueItem,
      operationalOutcome: operationalOutcome(call, conversation, extraction),
      rawTranscriptPolicy: this.rawTranscriptPolicy,
      approvalScope: approvalScope(this.locationId, call, match, note),
      nativeActivityRole: 'NATIVE_ACTIVITY',
      structuredNoteRole: 'STRUCTURED_KAYLA_NOTE',
      productionEffects: zeroEffects(),
    };
  }

  async writeApprovedNote(prepared, approval = {}) {
    if (!this.allowNoteWrites) return blocked('CALL_NOTE_REVIEW_REQUIRED', 'GHL_NOTE_WRITES_DISABLED', { prepared });
    if (this.getSafetyState() !== 'CANARY_ALLOWED') return blocked('CALL_NOTE_REVIEW_REQUIRED', 'KILL_SWITCH_BLOCKS_GHL_NOTE_WRITE', { prepared });
    if (!prepared?.note || prepared.match?.status !== MATCHED) return blocked('CALL_NOTE_REVIEW_REQUIRED', 'VERIFIED_PREPARED_NOTE_REQUIRED', { prepared });
    const currentScope = approvalScope(this.locationId, prepared.call, prepared.match, prepared.note);
    const existing = this.journal.load(prepared.key);
    if (existing?.state === 'NOTE_WRITTEN' && currentScope.scopeHash === prepared.approvalScope?.scopeHash && stableHash(prepared.note.body) === prepared.note.bodyHash) {
      return { status: 'DUPLICATE_ALREADY_PROCESSED', journal: existing, productionEffects: zeroEffects() };
    }
    const storedApproval = this.approvalStore?.verify(approval.approvalId, prepared);
    const authorized = Boolean(storedApproval && currentScope.scopeHash === prepared.approvalScope?.scopeHash && stableHash(prepared.note.body) === prepared.note.bodyHash);
    if (!authorized) return blocked('CALL_NOTE_REVIEW_REQUIRED', 'EXACT_NOTE_APPROVAL_REQUIRED', { prepared });
    try {
      const result = await this.journal.withLock(prepared.key, async () => this._writeUnderLock(prepared));
      if (result.status === 'NOTE_WRITTEN') this.approvalStore.consume(storedApproval.approvalId, result.noteId);
      return result;
    } catch (error) {
      if (error.message === 'CALL_NOTE_PROCESSING_LOCKED') return blocked('PROCESSING', error.message, { prepared });
      throw error;
    }
  }

  async _writeUnderLock(prepared) {
    const existing = this.journal.load(prepared.key);
    if (existing?.state === 'NOTE_WRITTEN') return { status: 'DUPLICATE_ALREADY_PROCESSED', journal: existing, productionEffects: zeroEffects() };
    if (existing?.state === 'PARTIAL_WRITE_UNCERTAIN') return { status: 'PARTIAL_WRITE_UNCERTAIN', reason: 'READ_ONLY_RECONCILIATION_REQUIRED_BEFORE_RETRY', journal: existing, productionEffects: zeroEffects() };
    let existingNotes;
    try {
      existingNotes = await this.ghl.findContactNotes(prepared.match.contactId, prepared.note.marker);
    } catch (error) {
      return blocked('FAILED_RETRYABLE', `PREWRITE_RECONCILIATION_FAILED: ${error.message}`, { prepared });
    }
    if (existingNotes.length > 1) {
      const conflicted = this.journal.transition(prepared.key, 'FAILED_MANUAL_REVIEW', { reason: 'MULTIPLE_GHL_CALL_NOTE_MARKERS_FOUND', markerCount: existingNotes.length }, { expectedState: existing?.state || 'NOT_PROCESSED' });
      return { status: 'FAILED_MANUAL_REVIEW', journal: conflicted, productionEffects: zeroEffects() };
    }
    if (existingNotes.length === 1) {
      if (stableHash(String(existingNotes[0].body || '')) !== prepared.note.bodyHash) {
        const conflicted = this.journal.transition(prepared.key, 'FAILED_MANUAL_REVIEW', { reason: 'GHL_MARKER_BODY_HASH_MISMATCH', noteId: existingNotes[0].id || null }, { expectedState: existing?.state || 'NOT_PROCESSED' });
        return { status: 'FAILED_MANUAL_REVIEW', journal: conflicted, productionEffects: zeroEffects() };
      }
      const reconciled = this.journal.transition(prepared.key, 'NOTE_WRITTEN', { callId: prepared.call.callId, contactId: prepared.match.contactId, opportunityId: prepared.match.opportunityId, noteId: existingNotes[0].id || null, reconciliation: 'GHL_MARKER_FOUND' });
      return { status: 'DUPLICATE_ALREADY_PROCESSED', journal: reconciled, productionEffects: zeroEffects() };
    }
    if (existing?.state === 'PROCESSING') {
      const uncertain = this.journal.transition(prepared.key, 'PARTIAL_WRITE_UNCERTAIN', { reason: 'INTERRUPTED_PROCESSING_WITHOUT_CONFIRMED_READBACK' }, { expectedState: 'PROCESSING' });
      return { status: 'PARTIAL_WRITE_UNCERTAIN', journal: uncertain, productionEffects: zeroEffects() };
    }
    this.journal.transition(prepared.key, 'PROCESSING', { callId: prepared.call.callId, contactId: prepared.match.contactId, opportunityId: prepared.match.opportunityId, noteHash: prepared.note.bodyHash }, { expectedState: existing?.state || 'NOT_PROCESSED' });
    let writeResult;
    try {
      writeResult = await this.ghl.createContactNote(prepared.match.contactId, prepared.note.body);
    } catch (error) {
      const uncertain = error.writeUncertain === true;
      const journal = this.journal.transition(prepared.key, uncertain ? 'PARTIAL_WRITE_UNCERTAIN' : 'FAILED_RETRYABLE', { reason: error.message }, { expectedState: 'PROCESSING' });
      return { status: journal.state, reason: error.message, journal, productionEffects: zeroEffects() };
    }
    let readback;
    try {
      readback = await this.ghl.findContactNotes(prepared.match.contactId, prepared.note.marker);
    } catch (error) {
      const journal = this.journal.transition(prepared.key, 'PARTIAL_WRITE_UNCERTAIN', { reason: `POSTWRITE_READBACK_FAILED: ${error.message}` }, { expectedState: 'PROCESSING' });
      return { status: 'PARTIAL_WRITE_UNCERTAIN', journal, productionEffects: { ...zeroEffects(), ghlWrites: 1 } };
    }
    if (readback.length !== 1) {
      const journal = this.journal.transition(prepared.key, 'PARTIAL_WRITE_UNCERTAIN', { reason: `EXPECTED_ONE_MARKER_FOUND_${readback.length}` }, { expectedState: 'PROCESSING' });
      return { status: 'PARTIAL_WRITE_UNCERTAIN', journal, productionEffects: { ...zeroEffects(), ghlWrites: 1 } };
    }
    if (stableHash(String(readback[0].body || '')) !== prepared.note.bodyHash) {
      const journal = this.journal.transition(prepared.key, 'PARTIAL_WRITE_UNCERTAIN', { reason: 'POSTWRITE_BODY_HASH_MISMATCH', noteId: readback[0].id || writeResult?.id || null }, { expectedState: 'PROCESSING' });
      return { status: 'PARTIAL_WRITE_UNCERTAIN', journal, productionEffects: { ...zeroEffects(), ghlWrites: 1 } };
    }
    const journal = this.journal.transition(prepared.key, 'NOTE_WRITTEN', { noteId: readback[0].id || writeResult?.id || null, noteHash: prepared.note.bodyHash }, { expectedState: 'PROCESSING' });
    const postWriteState = { ...(prepared.match.opportunity.operatorState || {}), opportunityId: prepared.match.opportunityId, contactId: prepared.match.contactId, propertyAddress: prepared.match.propertyAddress, currentStage: prepared.match.currentStage, contactPathStatus: 'ESTABLISHED', contactName: prepared.match.contactName, contactRole: prepared.match.contactRole, intStatus: 'SENT', completedCallStatus: prepared.conversation.meaningful ? 'ANSWERED' : 'NOT_COMPLETED', callAttemptCount: prepared.call.attemptNumber, qualificationChecklistStatus: prepared.extraction.missing.length ? 'INCOMPLETE' : 'COMPLETED', notesStatus: 'WRITTEN', missingPropertyFacts: prepared.extraction.missing };
    const next = evaluateOpportunity(postWriteState);
    return { status: 'NOTE_WRITTEN', noteId: journal.noteId, journal, nextAction: next.queueItem, productionEffects: { ...zeroEffects(), ghlWrites: 1 } };
  }

  async reconcileRecentCalls(options = {}) {
    const response = await this.justcall.listCalls({ from_datetime: options.from, to_datetime: options.to, order: 'desc', per_page: Math.min(100, options.limit || 100), fetch_ai_data: true });
    const calls = response?.data || [];
    const results = [];
    for (const callRecord of calls) {
      const result = await this.inspectCall(String(callRecord.id || callRecord.call_id), { ...options, callRecord });
      await this._persistInspection(result);
      results.push(result);
    }
    return { status: 'READ_ONLY_RECONCILIATION_COMPLETE', callsInspected: calls.length, results, productionEffects: zeroEffects() };
  }

  async _loadAiData(call, options) {
    if (options.aiData) return { data: options.aiData, retrievedAt: new Date().toISOString() };
    if (call.raw.justcall_ai) return { data: call.raw.justcall_ai, retrievedAt: new Date().toISOString() };
    try {
      const data = await this.justcall.fetchCallAiData(call.callId);
      return { data, retrievedAt: new Date().toISOString() };
    } catch (error) {
      return { data: { callId: call.callId, transcript_status: error.status === 404 ? 'UNAVAILABLE' : 'PENDING' }, retrievedAt: null };
    }
  }

  async _persistInspection(result) {
    if (!result?.key || ['NOTE_WRITTEN', 'DUPLICATE_ALREADY_PROCESSED', 'PARTIAL_WRITE_UNCERTAIN'].includes(result.status)) return;
    try {
      await this.journal.withLock(result.key, async () => {
        const existing = this.journal.load(result.key);
        if (['NOTE_WRITTEN', 'PARTIAL_WRITE_UNCERTAIN', 'PROCESSING'].includes(existing?.state)) return;
        const state = ['TRANSCRIPT_PENDING', 'TRANSCRIPT_FAILED'].includes(result.status) ? 'FAILED_RETRYABLE' : 'FAILED_MANUAL_REVIEW';
        this.journal.transition(result.key, state, {
          callId: result.call?.callId,
          contactId: result.match?.contactId,
          opportunityId: result.match?.opportunityId,
          transcriptStatus: result.transcript?.status,
          reviewQueue: result.reviewQueue,
          missingFacts: result.extraction?.missing || [],
          nextAction: result.nextAction?.exactNextAction || null,
          notePreview: result.note?.body || null,
          preparedWrite: result.note ? minimalPreparedWrite(result) : null,
          contactMadeEligible: Boolean(result.conversation?.meaningful && result.extraction?.missing?.length === 0),
          reason: result.reason,
        }, { expectedState: existing?.state || 'NOT_PROCESSED' });
      });
    } catch (error) {
      if (error.message !== 'CALL_NOTE_PROCESSING_LOCKED') throw error;
    }
  }
}

function isCompleted(call) {
  return /completed|answered|no.?answer|missed|failed|busy|voicemail/i.test(`${call.status} ${call.disposition}`) || Boolean(call.completedAt);
}

function calculateNextAction(call, match, conversation, extraction, current = {}) {
  const state = {
    ...current,
    opportunityId: match.opportunityId,
    contactId: match.contactId,
    propertyAddress: match.propertyAddress,
    currentStage: match.currentStage,
    currentStageId: match.currentStageId,
    contactPathStatus: 'ESTABLISHED',
    contactName: match.contactName,
    contactRole: match.contactRole,
    intStatus: 'SENT',
    callAttemptCount: call.attemptNumber,
    completedCallStatus: conversation.meaningful ? 'ANSWERED' : 'NOT_COMPLETED',
    qualificationChecklistStatus: conversation.meaningful && extraction.missing.length === 0 ? 'COMPLETED' : 'INCOMPLETE',
    notesStatus: 'NOT_PREPARED',
    missingPropertyFacts: extraction.missing,
    complianceStatus: 'CLEAR',
  };
  return evaluateOpportunity(state);
}

function operationalOutcome(call, conversation, extraction) {
  if (conversation.outcome === 'NO_ANSWER') return call.attemptNumber >= 2 ? 'NO_ANSWER_ATTEMPT_2' : 'NO_ANSWER_ATTEMPT_1';
  if (conversation.meaningful) return extraction.missing.length ? 'ANSWERED_INCOMPLETE_QUALIFICATION' : 'ANSWERED_QUALIFICATION_COMPLETE';
  return conversation.outcome;
}

function objectiveSummary(call, conversation, extraction) {
  return `Verified ${call.direction.toLowerCase()} call outcome ${conversation.outcome}; ${Object.keys(extraction.facts).length} transcript-supported property fact(s); ${extraction.missing.length} required item(s) remain missing.`;
}

function zeroEffects() {
  return { providerSends: 0, callsPlaced: 0, smsSent: 0, ghlWrites: 0, stageMovements: 0, ccc: 0, contactCards: 0, handoffs: 0, offers: 0 };
}

function approvalScope(locationId, call, match, note) {
  const payload = { actionType: 'WRITE_GHL_CALL_NOTE', locationId, callId: call.callId, contactId: match.contactId, opportunityId: match.opportunityId, marker: note.marker, noteHash: note.bodyHash };
  return { ...payload, scopeHash: stableHash(payload) };
}

function minimalPreparedWrite(result) {
  return {
    key: result.key,
    call: { callId: result.call.callId, attemptNumber: result.call.attemptNumber },
    match: {
      status: result.match.status,
      contactId: result.match.contactId,
      opportunityId: result.match.opportunityId,
      propertyAddress: result.match.propertyAddress,
      currentStage: result.match.currentStage,
      contactName: result.match.contactName,
      contactRole: result.match.contactRole,
      opportunity: {},
    },
    note: result.note,
    approvalScope: result.approvalScope,
    conversation: { meaningful: result.conversation.meaningful, outcome: result.conversation.outcome },
    extraction: { missing: result.extraction.missing },
  };
}

function blocked(status, reason, extra = {}) {
  return { status, reason, reviewQueue: 'CALL_NOTE_REVIEW_REQUIRED', ...extra, productionEffects: zeroEffects() };
}

module.exports = { JustCallGhlCallNoteProcessor, REQUIRED_AGENT_FACTS, REQUIRED_SELLER_FACTS, calculateNextAction, operationalOutcome, zeroEffects };
