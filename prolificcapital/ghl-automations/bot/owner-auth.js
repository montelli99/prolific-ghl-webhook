'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let _ownerConfigPath = path.resolve(__dirname, '..', 'data', 'owner-config.json');
let _bootstrapCodePath = path.resolve(__dirname, '..', 'data', 'bootstrap-code.json');

function ownerConfigPath() { return _ownerConfigPath; }
function bootstrapCodePath() { return _bootstrapCodePath; }
function setOwnerConfigPath(p) { _ownerConfigPath = p; }
function setBootstrapCodePath(p) { _bootstrapCodePath = p; }

function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function readOwnerConfig() {
  try {
    const raw = fs.readFileSync(ownerConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    if (config.integrityDigest !== stableHash({ ownerId: config.ownerId, chatId: config.chatId, boundAt: config.boundAt })) {
      return null;
    }
    return config;
  } catch (_) {
    return null;
  }
}

function writeOwnerConfig(ownerId, chatId, username) {
  const config = {
    ownerId: String(ownerId),
    chatId: String(chatId),
    username: username || null,
    boundAt: new Date().toISOString(),
  };
  config.integrityDigest = stableHash({ ownerId: config.ownerId, chatId: config.chatId, boundAt: config.boundAt });
  fs.mkdirSync(path.dirname(ownerConfigPath()), { recursive: true });
  const tmp = ownerConfigPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, ownerConfigPath());
  return config;
}

function generateBootstrapCode() {
  const code = crypto.randomBytes(16).toString('hex');
  const bootstrap = {
    code,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    used: false,
  };
  fs.mkdirSync(path.dirname(bootstrapCodePath()), { recursive: true });
  const tmp = bootstrapCodePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(bootstrap, null, 2) + '\n');
  fs.renameSync(tmp, bootstrapCodePath());
  return bootstrap;
}

function readBootstrapCode() {
  try {
    const raw = fs.readFileSync(bootstrapCodePath(), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function invalidateBootstrapCode() {
  try {
    const bootstrap = readBootstrapCode();
    if (bootstrap) {
      bootstrap.used = true;
      bootstrap.usedAt = new Date().toISOString();
      fs.writeFileSync(bootstrapCodePath(), JSON.stringify(bootstrap, null, 2) + '\n');
    }
  } catch (_) {}
}

function isBootstrapRequired() {
  const owner = readOwnerConfig();
  if (owner) return false;
  const envOwner = process.env.TELEGRAM_OWNER_USER_ID;
  if (envOwner) return false;
  return true;
}

function getOwnerId() {
  const owner = readOwnerConfig();
  if (owner) return owner.ownerId;
  return process.env.TELEGRAM_OWNER_USER_ID || null;
}

function getOwnerChatId() {
  const owner = readOwnerConfig();
  if (owner) return owner.chatId;
  return null;
}

function isOwner(userId) {
  const ownerId = getOwnerId();
  return ownerId ? String(userId) === String(ownerId) : false;
}

function isAdmin(userId) {
  if (isOwner(userId)) return true;
  const adminIds = (process.env.TELEGRAM_ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return adminIds.includes(String(userId));
}

function isPrivateChat(chatType) {
  return chatType === 'private';
}

function isForwarded(msg) {
  return !!(msg && (msg.forward_date || msg.forward_from || msg.forward_from_chat));
}

function isBotAccount(msg) {
  return !!(msg && msg.from && msg.from.is_bot);
}

function isEdited(msg) {
  return !!(msg && msg.edit_date);
}

function validateOwnerRequest(msg) {
  if (!msg || !msg.from) return { ok: false, reason: 'NO_SENDER' };
  if (isBotAccount(msg)) return { ok: false, reason: 'BOT_ACCOUNT' };
  if (isForwarded(msg)) return { ok: false, reason: 'FORWARDED_MESSAGE' };
  if (isEdited(msg)) return { ok: false, reason: 'EDITED_MESSAGE' };
  if (!isPrivateChat(msg.chat?.type)) return { ok: false, reason: 'NOT_PRIVATE_CHAT' };
  return { ok: true, userId: String(msg.from.id), chatId: String(msg.chat.id), username: msg.from.username || null };
}

function ownerDigest() {
  const ownerId = getOwnerId();
  return ownerId ? stableHash({ ownerId }).slice(0, 16) : null;
}

module.exports = {
  ownerConfigPath,
  bootstrapCodePath,
  setOwnerConfigPath,
  setBootstrapCodePath,
  readOwnerConfig,
  writeOwnerConfig,
  generateBootstrapCode,
  readBootstrapCode,
  invalidateBootstrapCode,
  isBootstrapRequired,
  getOwnerId,
  getOwnerChatId,
  isOwner,
  isAdmin,
  isPrivateChat,
  isForwarded,
  isBotAccount,
  isEdited,
  validateOwnerRequest,
  ownerDigest,
};
