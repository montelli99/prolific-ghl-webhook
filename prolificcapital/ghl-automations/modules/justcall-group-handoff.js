'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HANDOFF_STATES = Object.freeze({
  GROUP_HANDOFF_READY: 'GROUP_HANDOFF_READY',
  GROUP_HANDOFF_MANUAL_ACTION_REQUIRED: 'GROUP_HANDOFF_MANUAL_ACTION_REQUIRED',
  GROUP_HANDOFF_CREATED: 'GROUP_HANDOFF_CREATED',
  GROUP_HANDOFF_CONFIRMED: 'GROUP_HANDOFF_CONFIRMED',
  GROUP_HANDOFF_FAILED: 'GROUP_HANDOFF_FAILED',
  GROUP_HANDOFF_UNCERTAIN: 'GROUP_HANDOFF_UNCERTAIN',
  GROUP_HANDOFF_NOT_SUPPORTED: 'GROUP_HANDOFF_NOT_SUPPORTED',
});

class JustCallGroupHandoff {
  constructor(config = {}) {
    this.operatorName = config.operatorName || 'Montelli';
    this.operatorNumber = config.operatorNumber || '+15716012619';
    this.closerName = config.closerName !== undefined ? config.closerName : 'Kayla';
    this.closerNumber = config.closerNumber !== undefined ? config.closerNumber : '+19044472520';
    this.closerJustCallUserId = config.closerJustCallUserId !== undefined ? config.closerJustCallUserId : '506515';
  }

  getCapability() {
    return {
      groupSmsActive: true,
      apiSupported: false,
      appSupported: true,
      classification: 'ACTIVE_MANUAL_ONLY',
      reason: 'Group SMS is enabled in JustCall dashboard but has no REST API. All group operations must be performed manually in the JustCall web or mobile app.',
    };
  }

  buildManualChecklist({ externalContact, externalPhone, propertyAddress, handoffSummary, stage }) {
    return {
      state: 'GROUP_HANDOFF_MANUAL_ACTION_REQUIRED',
      capability: this.getCapability(),
      checklist: [
        {
          step: 1,
          action: 'Open JustCall web or mobile app',
          detail: 'Navigate to the Messages section.',
        },
        {
          step: 2,
          action: 'Create a new group conversation',
          detail: `Add participants: ${this.operatorName} (${this.operatorNumber}), ${this.closerName} (${this.closerNumber}), and ${externalContact} (${externalPhone}).`,
        },
        {
          step: 3,
          action: 'Send the GCJ opening message',
          detail: `Send the approved GCJ text introducing ${this.closerName} as your business partner for the purchase of ${propertyAddress}.`,
        },
        {
          step: 4,
          action: 'Verify all participants received the message',
          detail: `Confirm ${this.closerName} and ${externalContact} can see the group and the opening message.`,
        },
        {
          step: 5,
          action: 'Hand off to closer',
          detail: `${this.closerName} now presents the offer. You (${this.operatorName}) step back from active negotiation but stay warm with the seller every 3-5 days.`,
        },
        {
          step: 6,
          action: 'Record handoff evidence',
          detail: 'Note the group thread ID (if visible), participants, timestamp, and confirmation that the closer has acknowledged the handoff.',
        },
      ],
      participants: {
        operator: { name: this.operatorName, number: this.operatorNumber },
        closer: { name: this.closerName, number: this.closerNumber, justCallUserId: this.closerJustCallUserId },
        external: { name: externalContact, phone: externalPhone },
      },
      propertyAddress,
      handoffSummary,
      stage,
      gcjText: `[Name] - happy [day]! Creating a group chat for the purchase on ${propertyAddress} with my business partner ${this.closerName}. He is currently in a meeting with our lender; The LOI will be coming from our partner at Homewithkaylamauser@gmail.com ; simply inform us it has been received for presentation, and also ensure to check other folders as well. Have a blessed rest of the week!`,
      createdAt: new Date().toISOString(),
    };
  }

  recordHandoffCompletion(checklist, evidence = {}) {
    return {
      state: 'GROUP_HANDOFF_CONFIRMED',
      checklistId: crypto.createHash('sha256').update(JSON.stringify(checklist)).digest('hex').slice(0, 16),
      confirmedAt: new Date().toISOString(),
      evidence: {
        groupThreadId: evidence.groupThreadId || null,
        participantsConfirmed: evidence.participantsConfirmed || false,
        closerAcknowledged: evidence.closerAcknowledged || false,
        openingMessageSent: evidence.openingMessageSent || false,
        notes: evidence.notes || null,
      },
    };
  }

  validateParticipants(externalContact, externalPhone) {
    const errors = [];
    if (!externalContact) errors.push('MISSING_EXTERNAL_CONTACT_NAME');
    if (!externalPhone) errors.push('MISSING_EXTERNAL_PHONE');
    if (!this.closerName) errors.push('MISSING_CLOSER_NAME');
    if (!this.closerNumber) errors.push('MISSING_CLOSER_NUMBER');
    return { ok: errors.length === 0, errors };
  }
}

module.exports = { JustCallGroupHandoff, HANDOFF_STATES };
