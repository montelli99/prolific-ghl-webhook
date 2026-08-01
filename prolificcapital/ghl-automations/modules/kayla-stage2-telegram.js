'use strict';

const fs = require('fs');
const path = require('path');
const stage1 = require('./kayla-stage1-transaction');
const contract = require('./kayla-stage2-contract');
const tx = require('./kayla-stage2-transaction');
const availability = require('./kayla-stage2-action-availability');
const { CONTACT_PATHS } = require('./kayla-stage1-contact-path');
const { SCRIPT_REGISTRY } = require('./kayla-stage1-scripts');
const { SMS_TEMPLATES } = require('../../divinitycrm/backend/src/services/sms-service');

function stage2Dir(options = {}) { return options.stage2DataDir || path.resolve(__dirname, '..', 'data', 'kayla-stage2'); }
function stage2File(ctx = {}, options = {}) { return path.join(stage2Dir(options), `${ctx.chatId || 'default'}-${ctx.telegramUserId || 'operator'}-stage2.json`); }
function readStage2Session(ctx, options = {}) { try { return JSON.parse(fs.readFileSync(stage2File(ctx, options), 'utf8')); } catch (_) { return null; } }
function saveStage2Session(ctx, session, options = {}) { fs.mkdirSync(stage2Dir(options), { recursive: true }); fs.writeFileSync(stage2File(ctx, options), `${JSON.stringify(session, null, 2)}\n`); }

function escapeMd(text) { return String(text ?? '').replace(/[_*`\[]/g, '\\$&'); }

function formatStage2(session, detail = '') {
  const missing = (session.unresolvedRequirements || []).join(', ') || 'none';
  return [
    '*Kayla Stage 2 Operator Console*',
    `Property: ${escapeMd(session.property?.address || '(missing)')}`,
    `Contact path: ${session.contactPath || 'RESEARCH_REQUIRED'}`,
    `Current state: ${session.state}`,
    `Instruction: ${escapeMd(session.nextExactCourseStep)}`,
    detail,
    `Missing: ${escapeMd(missing)}`,
    `Blocked: ${(session.blockedCapabilities || []).join(', ') || 'none'}`,
    'Production sends: 0 | Calls: 0 | GHL writes: 0 | Stage movements: 0',
  ].filter(Boolean).join('\n');
}

function formatBlocked(session, av) {
  return formatStage2(session, `Blocked: ${av.blockingReason}`);
}

function parseStage2Intent(text) {
  const t = String(text || '').toLowerCase();
  if (/show.*stage 2.*work|stage 2 work/.test(t)) return { intent: 'SHOW_STAGE2_WORK' };
  if (/start.*stage 2.*review|start.*contact made/.test(t)) return { intent: 'START_STAGE2_REVIEW' };
  if (/show.*stage 1.*notes|show.*stage 1.*handoff|stage 1 notes/.test(t)) return { intent: 'SHOW_STAGE1_HANDOFF' };
  if (/verify.*entry|confirm.*entry|enter.*contact made/.test(t)) return { intent: 'VERIFY_STAGE2_ENTRY' };
  if (/show.*contact facts|show.*facts|what.*facts/.test(t)) return { intent: 'SHOW_CONTACT_FACTS' };
  if (/what.*missing|missing.*info|what.*information/.test(t)) return { intent: 'SHOW_MISSING_STAGE2_INFO' };
  if (/mark.*unknown|not provided|don't know/.test(t)) return { intent: 'MARK_STAGE2_FIELD_UNKNOWN', fieldId: parseFieldId(text) };
  if (/mark.*not applicable|n\/a/.test(t)) return { intent: 'MARK_STAGE2_FIELD_NOT_APPLICABLE', fieldId: parseFieldId(text) };
  if (/mark.*deferred/.test(t)) return { intent: 'MARK_STAGE2_FIELD_DEFERRED', fieldId: parseFieldId(text) };
  if (/show.*ccc.*status|ccc status/.test(t)) return { intent: 'SHOW_CCC_STATUS' };
  if (/confirm.*ccc|ccc sent/.test(t)) return { intent: 'CONFIRM_CCC' };
  if (/show.*contact card.*status|contact card status/.test(t)) return { intent: 'SHOW_CONTACT_CARD_STATUS' };
  if (/confirm.*contact card|contact card sent/.test(t)) return { intent: 'CONFIRM_CONTACT_CARD' };
  if (/evaluate.*deal|classify|turnkey|renovation/.test(t)) {
    if (/turnkey|good condition/.test(t)) return { intent: 'EVALUATE_DEAL_TYPE', dealType: contract.DEAL_TYPES.TURNKEY };
    if (/renovation|needs work|older/.test(t)) return { intent: 'EVALUATE_DEAL_TYPE', dealType: contract.DEAL_TYPES.RENOVATION };
    return { intent: 'EVALUATE_DEAL_TYPE' };
  }
  if (/select.*turnkey/.test(t)) return { intent: 'SELECT_TURNKEY' };
  if (/select.*renovation/.test(t)) return { intent: 'SELECT_RENOVATION' };
  if (/review.*comps|comps.*review|rental comps/.test(t)) return { intent: 'RECORD_COMPS_REVIEW' };
  if (/rent.*viability|1.*percent/.test(t)) return { intent: 'RECORD_RENT_VIABILITY' };
  if (/rehab.*evidence|rehab.*info|repair.*estimate/.test(t)) return { intent: 'RECORD_REHAB_EVIDENCE' };
  if (/show.*f50|f50/.test(t)) return { intent: 'SHOW_F50' };
  if (/show.*f10|f10/.test(t)) return { intent: 'SHOW_F10' };
  if (/who.*handoff|handoff.*destination|who.*go|who.*does/.test(t)) return { intent: 'SHOW_HANDOFF_DESTINATION' };
  if (/draft.*handoff|prepare.*handoff/.test(t)) return { intent: 'DRAFT_HANDOFF' };
  if (/submit.*handoff|handoff.*submit|submitted.*handoff/.test(t)) return { intent: 'CONFIRM_HANDOFF_SUBMITTED' };
  if (/show.*gcj|gcj/.test(t)) return { intent: 'SHOW_GCJ' };
  if (/show.*stage 2.*notes|stage 2 notes/.test(t)) return { intent: 'SHOW_STAGE2_NOTES' };
  if (/show.*completion|is.*complete|stage 2.*complete|recorded.*notes|notes.*recorded/.test(t)) return { intent: 'SHOW_STAGE2_COMPLETION' };
  if (/offer ready|ready.*offer|next stage|simulate.*move/.test(t)) return { intent: 'SHOW_OFFER_READY_ELIGIBILITY' };
  if (/simulate.*offer ready|move.*offer ready/.test(t)) return { intent: 'SIMULATE_OFFER_READY_MOVE' };
  if (/not motivated|not ready|alternate.*outcome|what.*course.*say/.test(t)) return { intent: 'SHOW_STAGE2_ALTERNATE_OUTCOME' };
  if (/what.*next|next.*step/.test(t)) return { intent: 'SHOW_NEXT_COURSE_STEP' };
  if (/cancel.*stage 2/.test(t)) return { intent: 'CANCEL_STAGE2_SESSION' };
  if (/roof|hvac|rent|lease|utilities|occupied|vacant|price|condition|repair|photo|motivation|timeline|feedback|email|phone|name/.test(t)) return { intent: 'RECORD_STAGE2_FIELD', fieldData: parseFieldData(text) };
  return null;
}

function parseFieldId(text) {
  const t = String(text || '').toLowerCase();
  if (/roof/.test(t)) return 'roofAge';
  if (/hvac/.test(t)) return 'hvacAge';
  if (/rent/.test(t)) return 'monthlyRent';
  if (/lease/.test(t)) return 'leaseTerms';
  if (/utilit/.test(t)) return 'utilityResponsibility';
  if (/occup/.test(t)) return 'occupancy';
  if (/feedback/.test(t)) return 'listingFeedback';
  if (/motivation/.test(t)) return 'sellerMotivation';
  if (/timeline/.test(t)) return 'sellerTimeline';
  if (/price|asking/.test(t)) return 'askingPrice';
  if (/net/.test(t)) return 'netPrice';
  if (/condition/.test(t)) return 'propertyCondition';
  if (/repair|rehab/.test(t)) return 'repairEstimate';
  if (/photo/.test(t)) return 'photos';
  if (/email/.test(t)) return 'contactEmail';
  if (/phone/.test(t)) return 'contactPhone';
  if (/name/.test(t)) return 'contactName';
  if (/other.*propert/.test(t)) return 'otherProperties';
  return '';
}

function parseFieldData(text) {
  const value = String(text || '');
  const data = {};
  const roof = value.match(/roof\s*(?:is|:)?\s*(unknown|not provided|new|\d+\s*(?:years?|yrs?)?(?:\s*old)?)/i);
  const hvac = value.match(/hvac\s*(?:is|:)?\s*(unknown|not provided|new|\d+\s*(?:years?|yrs?)?(?:\s*old)?)/i);
  const rent = value.match(/rent\D+\$?([0-9,]+)/i);
  if (roof) data.roofAge = roof[1];
  if (hvac) data.hvacAge = hvac[1];
  if (rent) data.monthlyRent = rent[1];
  if (/occupied/i.test(value)) data.occupancy = 'occupied';
  if (/vacant/i.test(value)) data.occupancy = 'vacant';
  if (/utilities.*on/i.test(value)) data.utilityResponsibility = 'utilities on';
  if (/lease/i.test(value)) data.leaseTerms = value;
  if (/email/i.test(value)) data.contactEmail = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || data.contactEmail;
  if (/price\D+\$?([0-9,]+)/i.test(value)) data.askingPrice = value.match(/price\D+\$?([0-9,]+)/i)?.[1];
  if (/condition\D+(\d+)/i.test(value)) data.propertyCondition = value.match(/condition\D+(\d+)/i)?.[1];
  return data;
}

function firstStage1SessionForStage2(options = {}) {
  const stage1Dir = options.stage1DataDir || path.resolve(__dirname, '..', 'data', 'kayla-stage1');
  if (!fs.existsSync(stage1Dir)) return null;
  const files = fs.readdirSync(stage1Dir).filter(f => f.endsWith('.json'));
  if (!files.length) return null;
  const filePath = path.join(stage1Dir, files[0]);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function buildHandoffDraft(session) {
  const facts = {};
  for (const f of session.importedFacts) facts[f.field] = f;
  const dest = session.handoffDestination;
  const destName = dest === contract.HANDOFF_DESTINATIONS.SETH_LOI ? 'Seth (LOI)' : dest === contract.HANDOFF_DESTINATIONS.KAYLA_PPC ? 'Kayla (PPC)' : dest;
  return [
    'STAGE 2 HANDOFF PACKAGE',
    '',
    `To: ${destName}`,
    `Property: ${session.property.address}`,
    `Contact path: ${session.contactPath}`,
    `Contact: ${(facts.contactName || {}).value || 'N/A'} | ${(facts.contactPhone || {}).value || 'N/A'} | ${(facts.contactEmail || {}).value || 'N/A'}`,
    `Occupancy: ${(facts.occupancy || {}).value || 'N/A'}`,
    `Roof: ${(facts.roofAge || {}).value || 'unknown'} | HVAC: ${(facts.hvacAge || {}).value || 'unknown'}`,
    `Rent: ${(facts.monthlyRent || {}).value || 'N/A'} | Lease: ${(facts.leaseTerms || {}).value || 'N/A'}`,
    `Utilities: ${(facts.utilityResponsibility || {}).value || 'N/A'}`,
    `Feedback: ${(facts.listingFeedback || facts.buyerFeedback || {}).value || 'N/A'}`,
    `Deal type: ${session.dealType}`,
    `Comps/rent: ${session.compsEvidence || 'N/A'}`,
    `Rehab: ${session.rehabEvidence || 'N/A'}`,
    `F50: ${session.f50Eligible ? 'available' : 'N/A'} | F10: ${session.f10Eligible ? 'available' : 'N/A'}`,
    `Requested action: ${dest === contract.HANDOFF_DESTINATIONS.SETH_LOI ? 'Generate LOI/offer' : 'Review and prepare offer'}`,
    '',
    '[SIMULATED — no production handoff occurred]',
  ].join('\n');
}

function handleStage2Command(ctx, text, options = {}) {
  const intent = parseStage2Intent(text);
  if (!intent) return null;
  let session = readStage2Session(ctx, options);
  if (intent.intent === 'SHOW_STAGE2_WORK') return { reply: 'Stage 2 work: Review Stage 1 facts, verify CCC/contact card, resolve missing information, evaluate deal type, prepare handoff, confirm Offer Ready exit. Production sends/calls/writes/stage movements: 0.' };
  if (intent.intent === 'START_STAGE2_REVIEW' || !session) {
    const s1 = firstStage1SessionForStage2(options);
    if (!s1) return { reply: 'No Stage 1 session found. Complete Stage 1 before starting Stage 2 review.' };
    session = tx.createStage2Session(s1, { operatorId: ctx.telegramUserId });
    tx.addEvent(session, 'STAGE2_SESSION_STARTED', {}, { operatorId: ctx.telegramUserId });
    tx.addEvent(session, 'STAGE1_HANDOFF_LOADED', {}, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'SHOW_STAGE1_HANDOFF') {
    const s1Ref = session.stage1SessionRef || {};
    return { reply: formatStage2(session, `Stage 1: call=${s1Ref.callOutcome || 'N/A'} INT=${s1Ref.intStatus || 'N/A'} CCC=${s1Ref.cccStatus || 'N/A'} card=${s1Ref.contactCardStatus || 'N/A'} notes=${s1Ref.notesStatus || 'N/A'}`) };
  }
  if (intent.intent === 'VERIFY_STAGE2_ENTRY') {
    const entry = tx.evaluateEntry(session);
    if (!entry.allowed) return { reply: formatStage2(session, `Entry blocked: ${entry.reason} — ${entry.detail}`) };
    tx.addEvent(session, 'STAGE2_ENTRY_VERIFIED', {}, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session, 'Entry verified. Contact Made prerequisites satisfied.') };
  }
  if (intent.intent === 'SHOW_CONTACT_FACTS') {
    const lines = session.importedFacts.map(f => `- ${f.field}: ${f.value || '(empty)'} [${f.disposition}]`);
    return { reply: formatStage2(session, lines.join('\n')) };
  }
  if (intent.intent === 'SHOW_MISSING_STAGE2_INFO') {
    const missing = tx.missingRequiredFacts(session);
    return { reply: formatStage2(session, `Missing required: ${missing.join(', ') || 'none'}`) };
  }
  if (intent.intent === 'RECORD_STAGE2_FIELD') {
    for (const [fieldId, value] of Object.entries(intent.fieldData || {})) {
      tx.addEvent(session, 'FIELD_VALUE_RECORDED', { fieldId, value }, { operatorId: ctx.telegramUserId });
    }
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'MARK_STAGE2_FIELD_UNKNOWN') {
    if (!intent.fieldId) return { reply: formatStage2(session, 'Specify which field to mark unknown.') };
    tx.addEvent(session, 'FIELD_MARKED_UNKNOWN', { fieldId: intent.fieldId }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'MARK_STAGE2_FIELD_NOT_APPLICABLE') {
    if (!intent.fieldId) return { reply: formatStage2(session, 'Specify which field to mark not applicable.') };
    tx.addEvent(session, 'FIELD_MARKED_NOT_APPLICABLE', { fieldId: intent.fieldId }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'MARK_STAGE2_FIELD_DEFERRED') {
    if (!intent.fieldId) return { reply: formatStage2(session, 'Specify which field to mark deferred.') };
    tx.addEvent(session, 'FIELD_MARKED_DEFERRED', { fieldId: intent.fieldId }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'SHOW_CCC_STATUS') return { reply: formatStage2(session, `CCC: ${session.cccConfirmed ? 'confirmed' : 'not confirmed'}`) };
  if (intent.intent === 'CONFIRM_CCC') {
    tx.addEvent(session, 'CCC_CONFIRMED', {}, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'SHOW_CONTACT_CARD_STATUS') return { reply: formatStage2(session, `Contact card: ${session.contactCardConfirmed ? 'confirmed' : 'not confirmed'}`) };
  if (intent.intent === 'CONFIRM_CONTACT_CARD') {
    tx.addEvent(session, 'CONTACT_CARD_CONFIRMED', {}, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'EVALUATE_DEAL_TYPE') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE2_ACTIONS.EVALUATE_DEAL);
    if (!av.available) return { reply: formatBlocked(session, av) };
    if (intent.dealType) {
      tx.addEvent(session, 'DEAL_TYPE_CLASSIFIED', { dealType: intent.dealType }, { operatorId: ctx.telegramUserId });
      saveStage2Session(ctx, session, options);
      return { reply: formatStage2(session) };
    }
    return { reply: formatStage2(session, 'Classify as turnkey/good condition or renovation/older.') };
  }
  if (intent.intent === 'SELECT_TURNKEY') {
    tx.addEvent(session, 'DEAL_TYPE_CLASSIFIED', { dealType: contract.DEAL_TYPES.TURNKEY }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'SELECT_RENOVATION') {
    tx.addEvent(session, 'DEAL_TYPE_CLASSIFIED', { dealType: contract.DEAL_TYPES.RENOVATION }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'RECORD_COMPS_REVIEW') {
    tx.addEvent(session, 'COMPS_REVIEWED', { evidence: 'operator reviewed' }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'RECORD_RENT_VIABILITY') {
    tx.addEvent(session, 'RENT_VIABILITY_RECORDED', { evidence: 'operator recorded' }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'RECORD_REHAB_EVIDENCE') {
    tx.addEvent(session, 'REHAB_EVIDENCE_RECORDED', { evidence: 'operator recorded' }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  if (intent.intent === 'SHOW_F50') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE2_ACTIONS.SHOW_F50);
    if (!av.available) return { reply: formatBlocked(session, av) };
    return { reply: formatStage2(session, `F50: ${SMS_TEMPLATES.F50}`) };
  }
  if (intent.intent === 'SHOW_F10') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE2_ACTIONS.SHOW_F10);
    if (!av.available) return { reply: formatBlocked(session, av) };
    return { reply: formatStage2(session, `F10: ${SMS_TEMPLATES.F10}`) };
  }
  if (intent.intent === 'SHOW_HANDOFF_DESTINATION') {
    return { reply: formatStage2(session, `Handoff destination: ${session.handoffDestination || 'not set'}`) };
  }
  if (intent.intent === 'DRAFT_HANDOFF') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE2_ACTIONS.DRAFT_HANDOFF);
    if (!av.available) return { reply: formatBlocked(session, av) };
    const draft = buildHandoffDraft(session);
    tx.addEvent(session, 'HANDOFF_DRAFT_CREATED', { draft }, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session, '```\n' + draft + '\n```') };
  }
  if (intent.intent === 'CONFIRM_HANDOFF_SUBMITTED') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE2_ACTIONS.CONFIRM_HANDOFF);
    if (!av.available) return { reply: formatBlocked(session, av) };
    tx.addEvent(session, 'HANDOFF_DRAFT_REVIEWED', {}, { operatorId: ctx.telegramUserId });
    tx.addEvent(session, 'HANDOFF_SUBMISSION_SIMULATED', {}, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session, 'Handoff submitted (simulated).') };
  }
  if (intent.intent === 'SHOW_GCJ') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE2_ACTIONS.SHOW_GCJ);
    if (!av.available) return { reply: formatBlocked(session, av) };
    return { reply: formatStage2(session, `GCJ: ${SMS_TEMPLATES.GCJ}`) };
  }
  if (intent.intent === 'SHOW_STAGE2_NOTES') {
    return { reply: '```\n' + tx.buildStage2Note(session) + '\n```' };
  }
  if (intent.intent === 'SHOW_STAGE2_COMPLETION') {
    const missing = tx.missingRequirements(session);
    return { reply: formatStage2(session, missing.length ? `Incomplete. Missing: ${missing.join(', ')}` : 'Stage 2 operator work is complete.') };
  }
  if (intent.intent === 'SHOW_OFFER_READY_ELIGIBILITY') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE2_ACTIONS.SIMULATE_OFFER_READY_EXIT);
    return { reply: formatStage2(session, av.available ? 'Offer Ready exit is eligible (simulated).' : `Not eligible: ${av.blockingReason}`) };
  }
  if (intent.intent === 'SIMULATE_OFFER_READY_MOVE') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE2_ACTIONS.SIMULATE_OFFER_READY_EXIT);
    if (!av.available) return { reply: formatBlocked(session, av) };
    tx.addEvent(session, 'STAGE2_OPERATOR_WORK_COMPLETE', {}, { operatorId: ctx.telegramUserId });
    tx.addEvent(session, 'OFFER_READY_MOVE_SIMULATED', {}, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session, 'Course requirements for moving Contact Made to Offer Ready are satisfied in this simulated session. No production stage movement occurred.') };
  }
  if (intent.intent === 'SHOW_STAGE2_ALTERNATE_OUTCOME') {
    tx.addEvent(session, 'ALTERNATE_OUTCOME_BLOCKED', {}, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session, 'The course corpus does not define the standardized Stage 2 alternate outcome for this situation. The record remains under operator review; no stage or follow-up action was created.') };
  }
  if (intent.intent === 'SHOW_NEXT_COURSE_STEP') return { reply: formatStage2(session) };
  if (intent.intent === 'CANCEL_STAGE2_SESSION') {
    tx.addEvent(session, 'SESSION_CANCELED', {}, { operatorId: ctx.telegramUserId });
    saveStage2Session(ctx, session, options);
    return { reply: formatStage2(session) };
  }
  return null;
}

module.exports = { handleStage2Command, parseStage2Intent };
