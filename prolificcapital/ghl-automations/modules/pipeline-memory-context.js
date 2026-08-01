'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CORRECTIONS_PATH = path.join(DATA_DIR, 'pipeline-corrections.jsonl');
const PROPOSALS_PATH = path.join(DATA_DIR, 'pipeline-improvement-proposals.jsonl');
const PREFERENCES_PATH = path.join(DATA_DIR, 'pipeline-preferences.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function stableHash(v) { return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
function memId() { return `mem_${crypto.randomBytes(6).toString('hex')}`; }

function readJsonl(p) { try { const r = fs.readFileSync(p, 'utf8'); return r.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (_) { return []; } }
function appendJsonl(p, e) { fs.appendFileSync(p, JSON.stringify(e) + '\n'); }
function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fb; } }
function writeJson(p, v) { const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2) + '\n'); fs.renameSync(t, p); }

const AUTHORITY = { LIVE_SAFETY: 1, CANONICAL: 2, LIVE_OPERATIONAL: 3, VERIFIED_EPISODIC: 4, OWNER_PREFERENCE: 5, DERIVED: 6, STALE: 7 };

function getConversationContext(chatId, userId) {
  const convState = require('../bot/conversation-state');
  const ks = require('../bot/kill-switch').readKillSwitch();
  const ctx = convState.getConversationContext(chatId, userId);
  return {
    active: ctx.active, currentStage: ctx.currentStage, currentSessionId: ctx.currentSessionId,
    selectedLead: ctx.selectedLead, activePlanId: ctx.activePlanId,
    pendingQuestion: ctx.pendingQuestion, expectedAnswerType: ctx.expectedAnswerType,
    contactPath: ctx.contactPath, recentCorrections: ctx.corrections,
    killSwitch: ks.state, liveSends: ks.liveSends || 0, productionWrites: ks.productionWrites || 0,
    stageMovements: ks.stageMovements || 0, authority: AUTHORITY.LIVE_OPERATIONAL,
  };
}

function getLeadContext(opportunityId, contactId) {
  const dry = require('./telegram-outreach-dry-run');
  const sessions = readJsonl(path.join(DATA_DIR, 'telegram-outreach-dry-run', 'sessions.json'));
  const journal = readJsonl(path.join(DATA_DIR, 'telegram-outreach-dry-run', 'journal.jsonl'));
  const relevant = journal.filter(e => e.opportunityId === opportunityId || e.contactId === contactId).slice(-20);
  return { sessions: sessions.slice(-5), journalEntries: relevant, authority: AUTHORITY.VERIFIED_EPISODIC };
}

function getCanonicalRules() {
  const spec = require('./kayla-course-spec');
  const registry = require('./kayla-template-registry');
  return {
    stages: spec.loadKaylaCourseSpec ? Object.keys(spec.loadKaylaCourseSpec() || {}).length : 21,
    templates: registry.createTemplateRegistry ? registry.createTemplateRegistry({ spec: spec.loadKaylaCourseSpec() }).length : 0,
    source: 'kayla-course-spec.js + kayla-template-registry.js',
    authority: AUTHORITY.CANONICAL,
  };
}

function getOwnerPreferences() {
  return readJson(PREFERENCES_PATH, {
    consoleChannel: 'pipeline-topic-389',
    preferredInteraction: 'natural-language',
    noAutonomousOutreach: true,
    noAutonomousStageMovement: true,
    senderPreference: '+*******2619',
    updatedAt: null,
  });
}

function getRecentHistory(limit = 10) {
  const journal = readJsonl(path.join(DATA_DIR, 'telegram-outreach-dry-run', 'journal.jsonl'));
  const canaryDir = path.join(DATA_DIR, 'canary');
  let canaryPlans = [];
  try {
    canaryPlans = fs.readdirSync(canaryDir).filter(f => f.endsWith('.json')).map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(canaryDir, f), 'utf8')); } catch (_) { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  } catch (_) {}
  return {
    journalEntries: journal.slice(-limit),
    recentCanaryPlans: canaryPlans.map(p => ({ planId: p.planId, state: p.state, totalItems: p.totalItems, completedItems: p.completedItems })),
    authority: AUTHORITY.VERIFIED_EPISODIC,
  };
}

function getActivePlan(chatId) {
  const canary = require('../bot/canary-executor');
  const plan = canary.loadActiveCanaryPlan(chatId);
  if (!plan) return null;
  return {
    planId: plan.planId, planHash: plan.planHash, state: plan.state,
    totalItems: plan.totalItems, completedItems: plan.completedItems, failedItems: plan.failedItems,
    items: plan.items.map(i => ({ number: i.number, status: i.status, propertyAddress: i.propertyAddress, contactRole: i.contactRole })),
    authority: AUTHORITY.LIVE_OPERATIONAL,
  };
}

function getSafetyState() {
  const ks = require('../bot/kill-switch').readKillSwitch();
  const ownerAuth = require('../bot/owner-auth');
  return {
    killSwitch: ks.state, liveSends: ks.liveSends || 0, productionWrites: ks.productionWrites || 0,
    stageMovements: ks.stageMovements || 0, canSend: require('../bot/kill-switch').canSend(ks.state),
    ownerBound: !!ownerAuth.ownerDigest(), authority: AUTHORITY.LIVE_SAFETY,
  };
}

function buildBoundedContext(chatId, userId, messageText) {
  return {
    safety: getSafetyState(),
    conversation: getConversationContext(chatId, userId),
    activePlan: getActivePlan(chatId),
    preferences: getOwnerPreferences(),
    canonicalRules: getCanonicalRules(),
    recentHistory: getRecentHistory(5),
    message: messageText ? messageText.slice(0, 200) : null,
    timestamp: nowIso(),
  };
}

function recordCorrection(text, scope, chatId, userId, supersedes) {
  const entry = {
    memoryId: memId(), type: 'CORRECTION', text, scope, chatId, userId,
    supersedes: supersedes || null, createdAt: nowIso(), project: 'prolificcapital',
  };
  appendJsonl(CORRECTIONS_PATH, entry);
  return entry;
}

function getCorrections(filter = {}) {
  let items = readJsonl(CORRECTIONS_PATH);
  if (filter.scope) items = items.filter(c => c.scope === filter.scope);
  if (filter.limit) items = items.slice(-filter.limit);
  return items;
}

function recordProposal(opts) {
  const entry = {
    proposalId: `prop_${crypto.randomBytes(4).toString('hex')}`,
    type: 'IMPROVEMENT_PROPOSAL',
    evidence: opts.evidence || '', frequency: opts.frequency || 1,
    proposedChange: opts.proposedChange || '', affectedFiles: opts.affectedFiles || [],
    risk: opts.risk || 'low', canonicalImpact: opts.canonicalImpact || 'none',
    requiredTests: opts.requiredTests || [], status: 'PROPOSED',
    createdAt: nowIso(), approvedBy: null, approvedAt: null,
  };
  appendJsonl(PROPOSALS_PATH, entry);
  return entry;
}

function getProposals(filter = {}) {
  let items = readJsonl(PROPOSALS_PATH);
  if (filter.status) items = items.filter(p => p.status === filter.status);
  if (filter.limit) items = items.slice(-filter.limit);
  return items;
}

function updatePreference(key, value) {
  const prefs = getOwnerPreferences();
  prefs[key] = value;
  prefs.updatedAt = nowIso();
  writeJson(PREFERENCES_PATH, prefs);
  return prefs;
}

function explainSource(memoryId) {
  const corrections = readJsonl(CORRECTIONS_PATH);
  const proposals = readJsonl(PROPOSALS_PATH);
  for (const c of corrections) { if (c.memoryId === memoryId) return { type: 'correction', text: c.text, scope: c.scope, createdAt: c.createdAt }; }
  for (const p of proposals) { if (p.proposalId === memoryId) return { type: 'proposal', evidence: p.evidence, status: p.status, createdAt: p.createdAt }; }
  return { memoryId, found: false };
}

module.exports = {
  AUTHORITY,
  buildBoundedContext,
  getConversationContext,
  getLeadContext,
  getCanonicalRules,
  getOwnerPreferences,
  getRecentHistory,
  getActivePlan,
  getSafetyState,
  recordCorrection,
  getCorrections,
  recordProposal,
  getProposals,
  updatePreference,
  explainSource,
};
