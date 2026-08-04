'use strict';

const { JustCallIntegration } = require('./justcall-integration');
const { GhlCallNoteGateway } = require('./ghl-call-note-gateway');
const { CallNoteJournal } = require('./call-note-journal');
const { JustCallGhlCallNoteProcessor } = require('./justcall-ghl-call-note-processor');
const { CallNoteApprovalStore } = require('./call-note-approval-store');

function createCallNoteRuntime(env = process.env, options = {}) {
  const locationId = env.GHL_LOCATION_ID || options.locationId || '61XPzSqRy7UKMwW9DeB8';
  const pipelineId = env.GHL_PIPELINE_ID || options.pipelineId || 'nSf3NXYVkt8X4PgW9aZ3';
  const justcallKey = env.JUSTCALL_API_KEY || '';
  const justcallSecret = env.JUSTCALL_API_SECRET || '';
  const ghlToken = env.GHL_READ_TOKEN || env.GHL_PRIVATE_INTEGRATION_TOKEN || env.GHL_API_TOKEN || env.GHL_API_KEY || '';
  const readiness = {
    justcallReadConfigured: Boolean(justcallKey && justcallSecret),
    ghlReadConfigured: Boolean(ghlToken),
    webhookUrlConfigured: Boolean(env.JUSTCALL_WEBHOOK_URL),
    noteWritesEnabled: options.allowNoteWrites === true,
  };
  if (!readiness.justcallReadConfigured || !readiness.ghlReadConfigured) return { readiness, processor: null };

  const justcall = options.justcall || new JustCallIntegration({ apiKey: justcallKey, apiSecret: justcallSecret, webhookUrl: env.JUSTCALL_WEBHOOK_URL || '' });
  const ghl = options.ghl || new GhlCallNoteGateway({ token: ghlToken, locationId, pipelineId, writeEnabled: options.allowNoteWrites === true });
  const processor = new JustCallGhlCallNoteProcessor({
    justcall,
    ghl,
    journal: options.journal || new CallNoteJournal(options.journalOptions),
    locationId,
    pipelineId,
    allowNoteWrites: options.allowNoteWrites === true,
    autoLogStructuredNotes: false,
    approvalStore: options.approvalStore || (env.CALL_NOTE_APPROVAL_SECRET ? new CallNoteApprovalStore({ ...options.approvalOptions, signingSecret: env.CALL_NOTE_APPROVAL_SECRET }) : null),
  });
  return { readiness, processor };
}

module.exports = { createCallNoteRuntime };
