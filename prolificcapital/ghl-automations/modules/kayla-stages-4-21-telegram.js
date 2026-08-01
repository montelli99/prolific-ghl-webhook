'use strict';

const fs = require('fs');
const path = require('path');
const framework = require('./kayla-post-offer-framework');
const { SMS_TEMPLATES } = require('../../divinitycrm/backend/src/services/sms-service');

function stageDir(stageNum, options = {}) { return options.stageDataDir || path.resolve(__dirname, '..', 'data', `kayla-stage${stageNum}`); }
function stageFile(stageNum, ctx = {}, options = {}) { return path.join(stageDir(stageNum, options), `${ctx.chatId || 'default'}-${ctx.telegramUserId || 'operator'}-stage${stageNum}.json`); }
function readSession(stageNum, ctx, options = {}) { try { return JSON.parse(fs.readFileSync(stageFile(stageNum, ctx, options), 'utf8')); } catch (_) { return null; } }
function saveSession(stageNum, ctx, session, options = {}) { fs.mkdirSync(stageDir(stageNum, options), { recursive: true }); fs.writeFileSync(stageFile(stageNum, ctx, options), `${JSON.stringify(session, null, 2)}\n`); }

function escapeMd(text) { return String(text ?? '').replace(/[_*`\[]/g, '\\$&'); }

function formatStage(session, detail = '') {
  return [
    `*Kayla Stage ${session.stageNumber} Operator Console*`,
    `Stage: ${session.currentPipelineStage}`,
    `Property: ${escapeMd(session.property?.address || '(missing)')}`,
    `Operator role: ${session.operatorRole}`,
    `State: ${session.state}`,
    `Instruction: ${escapeMd(session.nextExactCourseStep)}`,
    detail,
    'Production sends: 0 | Calls: 0 | GHL writes: 0 | Stage movements: 0',
  ].filter(Boolean).join('\n');
}

function parseIntent(text, stageNum) {
  const t = String(text || '').toLowerCase();
  if (/show.*work|what.*do/.test(t)) return { intent: 'SHOW_WORK' };
  if (/start.*review|start.*stage/.test(t)) return { intent: 'START_REVIEW' };
  if (/verify.*entry|confirm.*entry/.test(t)) return { intent: 'VERIFY_ENTRY' };
  if (/confirm.*receipt|receipt.*confirm|received.*offer/.test(t)) return { intent: 'CONFIRM_RECEIPT' };
  if (/call.*confirm|confirmation.*call/.test(t)) return { intent: 'CONFIRMATION_CALL' };
  if (/gain.*feedback|feedback.*call/.test(t)) return { intent: 'FEEDBACK_CALL' };
  if (/record.*feedback/.test(t)) return { intent: 'RECORD_FEEDBACK' };
  if (/relay.*closer|relay.*feedback/.test(t)) return { intent: 'RELAY_FEEDBACK' };
  if (/voice.*memo/.test(t)) return { intent: 'SEND_VOICE_MEMO' };
  if (/loi2days|loi.*2.*day/.test(t)) return { intent: 'SEND_LOI2DAYS' };
  if (/send.*sd|sd.*text/.test(t)) return { intent: 'SEND_SD' };
  if (/note.*dom|days.*market/.test(t)) return { intent: 'NOTE_DOM' };
  if (/listing.*expir|circle.*back/.test(t)) return { intent: 'CALCULATE_LISTING_EXPIRY' };
  if (/other.*propert/.test(t)) return { intent: 'ASK_OTHER_PROPERTIES' };
  if (/revisit|30.*day/.test(t)) return { intent: 'SCHEDULE_REVISIT' };
  if (/negotiation.*outcome|outcome.*record/.test(t)) return { intent: 'RECORD_NEGOTIATION_OUTCOME' };
  if (/contract.*draft/.test(t)) return { intent: 'CONTRACT_DRAFTED' };
  if (/contract.*sent/.test(t)) return { intent: 'CONTRACT_SENT' };
  if (/seller.*response/.test(t)) return { intent: 'RECORD_SELLER_RESPONSE' };
  if (/stay.*warm|warm.*contact/.test(t)) return { intent: 'STAY_WARM' };
  if (/show.*notes|stage.*notes/.test(t)) return { intent: 'SHOW_NOTES' };
  if (/is.*complete|completion/.test(t)) return { intent: 'SHOW_COMPLETION' };
  if (/next.*stage|simulate.*move|exit/.test(t)) return { intent: 'SIMULATE_EXIT' };
  if (/what.*next|next.*step/.test(t)) return { intent: 'SHOW_NEXT_STEP' };
  if (/cancel/.test(t)) return { intent: 'CANCEL_SESSION' };
  return null;
}

function firstPriorSession(stageNum, options = {}) {
  const priorDir = options.priorStageDataDir || path.resolve(__dirname, '..', 'data', `kayla-stage${stageNum - 1}`);
  if (!fs.existsSync(priorDir)) return null;
  const files = fs.readdirSync(priorDir).filter(f => f.endsWith('.json'));
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(priorDir, files[0]), 'utf8')); } catch (_) { return null; }
}

function handleStageCommand(ctx, text, stageNum, options = {}) {
  const intent = parseIntent(text, stageNum);
  if (!intent) return null;
  let session = readSession(stageNum, ctx, options);

  if (intent.intent === 'SHOW_WORK') {
    const spec = framework.STAGE_SPECS[stageNum];
    return { reply: `Stage ${stageNum} (${spec ? spec.name : 'Monitor'}): ${spec ? spec.description : 'Monitor only. Stay warm with seller every 3-5 days.'} Production sends/calls/writes/stage movements: 0.` };
  }

  if (intent.intent === 'START_REVIEW' || !session) {
    const prior = firstPriorSession(stageNum, options);
    if (!prior) return { reply: `No Stage ${stageNum - 1} session found. Complete prior stage first.` };
    if (framework.MONITOR_STAGES.includes(stageNum)) {
      session = framework.createMonitorSession(prior, stageNum, { operatorId: ctx.telegramUserId });
    } else {
      session = framework.createPostOfferSession(prior, stageNum, { operatorId: ctx.telegramUserId });
    }
    framework.addEvent(session, 'SESSION_STARTED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session) };
  }

  if (intent.intent === 'VERIFY_ENTRY') {
    framework.addEvent(session, 'ENTRY_VERIFIED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Entry verified.') };
  }

  if (intent.intent === 'CONFIRMATION_CALL') {
    framework.addEvent(session, 'CONFIRMATION_CALL_MADE', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Confirmation call recorded.') };
  }

  if (intent.intent === 'CONFIRM_RECEIPT') {
    framework.addEvent(session, 'RECEIPT_CONFIRMED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Receipt confirmed.') };
  }

  if (intent.intent === 'FEEDBACK_CALL') {
    framework.addEvent(session, 'FEEDBACK_CALL_MADE', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Feedback call recorded.') };
  }

  if (intent.intent === 'RECORD_FEEDBACK') {
    framework.addEvent(session, 'FEEDBACK_RECORDED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Feedback recorded.') };
  }

  if (intent.intent === 'RELAY_FEEDBACK') {
    framework.addEvent(session, 'FEEDBACK_RELAYED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Feedback relayed to closer team.') };
  }

  if (intent.intent === 'SEND_VOICE_MEMO') {
    framework.addEvent(session, 'VOICE_MEMO_SENT', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Voice memo sent (simulated).') };
  }

  if (intent.intent === 'SEND_LOI2DAYS') {
    framework.addEvent(session, 'LOI2DAYS_SENT', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, `LOI2DAYS: ${SMS_TEMPLATES.LOI2DAYS || 'LOI2DAYS shortcut'}`) };
  }

  if (intent.intent === 'SEND_SD') {
    framework.addEvent(session, 'SD_SENT', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, `SD: ${SMS_TEMPLATES.SD || 'SD shortcut'}`) };
  }

  if (intent.intent === 'NOTE_DOM') {
    framework.addEvent(session, 'DOM_NOTED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Days on Market noted.') };
  }

  if (intent.intent === 'CALCULATE_LISTING_EXPIRY') {
    framework.addEvent(session, 'LISTING_EXPIRY_CALCULATED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Listing expiry calculated (DOM - 181 days).') };
  }

  if (intent.intent === 'ASK_OTHER_PROPERTIES') {
    framework.addEvent(session, 'OTHER_PROPERTIES_ASKED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Asked about other properties.') };
  }

  if (intent.intent === 'SCHEDULE_REVISIT') {
    framework.addEvent(session, 'REVISIT_SCHEDULED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, '30-day revisit scheduled.') };
  }

  if (intent.intent === 'RECORD_NEGOTIATION_OUTCOME') {
    framework.addEvent(session, 'NEGOTIATION_OUTCOME_RECORDED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Negotiation outcome recorded.') };
  }

  if (intent.intent === 'CONTRACT_DRAFTED') {
    framework.addEvent(session, 'CONTRACT_DRAFTED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Contract drafted (closer team).') };
  }

  if (intent.intent === 'CONTRACT_SENT') {
    framework.addEvent(session, 'CONTRACT_SENT', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Contract sent (closer team).') };
  }

  if (intent.intent === 'RECORD_SELLER_RESPONSE') {
    framework.addEvent(session, 'SELLER_RESPONSE_RECORDED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Seller response recorded.') };
  }

  if (intent.intent === 'STAY_WARM') {
    framework.addEvent(session, 'STAY_WARM_CONTACT_MADE', { date: new Date().toISOString() }, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, 'Warm contact recorded.') };
  }

  if (intent.intent === 'SHOW_NOTES') {
    return { reply: '```\n' + framework.buildPostOfferNote(session) + '\n```' };
  }

  if (intent.intent === 'SHOW_COMPLETION') {
    return { reply: formatStage(session, session.completionStatus === 'COMPLETE' ? 'Operator work is complete.' : 'Work in progress.') };
  }

  if (intent.intent === 'SIMULATE_EXIT') {
    framework.addEvent(session, 'OPERATOR_WORK_COMPLETE', {}, { operatorId: ctx.telegramUserId });
    framework.addEvent(session, 'EXIT_SIMULATED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session, `Course requirements for Stage ${stageNum} are satisfied in this simulated session. No production stage movement occurred.`) };
  }

  if (intent.intent === 'SHOW_NEXT_STEP') return { reply: formatStage(session) };

  if (intent.intent === 'CANCEL_SESSION') {
    framework.addEvent(session, 'SESSION_CANCELED', {}, { operatorId: ctx.telegramUserId });
    saveSession(stageNum, ctx, session, options);
    return { reply: formatStage(session) };
  }

  return null;
}

module.exports = { handleStageCommand };
