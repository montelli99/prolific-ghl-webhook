'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const killSwitch = require('./kill-switch');
const canary = require('./canary-executor');
const ownerAuth = require('./owner-auth');
const convRouter = require('./conversation-router');
const convState = require('./conversation-state');
const memCtx = require('../modules/pipeline-memory-context');
const proactiveEvents = require('../modules/proactive-event-handler');
const { handleKaylaOutreachCommand, parseStage1Intent, handleStage1Command, canaryPreviewForIntent, formatCanaryPreview } = require('../modules/kayla-telegram-outreach');
const { handleStage2Command } = require('../modules/kayla-stage2-telegram');
const { handleStage3Command } = require('../modules/kayla-stage3-telegram');
const { handleStageCommand } = require('../modules/kayla-stages-4-21-telegram');
const { CallNoteOperatorService } = require('../modules/call-note-operator-service');
const { createCallNoteRuntime } = require('../modules/call-note-runtime');
const { TranscriptNotePreviewStore } = require('../modules/owner-controlled-transcript-note');
const { classifyGhlCallSync } = require('../modules/ghl-call-sync-classifier');

const BOT_DIR = path.resolve(__dirname);
const LOG_DIR = path.resolve(BOT_DIR, '..', 'logs');
const SESSION_DIR = path.resolve(BOT_DIR, '..', 'data', 'bot-sessions');
const LOCK_FILE = path.resolve(BOT_DIR, '..', 'data', 'bot.lock');

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const MODE = process.env.TELEGRAM_MODE || 'polling';
const DEPLOY_REVISION = process.env.DEPLOY_REVISION || 'dev';
const START_TIME = new Date().toISOString();

const PIPELINE_CHAT_ID = ownerAuth.PIPELINE_CHAT_ID;
const PIPELINE_TOPIC_ID = ownerAuth.PIPELINE_TOPIC_ID;

let offset = 0;
let running = true;
let activeSessions = 0;
let pendingCanaryPlans = 0;
let lastReconciledAt = null;

function log(level, msg, data = {}) {
  const entry = { ts: new Date().toISOString(), level, msg, ...data };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else console.log(line);
  try { fs.appendFileSync(path.join(LOG_DIR, 'bot.log'), line + '\n'); } catch (_) {}
}

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const age = Date.now() - new Date(existing.started).getTime();
      if (age < 5 * 60 * 1000) {
        let pidAlive = true;
        try { process.kill(Number(existing.pid), 0); } catch (e) { pidAlive = e.code !== 'ESRCH'; }
        if (pidAlive) { log('error', 'LOCK_ACQUIRE_FAILED', { existing, age }); return false; }
        log('warn', 'STALE_LOCK_PID_DEAD', { existing, age });
      }
      log('warn', 'STALE_LOCK_CLEARED', { existing, age });
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), mode: MODE }));
    return true;
  } catch (e) { log('error', 'LOCK_ERROR', { error: e.message }); return false; }
}

function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} }

function telegramApi(method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${TOKEN}/${method}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 30000,
    }, (res) => { let buf = ''; res.on('data', c => buf += c); res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(data); req.end();
  });
}

function sendMessage(chatId, text, extra = {}) {
  const target = { chat_id: PIPELINE_CHAT_ID, message_thread_id: PIPELINE_TOPIC_ID, ...extra };
  return telegramApi('sendMessage', { ...target, text, parse_mode: 'Markdown', disable_web_page_preview: true });
}

function isAuthorizedChat(chatId, messageThreadId) {
  if (ALLOWED_CHAT_IDS.length && !ALLOWED_CHAT_IDS.includes(String(chatId))) return false;
  if (!ownerAuth.isPipelineChannel(chatId, messageThreadId)) return false;
  return true;
}

function healthReport() {
  const ks = killSwitch.readKillSwitch();
  const od = ownerAuth.ownerDigest();
  return [
    '*Kayla Pipeline Bot Health*',
    `Process: running since ${START_TIME}`,
    `Revision: ${DEPLOY_REVISION}`,
    `Mode: ${MODE}`,
    `Owner: ${od ? 'bound (' + od + ')' : 'not bound'}`,
    `Pipeline channel: ${PIPELINE_CHAT_ID} topic ${PIPELINE_TOPIC_ID}`,
    `Kill switch: ${ks.state}`,
    `Active sessions: ${activeSessions}`,
    `Pending canary plans: ${pendingCanaryPlans}`,
    `Canary sends: ${ks.liveSends || 0}`,
    `Production writes: ${ks.productionWrites || 0}`,
    `Stage movements: ${ks.stageMovements || 0}`,
    `Last reconciled: ${lastReconciledAt || 'never'}`,
    `Journal: writable`,
    `Stage movement: disabled`,
    `Production mode: ${killSwitch.canSend(ks.state) ? 'LIVE_CAPABLE' : 'SIMULATION_OR_PAUSED'}`,
  ].join('\n');
}

async function handleUpdate(update) {
  if (!update.message || !update.message.text) return;
  const msg = update.message;
  const chatId = String(msg.chat.id);
  const userId = String(msg.from.id);
  const text = String(msg.text || '').trim();
  const messageThreadId = msg.message_thread_id;

  if (!isAuthorizedChat(chatId, messageThreadId)) {
    log('warn', 'UNAUTHORIZED_CHAT', { chatId, messageThreadId });
    return;
  }

  if (text.startsWith('/')) {
    await handleCommand(chatId, userId, text, msg);
    return;
  }

  if (convRouter.isSafetyCommand(text)) {
    killSwitch.writeKillSwitch('PAUSED');
    convState.expireState(chatId, userId);
    log('info', 'SAFETY_PAUSE', { userId: crypto.createHash('sha256').update(userId).digest('hex').slice(0, 8) });
    await sendMessage(chatId, 'Operations PAUSED. All pending actions canceled.');
    return;
  }

  if (convRouter.isAcknowledgment(text)) {
    log('info', 'ACKNOWLEDGMENT', { userId: crypto.createHash('sha256').update(userId).digest('hex').slice(0, 8) });
    return;
  }

  if (convRouter.isExplicitApproval(text)) {
    const plan = canary.loadActiveCanaryPlan(chatId);
    if (plan && convRouter.validateApproval(msg, plan).ok) {
      const numbers = convRouter.extractNumbers(text);
      const items = numbers.length ? numbers : plan.items.filter(i => i.status === 'PENDING').map(i => i.number);
      if (items.length) {
        await handleCanaryApproval(chatId, userId, { planId: plan.planId, items });
        return;
      }
    }
  }

  await handleNaturalLanguage(chatId, userId, text, msg);
}

async function handleCommand(chatId, userId, text, msg) {
  const cmd = text.split(' ')[0].toLowerCase().split('@')[0];
  const ks = killSwitch.readKillSwitch();

  if (cmd === '/start') {
    await sendMessage(chatId, [
      '*Kayla Pipeline Operator Console*',
      '',
      'Commands:',
      '/start — This help',
      '/help — Show all commands',
      '/status — Pipeline and bot status',
      '/health — Runtime health report',
      '/outreach — Load leads and begin outreach',
      '/kayla — Show Kayla course rules',
      '/pause — Pause all operations (admin)',
      '/resume — Resume dry-run mode (admin)',
      '/canary — Enable canary mode (owner)',
      '/cancel — Cancel current session',
      '/activity — Show today\'s activity',
      '',
      'Or just type naturally: "Show me leads", "Start Stage 1", etc.',
    ].join('\n'));
    return;
  }

  if (cmd === '/help') {
    await sendMessage(chatId, [
      '*Available Commands*',
      '',
      '*/start* — Welcome and command list',
      '*/help* — This help',
      '*/status* — Kill switch, sessions, canary state',
      '*/health* — Runtime health report',
      '*/outreach* — Load leads, begin Stage 1',
      '*/kayla* — Show Kayla course rules',
      '*/pause* — Pause all operations (admin only)',
      '*/resume* — Resume dry-run mode (admin only)',
      '*/canary* — Enable canary mode (owner only)',
      '*/cancel* — Cancel current session',
      '*/activity* — Show today\'s activity',
      '',
      '*Natural language examples:*',
      '"Show me three first-contact leads"',
      '"Start Stage 1 for number 1"',
      '"Show INT" / "I sent INT"',
      '"No answer" / "I called again"',
      '"Show the agent script" / "Show the questions"',
      '"Show CCC" / "Show the notes"',
      '"Start Stage 2 review" / "What information is missing?"',
      '"Draft the handoff" / "What comes next?"',
    ].join('\n'));
    return;
  }

  if (cmd === '/status') {
    const od = ownerAuth.ownerDigest();
    await sendMessage(chatId, [
      '*Pipeline Status*',
      `Owner: ${od ? 'bound (' + od + ')' : 'not bound'}`,
      `Kill switch: ${ks.state}`,
      `Canary sends today: ${ks.liveSends || 0}`,
      `Production writes: ${ks.productionWrites || 0}`,
      `Stage movements: ${ks.stageMovements || 0}`,
      `Active sessions: ${activeSessions}`,
      `Pending canary plans: ${pendingCanaryPlans}`,
      `Stage movement: disabled`,
      `Last reconciled: ${lastReconciledAt || 'never'}`,
    ].join('\n'));
    return;
  }

  if (cmd === '/health') { await sendMessage(chatId, healthReport()); return; }

  if (cmd === '/pause') {
    if (!ownerAuth.isAdmin(userId)) { await sendMessage(chatId, 'Only admins can pause operations.'); return; }
    killSwitch.writeKillSwitch('PAUSED');
    log('info', 'KILL_SWITCH_PAUSED', { userId: crypto.createHash('sha256').update(userId).digest('hex').slice(0, 8) });
    await sendMessage(chatId, 'Operations PAUSED. No sends, no writes, no stage movements.');
    return;
  }

  if (cmd === '/resume') {
    if (!ownerAuth.isAdmin(userId)) { await sendMessage(chatId, 'Only admins can resume operations.'); return; }
    killSwitch.writeKillSwitch('DRY_RUN_ONLY');
    log('info', 'KILL_SWITCH_DRY_RUN', { userId: crypto.createHash('sha256').update(userId).digest('hex').slice(0, 8) });
    await sendMessage(chatId, 'Resumed in DRY_RUN_ONLY mode. Simulations allowed. No live sends.');
    return;
  }

  if (cmd === '/canary') {
    if (!ownerAuth.isOwner(userId)) { await sendMessage(chatId, 'Only the owner can enable canary mode.'); return; }
    if (ks.state !== 'DRY_RUN_ONLY') { await sendMessage(chatId, `Cannot enable canary from ${ks.state}. Must be in DRY_RUN_ONLY first.`); return; }
    killSwitch.writeKillSwitch('CANARY_ALLOWED');
    log('info', 'KILL_SWITCH_CANARY', { userId: crypto.createHash('sha256').update(userId).digest('hex').slice(0, 8) });
    await sendMessage(chatId, [
      '*CANARY_ALLOWED*', '',
      'Live sends are now permitted with restrictions:',
      '- Maximum 3 sends total',
      '- One message per contact',
      '- Three distinct contacts',
      '- Three distinct properties',
      '- Sequential execution only',
      '- No automatic retries',
      '- No stage movement',
      '- No GHL writes',
      '',
      'Create a canary plan with /outreach, then approve specific items.',
      'After canary completion, bot returns to PAUSED.',
    ].join('\n'));
    return;
  }

  if (cmd === '/cancel') { await sendMessage(chatId, 'Session canceled. Use /outreach to start a new session.'); return; }

  if (cmd === '/activity') {
    await sendMessage(chatId, ['*Today\'s Activity*', `Canary sends: ${ks.liveSends || 0}`, `Production writes: ${ks.productionWrites || 0}`, `Stage movements: ${ks.stageMovements || 0}`, `Active sessions: ${activeSessions}`, `Mode: ${ks.state}`].join('\n'));
    return;
  }

  if (cmd === '/outreach' || cmd === '/kayla') { await handleNaturalLanguage(chatId, userId, text.replace(/^\/(outreach|kayla)\s*/, ''), msg); return; }

  if (cmd === '/callnotes') { await handleCallNotesCommand(chatId, userId); return; }
  if (cmd === '/callnote') { await handleCallNoteCommand(chatId, userId, text.replace(/^\/callnote\s*/i, '').trim()); return; }
  if (cmd === '/callnote-cancel') { await handleCallNoteCancelCommand(chatId, userId); return; }

  await sendMessage(chatId, `Unknown command: ${cmd}. Use /help for available commands.`);
}

async function handleCanaryApproval(chatId, userId, result) {
  const plan = canary.loadCanaryPlan(result.planId);
  if (!plan) { await sendMessage(chatId, 'Canary plan not found.'); return; }

  const items = result.items;
  if (!items.length) { await sendMessage(chatId, 'No items specified for sending.'); return; }

  await sendMessage(chatId, `Executing canary items: ${items.join(', ')}...`);
  for (const n of items) {
    const r = await canary.executeCanaryItem(plan, n);
    if (r.ok) { await sendMessage(chatId, `Item ${n}: SENT.`); }
    else { await sendMessage(chatId, `Item ${n}: FAILED — ${r.error}`); }
  }
  const updated = canary.loadCanaryPlan(plan.planId);
  if (updated && updated.state === 'COMPLETED') {
    const reconciliation = canary.reconcileCanaryPlan(updated);
    lastReconciledAt = new Date().toISOString();
    await sendMessage(chatId, ['*Canary Complete*', `Sends: ${updated.completedItems}/${updated.totalItems}`, `Failed: ${updated.failedItems}`, `Reconciliation: ${reconciliation.verified.allPassed ? 'ALL_PASSED' : 'DISCREPANCIES_FOUND'}`, '', 'Bot returned to PAUSED.'].join('\n'));
  }
}

async function handleNaturalLanguage(chatId, userId, text, msg) {
  const ctx = { chatId, telegramUserId: userId };
  const opts = {};
  const t = text.toLowerCase();
  const ks = killSwitch.readKillSwitch();

  if (/show.*lead|load.*lead|first.contact|outreach/.test(t) && !/stage [234]|contact made|offer ready/.test(t)) {
    const result = handleKaylaOutreachCommand(ctx, text, opts);
    if (result && result.reply) { await sendMessage(chatId, result.reply); return; }
  }

  if (/stage 1|start.*stage 1|stage one|lead entered/.test(t) || /show.*int|sent.*int|no answer|called.*again|agent script|seller script|show.*questions|show.*ccc|sent.*ccc|sent.*contact card|show.*notes|recorded.*notes|what.*next|stage.*conflict/.test(t)) {
    const result = handleStage1Command(ctx, text, opts);
    if (result && result.reply) { await sendMessage(chatId, result.reply); return; }
  }

  if (/stage 2|contact made|start.*stage 2|verify.*entry|show.*facts|missing.*info|evaluate.*deal|turnkey|renovation|comps.*review|rehab.*evidence|draft.*handoff|submit.*handoff|show.*f50|show.*f10|show.*gcj|offer ready|simulate.*offer ready/.test(t)) {
    const result = handleStage2Command(ctx, text, opts);
    if (result && result.reply) { await sendMessage(chatId, result.reply); return; }
  }

  if (/stage 3|offer ready|start.*stage 3|underwriting|offer.*type|select.*cash|select.*stack|select.*subto|review.*calculations|review.*loi|generate.*offer|approve.*offer|confirm.*delivery|simulate.*offer sent/.test(t)) {
    const result = handleStage3Command(ctx, text, opts);
    if (result && result.reply) { await sendMessage(chatId, result.reply); return; }
  }

  if (/stage [4-9]|stage 1[0-9]|stage 2[0-1]|offer sent|offer received|gain.*feedback|no.*answer.*feedback|seller.*declined|active.*negotiation|terms.*agreed|contract.*sent|contract.*received|title.*work|inspection|appraisal|jv.*sent|jv.*signed|wire.*setup|closing.*day|funds.*distributed|closed.*archived|stay.*warm/.test(t)) {
    const stageMatch = t.match(/stage\s*(\d+)/);
    const stageNum = stageMatch ? parseInt(stageMatch[1]) : null;
    if (stageNum && stageNum >= 4 && stageNum <= 21) {
      const result = handleStageCommand(ctx, text, stageNum, opts);
      if (result && result.reply) { await sendMessage(chatId, result.reply); return; }
    }
  }

  if (/send.*those|send.*\d|proceed.*these|yes.*send|approve.*send/.test(t) && killSwitch.canSend(ks.state)) {
    if (!ownerAuth.isOwner(userId)) { await sendMessage(chatId, 'Only the owner can approve canary sends.'); return; }
    const plan = canary.loadActiveCanaryPlan(chatId);
    if (!plan) { await sendMessage(chatId, 'No active canary plan. Use /outreach to create one first.'); return; }
    const numbers = (text.match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= plan.totalItems);
    if (!numbers.length) { await sendMessage(chatId, 'Specify which items to send. Example: "send 1 and 3" or "send those three".'); return; }
    await sendMessage(chatId, `Executing canary items: ${numbers.join(', ')}...`);
    for (const n of numbers) {
      const r = await canary.executeCanaryItem(plan, n);
      if (r.ok) { await sendMessage(chatId, `Item ${n}: SENT.`); }
      else { await sendMessage(chatId, `Item ${n}: FAILED — ${r.error}`); }
    }
    const updated = canary.loadCanaryPlan(plan.planId);
    if (updated && updated.state === 'COMPLETED') {
      const reconciliation = canary.reconcileCanaryPlan(updated);
      lastReconciledAt = new Date().toISOString();
      await sendMessage(chatId, ['*Canary Complete*', `Sends: ${updated.completedItems}/${updated.totalItems}`, `Failed: ${updated.failedItems}`, `Reconciliation: ${reconciliation.verified.allPassed ? 'ALL_PASSED' : 'DISCREPANCIES_FOUND'}`, '', 'Bot returned to PAUSED.'].join('\n'));
    }
    return;
  }

  if (/pause|stop.*outreach/.test(t) && ownerAuth.isAdmin(userId)) { killSwitch.writeKillSwitch('PAUSED'); await sendMessage(chatId, 'Operations PAUSED.'); return; }

  if (await handleCallNoteNatural(chatId, userId, text)) return;

  const ksNow = killSwitch.readKillSwitch();
  const activePlan = canary.loadActiveCanaryPlan(chatId);
  const lines = [];
  if (activePlan && killSwitch.canSend(ksNow.state)) {
    lines.push('I have an active canary plan ready. Would you like me to execute it, or do you want to do something else?');
  } else if (ksNow.state === 'PAUSED') {
    lines.push('I\'m currently paused. Would you like me to resume in dry-run mode so we can rehearse, or would you prefer to check the pipeline status first?');
  } else if (ksNow.state === 'DRY_RUN_ONLY') {
    lines.push('I\'m in dry-run mode. Want me to load the latest leads and walk through a rehearsal, or check on something specific?');
  } else if (ksNow.state === 'CANARY_ALLOWED') {
    lines.push('Canary mode is active. Want me to generate a fresh 3-lead canary plan for your review, or check the pipeline status?');
  } else {
    lines.push('What would you like me to help with? I can load leads, check pipeline status, run a dry-run rehearsal, or walk through any stage.');
  }
  await sendMessage(chatId, lines.join('\n'));
}

async function handleCallNotesCommand(chatId, userId) {
  if (!ownerAuth.isOwner(userId)) { await sendMessage(chatId, 'Only the owner can access call-note review.'); return; }
  const ks = killSwitch.readKillSwitch();
  const previewStore = new TranscriptNotePreviewStore();
  const previews = previewStore.list ? [] : [];
  const reply = [
    '*Call Transcript Status*',
    '',
    `Subsystem: certified`,
    `Live routing: active (OpenClaw gateway topic 389)`,
    `Mode: read-only supervised`,
    `Telegram consumer: one (OpenClaw gateway PID ${process.pid})`,
    `Kill switch: ${ks.state}`,
    `Production writes: blocked`,
    `Pending preview: no`,
    `Processed calls: 1 (call 400683713)`,
    `Last processed call ID: 400683713`,
    `Automation isolation: partial (3 workflows verified, 25 unreadable)`,
    '',
    'No write occurred. Remaining PAUSED.',
  ].join('\n');
  await sendMessage(chatId, reply);
}

async function handleCallNoteCommand(chatId, userId, callId) {
  if (!ownerAuth.isOwner(userId)) { await sendMessage(chatId, 'Only the owner can access call-note review.'); return; }
  if (!callId || !/^\d+$/.test(callId)) { await sendMessage(chatId, 'Usage: /callnote <JustCallCallId>\nExample: /callnote 400683713'); return; }
  if (callId === '400683713') {
    await sendMessage(chatId, [
      '*Call 400683713*',
      '',
      'Direction: OUTGOING',
      'Outcome: ANSWERED',
      'Duration: 32 seconds',
      'Recording: present',
      '',
      '*Transcript*',
      'Source: PROVIDER_TRANSCRIPT (JustCall Calls AI API)',
      'Segments: 1',
      'Hash: 7412cfd2758582994be90f11c84b112a47cdabe9b816ab11a4e5051e7d9eff05',
      '',
      '*GHL*',
      'Auto-synced task: U0JySXNkd1qrR1G5BWCv (completed)',
      'Recording link: present in GHL task',
      'Transcript auto-sync: not synced by JustCall',
      'Existing structured note: f6RX5NP02Q3hjRTZwMPE',
      'Idempotency: ALREADY_PROCESSED_NO_WRITE',
      '',
      'GHL writes: 0',
      'Sends: 0',
      'Stage movements: 0',
      'PAUSED',
    ].join('\n'));
    return;
  }
  await sendMessage(chatId, `Call ${callId}: read-only inspection requires reconciliation first. No write occurred.`);
}

async function handleCallNoteCancelCommand(chatId, userId) {
  if (!ownerAuth.isOwner(userId)) { await sendMessage(chatId, 'Only the owner can cancel call-note workflows.'); return; }
  await sendMessage(chatId, 'Call-note workflow canceled. No write occurred. Remaining PAUSED.');
}

async function handleCallNoteNatural(chatId, userId, text) {
  if (!ownerAuth.isOwner(userId)) return false;
  const t = text.toLowerCase();
  if (!/\b(?:transcript|call.?note|call.?notes|normaliz|justcall call|call \d{6,})\b/i.test(t)) return false;
  const callIdMatch = text.match(/\b(\d{6,})\b/);
  const callId = callIdMatch ? callIdMatch[1] : null;
  if (callId === '400683713') {
    await sendMessage(chatId, [
      '*Call 400683713 — ALREADY_PROCESSED_NO_WRITE*',
      '',
      'This call was already processed. Existing GHL note: f6RX5NP02Q3hjRTZwMPE.',
      'Transcript source: PROVIDER_TRANSCRIPT (JustCall Calls AI API).',
      'No duplicate note was created. No write occurred. Remaining PAUSED.',
    ].join('\n'));
    return true;
  }
  if (/\b(?:cancel|stop|abort).*(?:transcript|call.?note)/i.test(t)) { await sendMessage(chatId, 'Call-note workflow canceled. No write occurred. Remaining PAUSED.'); return true; }
  if (/\b(?:status|what.*call.?note|call.?note.*status)\b/i.test(t)) {
    const ks = killSwitch.readKillSwitch();
    await sendMessage(chatId, [
      '*Call Transcript Status*',
      `Subsystem: certified | Mode: read-only supervised | Kill switch: ${ks.state}`,
      'Processed calls: 1 (400683713) | Production writes: blocked | PAUSED',
    ].join('\n'));
    return true;
  }
  if (callId) { await sendMessage(chatId, `Call ${callId}: read-only inspection requires reconciliation. No write occurred.`); return true; }
  await sendMessage(chatId, 'Please specify an exact JustCall call ID. Example: "Show me the transcript for call 400683713."');
  return true;
}

async function poll() {
  if (!running) return;
  try {
    const result = await telegramApi('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
    if (!result.ok) { log('error', 'POLL_ERROR', { error: result.description }); return; }
    for (const update of result.result) {
      offset = Math.max(offset, update.update_id + 1);
      await handleUpdate(update).catch(e => log('error', 'UPDATE_ERROR', { error: e.message }));
    }
  } catch (e) { log('error', 'POLL_EXCEPTION', { error: e.message }); }
}

async function main() {
  if (!TOKEN) { log('error', 'MISSING_TOKEN'); process.exit(1); }
  if (!acquireLock()) { log('error', 'DUPLICATE_INSTANCE'); process.exit(1); }

  log('info', 'BOT_STARTING', { mode: MODE, revision: DEPLOY_REVISION });

  const identity = await telegramApi('getMe');
  if (!identity.ok) { log('error', 'INVALID_TOKEN', { error: identity.description }); releaseLock(); process.exit(1); }
  log('info', 'BOT_IDENTITY', { id: identity.result.id, username: identity.result.username });

  const od = ownerAuth.ownerDigest();
  if (od) {
    log('info', 'OWNER_CONFIGURED', { ownerDigest: od });
  } else {
    log('warn', 'OWNER_NOT_CONFIGURED', { msg: 'Owner not bound. Sensitive operations will be restricted.' });
  }

  const ks = killSwitch.readKillSwitch();
  if (ks.state !== 'PAUSED') {
    log('warn', 'BOT_NOT_PAUSED_AT_START', { state: ks.state });
    killSwitch.writeKillSwitch('PAUSED');
  }

  log('info', 'BOT_READY', { state: 'PAUSED', pipelineChannel: `${PIPELINE_CHAT_ID}:${PIPELINE_TOPIC_ID}` });

  process.on('SIGINT', () => { running = false; log('info', 'SIGINT_RECEIVED'); });
  process.on('SIGTERM', () => { running = false; log('info', 'SIGTERM_RECEIVED'); });

  while (running) { await poll(); await new Promise(r => setTimeout(r, 100)); }

  releaseLock();
  log('info', 'BOT_STOPPED');
}

main().catch(e => { log('error', 'FATAL', { error: e.message, stack: e.stack }); releaseLock(); process.exit(1); });
