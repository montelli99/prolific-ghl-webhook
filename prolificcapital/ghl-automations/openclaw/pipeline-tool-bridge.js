'use strict';

// pipeline-tool-bridge.js
//
// Thin adapter between the OpenClaw `pipeline-tools` extension and the
// authoritative Prolific Capital modules. This bridge never reimplements
// business logic; every operation delegates to the authoritative modules:
//
//   - safety state              -> bot/kill-switch
//   - canary previews           -> modules/canary-plan-builder (CanaryPlanBuilder)
//   - plan persistence/status   -> modules/plan-store (PlanStore)
//   - approvals                 -> modules/approval-store (ApprovalStore)
//   - runbook v2 review/approve -> modules/supervised-canary-runbook-service
//   - execution/reconciliation  -> bot/canary-executor
//   - memory provenance         -> modules/pipeline-memory-context
//   - stage/script guidance     -> modules/kayla-course-spec
//
// The extension (extensions/pipeline-tools/index.ts) already marks every tool
// `ownerOnly: true`, which the platform enforces mechanically (wrapOwnerOnlyToolExecution
// in src/agents/tools/common.ts). As defense in depth, every state-changing or
// context-sensitive method additionally enforces owner/chat/topic here via
// authorize() BEFORE touching any authoritative store or operation. Read-only
// tools (which the extension invokes without context) are covered by the platform
// owner gate and only expose aggregated state; they never mutate anything.
//
// Kill switch stays PAUSED in production; execution is blocked by the kill switch
// itself (KILL_SWITCH_BLOCKS_SEND) and by the approval/provenance gates in the
// runbook service before any provider action can occur.

const OWNER_ID = '718718959';
const CHAT_ID = '-1003975794600';
const TOPIC_ID = '389';
const PIPELINE_LIVE_MODE = 'READ_ONLY_SUPERVISED';
const LOCATION_ID = '61XPzSqRy7UKMwW9DeB8';
const PIPELINE_ID = 'nSf3NXYVkt8X4PgW9aZ3';
const RUNBOOK_ID = 'runbook_supervised_canary_v2';
const RUNBOOK_CANONICAL_HASH = '9126b05e2c39d2ee6d8fb35ed2ad065a95969badf316c65124b74315ff17b750';
const SECRETS_ENV_PATH = 'C:/Users/mscott/AI_Workspace/prolificcapital/secrets/.env';

const PPC_PROFILE_ID = 'PPC_EWA_BEACH';
const PPC_LOCATION_ID = 'GDq92uruRngbi9mLGGrV';
const PPC_PIPELINE_ID = 'ril84XHGQleRgE0W0FKU';
const PPC_CREDENTIAL_REF = 'PPC_GHL_API_KEY';
const PPC_STAGE_AUTHORITY_PATH = 'C:/Users/mscott/AI_Workspace/prolificcapital/ghl-automations/profiles/ppc-ewa-beach/stage-authority.json';

const VALID_PROFILES = Object.freeze({
  ATLAS_OUTBOUND: { profileId: 'ATLAS_OUTBOUND', locationId: LOCATION_ID, pipelineId: PIPELINE_ID, credentialRef: 'GHL_API_TOKEN' },
  PPC_EWA_BEACH: { profileId: PPC_PROFILE_ID, locationId: PPC_LOCATION_ID, pipelineId: PPC_PIPELINE_ID, credentialRef: PPC_CREDENTIAL_REF },
});

const ZERO_EFFECTS = Object.freeze({ providerSends: 0, ghlWrites: 0, stageMovements: 0 });

// ---- Profile-aware routing ----

function resolvePipelineContext(profileId) {
  if (!profileId || typeof profileId !== 'string') {
    return { resolved: false, reason: 'PIPELINE_PROFILE_SELECTION_REQUIRED' };
  }
  const normalized = String(profileId).trim().toUpperCase();
  const profile = VALID_PROFILES[normalized];
  if (!profile) {
    return { resolved: false, reason: `UNKNOWN_PROFILE: ${profileId}`, validProfiles: Object.keys(VALID_PROFILES) };
  }
  return {
    resolved: true,
    profileId: profile.profileId,
    locationId: profile.locationId,
    pipelineId: profile.pipelineId,
    credentialRef: profile.credentialRef,
  };
}

async function resolveProfileFromOpportunity(opportunityId, auth) {
  if (!opportunityId) return { resolved: false, reason: 'OPPORTUNITY_ID_REQUIRED' };
  const a = authorize(auth);
  if (!a.authorized) return { resolved: false, reason: a.reason };
  const token = getGhlToken('ATLAS_OUTBOUND');
  const ppcToken = getGhlToken('PPC_EWA_BEACH');
  if (!token && !ppcToken) return { resolved: false, reason: 'NO_GHL_CREDENTIALS' };

  const results = [];
  if (token) {
    try {
      const res = await ghlGet(token, `/opportunities/${opportunityId}`);
      const opp = res.body?.opportunity || res.body;
      if (opp && opp.id) {
        const locId = opp.locationId || '';
        const pipeId = opp.pipelineId || '';
        for (const [key, profile] of Object.entries(VALID_PROFILES)) {
          if (profile.locationId === locId && profile.pipelineId === pipeId) {
            return { resolved: true, profileId: profile.profileId, locationId: locId, pipelineId: pipeId, credentialRef: profile.credentialRef, opportunity: opp };
          }
        }
        results.push({ locationId: locId, pipelineId: pipeId });
      }
    } catch (_) {}
  }
  if (ppcToken && token !== ppcToken) {
    try {
      const res = await ghlGet(ppcToken, `/opportunities/${opportunityId}`);
      const opp = res.body?.opportunity || res.body;
      if (opp && opp.id) {
        const locId = opp.locationId || '';
        const pipeId = opp.pipelineId || '';
        for (const [key, profile] of Object.entries(VALID_PROFILES)) {
          if (profile.locationId === locId && profile.pipelineId === pipeId) {
            return { resolved: true, profileId: profile.profileId, locationId: locId, pipelineId: pipeId, credentialRef: profile.credentialRef, opportunity: opp };
          }
        }
        results.push({ locationId: locId, pipelineId: pipeId });
      }
    } catch (_) {}
  }
  return { resolved: false, reason: 'OPPORTUNITY_NOT_FOUND_OR_CROSS_PROFILE', searched: results };
}

// ---- GHL HTTP helpers (async) ----

function getGhlToken(profileId) {
  const profile = VALID_PROFILES[profileId];
  if (!profile) return null;
  return process.env[profile.credentialRef] || null;
}

function ghlRequest(method, token, pathname, body) {
  return new Promise((resolve) => {
    const https = require('https');
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'services.leadconnectorhq.com', path: pathname, method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Version: '2021-07-28' },
      timeout: 15000,
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

function ghlGet(token, pathname) {
  return ghlRequest('GET', token, pathname);
}

function ghlPut(token, pathname, body) {
  return ghlRequest('PUT', token, pathname, body);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let postCallDelay = delay;

function _setPostCallDelay(fn) {
  postCallDelay = typeof fn === 'function' ? fn : delay;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isExpectedPpcOpportunity(opp) {
  return Boolean(opp && opp.locationId === PPC_LOCATION_ID && opp.pipelineId === PPC_PIPELINE_ID);
}

function toIsoFromCall(call) {
  const callDate = call && call.callDate;
  const callTime = call && call.callTime;
  if (!callDate || !callTime) return null;
  const iso = new Date(`${callDate}T${callTime}Z`);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

function parseConversationTimestamp(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : ts;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  return null;
}

function findLastCallOutcome(customFields) {
  const fields = Array.isArray(customFields) ? customFields : [];
  const match = fields.find((field) => /last\s*call\s*outcome/i.test(`${field.name || ''} ${field.key || ''} ${field.fieldKey || ''} ${field.id || ''}`));
  if (!match) return null;
  return match.fieldValue || match.value || match.field_value || null;
}

function summarizeConversationMessages(messages, call) {
  const items = Array.isArray(messages) ? messages : [];
  const callId = String(call && call.callId || '');
  const recordingUrl = call && call.recordingUrl ? String(call.recordingUrl) : '';
  const callAtMs = call && call.callAt ? Date.parse(call.callAt) : NaN;
  const windowStart = Number.isNaN(callAtMs) ? null : callAtMs - 5 * 60 * 1000;
  const windowEnd = Number.isNaN(callAtMs) ? null : callAtMs + 5 * 60 * 1000;

  const relevant = items.filter((message) => {
    const when = parseConversationTimestamp(message.dateAdded);
    if (windowStart == null || when == null) return true;
    return when >= windowStart && when <= windowEnd;
  });

  let matchedMessage = null;
  for (const message of relevant) {
    const haystack = JSON.stringify(message);
    if ((callId && haystack.includes(callId)) || (recordingUrl && haystack.includes(recordingUrl)) || /call/i.test(String(message.messageType || '')) || /call/i.test(String(message.body || ''))) {
      matchedMessage = message;
      break;
    }
  }

  return {
    total: items.length,
    relevantCount: relevant.length,
    matched: Boolean(matchedMessage),
    matchedMessage,
  };
}

function truncateText(text, max = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function cleanPropertyLabel(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 4) {
    const joined = `${parts[0]}, ${parts[1]} ${parts[2]}`;
    const doubled = `${joined}, ${parts[1]} ${parts[2]}`;
    if (value === doubled) return joined;
  }
  return value;
}

function summarizeTask(task) {
  return {
    id: task.id,
    title: task.title || '',
    body: truncateText(task.body || '', 240),
    dueDate: task.dueDate || null,
    completed: task.completed === true,
  };
}

function summarizeNote(note) {
  const body = truncateText(note.bodyText || note.body || '', 280);
  const noisy = /Outgoing SMS|Opportunity updated|Opportunity created/i.test(body);
  return {
    id: note.id,
    body,
    dateAdded: note.dateAdded || null,
    noisy,
  };
}

function extractKnownFacts(contact, notes) {
  const facts = [];
  const fields = Array.isArray(contact && contact.customFields) ? contact.customFields : [];
  for (const field of fields) {
    const value = field.value || field.fieldValue || field.field_value;
    if (!value) continue;
    const text = String(value);
    if (text === 'Within 1-3 months' || text === 'Within 30 days' || text === 'Urgent') {
      facts.push(`Timeline: ${text}`);
      continue;
    }
    if (text === 'Investment property' || text === 'Other') {
      facts.push(`Lead context: ${text}`);
      continue;
    }
    facts.push(text);
  }
  for (const note of notes) {
    const body = String(note.body || '');
    if (/vacant/i.test(body)) facts.push('Vacant');
    if (/occupied/i.test(body)) facts.push('Occupied');
    const ask = body.match(/(?:listed|bring it down to|wants)\s+(\d{2,3}[kK])/);
    if (ask) facts.push(`Price signal ${ask[1].toUpperCase()}`);
    if (/inherit/i.test(body)) facts.push('Inherited');
    if (/roof/i.test(body)) facts.push('Roof mentioned');
  }
  return [...new Set(facts)].slice(0, 5);
}

function deriveCallObjective(stageName, notes, tasks) {
  if (stageName === 'Called Once, No Answer') return 'Reconnect after first no-answer';
  if (stageName === 'Awaiting Photos') return 'Get promised property photos';
  if (stageName === 'Sent Apt Times to Pitch') return 'Confirm appointment status and keep deal moving';
  if (tasks.some((task) => /callback/i.test(task.title) || /callback/i.test(task.body))) return 'Honor prior callback commitment';
  return 'Reach seller and progress qualification';
}

function deriveOpening(stageName, contactName, property, knownFacts) {
  const firstName = String(contactName || '').split(' ')[0] || 'there';
  if (stageName === 'Called Once, No Answer') {
    return `Hi ${firstName}, this is Montelli. I was trying to reach you about ${property}. I wanted to follow up and see if selling it is still something you're considering.`;
  }
  if (stageName === 'Awaiting Photos') {
    return `Hi ${firstName}, this is Montelli following up on ${property}. I wanted to check in on the photos we discussed and see where things stand.`;
  }
  if (stageName === 'Sent Apt Times to Pitch') {
    return `Hi ${firstName}, this is Montelli calling about ${property}. I wanted to follow up on the appointment timing we discussed and see what the next best step is.`;
  }
  return `Hi ${firstName}, this is Montelli calling about ${property}.`;
}

function deriveKeyQuestions(stageName, knownFacts) {
  const knownText = knownFacts.join(' ').toLowerCase();
  if (stageName === 'Called Once, No Answer') {
    return [
      'Are you still considering selling the property?',
      knownText.includes('vacant') ? 'Is the property still vacant, or has anything changed?' : 'Is the property vacant, occupied, or tenant-occupied right now?',
      knownText.includes('price signal') ? 'Is that pricing target still accurate?' : 'What number are you hoping to get if you sell?',
    ];
  }
  if (stageName === 'Awaiting Photos') {
    return [
      'Were you able to gather the photos we discussed?',
      'Has anything changed with the condition since we last spoke?',
      'What is the biggest blocker to getting those photos over?',
    ];
  }
  return [
    'Where does the deal currently stand from your side?',
    'Is the current timeline still accurate?',
    'What do you need from us next to keep this moving?',
  ];
}

function deriveWhy(stageName, notes, tasks) {
  const note = notes[0]?.body || '';
  if (stageName === 'Called Once, No Answer') return 'This seller is in a no-answer follow-up stage. We need to reconnect, confirm selling intent, and pick up qualification where the first attempt stopped.';
  if (stageName === 'Awaiting Photos') return 'This seller already moved past first contact. The call is to unblock photos, confirm condition, and keep the deal progressing.';
  if (stageName === 'Sent Apt Times to Pitch') return 'This seller is already in the active pipeline. The call should advance the current appointment/negotiation context, not restart discovery from zero.';
  return note ? note : 'Review the latest context and move the opportunity forward safely.';
}

function deriveWatchFor(stageName, knownFacts) {
  const watch = [];
  if (stageName === 'Called Once, No Answer') watch.push('Do not sound like a first-contact cold call.');
  if (stageName === 'Awaiting Photos') watch.push('Do not restart discovery if the seller already provided context.');
  if (!knownFacts.length) watch.push('Missing qualification data - verify motivation, condition, timeline, and price.');
  return watch.slice(0, 2);
}

// Deterministic first-name derivation: seller first name from authoritative
// contact data, never the owner name, never invented.
function deriveFirstName(contact, contactName) {
  if (contact && typeof contact === 'object') {
    const first = contact.firstName || contact.first_name;
    if (first && String(first).trim()) return String(first).trim().split(' ')[0];
    const full = contact.name;
    if (full && String(full).trim()) return String(full).trim().split(' ')[0];
  }
  const name = String(contactName || '').trim();
  if (!name) return null;
  return name.split(' ')[0];
}

// Stage-aware voicemail scripts (IF THEY DON'T ANSWER). Deterministic; never a
// first-contact script when the seller is already deep in the pipeline.
function deriveVoicemailScript(stageName, firstName, property, openPromises) {
  const name = firstName || 'there';
  const prop = String(property || 'the property').trim();
  const hasPhotoPromise = Array.isArray(openPromises) && openPromises.some((p) => /photo|picture|image/i.test(String(p)));
  if (stageName === 'Awaiting Photos' || stageName === 'Called Once, No Answer' || (Array.isArray(openPromises) && openPromises.length)) {
    const detail = hasPhotoPromise ? ` I wanted to check in on the photos we discussed.` : ` I wanted to follow up and see if selling it is still something you're considering.`;
    return `Hi ${name}, this is Montelli calling about ${prop}.${detail} Give me a call back when you get a chance. Thanks.`;
  }
  if (stageName === 'Sent Apt Times to Pitch' || /pipeline|negotiat|offer|appointment/i.test(stageName)) {
    return `Hi ${name}, this is Montelli following up about ${prop}. I wanted to check on the next step we discussed. Give me a call when you get a chance.`;
  }
  return `Hi ${name}, this is Montelli calling about ${prop}. Give me a call back when you get a chance. Thanks.`;
}

// Copy-ready SMS shortcuts (TEXT IF NO ANSWER). Never auto-sends.
function deriveSmsText(stageName, firstName, property, openPromises, callback, appointment) {
  const name = firstName || 'there';
  const prop = String(property || 'the property').trim();
  const hasPhotoPromise = Array.isArray(openPromises) && openPromises.some((p) => /photo|picture|image/i.test(String(p)));
  if (hasPhotoPromise || stageName === 'Awaiting Photos') {
    return `Hi ${name}, just following up on the photos for ${prop}. Send them over whenever you get a chance and I'll take a look.`;
  }
  if (callback) return `Hi ${name}, this is Montelli. I'll follow up ${callback} like we discussed about ${prop}. Give me a call or text when you get a chance.`;
  if (appointment) return `Hi ${name}, confirming ${appointment} for ${prop}. I'll follow up if anything changes.`;
  if (stageName === 'Sent Apt Times to Pitch' || /pipeline|negotiat|offer|appointment/i.test(stageName)) {
    return `Hi ${name}, this is Montelli. I was trying to reach you about ${prop} to keep the deal moving. Give me a call when you get a chance.`;
  }
  return `Hi ${name}, this is Montelli. I was trying to reach you about ${prop}. I wanted to see if selling it is still something you're considering. Give me a call or text when you get a chance.`;
}

async function getPpcCallContext(profileId, contactId, opportunityId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (profileId !== 'PPC_EWA_BEACH') return blocked('CALL_CONTEXT_PPC_ONLY');
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');

  const [contactRes, notesRes, tasksRes, oppRes, conversationSearch] = await Promise.all([
    ghlGet(token, `/contacts/${contactId}`),
    ghlGet(token, `/contacts/${contactId}/notes/`),
    ghlGet(token, `/contacts/${contactId}/tasks`),
    ghlGet(token, `/opportunities/${opportunityId}`),
    ghlGet(token, `/conversations/search?locationId=${encodeURIComponent(ctx.locationId)}&contactId=${encodeURIComponent(contactId)}`),
  ]);

  const contact = contactRes.body?.contact || null;
  const opportunity = oppRes.body?.opportunity || oppRes.body || null;
  const notes = (notesRes.body?.notes || []).map(summarizeNote).filter((note) => note.body && !note.noisy);
  const tasks = (tasksRes.body?.tasks || []).map(summarizeTask);
  const conversations = conversationSearch.body?.conversations || [];

  let conversationMessages = [];
  if (conversations[0]?.id) {
    const conversationMessagesRes = await ghlGet(token, `/conversations/${conversations[0].id}/messages`);
    conversationMessages = (conversationMessagesRes.body?.messages?.messages || []).filter((message) => message.messageType !== 'TYPE_ACTIVITY_OPPORTUNITY');
  }

  const stageName = opportunity?.pipelineStageId ? ((loadPpcStageAuthority().stages || []).find((s) => s.stageId === opportunity.pipelineStageId)?.name || '') : '';
  const knownFacts = extractKnownFacts(contact, notes);
  const recentConversation = conversationMessages.slice(0, 3).map((message) => truncateText(message.body || '', 180)).filter(Boolean);
  const lastTask = tasks[0] || null;
  const qualificationState = loadQualification(opportunityId) || null;
  const qualification = qualificationState?.qualification || {};
  const qualificationKnown = [];
  const qualificationMissing = [];
  const qualificationConflicts = [];
  const openPromises = [];
  for (const [field, value] of Object.entries(qualification)) {
    if (field === 'commitments' && Array.isArray(value)) {
      for (const item of value.filter((entry) => entry.status === 'pending').slice(0, 3)) openPromises.push(item.description || item.type);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (value.status === 'KNOWN' && value.value != null && value.value !== '' && (!Array.isArray(value.value) || value.value.length)) qualificationKnown.push(`${field}: ${Array.isArray(value.value) ? value.value.join(', ') : value.value}`);
    if (value.status === 'UNKNOWN') qualificationMissing.push(field);
    if (value.status === 'NEEDS_CONFIRMATION' || value.status === 'CONFLICTING') qualificationConflicts.push(`${field}: ${value.evidence || 'needs clarification'}`);
  }

  return {
    status: 'OK',
    contact,
    opportunity,
    notes: notes.slice(0, 5),
    tasks: tasks.slice(0, 3),
    recentConversation,
    knownFacts,
    qualificationKnown: qualificationKnown.slice(0, 6),
    qualificationMissing: qualificationMissing.slice(0, 6),
    qualificationConflicts: qualificationConflicts.slice(0, 3),
    openPromises: openPromises.slice(0, 3),
    lastTask,
    callObjective: deriveCallObjective(stageName, notes, tasks),
    whyWeAreCalling: deriveWhy(stageName, notes, tasks),
    opening: deriveOpening(stageName, deriveFirstName(contact, contact?.name), cleanPropertyLabel(opportunity?.name || ''), knownFacts),
    keyQuestions: deriveKeyQuestions(stageName, knownFacts),
    watchFor: deriveWatchFor(stageName, knownFacts),
    firstName: deriveFirstName(contact, contact?.name),
    voicemailScript: deriveVoicemailScript(stageName, deriveFirstName(contact, contact?.name), cleanPropertyLabel(opportunity?.name || ''), openPromises),
    smsText: deriveSmsText(stageName, deriveFirstName(contact, contact?.name), cleanPropertyLabel(opportunity?.name || ''), openPromises, (qualification?.callback && qualification.callback.value) || null, null),
    lastContactLabel: tasks.find((task) => /Outgoing call/i.test(task.title)) ? `${tasks.find((task) => /Outgoing call/i.test(task.title)).dueDate || ''}` : null,
    effects: { ...ZERO_EFFECTS },
  };
}

async function readPpcPostCallSyncSnapshot(token, ctx, contactId, opportunityId, normalizedPhone, call) {
  const [contactRes, duplicateRes, notesRes, tasksRes, opportunityRes] = await Promise.all([
    ghlGet(token, `/contacts/${contactId}`),
    ghlGet(token, `/contacts/?locationId=${encodeURIComponent(ctx.locationId)}&query=${encodeURIComponent(`+${normalizedPhone}`)}`),
    ghlGet(token, `/contacts/${contactId}/notes/`),
    ghlGet(token, `/contacts/${contactId}/tasks`),
    ghlGet(token, `/opportunities/${opportunityId}`),
  ]);

  const contact = contactRes.body?.contact || null;
  const duplicateContacts = Array.isArray(duplicateRes.body?.contacts) ? duplicateRes.body.contacts : [];
  const notes = Array.isArray(notesRes.body?.notes) ? notesRes.body.notes : [];
  const tasks = Array.isArray(tasksRes.body?.tasks) ? tasksRes.body.tasks : [];
  const opportunity = opportunityRes.body?.opportunity || opportunityRes.body || null;

  let conversation = null;
  let conversationMessages = [];
  let conversationMessageSummary = { total: 0, relevantCount: 0, matched: false, matchedMessage: null };

  const conversationSearch = await ghlGet(token, `/conversations/search?locationId=${encodeURIComponent(ctx.locationId)}&contactId=${encodeURIComponent(contactId)}`);
  const conversations = Array.isArray(conversationSearch.body?.conversations) ? conversationSearch.body.conversations : [];
  if (conversations.length > 0) {
    conversation = conversations[0];
    const conversationMessagesRes = await ghlGet(token, `/conversations/${conversation.id}/messages`);
    conversationMessages = conversationMessagesRes.body?.messages?.messages || [];
    conversationMessageSummary = summarizeConversationMessages(conversationMessages, call);
  }

  const customFields = Array.isArray(contact && contact.customFields) ? contact.customFields : [];
  const callAt = call && call.callAt ? Date.parse(call.callAt) : NaN;
  const conversationLastMessageAt = parseConversationTimestamp(conversation && conversation.lastMessageDate);
  const conversationFresh = conversationLastMessageAt != null && !Number.isNaN(callAt) ? Math.abs(conversationLastMessageAt - callAt) <= 5 * 60 * 1000 : false;

  const recordingLogged = conversationMessageSummary.matched && JSON.stringify(conversationMessageSummary.matchedMessage).includes(String(call && call.recordingUrl || ''));
  const justcallIdStored = conversationMessageSummary.matched && JSON.stringify(conversationMessageSummary.matchedMessage).includes(String(call && call.callId || '')) ? String(call.callId) : null;
  const callLogged = conversationMessageSummary.matched;

  return {
    status: 'OK',
    contactMatched: Boolean(contact && contact.id === contactId && normalizePhone(contact.phone) === normalizedPhone),
    duplicateCount: duplicateContacts.filter((item) => normalizePhone(item.phone) === normalizedPhone).length,
    duplicateContactIds: duplicateContacts.filter((item) => normalizePhone(item.phone) === normalizedPhone).map((item) => item.id),
    phone: contact ? contact.phone || null : null,
    dnd: contact && contact.dnd === true,
    wrongNumber: contact && contact.wrongNumber === true,
    notesCount: notes.length,
    tasksCount: tasks.length,
    contact,
    opportunity,
    stageUnchanged: Boolean(opportunity && opportunity.id === opportunityId && opportunity.pipelineStageId === 'd31c50be-0148-4769-b3bd-cf32c2a16bff'),
    unexpectedStageMove: Boolean(opportunity && opportunity.id === opportunityId && opportunity.pipelineStageId !== 'd31c50be-0148-4769-b3bd-cf32c2a16bff'),
    conversationPresent: Boolean(conversation),
    conversationType: conversation ? conversation.type : null,
    conversationLastMessageAt: conversationLastMessageAt != null ? new Date(conversationLastMessageAt).toISOString() : null,
    conversationFresh,
    conversationMessageCount: conversationMessageSummary.total,
    relevantConversationMessageCount: conversationMessageSummary.relevantCount,
    callLogged,
    callActivityType: conversationMessageSummary.matchedMessage ? conversationMessageSummary.matchedMessage.messageType || null : null,
    callActivityTimestamp: conversationMessageSummary.matchedMessage ? conversationMessageSummary.matchedMessage.dateAdded || null : null,
    callActivityText: conversationMessageSummary.matchedMessage ? conversationMessageSummary.matchedMessage.body || null : null,
    answeredStatus: call && call.answered === true ? 'answered' : call && call.answered === false ? 'not_answered' : null,
    duration: call ? call.duration || 0 : 0,
    justcallIdStored,
    recordingLogged,
    recordingUrl: recordingLogged ? String(call.recordingUrl || '') : null,
    recordingUsable: Boolean(recordingLogged && call && call.recordingUrl),
    lastCallOutcome: findLastCallOutcome(customFields),
    disposition: null,
    tasks,
    unexpectedTask: tasks.length > 0,
    workflowTriggered: false,
    smsDetected: false,
    duplicateAutomation: false,
    rawConversationId: conversation ? conversation.id : null,
  };
}

async function getPpcPostCallSyncStatus(profileId, contactId, opportunityId, contactPhone, call, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (profileId !== 'PPC_EWA_BEACH') return blocked('POST_CALL_SYNC_PPC_ONLY');
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');

  const normalizedPhone = normalizePhone(contactPhone);
  if (!normalizedPhone) return blocked('CONTACT_PHONE_REQUIRED');

  const pollScheduleMs = [0, 10_000, 30_000, 60_000];
  const snapshots = [];
  for (let idx = 0; idx < pollScheduleMs.length; idx++) {
    const waitMs = pollScheduleMs[idx];
    if (waitMs > 0) await postCallDelay(waitMs);
    const snapshot = await readPpcPostCallSyncSnapshot(token, ctx, contactId, opportunityId, normalizedPhone, call);
    snapshots.push({ attempt: idx + 1, waitedMs: waitMs, snapshot });
    if (snapshot.callLogged || snapshot.recordingLogged) {
      return {
        status: 'OK',
        synced: true,
        pending: false,
        waitedMs: waitMs,
        attempts: snapshots,
        ...snapshot,
      };
    }
  }

  const last = snapshots[snapshots.length - 1]?.snapshot || null;
  return {
    status: 'OK',
    synced: false,
    pending: true,
    waitedMs: pollScheduleMs[pollScheduleMs.length - 1],
    attempts: snapshots,
    ...(last || {}),
  };
}

function normalizeTags(tags) {
  return Array.isArray(tags) ? [...new Set(tags.filter((tag) => typeof tag === 'string' && tag.trim()))] : [];
}

function contactHasAnyTag(contact, tags) {
  const existingTags = normalizeTags(contact && contact.tags);
  return tags.some((tag) => existingTags.includes(tag));
}

async function verifyPpcQueueExclusion(token, opportunityId, verifiedContact) {
  if (!opportunityId) return { ok: false, reason: 'OPPORTUNITY_ID_REQUIRED' };
  const oppRes = await ghlGet(token, `/opportunities/${opportunityId}`);
  const opp = oppRes.body?.opportunity || oppRes.body;
  if (!opp || !opp.id) return { ok: false, reason: 'OPPORTUNITY_NOT_FOUND' };
  const eligibility = evaluatePpcCallEligibility({
    ...opp,
    contact: {
      ...(opp.contact || {}),
      ...(verifiedContact || {}),
      tags: normalizeTags((verifiedContact && verifiedContact.tags) || (opp.contact && opp.contact.tags)),
    },
  });
  if (eligibility.callEligible) {
    return { ok: false, reason: 'CALL_ELIGIBILITY_RETAINED', eligibility };
  }
  return { ok: true, opportunityId: opp.id, eligibility };
}

async function startPpcCallIntelligence(profileId, input, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (profileId !== 'PPC_EWA_BEACH') return blocked('CALL_INTELLIGENCE_PPC_ONLY');
  const result = await processCompletedCall({ ...input, profile: profileId });
  return { ...result, effects: { ...ZERO_EFFECTS } };
}

function getPpcCallIntelligence(callId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (!callId) return blocked('CALL_ID_REQUIRED');
  const result = reviewCall(String(callId));
  return result ? { ...result, effects: { ...ZERO_EFFECTS } } : { status: 'missing', callId: String(callId), reason: 'CALL_INTELLIGENCE_NOT_FOUND', effects: { ...ZERO_EFFECTS } };
}

// ---- PPC Stage Authority ----

let _ppcStageAuthority = null;
function loadPpcStageAuthority() {
  if (_ppcStageAuthority) return _ppcStageAuthority;
  try {
    const fs = require('fs');
    _ppcStageAuthority = JSON.parse(fs.readFileSync(PPC_STAGE_AUTHORITY_PATH, 'utf8'));
  } catch (_) {
    _ppcStageAuthority = { stages: [], totalStages: 0 };
  }
  return _ppcStageAuthority;
}

function resolvePpcStage(target) {
  const authority = loadPpcStageAuthority();
  const stages = authority.stages || [];
  if (!target) return { resolved: false, reason: 'TARGET_STAGE_REQUIRED' };
  const byId = stages.find((s) => s.stageId === String(target));
  if (byId) return { resolved: true, stage: byId };
  const byName = stages.find((s) => s.name.toLowerCase() === String(target).toLowerCase());
  if (byName) return { resolved: true, stage: byName };
  const byPosition = stages.find((s) => String(s.position) === String(target));
  if (byPosition) return { resolved: true, stage: byPosition };
  return { resolved: false, reason: 'PPC_STAGE_NOT_FOUND', target, availableStages: stages.map((s) => ({ position: s.position, stageId: s.stageId, name: s.name })) };
}

// Authoritative module singletons. `_setDeps` is a test-only seam that lets the
// pre-restart harness substitute hermetic stubs; production always uses these.
const deps = {
  killSwitch: require('../bot/kill-switch'),
  PlanStore: require('../modules/plan-store').PlanStore,
  ApprovalStore: require('../modules/approval-store').ApprovalStore,
  CanaryPlanBuilder: require('../modules/canary-plan-builder').CanaryPlanBuilder,
  SupervisedCanaryRunbookService: require('../modules/supervised-canary-runbook-service').SupervisedCanaryRunbookService,
  executor: require('../bot/canary-executor'),
  mem: require('../modules/pipeline-memory-context'),
  spec: require('../modules/kayla-course-spec'),
};

function _setDeps(override) {
  Object.assign(deps, override || {});
  runbookService = null;
  return deps;
}

let runbookService = null;
function getRunbookService() {
  if (!runbookService) {
    runbookService = new deps.SupervisedCanaryRunbookService({
      planStore: new deps.PlanStore(),
      approvalStore: new deps.ApprovalStore(),
    });
  }
  return runbookService;
}

// Load Prolific secrets into the gateway process env (read-only file read) so the
// authoritative modules can construct read clients (GHL token, JustCall creds).
// Never overwrites an already-set environment variable.
function loadSecretsIntoEnv() {
  try {
    const fs = require('fs');
    const content = fs.readFileSync(SECRETS_ENV_PATH, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].replace(/^['"]|['"]$/g, '').trim();
      if (value && !(key in process.env)) process.env[key] = value;
    }
  } catch (_) {
    // Keep whatever env the gateway already has.
  }
}
loadSecretsIntoEnv();

const { processCompletedCall, reviewCall, loadQualification } = require('../modules/call-intelligence');

function authorize(auth) {
  const ctx = auth || {};
  if (ctx.mode && ctx.mode !== PIPELINE_LIVE_MODE) {
    return { authorized: false, reason: 'PIPELINE_LIVE_MODE_REQUIRED' };
  }
  if (ctx.platformOwnerVerified) {
    if (String(ctx.chatId || '') !== CHAT_ID) {
      return { authorized: false, reason: 'GROUP_REQUIRED' };
    }
    if (String(ctx.topicId || '') !== TOPIC_ID) {
      return { authorized: false, reason: 'TOPIC_389_REQUIRED' };
    }
    return { authorized: true };
  }
  if (String(ctx.telegramUserId || '') !== OWNER_ID) {
    return { authorized: false, reason: 'OWNER_REQUIRED' };
  }
  if (String(ctx.chatId || '') !== CHAT_ID) {
    return { authorized: false, reason: 'GROUP_REQUIRED' };
  }
  if (String(ctx.topicId || '') !== TOPIC_ID) {
    return { authorized: false, reason: 'TOPIC_389_REQUIRED' };
  }
  return { authorized: true };
}

function runbookCtx(auth) {
  return {
    telegramUserId: auth && auth.telegramUserId,
    chatId: auth && auth.chatId,
    topicId: auth && auth.topicId,
    messageId: (auth && auth.messageId) || null,
  };
}

function blocked(reason) {
  return { status: 'BLOCKED', reason, effects: { ...ZERO_EFFECTS } };
}

function safetySnapshot(ks) {
  return {
    killSwitch: ks.state,
    canSend: deps.killSwitch.canSend(ks.state),
    canSimulate: deps.killSwitch.canSimulate(ks.state),
    isPaused: deps.killSwitch.isPaused(ks.state),
    counts: {
      liveSends: ks.liveSends || 0,
      productionWrites: ks.productionWrites || 0,
      stageMovements: ks.stageMovements || 0,
    },
  };
}

// ---- Read-only tools (platform owner-gated; aggregated state only) ----

function getKillSwitchState() {
  const ks = deps.killSwitch.readKillSwitch();
  return {
    status: 'OK',
    state: ks.state,
    canSend: deps.killSwitch.canSend(ks.state),
    canSimulate: deps.killSwitch.canSimulate(ks.state),
    isPaused: deps.killSwitch.isPaused(ks.state),
    counts: { liveSends: ks.liveSends || 0, productionWrites: ks.productionWrites || 0, stageMovements: ks.stageMovements || 0 },
    file: deps.killSwitch.KILL_SWITCH_PATH,
    effects: { ...ZERO_EFFECTS },
  };
}

function getPipelineCurrentState() {
  const ks = deps.killSwitch.readKillSwitch();
  const planStore = new deps.PlanStore();
  const service = getRunbookService();
  const runbook = service.loadRunbook();
  const activePlanId = service.getActivePlanId();
  return {
    status: 'OK',
    mode: PIPELINE_LIVE_MODE,
    subsystem: 'certified',
    productionWrites: 'blocked',
    safety: safetySnapshot(ks),
    runbook: runbook
      ? { instructionId: runbook.instructionId, status: runbook.status, version: runbook.version, hashVerified: !runbook._hashMismatch }
      : null,
    plans: {
      pending: planStore.listPlans({ status: 'PREVIEW_PENDING_APPROVAL' }).length,
      approved: planStore.listPlans({ status: 'APPROVED_PENDING_EXECUTION' }).length,
      activePlanId,
    },
    provider: { provider: 'JustCall', sender: `+*******${deps.spec.SELECTED_SENDER_SUFFIX}`, tenDLC: 'APPROVED' },
    effects: { ...ZERO_EFFECTS },
  };
}

function getPipelineWorkSummary() {
  const ks = deps.killSwitch.readKillSwitch();
  const service = getRunbookService();
  const planStore = new deps.PlanStore();
  const activePlanId = service.getActivePlanId();
  const activePlan = activePlanId ? planStore.loadPlan(activePlanId) : null;
  return {
    status: 'OK',
    mode: PIPELINE_LIVE_MODE,
    safety: safetySnapshot(ks),
    activePlan: activePlan
      ? { planId: activePlan.planId, status: activePlan.status, selectedCount: activePlan.selectedCount, expiresAt: activePlan.expiresAt, executable: Boolean(activePlan.executable) }
      : null,
    availableTools: [
      'pipeline_current_state', 'pipeline_work_summary', 'pipeline_stage_guidance', 'pipeline_kayla_script',
      'pipeline_kill_switch', 'pipeline_pause', 'pipeline_dry_run', 'pipeline_provider_status',
      'pipeline_memory_provenance', 'pipeline_canary_candidates', 'pipeline_canary_preview',
      'pipeline_canary_review', 'pipeline_canary_expire', 'pipeline_canary_approve',
      'pipeline_canary_execute', 'pipeline_canary_reconcile', 'pipeline_record_correction',
      'pipeline_session_status',
    ],
    nextMilestones: ['Prepare the first supervised canary preview (owner in Pipeline topic 389)'],
    effects: { ...ZERO_EFFECTS },
  };
}

function getStageGuidance(profileId, stage) {
  if (profileId === 'PPC_EWA_BEACH') {
    const authority = loadPpcStageAuthority();
    const s = (authority.stages || []).find((x) => x.position === Number(stage));
    if (!s) return { status: 'BLOCKED', reason: 'INVALID_STAGE', validRange: `1-${authority.totalStages}`, effects: { ...ZERO_EFFECTS } };
    return {
      status: 'OK',
      profileId: 'PPC_EWA_BEACH',
      stage: s.position,
      name: s.name,
      semanticCategory: s.semanticCategory,
      outreachEligibility: s.outreachEligibility,
      nextExpectedAction: s.nextExpectedAction,
      courseSequence: s.courseSequence || null,
      automationPolicy: s.automationPolicy || null,
      humanWorkExpected: s.humanWorkExpected,
      automationExpected: s.automationExpected,
      terminal: s.terminal,
      allowedScripts: s.allowedScripts || [],
      permittedWrites: s.permittedWrites || [],
      prohibitedWrites: s.prohibitedWrites || [],
      confidence: s.confidence,
      provenance: s.provenance,
      effects: { ...ZERO_EFFECTS },
    };
  }
  let stages;
  try {
    stages = deps.spec.loadKaylaCourseSpec().stages;
  } catch (_) {
    stages = null;
  }
  const source = stages || deps.spec.STAGES || [];
  const s = source.find((x) => Number(x.order || x[0]) === Number(stage));
  if (!s) return { status: 'BLOCKED', reason: 'INVALID_STAGE', validRange: '1-21', effects: { ...ZERO_EFFECTS } };
  if (Array.isArray(s)) {
    return {
      status: 'OK',
      profileId: 'ATLAS_OUTBOUND',
      stage: Number(s[0]),
      name: s[1],
      mode: s[2],
      textShortcut: s[3],
      purpose: s[4],
      effects: { ...ZERO_EFFECTS },
    };
  }
  return {
    status: 'OK',
    profileId: 'ATLAS_OUTBOUND',
    stage: s.order,
    name: s.stageName,
    mode: s.mode,
    textShortcut: s.textShortcut,
    purpose: s.coursePurpose,
    allowedAutomation: s.allowedAutomation,
    effects: { ...ZERO_EFFECTS },
  };
}

function getKaylaScript(profileId, stage) {
  if (profileId === 'PPC_EWA_BEACH') {
    const authority = loadPpcStageAuthority();
    const s = (authority.stages || []).find((x) => x.position === Number(stage));
    if (!s) return { status: 'BLOCKED', reason: 'INVALID_STAGE', validRange: `1-${authority.totalStages}`, effects: { ...ZERO_EFFECTS } };
    const allowedScripts = s.allowedScripts || [];
    if (allowedScripts.length === 0) {
      return {
        status: 'OK',
        profileId: 'PPC_EWA_BEACH',
        stage: s.position,
        stageName: s.name,
        scripts: [],
        note: 'No PPC scripts defined for this stage.',
        effects: { ...ZERO_EFFECTS },
      };
    }
    let scriptAuthority;
    try {
      const fs = require('fs');
      scriptAuthority = JSON.parse(fs.readFileSync('C:/Users/mscott/AI_Workspace/prolificcapital/ghl-automations/profiles/ppc-ewa-beach/script-authority.json', 'utf8'));
    } catch (_) {
      scriptAuthority = { scripts: {} };
    }
    const scripts = allowedScripts.map((name) => {
      const def = (scriptAuthority.scripts || {})[name];
      return def ? { name, fullName: def.fullName, body: def.body, channel: def.channel, trigger: def.trigger, timing: def.timing, humanVsAutomated: def.humanVsAutomated, ownerApprovalRequired: def.ownerApprovalRequired, complianceRequirements: def.complianceRequirements || [] } : { name, note: 'Script definition not found in PPC script authority.' };
    });
    return {
      status: 'PREVIEW_ONLY',
      profileId: 'PPC_EWA_BEACH',
      stage: s.position,
      stageName: s.name,
      scripts,
      effects: { ...ZERO_EFFECTS },
    };
  }
  let spec;
  try {
    spec = deps.spec.loadKaylaCourseSpec();
  } catch (_) {
    spec = null;
  }
  const stages = (spec && spec.stages) || deps.spec.STAGES || [];
  const s = stages.find((x) => Number(x.order || x[0]) === Number(stage));
  if (!s) return { status: 'BLOCKED', reason: 'INVALID_STAGE', validRange: '1-21', effects: { ...ZERO_EFFECTS } };
  const shortcutName = Array.isArray(s) ? s[3] : s.textShortcut;
  const script = (spec && spec.shortcuts && spec.shortcuts.find((c) => c.name === shortcutName)) || null;
  return {
    status: 'PREVIEW_ONLY',
    profileId: 'ATLAS_OUTBOUND',
    stage: Number(Array.isArray(s) ? s[0] : s.order),
    stageName: Array.isArray(s) ? s[1] : s.stageName,
    shortcut: shortcutName || null,
    script: script ? script.body : null,
    senderName: 'Montelli',
    effects: { ...ZERO_EFFECTS },
  };
}

function getProviderStatus() {
  const ks = deps.killSwitch.readKillSwitch();
  return {
    status: 'OK',
    provider: 'JustCall',
    sender: `+*******${deps.spec.SELECTED_SENDER_SUFFIX}`,
    tenDLC: 'APPROVED',
    killSwitch: ks.state,
    sendsPossible: deps.killSwitch.canSend(ks.state),
    effects: { ...ZERO_EFFECTS },
  };
}

function getMemoryProvenance() {
  const corrections = deps.mem.getCorrections({ limit: 10 });
  return {
    status: 'OK',
    authority: deps.mem.AUTHORITY || null,
    recentCorrections: corrections.map((c) => ({
      memoryId: c.memoryId,
      text: c.text,
      scope: c.scope,
      supersedes: c.supersedes || null,
      createdAt: c.createdAt,
    })),
    preferences: deps.mem.getOwnerPreferences(),
    effects: { ...ZERO_EFFECTS },
  };
}

function listSafeCanaryCandidates() {
  const builder = new deps.CanaryPlanBuilder({
    profileId: 'ATLAS_OUTBOUND',
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
  });
  return builder
    .buildPreview({
      now: new Date(),
      ownerId: OWNER_ID,
      chatId: CHAT_ID,
      topicId: Number(TOPIC_ID),
      runbookId: RUNBOOK_ID,
      runbookHash: RUNBOOK_CANONICAL_HASH,
    })
    .then((plan) => ({
      status: 'OK',
      count: plan.selectedCount,
      totalCandidates: plan.totalCandidates,
      blockedCount: plan.blockedCount,
      blockerDistribution: plan.blockerDistribution,
      previewPlanId: plan.planId,
      constraints: {
        maxCanary: 3,
        sendWindow: 'Monday-Friday 12:00 PM - 6:00 PM property-local time',
        noPriorOutreach: true,
        noDncStop: true,
        rolePriority: 'agent > broker > owner',
      },
      effects: { ...ZERO_EFFECTS },
    }))
    .catch((err) => ({ status: 'BLOCKED', reason: err.message || String(err), effects: { ...ZERO_EFFECTS } }));
}

function reviewCanaryPlan(planId) {
  const planStore = new deps.PlanStore();
  const plan = planStore.loadPlan(planId);
  if (!plan) return blocked('PLAN_NOT_FOUND');
  return {
    status: 'OK',
    planId: plan.planId,
    planHash: plan.planHash,
    planStatus: plan.status,
    executable: Boolean(plan.executable),
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    selectedCount: plan.selectedCount,
    totalCandidates: plan.totalCandidates,
    items: (plan.items || []).map((i) => ({
      number: i.number,
      contactName: i.contactName,
      contactRole: i.contactRole,
      propertyAddress: i.propertyAddress,
      timezone: i.timezone,
      renderedMessage: i.renderedMessage,
    })),
    persisted: planStore.planPath(planId),
    effects: { ...ZERO_EFFECTS },
  };
}

function getCanaryReconciliation(planId) {
  const planStore = new deps.PlanStore();
  const plan = planStore.loadPlan(planId);
  if (plan) {
    const items = plan.items || [];
    const executed = (plan.executionResults || []).filter((r) => r && typeof r.ok === 'boolean');
    return {
      status: 'OK',
      planId,
      planStatus: plan.status,
      total: items.length,
      sent: executed.filter((r) => r.ok).length,
      failed: executed.filter((r) => !r.ok).length,
      pending: items.length - executed.length,
      executionResults: executed,
      effects: { ...ZERO_EFFECTS },
    };
  }
  const executorPlan = deps.executor.loadCanaryPlan(planId);
  if (executorPlan) {
    return { status: 'OK', ...deps.executor.reconcileCanaryPlan(executorPlan), effects: { ...ZERO_EFFECTS } };
  }
  return blocked('PLAN_NOT_FOUND');
}

// ---- Auth-gated state-changing / context methods ----

function pauseOutreach(auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ks = deps.killSwitch.readKillSwitch();
  if (!deps.killSwitch.transitionAllowed(ks.state, 'PAUSED', auth.telegramUserId, [], OWNER_ID)) {
    return blocked('TRANSITION_NOT_ALLOWED');
  }
  const updated = deps.killSwitch.writeKillSwitch('PAUSED');
  return { status: 'PAUSED', state: updated.state, effects: { ...ZERO_EFFECTS } };
}

function enableDryRun(auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ks = deps.killSwitch.readKillSwitch();
  if (!deps.killSwitch.transitionAllowed(ks.state, 'DRY_RUN_ONLY', auth.telegramUserId, [], OWNER_ID)) {
    return blocked('TRANSITION_NOT_ALLOWED');
  }
  const updated = deps.killSwitch.writeKillSwitch('DRY_RUN_ONLY');
  return { status: 'DRY_RUN_ONLY', state: updated.state, effects: { ...ZERO_EFFECTS } };
}

function recordCorrection(text, scope, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (!text || !String(text).trim()) return blocked('CORRECTION_TEXT_REQUIRED');
  const entry = deps.mem.recordCorrection(String(text).trim(), scope || 'general', auth.chatId, auth.telegramUserId);
  return { status: 'RECORDED', memoryId: entry.memoryId, scope: entry.scope, effects: { ...ZERO_EFFECTS } };
}

async function createCanaryPreview(records, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const service = getRunbookService();
  const result = await service.beginPreparation(runbookCtx(auth));
  if (!result.plan) {
    return { status: 'PREVIEW_FAILED', reason: result.reply, effects: { ...ZERO_EFFECTS } };
  }
  const plan = result.plan;
  return {
    status: 'PREVIEW_READY',
    planId: plan.planId,
    planHash: plan.planHash,
    executable: false,
    planStatus: plan.status,
    expiresAt: plan.expiresAt,
    selectedCount: plan.selectedCount,
    totalCandidates: plan.totalCandidates,
    items: (plan.items || []).map((i) => ({
      number: i.number,
      contactName: i.contactName,
      contactRole: i.contactRole,
      propertyAddress: i.propertyAddress,
      timezone: i.timezone,
      renderedMessage: i.renderedMessage,
      guardStates: Object.fromEntries(Object.entries(i.guardEvidence || {}).map(([k, v]) => [k, v.state])),
    })),
    persisted: `data/production-plans/${plan.planId}.json`,
    reply: result.reply,
    effects: { ...ZERO_EFFECTS },
  };
}

async function expireCanaryPlan(planId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const service = getRunbookService();
  const result = await service.handleCancel(planId, runbookCtx(auth));
  return { status: 'EXPIRED_OR_CANCELLED', planId, reply: result.reply, effects: { ...ZERO_EFFECTS } };
}

async function approveCanaryPlan(planId, itemNumbers, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const numbers = (itemNumbers || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1);
  if (numbers.length === 0) return blocked('ITEM_NUMBERS_REQUIRED');
  const approvalText = `Send items ${numbers.join(', ')}`;
  const service = getRunbookService();
  const result = await service.handleApproval(planId, approvalText, runbookCtx(auth));
  if (!result.approval) {
    return { status: 'APPROVAL_BLOCKED', reason: result.reply, planId, effects: { ...ZERO_EFFECTS } };
  }
  return {
    status: 'APPROVED',
    planId,
    approvalId: result.approval.approvalId,
    approvalHash: result.approval.approvalHash,
    items: result.approval.selectedItems,
    executable: false,
    reply: result.reply,
    effects: { ...ZERO_EFFECTS },
  };
}

async function executeCanary(planId, itemNumber, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ks = deps.killSwitch.readKillSwitch();
  if (!deps.killSwitch.canSend(ks.state)) {
    return blocked(`KILL_SWITCH_BLOCKS_SEND: current state is ${ks.state}`);
  }
  const result = await deps.executor.executeApprovedPlan(planId, [Number(itemNumber)], {
    planStore: new deps.PlanStore(),
    approvalStore: new deps.ApprovalStore(),
  });
  if (!result.ok) return blocked(result.error);
  return {
    status: 'EXECUTED',
    planId,
    itemNumber: Number(itemNumber),
    results: (result.results || []).map((r) => ({ itemNumber: r.item ? r.item.number : null, ok: r.ok, error: r.error || null })),
    effects: { providerSends: (result.results || []).filter((r) => r.ok).length, ghlWrites: 0, stageMovements: 0 },
  };
}

function getSessionStatus(auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ks = deps.killSwitch.readKillSwitch();
  const service = getRunbookService();
  const planStore = new deps.PlanStore();
  const activePlanId = service.getActivePlanId();
  const activePlan = activePlanId ? planStore.loadPlan(activePlanId) : null;
  return {
    status: 'OK',
    mode: PIPELINE_LIVE_MODE,
    session: { ownerId: String(auth.telegramUserId), chatId: String(auth.chatId), topicId: String(auth.topicId) },
    safety: { killSwitch: ks.state, canSend: deps.killSwitch.canSend(ks.state) },
    activePlan: activePlan
      ? { planId: activePlan.planId, status: activePlan.status, expiresAt: activePlan.expiresAt, executable: Boolean(activePlan.executable) }
      : null,
    effects: { ...ZERO_EFFECTS },
  };
}

// ---- PPC Read-Only Tools ----

async function pipelineReadOpportunity(profileId, opportunityId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');
  const res = await ghlGet(token, `/opportunities/${opportunityId}`);
  const opp = res.body?.opportunity || res.body;
  if (!opp || !opp.id) return blocked('OPPORTUNITY_NOT_FOUND');
  if (opp.locationId !== ctx.locationId || opp.pipelineId !== ctx.pipelineId) {
    return blocked('CROSS_PROFILE_OPPORTUNITY');
  }
  const stageId = opp.pipelineStageId || '';
  let stageName = null;
  if (ctx.profileId === 'PPC_EWA_BEACH') {
    const authority = loadPpcStageAuthority();
    const stage = (authority.stages || []).find((s) => s.stageId === stageId);
    if (stage) stageName = stage.name;
  }
  return {
    status: 'OK',
    profileId: ctx.profileId,
    locationId: ctx.locationId,
    pipelineId: ctx.pipelineId,
    opportunityId: opp.id,
    contactId: opp.contactId || opp.contact_id || null,
    contactTags: (opp.contact && opp.contact.tags) || [],
    currentStageId: stageId,
    currentStageName: stageName || null,
    opportunityName: opp.name || null,
    opportunityStatus: opp.status || null,
    monetaryValue: opp.monetaryValue ?? opp.monetary_value ?? null,
    assignedTo: opp.assignedTo || null,
    effects: { ...ZERO_EFFECTS },
  };
}

async function pipelineSearchOpportunities(profileId, query, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');
  const q = query || {};
  let path = `/opportunities/search?location_id=${encodeURIComponent(ctx.locationId)}&pipeline_id=${encodeURIComponent(ctx.pipelineId)}&limit=50`;
  if (q.stageId) path += `&pipeline_stage_id=${encodeURIComponent(q.stageId)}`;
  if (q.contactId) path += `&contact_id=${encodeURIComponent(q.contactId)}`;
  if (q.query) path += `&q=${encodeURIComponent(q.query)}`;
  const res = await ghlGet(token, path);
  if (!res.body || !res.body.opportunities) return blocked('SEARCH_FAILED');
  const items = (res.body.opportunities || []).map((opp) => {
    const stageId = opp.pipelineStageId || opp.pipeline_stage_id || '';
    let stageName = null;
    if (ctx.profileId === 'PPC_EWA_BEACH') {
      const authority = loadPpcStageAuthority();
      const stage = (authority.stages || []).find((s) => s.stageId === stageId);
      if (stage) stageName = stage.name;
    }
    return {
      opportunityId: opp.id,
      contactId: opp.contactId || opp.contact_id || null,
      currentStageId: stageId,
      currentStageName: stageName || null,
      opportunityName: opp.name || null,
      opportunityStatus: opp.status || null,
    };
  });
  return {
    status: 'OK',
    profileId: ctx.profileId,
    locationId: ctx.locationId,
    pipelineId: ctx.pipelineId,
    count: items.length,
    total: res.body.total || items.length,
    items,
    effects: { ...ZERO_EFFECTS },
  };
}

function pipelineListStages(profileId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  if (ctx.profileId !== 'PPC_EWA_BEACH') {
    return blocked('PPC_STAGE_LIST_ONLY_AVAILABLE_FOR_PPC');
  }
  const authority = loadPpcStageAuthority();
  const stages = (authority.stages || []).map((s) => ({
    position: s.position,
    stageId: s.stageId,
    name: s.name,
    semanticCategory: s.semanticCategory,
    terminal: s.terminal,
    outreachEligibility: s.outreachEligibility,
  }));
  return {
    status: 'OK',
    profileId: ctx.profileId,
    pipelineId: ctx.pipelineId,
    pipelineName: authority.pipelineName || 'Inbound PPC',
    totalStages: authority.totalStages,
    populatedStages: authority.populatedStages,
    stages,
    effects: { ...ZERO_EFFECTS },
  };
}

// ---- PPC Owner-Directed Stage Move ----

async function pipelineMoveStage(profileId, opportunityId, targetStage, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  if (ctx.profileId !== 'PPC_EWA_BEACH') {
    return blocked('STAGE_MOVE_ONLY_SUPPORTED_FOR_PPC');
  }
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');

  const oppRes = await ghlGet(token, `/opportunities/${opportunityId}`);
  const opp = oppRes.body?.opportunity || oppRes.body;
  if (!opp || !opp.id) return blocked('OPPORTUNITY_NOT_FOUND');
  if (opp.locationId !== ctx.locationId || opp.pipelineId !== ctx.pipelineId) {
    return blocked('CROSS_PROFILE_OPPORTUNITY');
  }

  const oldStageId = opp.pipelineStageId || '';
  const stageRes = resolvePpcStage(targetStage);
  if (!stageRes.resolved) return blocked(stageRes.reason);
  const targetStageId = stageRes.stage.stageId;
  if (targetStageId === oldStageId) {
    return { status: 'NO_OP', reason: 'ALREADY_AT_TARGET_STAGE', opportunityId, currentStageId: oldStageId, targetStageId, effects: { ...ZERO_EFFECTS } };
  }

  const beforeSnapshot = {
    opportunityId: opp.id,
    contactId: opp.contactId || opp.contact_id || null,
    name: opp.name || null,
    status: opp.status || null,
    monetaryValue: opp.monetaryValue ?? opp.monetary_value ?? null,
    assignedTo: opp.assignedTo || null,
    oldStageId,
  };

  const patchResult = await ghlPut(token, `/opportunities/${opportunityId}`, { pipelineStageId: targetStageId });
  if (patchResult.status < 200 || patchResult.status >= 300) {
    return { status: 'WRITE_UNCERTAIN_NO_RETRY', reason: `GHL_PATCH_FAILED: ${patchResult.status}`, opportunityId, oldStageId, targetStageId, effects: { ...ZERO_EFFECTS } };
  }

  const readbackRes = await ghlGet(token, `/opportunities/${opportunityId}`);
  const readback = readbackRes.body?.opportunity || readbackRes.body;
  if (!readback || !readback.id) {
    return { status: 'WRITE_UNCERTAIN_NO_RETRY', reason: 'READBACK_FAILED', opportunityId, oldStageId, targetStageId, effects: { ...ZERO_EFFECTS } };
  }

  const newStageId = readback.pipelineStageId || '';
  const sideEffects = {
    contactIdChanged: (readback.contactId || readback.contact_id || null) !== beforeSnapshot.contactId,
    nameChanged: (readback.name || null) !== beforeSnapshot.name,
    statusChanged: (readback.status || null) !== beforeSnapshot.status,
    monetaryValueChanged: (readback.monetaryValue ?? readback.monetary_value ?? null) !== beforeSnapshot.monetaryValue,
    assignedToChanged: (readback.assignedTo || null) !== beforeSnapshot.assignedTo,
  };
  const hasSideEffects = Object.values(sideEffects).some(Boolean);

  let newStageName = null;
  if (ctx.profileId === 'PPC_EWA_BEACH') {
    const authority = loadPpcStageAuthority();
    const stage = (authority.stages || []).find((s) => s.stageId === newStageId);
    if (stage) newStageName = stage.name;
  }

  return {
    status: hasSideEffects ? 'STAGE_MOVED_WITH_UNEXPECTED_SIDE_EFFECTS' : 'STAGE_MOVED',
    profileId: ctx.profileId,
    opportunityId,
    oldStageId: beforeSnapshot.oldStageId,
    newStageId,
    newStageName: newStageName || null,
    targetStageId,
    stageMatch: newStageId === targetStageId,
    sideEffects,
    effects: { providerSends: 0, ghlWrites: 1, stageMovements: 1 },
  };
}

// ---- PPC Call Queue ----

const PPC_CALL_QUEUE_PRIORITY = Object.freeze([
  { queue: 1, label: 'New Leads', stageIds: ['d31c50be-0148-4769-b3bd-cf32c2a16bff'], reason: 'First contact — highest priority' },
  { queue: 2, label: 'First No-Answer', stageIds: ['1a0d789b-c11d-47a2-9152-6a7ce07dc833'], reason: 'One call attempted, no answer — retry' },
  { queue: 3, label: 'Second No-Answer', stageIds: ['f03f27b9-f3c1-4534-b07e-8cc3c9186f7a'], reason: 'Two calls attempted, no answer — final attempt' },
  { queue: 4, label: 'Awaiting Photos', stageIds: ['0bac4afa-7cd0-4019-84ad-6f2a2dc33422'], reason: 'Contacted, awaiting property photos' },
  { queue: 5, label: 'Active Pipeline', stageIds: [
    '5147c1cf-0a9f-450a-86d8-02e9c75db4e5', '0b1c890d-3aa8-4efd-836d-35e7e34cda71',
    '3dacb3fc-3b4c-44d8-b9ab-035cd00affec', 'f2477c53-33fd-4d43-8e6d-9602acea1b29',
    'd708b2ef-f165-45d2-be87-7f54168a5229', '64e95e56-7cb7-41a9-a41c-39bbb860f47b',
    '956b8f91-ff30-47da-93db-3ea1c6ddb3d8', '01c72a0c-3b1d-4044-87af-5f1effd7cc05',
    '2da16bfe-a6c1-4db0-9168-4d1e24a31224', '6f3f0d9d-94bc-4f6f-a818-43ff67daa1da',
    'bc3ba84e-e2e8-47ed-aa2f-d7ebcff5c67c', 'c105ac70-54bb-4f24-8e18-0944d8838ec4',
    'e2c0f6fd-78a7-40a0-86c3-75dfd7f7154c', '9d6055d4-ee83-4d66-a040-25839088a842',
    'b2633c5b-b9b3-46fe-b443-2f1e3733f1be', '0ee5dd0b-452c-42a8-9108-c785b70cdbc9',
    '0f5e612a-098a-412e-b525-0b03228d9539',
  ], reason: 'Active deal progression' },
  { queue: 6, label: 'Ghosted / Stalled', stageIds: ['09033988-d393-45f4-922b-a822b1d79045'], reason: 'Interested but unresponsive — periodic follow-up' },
  { queue: 7, label: 'Salvage / Reactivation', stageIds: [
    '65f819d1-cca3-4d9f-b0ab-d68da038dab3', '1e91c3bd-046b-415b-92a7-dd3e68eb5792',
    'b68533d0-239b-478d-bcec-d4a570f951e1', '021339c8-15ea-459b-8120-bd76ebe802cb',
    '6b8304d7-1d63-475e-ba7e-7fbefeabbedb',
  ], reason: 'Closed/lost — salvage if owner policy allows' },
]);

const PPC_CALL_QUEUE_EXCLUDED_STAGE_IDS = Object.freeze([
  '8612fe47-5020-4286-bb66-89e2cd1f544b', 'acf40262-df1f-4632-932b-efef7ea2ee18', 'a5e1a75d-4d47-4212-995a-ffe9dd00fe43',
]);

const PPC_CALL_QUEUE_EXCLUDED_TAGS = Object.freeze([
  'do_not_contact_prospect', 'owner_controlled_test', 'pipeline_stage_certification',
]);

const PPC_CALL_GUARD_BLOCK_CALL = Object.freeze(['DNC', 'BAD_NUMBER', 'PENDING_REPLY', 'ACTIVE_HUMAN_WORK', 'DUPLICATE_HISTORY', 'PROVIDER_UNCERTAINTY']);
const PPC_CALL_GUARD_BLOCK_SMS_ONLY = Object.freeze(['LANDLINE', 'CONSENT']);
const PPC_CALL_GUARD_BLOCK_FIRST_CONTACT = Object.freeze(['PRIOR_CONTACT']);

function evaluatePpcCallEligibility(opp) {
  const tags = (opp.contact && opp.contact.tags) || [];
  const stageId = opp.pipelineStageId || opp.pipeline_stage_id || '';
  const assignedTo = opp.assignedTo || null;
  const contactName = (opp.contact && opp.contact.name) || null;
  const contactPhone = (opp.contact && opp.contact.phone) || null;
  const contactDnd = Boolean(opp.contact && opp.contact.dnd);
  const contactWrongNumber = Boolean(opp.contact && opp.contact.wrongNumber);

  const guards = [];
  let callEligible = true;
  let smsEligible = true;
  let reason = null;

  if (tags.some((t) => PPC_CALL_QUEUE_EXCLUDED_TAGS.includes(t))) {
    return { callEligible: false, smsEligible: false, reason: 'TEST_ARTIFACT', guards: [{ guard: 'TEST_ARTIFACT', action: 'BLOCK', channel: 'BOTH' }] };
  }

  if (PPC_CALL_QUEUE_EXCLUDED_STAGE_IDS.includes(stageId)) {
    return { callEligible: false, smsEligible: false, reason: 'TERMINAL_STAGE', guards: [{ guard: 'TERMINAL_STAGE', action: 'BLOCK', channel: 'BOTH' }] };
  }

  if (contactDnd || tags.includes('DNC') || tags.includes('do_not_call')) {
    callEligible = false;
    smsEligible = false;
    guards.push({ guard: 'DNC', action: 'BLOCK', channel: 'BOTH' });
  }

  if (tags.includes('STOP') || tags.includes('opt_out') || tags.includes('sms_opt_out')) {
    smsEligible = false;
    guards.push({ guard: 'STOP_OPT_OUT', action: 'BLOCK_SMS', channel: 'SMS' });
  }

  if (contactWrongNumber || tags.includes('wrong_number') || tags.includes('bad_number') || tags.includes('invalid_number')) {
    callEligible = false;
    smsEligible = false;
    guards.push({ guard: 'BAD_NUMBER', action: 'BLOCK', channel: 'BOTH' });
  }

  if (tags.includes('landline')) {
    smsEligible = false;
    guards.push({ guard: 'LANDLINE', action: 'BLOCK_SMS', channel: 'SMS' });
  }

  if (tags.includes('pending_reply') || tags.includes('awaiting_reply')) {
    callEligible = false;
    smsEligible = false;
    guards.push({ guard: 'PENDING_REPLY', action: 'BLOCK', channel: 'BOTH' });
  }

  if (tags.includes('active_human_work') || tags.includes('in_progress')) {
    callEligible = false;
    smsEligible = false;
    guards.push({ guard: 'ACTIVE_HUMAN_WORK', action: 'BLOCK', channel: 'BOTH' });
  }

  if (assignedTo && assignedTo !== 'PGfXxlXCRXs3hXN3Gq7R') {
    callEligible = false;
    smsEligible = false;
    guards.push({ guard: 'ACTIVE_HUMAN_WORK', action: 'BLOCK', channel: 'BOTH', detail: `Assigned to ${assignedTo}, not Montelli` });
  }

  if (stageId === 'd31c50be-0148-4769-b3bd-cf32c2a16bff') {
    callEligible = false;
    smsEligible = false;
    guards.push({ guard: 'FIRST_CONTACT_POLICY_BLOCKED', action: 'BLOCK', channel: 'BOTH', detail: 'PIN automation blocked pending consent verification. Owner must decide manual first-contact process.' });
  }

  if (!contactPhone || contactPhone.length < 10) {
    callEligible = false;
    smsEligible = false;
    guards.push({ guard: 'NO_PHONE', action: 'BLOCK', channel: 'BOTH' });
  }

  if (!callEligible && !reason) reason = guards.filter((g) => g.action === 'BLOCK' && g.channel === 'BOTH').map((g) => g.guard).join(', ');
  if (!reason) reason = 'CLEARED';

  return { callEligible, smsEligible, reason, guards };
}

function getPpcCallQueuePriority(stageId) {
  for (const q of PPC_CALL_QUEUE_PRIORITY) {
    if (q.stageIds.includes(stageId)) return q;
  }
  return null;
}

async function getPpcCallQueue(profileId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (profileId !== 'PPC_EWA_BEACH') return blocked('CALL_QUEUE_PPC_ONLY');
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');

  const allOpps = [];
  let startAfter = null;
  const limit = 50;
  while (true) {
    let path = `/opportunities/search?location_id=${encodeURIComponent(ctx.locationId)}&pipeline_id=${encodeURIComponent(ctx.pipelineId)}&limit=${limit}`;
    if (startAfter) path += `&startAfter=${encodeURIComponent(startAfter)}`;
    const res = await ghlGet(token, path);
    const opps = (res.body && res.body.opportunities) || [];
    allOpps.push(...opps);
    if (opps.length < limit) break;
    startAfter = opps[opps.length - 1].id;
  }

  const authority = loadPpcStageAuthority();
  const queues = {};
  for (const q of PPC_CALL_QUEUE_PRIORITY) {
    queues[q.queue] = { queue: q.queue, label: q.label, reason: q.reason, stageEligible: 0, contactEligible: 0, items: [] };
  }

  const exclusionCounts = {
    testArtifact: 0, terminal: 0, dnc: 0, stopOptOut: 0, badNumber: 0,
    landline: 0, pendingReply: 0, activeHumanWork: 0, firstContactPolicyBlocked: 0,
    noPhone: 0, noStage: 0, other: 0,
  };

  for (const opp of allOpps) {
    if (!isExpectedPpcOpportunity(opp)) {
      continue;
    }
    const stageId = opp.pipelineStageId || opp.pipeline_stage_id || '';
    if (!stageId) { exclusionCounts.noStage++; continue; }
    const eligibility = evaluatePpcCallEligibility(opp);
    const priority = getPpcCallQueuePriority(stageId);
    if (!priority) continue;

    const stage = (authority.stages || []).find((s) => s.stageId === stageId);
    const item = {
      opportunityId: opp.id,
      contactId: opp.contactId || opp.contact_id || null,
      locationId: opp.locationId || null,
      pipelineId: opp.pipelineId || null,
      contactName: (opp.contact && opp.contact.name) || null,
      contactPhone: (opp.contact && opp.contact.phone) || null,
      currentStageId: stageId,
      currentStageName: stage ? stage.name : null,
      opportunityName: opp.name || null,
      opportunityStatus: opp.status || null,
      monetaryValue: opp.monetaryValue ?? opp.monetary_value ?? null,
      assignedTo: opp.assignedTo || null,
      createdAt: opp.createdAt || null,
      lastActionDate: opp.lastActionDate || null,
      lastStageChangeAt: opp.lastStageChangeAt || null,
      callEligible: eligibility.callEligible,
      smsEligible: eligibility.smsEligible,
      eligibilityReason: eligibility.reason,
      eligibilityGuards: eligibility.guards,
    };

    queues[priority.queue].stageEligible++;
    if (eligibility.callEligible) {
      queues[priority.queue].contactEligible++;
    }

    for (const g of eligibility.guards) {
      switch (g.guard) {
        case 'TEST_ARTIFACT': exclusionCounts.testArtifact++; break;
        case 'TERMINAL_STAGE': exclusionCounts.terminal++; break;
        case 'DNC': exclusionCounts.dnc++; break;
        case 'STOP_OPT_OUT': exclusionCounts.stopOptOut++; break;
        case 'BAD_NUMBER': exclusionCounts.badNumber++; break;
        case 'LANDLINE': exclusionCounts.landline++; break;
        case 'PENDING_REPLY': exclusionCounts.pendingReply++; break;
        case 'ACTIVE_HUMAN_WORK': exclusionCounts.activeHumanWork++; break;
        case 'FIRST_CONTACT_POLICY_BLOCKED': exclusionCounts.firstContactPolicyBlocked++; break;
        case 'NO_PHONE': exclusionCounts.noPhone++; break;
        default: exclusionCounts.other++; break;
      }
    }

    queues[priority.queue].items.push(item);
  }

  const result = Object.values(queues).filter((q) => q.stageEligible > 0);
  const totalStageEligible = result.reduce((sum, q) => sum + q.stageEligible, 0);
  const totalContactEligible = result.reduce((sum, q) => sum + q.contactEligible, 0);
  return {
    status: 'OK',
    profileId: ctx.profileId,
    totalPipeline: allOpps.length,
    totalStageEligible,
    totalContactEligible,
    exclusionCounts,
    queues: result,
    effects: { ...ZERO_EFFECTS },
  };
}

async function getPpcCallCard(profileId, opportunityId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (profileId !== 'PPC_EWA_BEACH') return blocked('CALL_CARD_PPC_ONLY');
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');

  const res = await ghlGet(token, `/opportunities/${opportunityId}`);
  const opp = res.body?.opportunity || res.body;
  if (!opp || !opp.id) return blocked('OPPORTUNITY_NOT_FOUND');
  if (opp.locationId !== ctx.locationId || opp.pipelineId !== ctx.pipelineId) {
    return blocked('CROSS_PROFILE_OPPORTUNITY');
  }
  if ((opp.contact && opp.contact.locationId) && opp.contact.locationId !== ctx.locationId) {
    return blocked('CALL_CARD_CONTACT_LOCATION_MISMATCH');
  }

  const tags = (opp.contact && opp.contact.tags) || [];
  if (tags.some((t) => PPC_CALL_QUEUE_EXCLUDED_TAGS.includes(t))) {
    return blocked('TEST_ARTIFACT_EXCLUDED_FROM_CALL_QUEUE');
  }

  const stageId = opp.pipelineStageId || '';
  const authority = loadPpcStageAuthority();
  const stage = (authority.stages || []).find((s) => s.stageId === stageId);
  const priority = getPpcCallQueuePriority(stageId);

  let scriptAuthority;
  try {
    const fs = require('fs');
    scriptAuthority = JSON.parse(fs.readFileSync('C:/Users/mscott/AI_Workspace/prolificcapital/ghl-automations/profiles/ppc-ewa-beach/script-authority.json', 'utf8'));
  } catch (_) {
    scriptAuthority = { scripts: {}, firstContactChannel: {} };
  }

  const allowedScripts = stage ? (stage.allowedScripts || []) : [];
  const scripts = allowedScripts.map((name) => {
    const def = (scriptAuthority.scripts || {})[name];
    return def ? { name, fullName: def.fullName, body: def.body, channel: def.channel, timing: def.timing, humanVsAutomated: def.humanVsAutomated } : { name, note: 'Script definition not found.' };
  });

  const possibleOutcomes = [];
  if (stageId === 'd31c50be-0148-4769-b3bd-cf32c2a16bff') {
    possibleOutcomes.push(
      { outcome: 'Answered — seller engaged', nextStage: 'Called Once, No Answer', nextStageId: '1a0d789b-c11d-47a2-9152-6a7ce07dc833', note: 'After call, move here if follow-up needed' },
      { outcome: 'Answered — sending photos', nextStage: 'Awaiting Photos', nextStageId: '0bac4afa-7cd0-4019-84ad-6f2a2dc33422', note: 'Seller agreed to send property photos' },
      { outcome: 'No answer', nextStage: 'Called Once, No Answer', nextStageId: '1a0d789b-c11d-47a2-9152-6a7ce07dc833', note: 'No answer on first attempt' },
      { outcome: 'Wrong number / bad number', nextStage: 'Changed Number - Find on Batch', nextStageId: '1e91c3bd-046b-415b-92a7-dd3e68eb5792', note: 'Number is disconnected or wrong person' },
      { outcome: 'Not interested', nextStage: 'Changed Mind', nextStageId: '021339c8-15ea-459b-8120-bd76ebe802cb', note: 'Seller declined to proceed' },
    );
  } else if (stageId === '1a0d789b-c11d-47a2-9152-6a7ce07dc833') {
    possibleOutcomes.push(
      { outcome: 'Answered — seller engaged', nextStage: 'Awaiting Photos', nextStageId: '0bac4afa-7cd0-4019-84ad-6f2a2dc33422', note: 'Contact made, seller sending photos' },
      { outcome: 'No answer again', nextStage: 'Called Another Day, No Answer', nextStageId: 'f03f27b9-f3c1-4534-b07e-8cc3c9186f7a', note: 'Second no-answer attempt' },
    );
  }

  return {
    status: 'OK',
    profileId: ctx.profileId,
    locationId: ctx.locationId,
    opportunityId: opp.id,
    contactId: opp.contactId || opp.contact_id || null,
    contactName: (opp.contact && opp.contact.name) || null,
    contactPhone: (opp.contact && opp.contact.phone) || null,
    contactEmail: (opp.contact && opp.contact.email) || null,
    contactTags: tags,
    currentStageId: stageId,
    currentStageName: stage ? stage.name : null,
    opportunityName: opp.name || null,
    opportunityStatus: opp.status || null,
    monetaryValue: opp.monetaryValue ?? opp.monetary_value ?? null,
    assignedTo: opp.assignedTo || null,
    createdAt: opp.createdAt || null,
    lastActionDate: opp.lastActionDate || null,
    lastStageChangeAt: opp.lastStageChangeAt || null,
    queuePriority: priority ? priority.queue : null,
    queueLabel: priority ? priority.label : null,
    queueReason: priority ? priority.reason : null,
    courseSequence: stage ? (stage.courseSequence || null) : null,
    automationPolicy: stage ? (stage.automationPolicy || null) : null,
    nextExpectedAction: stage ? stage.nextExpectedAction : null,
    allowedScripts: scripts,
    possibleOutcomes,
    effects: { ...ZERO_EFFECTS },
  };
}

async function getPpcRecentCall(profileId, contactPhone, auth, selectedAt) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (profileId !== 'PPC_EWA_BEACH') return blocked('RECENT_CALL_PPC_ONLY');

  let jcKey = ''; let jcSecret = '';
  try {
    const fs = require('fs');
    const envContent = fs.readFileSync('C:/Users/mscott/AI_Workspace/prolificcapital/secrets/.env', 'utf8');
    for (const line of envContent.split('\n')) {
      if (line.startsWith('JUSTCALL_API_KEY=')) jcKey = line.split('=').slice(1).join('=').trim();
      if (line.startsWith('JUSTCALL_API_SECRET=')) jcSecret = line.split('=').slice(1).join('=').trim();
    }
  } catch (_) {
    return blocked('NO_JUSTCALL_CREDENTIALS');
  }
  if (!jcKey || !jcSecret) return blocked('NO_JUSTCALL_CREDENTIALS');

  const https = require('https');
  function jcGet(pathname) {
    return new Promise((resolve) => {
      const opts = { hostname: 'api.justcall.io', path: pathname, method: 'GET', headers: { 'Authorization': jcKey + ':' + jcSecret, 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 15000 };
      const req = https.request(opts, (res) => { let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch (_) { resolve({ status: res.statusCode, body: data }); } }); });
      req.on('error', (e) => resolve({ status: 0, body: null, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null, error: 'timeout' }); });
      req.end();
    });
  }

  const normalizedPhone = (contactPhone || '').replace(/\D/g, '');
  const callsRes = await jcGet('/v2.1/calls?per_page=10&direction=OUTGOING');
  const calls = (callsRes.body && callsRes.body.data) || [];

  const SELECTED_AT_TOLERANCE_SECONDS = 60;
  let selectedAtMs = 0;
  if (selectedAt) {
    selectedAtMs = typeof selectedAt === 'number' ? selectedAt : new Date(selectedAt).getTime();
  }

  let matchedCall = null;
  for (const call of calls) {
    const callTo = (call.contact_number || call.to || '').replace(/\D/g, '');
    if (callTo !== normalizedPhone && callTo !== normalizedPhone.replace(/^1/, '')) continue;

    if (selectedAtMs > 0) {
      const callDate = call.call_date || '';
      const callTime = call.call_time || '';
      const callDateTime = callDate && callTime ? new Date(callDate + 'T' + callTime + 'Z').getTime() : 0;
      if (callDateTime > 0 && callDateTime < (selectedAtMs - SELECTED_AT_TOLERANCE_SECONDS * 1000)) {
        continue;
      }
    }

    matchedCall = call;
    break;
  }

  if (!matchedCall) {
    return { status: 'OK', profileId, found: false, message: 'No fresh JustCall call found for this phone number after the seller was selected.', effects: { ...ZERO_EFFECTS } };
  }

  const callDetail = matchedCall;
  const callInfo = callDetail.call_info || {};
  const callDuration = callDetail.call_duration || {};

  return {
    status: 'OK',
    profileId,
    found: true,
    callId: callDetail.id,
    callSid: callDetail.call_sid || null,
    direction: (callInfo.direction || 'Outgoing').toLowerCase(),
    fromNumber: callDetail.justcall_number || null,
    toNumber: callDetail.contact_number || null,
    answered: (callInfo.type || '').toLowerCase() === 'answered',
    status: callInfo.status || null,
    disposition: callInfo.disposition || null,
    duration: callDuration.total_duration || 0,
    friendlyDuration: callDuration.friendly_duration || null,
    ringTime: callDuration.ring_time || 0,
    conversationTime: callDuration.conversation_time || 0,
    recordingUrl: callInfo.recording || null,
    transcriptAvailable: false,
    transcriptNote: 'AI Review Assist add-on required for transcript access',
    callDate: callDetail.call_date || null,
    callTime: callDetail.call_time || null,
    agentName: callDetail.agent_name || null,
    justcallLineName: callDetail.justcall_line_name || null,
    contactName: callDetail.contact_name || null,
    effects: { ...ZERO_EFFECTS },
  };
}

async function getPpcCallingDeskStatus(auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);

  let state;
  try {
    const deskState = require('../modules/calling-desk-state.js');
    state = deskState.loadCallingDeskState();
  } catch (_) {
    state = null;
  }

  let safeCallable = null;
  let queueError = null;
  try {
    const token = getGhlToken('PPC_EWA_BEACH');
    if (token) {
      const queueResult = await getPpcCallQueue('PPC_EWA_BEACH', auth);
      if (queueResult.status === 'OK') {
        safeCallable = queueResult.totalContactEligible != null ? queueResult.totalContactEligible : null;
      } else {
        queueError = queueResult.reason || queueResult.status;
      }
    } else {
      queueError = 'NO_GHL_CREDENTIALS';
    }
  } catch (_) {
    queueError = 'QUEUE_READ_FAILED';
  }

  let lastReviewStatus = 'none';
  let lastReviewError = null;
  if (state && state.lastMatchedCallId) {
    try {
      const ci = getPpcCallIntelligence(String(state.lastMatchedCallId), auth);
      if (ci && ci.status === 'complete') lastReviewStatus = 'complete';
      else if (ci && ci.status === 'processing') lastReviewStatus = 'processing';
      else if (ci && ci.status === 'failed') { lastReviewStatus = 'failed'; lastReviewError = ci.lastError || null; }
      else if (ci && ci.status === 'missing') lastReviewStatus = 'processing';
      else if (ci && ci.lastError) { lastReviewStatus = 'failed'; lastReviewError = ci.lastError; }
    } catch (_) {
      lastReviewStatus = 'unknown';
    }
  }

  return {
    status: 'OK',
    gateway: 'Online',
    activeSeller: state ? (state.activeSellerName || null) : null,
    activePhone: state ? (state.activePhone || null) : null,
    activeStageName: state ? (state.activeStageName || null) : null,
    safeCallable,
    queueError,
    lastMatchedCallId: state ? (state.lastMatchedCallId || null) : null,
    lastReviewStatus,
    lastReviewError,
    qualificationAvailable: state ? Boolean(state.lastMatchedCallId) : false,
  };
}

async function applyPpcDnc(profileId, contactId, opportunityId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (profileId !== 'PPC_EWA_BEACH') return blocked('DNC_PPC_ONLY');
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');

  const contactRes = await ghlGet(token, `/contacts/${contactId}`);
  const contact = contactRes.body?.contact;
  if (!contact) return blocked('CONTACT_NOT_FOUND');

  const existingTags = normalizeTags(contact.tags);
  const alreadyApplied = contact.dnd === true || existingTags.includes('DNC') || existingTags.includes('do_not_call');
  if (alreadyApplied) {
    const queueVerification = await verifyPpcQueueExclusion(token, opportunityId, { ...contact, tags: existingTags });
    if (!queueVerification.ok) return blocked('DNC_QUEUE_EXCLUSION_FAILED');
    return {
      status: 'OK',
      alreadyApplied: true,
      contactId,
      tags: existingTags,
      dndApplied: true,
      queueExclusionVerified: true,
      queueReason: queueVerification.eligibility.reason,
      effects: { ...ZERO_EFFECTS },
    };
  }

  const newTags = normalizeTags([...existingTags, 'DNC']);
  const updateRes = await ghlPut(token, `/contacts/${contactId}`, { tags: newTags, dnd: true });
  if (updateRes.status !== 200) return blocked('DNC_TAG_WRITE_FAILED');

  const verifyRes = await ghlGet(token, `/contacts/${contactId}`);
  const verifiedContact = verifyRes.body?.contact;
  const verifiedTags = normalizeTags(verifiedContact && verifiedContact.tags);
  const dncVerified = (verifiedContact && verifiedContact.dnd === true) || verifiedTags.includes('DNC') || verifiedTags.includes('do_not_call');
  if (!dncVerified) return blocked('DNC_READBACK_FAILED');

  const queueVerification = await verifyPpcQueueExclusion(token, opportunityId, { ...(verifiedContact || {}), tags: verifiedTags });
  if (!queueVerification.ok) return blocked('DNC_QUEUE_EXCLUSION_FAILED');

  return {
    status: 'OK',
    contactId,
    tags: verifiedTags,
    dncApplied: true,
    queueExclusionVerified: true,
    queueReason: queueVerification.eligibility.reason,
    effects: { providerSends: 0, ghlWrites: 1, stageMovements: 0 },
  };
}

async function applyPpcWrongNumber(profileId, contactId, opportunityId, auth) {
  const a = authorize(auth);
  if (!a.authorized) return blocked(a.reason);
  if (profileId !== 'PPC_EWA_BEACH') return blocked('WRONG_NUMBER_PPC_ONLY');
  const ctx = resolvePipelineContext(profileId);
  if (!ctx.resolved) return blocked(ctx.reason);
  const token = getGhlToken(ctx.profileId);
  if (!token) return blocked('NO_GHL_CREDENTIALS');

  const contactRes = await ghlGet(token, `/contacts/${contactId}`);
  const contact = contactRes.body?.contact;
  if (!contact) return blocked('CONTACT_NOT_FOUND');

  const existingTags = normalizeTags(contact.tags);
  const alreadyApplied = contact.wrongNumber === true || contactHasAnyTag(contact, ['wrong_number', 'bad_number', 'invalid_number']);
  if (alreadyApplied) {
    const queueVerification = await verifyPpcQueueExclusion(token, opportunityId, { ...contact, tags: existingTags });
    if (!queueVerification.ok) return blocked('WRONG_NUMBER_QUEUE_EXCLUSION_FAILED');
    return {
      status: 'OK',
      alreadyApplied: true,
      contactId,
      tags: existingTags,
      wrongNumberApplied: true,
      queueExclusionVerified: true,
      queueReason: queueVerification.eligibility.reason,
      effects: { ...ZERO_EFFECTS },
    };
  }

  const newTags = normalizeTags([...existingTags, 'wrong_number']);
  const updateRes = await ghlPut(token, `/contacts/${contactId}`, { tags: newTags, wrongNumber: true });
  if (updateRes.status !== 200) return blocked('WRONG_NUMBER_TAG_WRITE_FAILED');

  const verifyRes = await ghlGet(token, `/contacts/${contactId}`);
  const verifiedContact = verifyRes.body?.contact;
  const verifiedTags = normalizeTags(verifiedContact && verifiedContact.tags);
  const wrongNumberVerified = (verifiedContact && verifiedContact.wrongNumber === true) || contactHasAnyTag({ tags: verifiedTags }, ['wrong_number', 'bad_number', 'invalid_number']);
  if (!wrongNumberVerified) return blocked('WRONG_NUMBER_READBACK_FAILED');

  const queueVerification = await verifyPpcQueueExclusion(token, opportunityId, { ...(verifiedContact || {}), tags: verifiedTags });
  if (!queueVerification.ok) return blocked('WRONG_NUMBER_QUEUE_EXCLUSION_FAILED');

  return {
    status: 'OK',
    contactId,
    tags: verifiedTags,
    wrongNumberApplied: true,
    queueExclusionVerified: true,
    queueReason: queueVerification.eligibility.reason,
    effects: { providerSends: 0, ghlWrites: 1, stageMovements: 0 },
  };
}

module.exports = {
  PIPELINE_LIVE_MODE,
  OWNER_ID,
  CHAT_ID,
  TOPIC_ID,
  VALID_PROFILES,
  resolvePipelineContext,
  resolveProfileFromOpportunity,
  authorize,
  _setDeps,
  _setPostCallDelay,
  getPipelineCurrentState,
  getPipelineWorkSummary,
  getStageGuidance,
  getKaylaScript,
  getKillSwitchState,
  pauseOutreach,
  enableDryRun,
  getProviderStatus,
  getMemoryProvenance,
  recordCorrection,
  listSafeCanaryCandidates,
  createCanaryPreview,
  reviewCanaryPlan,
  expireCanaryPlan,
  approveCanaryPlan,
  executeCanary,
  getCanaryReconciliation,
  getSessionStatus,
  pipelineReadOpportunity,
  pipelineSearchOpportunities,
  pipelineListStages,
  pipelineMoveStage,
  loadPpcStageAuthority,
  resolvePpcStage,
  getPpcCallQueue,
  getPpcCallCard,
  getPpcCallContext,
  getPpcRecentCall,
  getPpcPostCallSyncStatus,
  getPpcCallingDeskStatus,
  startPpcCallIntelligence,
  getPpcCallIntelligence,
  applyPpcDnc,
  applyPpcWrongNumber,
};
