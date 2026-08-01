'use strict';

const fs = require('fs');
const path = require('path');
const contract = require('./kayla-stage3-contract');
const tx = require('./kayla-stage3-transaction');
const availability = require('./kayla-stage3-action-availability');
const { SMS_TEMPLATES } = require('../../divinitycrm/backend/src/services/sms-service');

function stage3Dir(options = {}) { return options.stage3DataDir || path.resolve(__dirname, '..', 'data', 'kayla-stage3'); }
function stage3File(ctx = {}, options = {}) { return path.join(stage3Dir(options), `${ctx.chatId || 'default'}-${ctx.telegramUserId || 'operator'}-stage3.json`); }
function readStage3Session(ctx, options = {}) { try { return JSON.parse(fs.readFileSync(stage3File(ctx, options), 'utf8')); } catch (_) { return null; } }
function saveStage3Session(ctx, session, options = {}) { fs.mkdirSync(stage3Dir(options), { recursive: true }); fs.writeFileSync(stage3File(ctx, options), `${JSON.stringify(session, null, 2)}\n`); }

function escapeMd(text) { return String(text ?? '').replace(/[_*`\[]/g, '\\$&'); }

function formatStage3(session, detail = '') {
  const missing = (session.unresolvedRequirements || []).join(', ') || 'none';
  return [
    '*Kayla Stage 3 Operator Console*',
    `Property: ${escapeMd(session.property?.address || '(missing)')}`,
    `Contact path: ${session.contactPath || 'RESEARCH_REQUIRED'}`,
    `Current state: ${session.state}`,
    `Instruction: ${escapeMd(session.nextExactCourseStep)}`,
    detail,
    `Offer type: ${session.offerType || 'not selected'} | Status: ${session.offerStatus}`,
    `Missing: ${escapeMd(missing)}`,
    `Blocked: ${(session.blockedCapabilities || []).join(', ') || 'none'}`,
    'Production sends: 0 | Calls: 0 | GHL writes: 0 | Stage movements: 0',
  ].filter(Boolean).join('\n');
}

function formatBlocked(session, av) {
  return formatStage3(session, `Blocked: ${av.blockingReason}`);
}

function parseStage3Intent(text) {
  const t = String(text || '').toLowerCase();
  if (/show.*stage 3.*work|stage 3 work/.test(t)) return { intent: 'SHOW_STAGE3_WORK' };
  if (/start.*stage 3.*review|start.*offer ready/.test(t)) return { intent: 'START_STAGE3_REVIEW' };
  if (/show.*stage 2.*handoff|stage 2 handoff/.test(t)) return { intent: 'SHOW_STAGE2_HANDOFF' };
  if (/verify.*entry|confirm.*entry|enter.*offer ready/.test(t)) return { intent: 'VERIFY_STAGE3_ENTRY' };
  if (/review.*handoff|handoff.*review/.test(t)) return { intent: 'REVIEW_HANDOFF' };
  if (/record.*underwriting|underwriting.*data|arv|purchase price|repair|market rent/.test(t)) return { intent: 'RECORD_UNDERWRITING', data: parseUnderwritingData(text) };
  if (/review.*underwriting/.test(t)) return { intent: 'REVIEW_UNDERWRITING' };
  if (/select.*offer.*type|offer.*type|what.*offer|select.*(cash|stack|subto|10.*down|fifty)/.test(t)) {
    if (/cash/.test(t)) return { intent: 'SELECT_OFFER_TYPE', offerType: contract.OFFER_TYPES.CASH };
    if (/stack|50.*down|fifty.*down/.test(t)) return { intent: 'SELECT_OFFER_TYPE', offerType: contract.OFFER_TYPES.STACK_50 };
    if (/10.*down|ten.*down/.test(t)) return { intent: 'SELECT_OFFER_TYPE', offerType: contract.OFFER_TYPES.DOWN_10 };
    if (/subto|subject.to|sub.*two/.test(t)) return { intent: 'SELECT_OFFER_TYPE', offerType: contract.OFFER_TYPES.SUBTO };
    return { intent: 'SHOW_OFFER_TYPES' };
  }
  if (/review.*calculations/.test(t)) return { intent: 'REVIEW_CALCULATIONS' };
  if (/show.*calculations|calculations|formula/.test(t)) return { intent: 'SHOW_CALCULATIONS' };
  if (/show.*loi|loi.*status/.test(t)) return { intent: 'SHOW_LOI_STATUS' };
  if (/review.*loi/.test(t)) return { intent: 'REVIEW_LOI' };
  if (/generate.*offer|offer.*generat/.test(t)) return { intent: 'SIMULATE_OFFER_GENERATION' };
  if (/approve.*offer|offer.*approv/.test(t)) return { intent: 'SIMULATE_OFFER_APPROVAL' };
  if (/confirm.*delivery|confirm.*offer.*sent|offer.*deliver/.test(t)) return { intent: 'CONFIRM_OFFER_DELIVERY' };
  if (/show.*gcj|gcj/.test(t)) return { intent: 'SHOW_GCJ' };
  if (/show.*stage 3.*notes|stage 3 notes/.test(t)) return { intent: 'SHOW_STAGE3_NOTES' };
  if (/show.*completion|is.*complete|stage 3.*complete/.test(t)) return { intent: 'SHOW_STAGE3_COMPLETION' };
  if (/simulate.*offer sent|move.*offer sent/.test(t)) return { intent: 'SIMULATE_OFFER_SENT_MOVE' };
  if (/offer sent|next stage|simulate.*move/.test(t)) return { intent: 'SHOW_OFFER_SENT_ELIGIBILITY' };
  if (/alternate.*outcome|what.*course.*say/.test(t)) return { intent: 'SHOW_STAGE3_ALTERNATE_OUTCOME' };
  if (/what.*next|next.*step/.test(t)) return { intent: 'SHOW_NEXT_COURSE_STEP' };
  if (/cancel.*stage 3/.test(t)) return { intent: 'CANCEL_STAGE3_SESSION' };
  return null;
}

function parseUnderwritingData(text) {
  const data = {};
  const arv = text.match(/arv\D+\$?([0-9,]+)/i);
  const price = text.match(/(?:purchase\s*)?price\D+\$?([0-9,]+)/i);
  const repair = text.match(/repair\D+\$?([0-9,]+)/i);
  const rent = text.match(/rent\D+\$?([0-9,]+)/i);
  const equity = text.match(/equity\D+(\d+)\s*%/i);
  const mortgage = text.match(/mortgage\D+\$?([0-9,]+)/i);
  if (arv) data.arv = arv[1];
  if (price) data.purchasePrice = price[1];
  if (repair) data.repairEstimate = repair[1];
  if (rent) data.marketRent = rent[1];
  if (equity) data.equityPercentage = equity[1] + '%';
  if (mortgage) data.mortgageBalance = mortgage[1];
  return data;
}

function firstStage2SessionForStage3(options = {}) {
  const stage2Dir = options.stage2DataDir || path.resolve(__dirname, '..', 'data', 'kayla-stage2');
  if (!fs.existsSync(stage2Dir)) return null;
  const files = fs.readdirSync(stage2Dir).filter(f => f.endsWith('.json'));
  if (!files.length) return null;
  const filePath = path.join(stage2Dir, files[0]);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function getFormulaText(offerType) {
  const formulas = contract.RESOLVED_RULES.S3_CALC_001.formulas;
  if (offerType === contract.OFFER_TYPES.CASH) return formulas.cash;
  if (offerType === contract.OFFER_TYPES.STACK_50) return formulas.stack50;
  if (offerType === contract.OFFER_TYPES.DOWN_10) return formulas.down10;
  if (offerType === contract.OFFER_TYPES.SUBTO) return formulas.subto;
  return 'Select an offer type to see the formula.';
}

function handleStage3Command(ctx, text, options = {}) {
  const intent = parseStage3Intent(text);
  if (!intent) return null;
  let session = readStage3Session(ctx, options);
  if (intent.intent === 'SHOW_STAGE3_WORK') return { reply: 'Stage 3 work: Review Stage 2 handoff, review underwriting data, select offer type, review calculations, review LOI status, await offer generation/approval, confirm offer delivery, exit to Offer Sent. Production sends/calls/writes/stage movements: 0.' };
  if (intent.intent === 'START_STAGE3_REVIEW' || !session) {
    const s2 = firstStage2SessionForStage3(options);
    if (!s2) return { reply: 'No Stage 2 session found. Complete Stage 2 before starting Stage 3 review.' };
    session = tx.createStage3Session(s2, { operatorId: ctx.telegramUserId });
    tx.addEvent(session, 'STAGE3_SESSION_STARTED', {}, { operatorId: ctx.telegramUserId });
    tx.addEvent(session, 'STAGE2_HANDOFF_LOADED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session) };
  }
  if (intent.intent === 'SHOW_STAGE2_HANDOFF') {
    const s2Ref = session.stage2SessionRef || {};
    return { reply: formatStage3(session, `Stage 2: deal=${s2Ref.dealType || 'N/A'} handoff=${s2Ref.handoffDestination || 'N/A'} submitted=${s2Ref.handoffSubmitted ? 'yes' : 'no'} exit=${s2Ref.exitEligible ? 'eligible' : 'not eligible'}`) };
  }
  if (intent.intent === 'VERIFY_STAGE3_ENTRY') {
    const entry = tx.evaluateEntry(session);
    if (!entry.allowed) return { reply: formatStage3(session, `Entry blocked: ${entry.reason} — ${entry.detail}`) };
    tx.addEvent(session, 'STAGE3_ENTRY_VERIFIED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'Entry verified. Offer Ready prerequisites satisfied.') };
  }
  if (intent.intent === 'REVIEW_HANDOFF') {
    tx.addEvent(session, 'HANDOFF_REVIEWED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'Handoff reviewed. Proceed to underwriting data review.') };
  }
  if (intent.intent === 'RECORD_UNDERWRITING') {
    if (intent.data && Object.keys(intent.data).length) {
      tx.addEvent(session, 'UNDERWRITING_DATA_RECORDED', { data: intent.data }, { operatorId: ctx.telegramUserId });
      saveStage3Session(ctx, session, options);
      return { reply: formatStage3(session, `Recorded: ${JSON.stringify(intent.data)}`) };
    }
    return { reply: formatStage3(session, 'Provide underwriting data: ARV, purchase price, repair estimate, market rent. Example: "arv 200000 price 150000 repair 30000 rent 2000"') };
  }
  if (intent.intent === 'REVIEW_UNDERWRITING') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE3_ACTIONS.REVIEW_UNDERWRITING);
    if (!av.available) return { reply: formatBlocked(session, av) };
    tx.addEvent(session, 'UNDERWRITING_DATA_REVIEWED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'Underwriting data reviewed. Select offer type.') };
  }
  if (intent.intent === 'SHOW_OFFER_TYPES') {
    const types = contract.RESOLVED_RULES.S3_TYPE_001.offerTypes;
    const lines = Object.entries(types).map(([k, v]) => `- ${k}: ${v.formula}`);
    return { reply: formatStage3(session, 'Offer types:\n' + lines.join('\n')) };
  }
  if (intent.intent === 'SELECT_OFFER_TYPE') {
    if (!intent.offerType) return { reply: formatStage3(session, 'Select: cash, stack (50% down), 10 down, or subto.') };
    tx.addEvent(session, 'OFFER_TYPE_SELECTED', { offerType: intent.offerType }, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, `Offer type: ${intent.offerType}`) };
  }
  if (intent.intent === 'SHOW_CALCULATIONS') {
    const formula = getFormulaText(session.offerType);
    return { reply: formatStage3(session, `Formula: ${formula}\n1% Rule: ${contract.RESOLVED_RULES.S3_CALC_001.onePercentRule.rule}`) };
  }
  if (intent.intent === 'REVIEW_CALCULATIONS') {
    tx.addEvent(session, 'CALCULATIONS_REVIEWED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'Calculations reviewed. Review LOI status.') };
  }
  if (intent.intent === 'SHOW_LOI_STATUS') {
    return { reply: formatStage3(session, `LOI: Generated by Seth after underwriting. Non-binding deal outline. Status: ${session.loiReviewed ? 'reviewed' : 'not reviewed'}`) };
  }
  if (intent.intent === 'REVIEW_LOI') {
    tx.addEvent(session, 'LOI_STATUS_REVIEWED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'LOI status reviewed. Awaiting offer generation by closer team.') };
  }
  if (intent.intent === 'SIMULATE_OFFER_GENERATION') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE3_ACTIONS.SIMULATE_OFFER_GENERATION);
    if (!av.available) return { reply: formatBlocked(session, av) };
    tx.addEvent(session, 'OFFER_GENERATION_SIMULATED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'Offer generated (simulated). Awaiting approval.') };
  }
  if (intent.intent === 'SIMULATE_OFFER_APPROVAL') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE3_ACTIONS.SIMULATE_OFFER_APPROVAL);
    if (!av.available) return { reply: formatBlocked(session, av) };
    tx.addEvent(session, 'OFFER_APPROVAL_SIMULATED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'Offer approved (simulated). Confirm delivery to seller.') };
  }
  if (intent.intent === 'CONFIRM_OFFER_DELIVERY') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE3_ACTIONS.CONFIRM_OFFER_DELIVERY);
    if (!av.available) return { reply: formatBlocked(session, av) };
    tx.addEvent(session, 'OFFER_DELIVERY_CONFIRMED', { sentDate: new Date().toISOString() }, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'Offer delivery confirmed. Offer sent to seller by closer team/AI system. 48-hour feedback clock started.') };
  }
  if (intent.intent === 'SHOW_GCJ') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE3_ACTIONS.SHOW_GCJ);
    if (!av.available) return { reply: formatBlocked(session, av) };
    return { reply: formatStage3(session, `GCJ: ${SMS_TEMPLATES.GCJ}`) };
  }
  if (intent.intent === 'SHOW_STAGE3_NOTES') {
    return { reply: '```\n' + tx.buildStage3Note(session) + '\n```' };
  }
  if (intent.intent === 'SHOW_STAGE3_COMPLETION') {
    const missing = tx.missingRequirements(session);
    return { reply: formatStage3(session, missing.length ? `Incomplete. Missing: ${missing.join(', ')}` : 'Stage 3 operator work is complete.') };
  }
  if (intent.intent === 'SHOW_OFFER_SENT_ELIGIBILITY') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE3_ACTIONS.SIMULATE_OFFER_SENT_EXIT);
    return { reply: formatStage3(session, av.available ? 'Offer Sent exit is eligible (simulated).' : `Not eligible: ${av.blockingReason}`) };
  }
  if (intent.intent === 'SIMULATE_OFFER_SENT_MOVE') {
    const av = availability.evaluateActionAvailability(session, availability.STAGE3_ACTIONS.SIMULATE_OFFER_SENT_EXIT);
    if (!av.available) return { reply: formatBlocked(session, av) };
    tx.addEvent(session, 'STAGE3_OPERATOR_WORK_COMPLETE', {}, { operatorId: ctx.telegramUserId });
    tx.addEvent(session, 'OFFER_SENT_EXIT_SIMULATED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'Course requirements for moving Offer Ready to Offer Sent are satisfied in this simulated session. No production stage movement occurred.') };
  }
  if (intent.intent === 'SHOW_STAGE3_ALTERNATE_OUTCOME') {
    tx.addEvent(session, 'ALTERNATE_OUTCOME_BLOCKED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session, 'The course corpus does not define alternate Stage 3 exits. The record remains under operator review.') };
  }
  if (intent.intent === 'SHOW_NEXT_COURSE_STEP') return { reply: formatStage3(session) };
  if (intent.intent === 'CANCEL_STAGE3_SESSION') {
    tx.addEvent(session, 'SESSION_CANCELED', {}, { operatorId: ctx.telegramUserId });
    saveStage3Session(ctx, session, options);
    return { reply: formatStage3(session) };
  }
  return null;
}

module.exports = { handleStage3Command, parseStage3Intent };
