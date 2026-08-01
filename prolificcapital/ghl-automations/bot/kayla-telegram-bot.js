'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const killSwitch = require('./kill-switch');
const canary = require('./canary-executor');
const { handleKaylaOutreachCommand, parseStage1Intent, handleStage1Command, canaryPreviewForIntent, formatCanaryPreview } = require('../modules/kayla-telegram-outreach');
const { handleStage2Command } = require('../modules/kayla-stage2-telegram');
const { handleStage3Command } = require('../modules/kayla-stage3-telegram');
const { handleStageCommand } = require('../modules/kayla-stages-4-21-telegram');

const BOT_DIR = path.resolve(__dirname);
const LOG_DIR = path.resolve(BOT_DIR, '..', 'logs');
const SESSION_DIR = path.resolve(BOT_DIR, '..', 'data', 'bot-sessions');
const LOCK_FILE = path.resolve(BOT_DIR, '..', 'data', 'bot.lock');

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.TELEGRAM_OWNER_USER_ID;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const MODE = process.env.TELEGRAM_MODE || 'polling';
const DEPLOY_REVISION = process.env.DEPLOY_REVISION || 'dev';
const START_TIME = new Date().toISOString();

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
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'bot.log'), line + '\n');
  } catch (_) {}
}

function redactSecrets(obj) {
  const r = { ...obj };
  for (const k of Object.keys(r)) {
    if (/token|key|secret|password|auth/i.test(k)) r[k] = '***REDACTED***';
  }
  return r;
}

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const age = Date.now() - new Date(existing.started).getTime();
      if (age < 5 * 60 * 1000) {
        log('error', 'LOCK_ACQUIRE_FAILED', { existing, age });
        return false;
      }
      log('warn', 'STALE_LOCK_CLEARED', { existing, age });
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), mode: MODE }));
    return true;
  } catch (e) {
    log('error', 'LOCK_ERROR', { error: e.message });
    return false;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
}

function telegramApi(method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 30000,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(data);
    req.end();
  });
}

function sendMessage(chatId, text, extra = {}) {
  return telegramApi('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true, ...extra });
}

function isAuthorized(userId, chatId) {
  if (ALLOWED_CHAT_IDS.length && !ALLOWED_CHAT_IDS.includes(String(chatId))) return false;
  return true;
}

function isAdmin(userId) {
  if (String(userId) === OWNER_ID) return true;
  if (ADMIN_IDS.includes(String(userId))) return true;
  return false;
}

function isOwner(userId) {
  return String(userId) === OWNER_ID;
}

function healthReport() {
  const ks = killSwitch.readKillSwitch();
  return [
    '*Kayla Pipeline Bot Health*',
    `Process: running since ${START_TIME}`,
    `Revision: ${DEPLOY_REVISION}`,
    `Mode: ${MODE}`,
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

  if (!isAuthorized(userId, chatId)) {
    log('warn', 'UNAUTHORIZED_USER', { userId, chatId });
    return;
  }

  const ks = killSwitch.readKillSwitch();
  const isPaused = killSwitch.isPaused(ks.state);

  if (text.startsWith('/')) {
    await handleCommand(chatId, userId, text, ks);
    return;
  }

  if (isPaused && !isAdmin(userId)) {
    await sendMessage(chatId, 'Bot is PAUSED. Only admins can interact while paused.');
    return;
  }

  await handleNaturalLanguage(chatId, userId, text, ks);
}

async function handleCommand(chatId, userId, text, ks) {
  const cmd = text.split(' ')[0].toLowerCase().replace('@', '').split('@')[0];

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
      '"Show the agent script"',
      '"Show the questions"',
      '"Show CCC" / "Show the notes"',
      '"Start Stage 2 review"',
      '"What information is missing?"',
      '"Draft the handoff"',
      '"What comes next?"',
    ].join('\n'));
    return;
  }

  if (cmd === '/status') {
    const ks = killSwitch.readKillSwitch();
    await sendMessage(chatId, [
      '*Pipeline Status*',
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

  if (cmd === '/health') {
    await sendMessage(chatId, healthReport());
    return;
  }

  if (cmd === '/pause') {
    if (!isAdmin(userId)) {
      await sendMessage(chatId, 'Only admins can pause operations.');
      return;
    }
    killSwitch.writeKillSwitch('PAUSED');
    log('info', 'KILL_SWITCH_PAUSED', { userId });
    await sendMessage(chatId, 'Operations PAUSED. No sends, no writes, no stage movements.');
    return;
  }

  if (cmd === '/resume') {
    if (!isAdmin(userId)) {
      await sendMessage(chatId, 'Only admins can resume operations.');
      return;
    }
    killSwitch.writeKillSwitch('DRY_RUN_ONLY');
    log('info', 'KILL_SWITCH_DRY_RUN', { userId });
    await sendMessage(chatId, 'Resumed in DRY_RUN_ONLY mode. Simulations allowed. No live sends.');
    return;
  }

  if (cmd === '/canary') {
    if (!isOwner(userId)) {
      await sendMessage(chatId, 'Only the owner can enable canary mode.');
      return;
    }
    if (ks.state !== 'DRY_RUN_ONLY') {
      await sendMessage(chatId, `Cannot enable canary from ${ks.state}. Must be in DRY_RUN_ONLY first. Use /resume then /canary.`);
      return;
    }
    killSwitch.writeKillSwitch('CANARY_ALLOWED');
    log('info', 'KILL_SWITCH_CANARY', { userId });
    await sendMessage(chatId, [
      '*CANARY_ALLOWED*',
      '',
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

  if (cmd === '/cancel') {
    await sendMessage(chatId, 'Session canceled. Use /outreach to start a new session.');
    return;
  }

  if (cmd === '/activity') {
    const ks = killSwitch.readKillSwitch();
    await sendMessage(chatId, [
      '*Today\'s Activity*',
      `Canary sends: ${ks.liveSends || 0}`,
      `Production writes: ${ks.productionWrites || 0}`,
      `Stage movements: ${ks.stageMovements || 0}`,
      `Active sessions: ${activeSessions}`,
      `Mode: ${ks.state}`,
    ].join('\n'));
    return;
  }

  if (cmd === '/outreach' || cmd === '/kayla') {
    await handleNaturalLanguage(chatId, userId, text.replace(/^\/(outreach|kayla)\s*/, ''), ks);
    return;
  }

  await sendMessage(chatId, `Unknown command: ${cmd}. Use /help for available commands.`);
}

async function handleNaturalLanguage(chatId, userId, text, ks) {
  const ctx = { chatId, telegramUserId: userId };
  const opts = {};

  const t = text.toLowerCase();

  if (/show.*lead|load.*lead|first.contact|outreach/.test(t) && !/stage [234]|contact made|offer ready/.test(t)) {
    const result = handleKaylaOutreachCommand(ctx, text, opts);
    if (result && result.reply) {
      await sendMessage(chatId, result.reply);
      return;
    }
  }

  if (/stage 1|start.*stage 1|stage one|lead entered/.test(t) || /show.*int|sent.*int|no answer|called.*again|agent script|seller script|show.*questions|show.*ccc|sent.*ccc|sent.*contact card|show.*notes|recorded.*notes|what.*next|stage.*conflict/.test(t)) {
    const result = handleStage1Command(ctx, text, opts);
    if (result && result.reply) {
      await sendMessage(chatId, result.reply);
      return;
    }
  }

  if (/stage 2|contact made|start.*stage 2|verify.*entry|show.*facts|missing.*info|evaluate.*deal|turnkey|renovation|comps.*review|rehab.*evidence|draft.*handoff|submit.*handoff|show.*f50|show.*f10|show.*gcj|offer ready|simulate.*offer ready/.test(t)) {
    const result = handleStage2Command(ctx, text, opts);
    if (result && result.reply) {
      await sendMessage(chatId, result.reply);
      return;
    }
  }

  if (/stage 3|offer ready|start.*stage 3|underwriting|offer.*type|select.*cash|select.*stack|select.*subto|review.*calculations|review.*loi|generate.*offer|approve.*offer|confirm.*delivery|simulate.*offer sent/.test(t)) {
    const result = handleStage3Command(ctx, text, opts);
    if (result && result.reply) {
      await sendMessage(chatId, result.reply);
      return;
    }
  }

  if (/stage [4-9]|stage 1[0-9]|stage 2[0-1]|offer sent|offer received|gain.*feedback|no.*answer.*feedback|seller.*declined|active.*negotiation|terms.*agreed|contract.*sent|contract.*received|title.*work|inspection|appraisal|jv.*sent|jv.*signed|wire.*setup|closing.*day|funds.*distributed|closed.*archived|stay.*warm/.test(t)) {
    const stageMatch = t.match(/stage\s*(\d+)/);
    const stageNum = stageMatch ? parseInt(stageMatch[1]) : null;
    if (stageNum && stageNum >= 4 && stageNum <= 21) {
      const result = handleStageCommand(ctx, text, stageNum, opts);
      if (result && result.reply) {
        await sendMessage(chatId, result.reply);
        return;
      }
    }
  }

  if (/send.*those|send.*\d|proceed.*these|yes.*send|approve.*send/.test(t) && killSwitch.canSend(ks.state)) {
    const plan = canary.loadActiveCanaryPlan(chatId);
    if (!plan) {
      await sendMessage(chatId, 'No active canary plan. Use /outreach to create one first.');
      return;
    }
    if (!isOwner(userId)) {
      await sendMessage(chatId, 'Only the owner can approve canary sends.');
      return;
    }
    const numbers = (text.match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= plan.totalItems);
    if (!numbers.length) {
      await sendMessage(chatId, 'Specify which items to send. Example: "send 1 and 3" or "send those three".');
      return;
    }
    await sendMessage(chatId, `Executing canary items: ${numbers.join(', ')}...`);
    for (const n of numbers) {
      const result = await canary.executeCanaryItem(plan, n);
      if (result.ok) {
        await sendMessage(chatId, `Item ${n}: SENT. Provider ID: ${result.item.providerMessageId}`);
      } else {
        await sendMessage(chatId, `Item ${n}: FAILED — ${result.error}`);
      }
    }
    const updated = canary.loadCanaryPlan(plan.planId);
    if (updated && updated.state === 'COMPLETED') {
      const reconciliation = canary.reconcileCanaryPlan(updated);
      lastReconciledAt = new Date().toISOString();
      await sendMessage(chatId, [
        '*Canary Complete*',
        `Sends: ${updated.completedItems}/${updated.totalItems}`,
        `Failed: ${updated.failedItems}`,
        `Reconciliation: ${reconciliation.verified.allPassed ? 'ALL_PASSED' : 'DISCREPANCIES_FOUND'}`,
        '',
        'Bot returned to PAUSED.',
      ].join('\n'));
    }
    return;
  }

  if (/pause|stop.*outreach/.test(t) && isAdmin(userId)) {
    killSwitch.writeKillSwitch('PAUSED');
    await sendMessage(chatId, 'Operations PAUSED.');
    return;
  }

  await sendMessage(chatId, [
    'I didn\'t understand that. Try:',
    '',
    '/outreach — Load leads and begin Stage 1',
    '/status — Check pipeline status',
    '/help — See all commands',
    '',
    'Or type naturally: "Show me leads", "Start Stage 1", "Show INT", etc.',
  ].join('\n'));
}

async function poll() {
  if (!running) return;
  try {
    const result = await telegramApi('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
    if (!result.ok) {
      log('error', 'POLL_ERROR', { error: result.description });
      return;
    }
    for (const update of result.result) {
      offset = Math.max(offset, update.update_id + 1);
      await handleUpdate(update).catch(e => log('error', 'UPDATE_ERROR', { error: e.message }));
    }
  } catch (e) {
    log('error', 'POLL_EXCEPTION', { error: e.message });
  }
}

async function main() {
  if (!TOKEN) {
    log('error', 'MISSING_TOKEN', { msg: 'TELEGRAM_BOT_TOKEN not set' });
    process.exit(1);
  }

  if (!acquireLock()) {
    log('error', 'DUPLICATE_INSTANCE');
    process.exit(1);
  }

  log('info', 'BOT_STARTING', { mode: MODE, revision: DEPLOY_REVISION });

  const identity = await telegramApi('getMe');
  if (!identity.ok) {
    log('error', 'INVALID_TOKEN', { error: identity.description });
    releaseLock();
    process.exit(1);
  }
  log('info', 'BOT_IDENTITY', { id: identity.result.id, username: identity.result.username });

  const ks = killSwitch.readKillSwitch();
  if (ks.state !== 'PAUSED') {
    log('warn', 'BOT_NOT_PAUSED_AT_START', { state: ks.state });
    killSwitch.writeKillSwitch('PAUSED');
    log('info', 'FORCED_PAUSED');
  }

  log('info', 'BOT_READY', { state: 'PAUSED', mode: MODE });

  process.on('SIGINT', () => { running = false; log('info', 'SIGINT_RECEIVED'); });
  process.on('SIGTERM', () => { running = false; log('info', 'SIGTERM_RECEIVED'); });

  while (running) {
    await poll();
    await new Promise(r => setTimeout(r, 100));
  }

  releaseLock();
  log('info', 'BOT_STOPPED');
}

main().catch(e => {
  log('error', 'FATAL', { error: e.message, stack: e.stack });
  releaseLock();
  process.exit(1);
});
