'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { calculateCanonicalArtifactHash, hashMetadata } = require('./atlas-artifact-hash');
const { loadKaylaCourseSpec, getStageById, LEAD_ENTERED_STAGE_ID, CONTACT_MADE_STAGE_ID, SELECTED_SENDER_SUFFIX } = require('./kayla-course-spec');
const { createTemplateRegistry, getTemplate, renderTemplate } = require('./kayla-template-registry');

const SESSION_STATES = Object.freeze(['DRAFT', 'PLANNED', 'PREVIEWED', 'PARTIALLY_SELECTED', 'APPROVED_DRY_RUN', 'SIMULATED_EXECUTING', 'SIMULATED_COMPLETE', 'CANCELED', 'EXPIRED', 'BLOCKED']);
const MODES = Object.freeze(['INITIAL_CONTACT', 'CALL_DUE', 'TEXT_DUE', 'FOLLOW_UP', 'OFFER_FEEDBACK', 'NEGOTIATION_ACTION', 'CONTRACT_ACTION']);
const KILL_SWITCH_STATES = Object.freeze(['PAUSED', 'DRY_RUN_ONLY', 'CANARY_ALLOWED']);
const LIVE_SENDS = 0;
const PRODUCTION_WRITES = 0;
const STAGE_MOVEMENTS = 0;
const WORKFLOW_MODIFICATIONS = 0;

function defaultDataDir() {
  return path.resolve(__dirname, '..', 'data', 'telegram-outreach-dry-run');
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function appendJsonl(file, value) { ensureDir(path.dirname(file)); fs.appendFileSync(file, `${JSON.stringify(value)}\n`); }

function stableHash(value) { return calculateCanonicalArtifactHash(value); }
function id(prefix, value) { return `${prefix}_${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)}`; }
function nowIso(now = Date.now()) { return new Date(now).toISOString(); }
function maskContact(value) { return String(value || 'unknown').replace(/[A-Za-z0-9](?=[A-Za-z0-9]{4})/g, '*'); }

function paths(options = {}) {
  const dir = options.dataDir || process.env.ATLAS_TELEGRAM_DRY_RUN_DIR || defaultDataDir();
  return {
    dir,
    sessions: path.join(dir, 'sessions.json'),
    killSwitch: path.join(dir, 'kill-switch.json'),
    journal: path.join(dir, 'journal.jsonl'),
    permissions: path.join(dir, 'permissions.json'),
  };
}

function roleFromEnv(userId, env = process.env) {
  const idText = String(userId || '');
  const contains = key => String(env[key] || '').split(',').map(s => s.trim()).filter(Boolean).includes(idText);
  if (contains('PIPELINE_TELEGRAM_ADMIN_IDS') || contains('ATLAS_TELEGRAM_ADMIN_IDS')) return 'ADMIN';
  if (contains('ATLAS_TELEGRAM_APPROVER_IDS')) return 'APPROVER';
  if (contains('PIPELINE_TELEGRAM_REVIEWER_IDS') || contains('ATLAS_TELEGRAM_REVIEWER_IDS')) return 'REVIEWER';
  if (contains('ATLAS_TELEGRAM_VIEWER_IDS')) return 'VIEWER';
  return null;
}

function roleRank(role) { return { VIEWER: 1, REVIEWER: 2, APPROVER: 3, ADMIN: 4 }[role] || 0; }
function assertPermission(userId, requiredRole, env = process.env) {
  const actual = roleFromEnv(userId, env);
  if (roleRank(actual) < roleRank(requiredRole)) {
    const error = new Error('OUTREACH_ACCESS_DENIED');
    error.code = 'ACCESS_DENIED';
    throw error;
  }
  return { role: actual };
}

function getKillSwitch(options = {}) {
  const file = paths(options).killSwitch;
  const state = readJson(file, null);
  if (state && KILL_SWITCH_STATES.includes(state.state)) return state;
  const initial = { state: 'DRY_RUN_ONLY', updatedAt: nowIso(), liveSends: LIVE_SENDS, productionWrites: PRODUCTION_WRITES, stageMovements: STAGE_MOVEMENTS, workflowModifications: WORKFLOW_MODIFICATIONS };
  writeJson(file, initial);
  return initial;
}

function setKillSwitch(state, ctx = {}, options = {}) {
  assertPermission(ctx.telegramUserId, 'ADMIN', ctx.env || process.env);
  if (!['PAUSED', 'DRY_RUN_ONLY', 'CANARY_ALLOWED'].includes(state)) throw new Error('INVALID_KILL_SWITCH_STATE');
  const next = { state, updatedAt: nowIso(), updatedBy: maskContact(ctx.telegramUserId), liveSends: LIVE_SENDS, productionWrites: PRODUCTION_WRITES, stageMovements: STAGE_MOVEMENTS, workflowModifications: WORKFLOW_MODIFICATIONS };
  writeJson(paths(options).killSwitch, next);
  appendJournal({ type: 'KILL_SWITCH_CHANGED', state, by: maskContact(ctx.telegramUserId) }, options);
  return next;
}

function normalizeOpportunity(input) {
  if (input.contactRoleText !== undefined && input.currentStageId && input.opportunityId) return input;
  const opp = input.opportunity || input;
  const contact = input.contact || {};
  return {
    opportunityId: opp.opportunityId || opp.id,
    contactId: opp.contactId || contact.contactId || contact.id,
    propertyAddress: opp.propertyAddress || opp.address || opp.name || opp.opportunityName,
    contactName: opp.contactName || contact.name || contact.fullName || contact.firstName || opp.name || 'Unknown',
    contactRoleText: opp.contactRole || opp.role || contact.role || opp.relationship || '',
    currentStageId: opp.stageId || opp.pipelineStageId || LEAD_ENTERED_STAGE_ID,
    currentStageName: opp.stageName || opp.pipelineStageName || 'Lead Entered',
    phone: opp.phone || contact.phone || contact.phoneNumber || '',
    tags: opp.tags || contact.tags || [],
    dnc: Boolean(opp.dnc || contact.dnc),
    wrongNumber: Boolean(opp.wrongNumber || contact.wrongNumber),
    pendingReply: Boolean(opp.pendingReply || contact.pendingReply),
    activeHumanWork: Boolean(opp.activeHumanWork),
    priorOutreachUncertain: Boolean(opp.priorOutreachUncertain),
    sourceRowId: opp.sourceRowId,
    raw: input,
  };
}

function classifyRole(record) {
  const text = `${record.contactRoleText || ''} ${record.contactName || ''}`.toLowerCase();
  const raw = record.raw || {};
  const contact = raw.contact || {};
  const companyText = `${contact.companyName || ''} ${(contact.tags || []).join(' ')}`.toLowerCase();
  const fullText = `${text} ${companyText}`;
  const evidence = [];
  let role = 'unknown';
  let confidence = 0.2;
  let status = 'unknown';
  if (/\bagent\b|realtor|listing/.test(fullText)) { role = 'agent'; confidence = 0.8; status = 'inferred'; evidence.push('role/name/company contains agent, realtor, or listing'); }
  else if (/\bbroker\b/.test(fullText)) { role = 'broker'; confidence = 0.8; status = 'inferred'; evidence.push('role/name/company contains broker'); }
  else if (/\bowner\b|seller|fsbo/.test(fullText)) { role = 'owner'; confidence = 0.75; status = 'inferred'; evidence.push('role/name/company contains owner, seller, or fsbo'); }
  else if (/investor|wholesale|llc|holdings|capital|properties/.test(fullText)) { role = /llc|holdings|properties/.test(fullText) ? 'organization/LLC' : 'investor/wholesaler'; confidence = 0.65; status = 'inferred'; evidence.push('role/name/company contains investor, wholesaler, LLC, holdings, capital, or properties'); }
  else if (raw.classification?.recordClass === 'PRODUCTION' && raw.atlas?.isAtlasValid) { role = 'agent'; confidence = 0.6; status = 'inferred'; evidence.push('Atlas/Propwire-sourced record; listing agent assumed'); }
  if (record.contactRoleText && ['owner', 'agent', 'broker', 'investor/wholesaler', 'organization/LLC'].includes(String(record.contactRoleText).toLowerCase())) {
    role = String(record.contactRoleText).toLowerCase(); confidence = 1; status = 'confirmed'; evidence.push('explicit role field');
  }
  return { role, confidence, evidence, status };
}

function layeredLocks(record, allRecords = []) {
  const sameContact = allRecords.filter(item => item.contactId && item.contactId === record.contactId);
  const sameProperty = allRecords.filter(item => item.propertyAddress && item.propertyAddress === record.propertyAddress);
  return {
    CONTACT_COMPLIANCE_LOCK: record.dnc || record.wrongNumber ? 'BLOCKED' : 'CLEAR',
    PROPERTY_ACTIVITY_LOCK: sameProperty.length > 1 ? 'BLOCKED_DUPLICATE_PROPERTY_CONTEXT' : 'CLEAR',
    CONVERSATION_CONTEXT_LOCK: record.pendingReply || record.priorOutreachUncertain ? 'BLOCKED' : 'CLEAR',
    TEAM_OWNERSHIP_LOCK: record.activeHumanWork ? 'BLOCKED' : 'CLEAR',
    sameContactPropertyCount: sameContact.length,
  };
}

function evaluateEligibility(input, options = {}) {
  const spec = options.spec || loadKaylaCourseSpec(options);
  const registry = options.registry || createTemplateRegistry({ spec });
  const record = normalizeOpportunity(input);
  const role = classifyRole(record);
  const locks = layeredLocks(record, (options.allRecords || []).map(normalizeOpportunity));
  const stage = getStageById(spec, record.currentStageId);
  const base = { opportunityId: record.opportunityId, contactId: record.contactId, propertyContext: record.propertyAddress, contactRole: role, currentStage: stage ? stage.stageName : record.currentStageName, kaylaProcessState: stage ? stage.mode : 'UNKNOWN', multiPropertyContext: locks, missingEvidence: [], workflowConflict: null, priorOutreachUncertainty: record.priorOutreachUncertain, rawRecord: record, safe: false };
  const block = (resultClass, reason) => ({ ...base, resultClass, due: false, reason, safe: false });

  if (!record.opportunityId || !record.contactId) return block('BLOCKED_IDENTITY', 'Missing opportunity or contact identity.');
  if (!record.propertyAddress) return block('BLOCKED_MISSING_PROPERTY_CONTEXT', 'Missing property address/context.');
  if (record.dnc) return block('BLOCKED_DNC', 'Contact-wide DNC flag present.');
  if (record.wrongNumber) return block('BLOCKED_WRONG_NUMBER', 'Wrong-number flag present.');
  if (record.pendingReply) return block('BLOCKED_PENDING_REPLY', 'Pending reply requires human review before new outreach.');
  if (record.priorOutreachUncertain) return block('BLOCKED_PRIOR_OUTREACH_UNCERTAIN', 'Prior outreach history is uncertain.');
  if (record.activeHumanWork) return block('BLOCKED_ACTIVE_HUMAN_WORK', 'Active human work lock is present.');
  if (locks.PROPERTY_ACTIVITY_LOCK !== 'CLEAR') return block('BLOCKED_MULTI_PROPERTY_CONTEXT', 'Duplicate same-property context requires manual resolution.');
  if (!stage) return block('BLOCKED_MISSING_COURSE_RULE', 'Current stage is not represented in the Kayla course spec.');

  let resultClass = 'NOT_DUE';
  let shortcut = stage.textShortcut;
  let action = 'No course-approved dry-run action is due.';
  if (stage.stageId === LEAD_ENTERED_STAGE_ID) { resultClass = 'ELIGIBLE_INITIAL_TEXT'; shortcut = 'INT'; action = 'Send INT before calling, then call twice.'; }
  else if (stage.order === 6) { resultClass = 'ELIGIBLE_OFFER_FEEDBACK'; shortcut = 'LOI'; action = 'Call with realignment script and ask for feedback.'; }
  else if (stage.order === 7) { resultClass = 'ELIGIBLE_FOLLOW_UP_TEXT'; shortcut = 'LOI2DAYS'; action = 'Escalate no-answer feedback sequence.'; }
  else if (stage.order === 9) { resultClass = 'ELIGIBLE_NEGOTIATION_ACTION'; action = 'Relay seller/counter details to Kayla/Jaxon; do not negotiate.'; }
  else if (stage.order >= 10) { resultClass = 'ELIGIBLE_CONTRACT_ACTION'; action = 'Monitor and relay in Kayla/Jaxon/TC territory.'; }

  if (resultClass === 'NOT_DUE') return { ...base, resultClass, due: false, reason: action, safe: true };
  const template = shortcut ? registry.find(item => item.shortcutName === shortcut) : null;
  if (shortcut && !template) return block('BLOCKED_MISSING_SCRIPT', `Missing required shortcut ${shortcut}.`);
  if (shortcut && template.status === 'CONFLICTING') return block('BLOCKED_COURSE_CONFLICT', `Shortcut ${shortcut} has a course conflict.`);
  if (shortcut && ['agent', 'owner', 'broker'].includes(role.role) === false && ['INT', 'NOA', 'CCC'].includes(shortcut)) return block('BLOCKED_ROLE_UNCERTAIN', 'Role-specific first-contact script requires agent, owner, or broker role confidence.');

  return {
    ...base,
    resultClass,
    due: true,
    reason: `${action} Kayla rule: ${spec.courseRules.find(rule => rule.id === 'INT_BEFORE_CALL')?.citation || 'course spec'}`,
    nextCourseApprovedAction: action,
    requiredScriptOrShortcut: shortcut,
    classification: resultClass.includes('CALL') ? 'CALL' : resultClass.includes('NEGOTIATION') ? 'NEGOTIATION' : resultClass.includes('CONTRACT') ? 'CONTRACT' : 'TEXT',
    renderedPreview: template ? renderTemplate(template, { contactName: record.contactName, propertyAddress: record.propertyAddress, senderName: 'Montelli', day: '[day]' }) : null,
    safe: true,
    sourceCitation: 'docs/atlas-kayla-course-parity-spec.md#course-rules',
  };
}

function filterRole(item, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'agents') return item.contactRole.role === 'agent';
  if (filter === 'owners') return item.contactRole.role === 'owner';
  if (filter === 'brokers') return item.contactRole.role === 'broker';
  if (filter === 'investors') return item.contactRole.role === 'investor/wholesaler';
  if (filter === 'unknown') return item.contactRole.role === 'unknown';
  return true;
}

function buildPlan({ opportunities = [], count = 10, roleFilter = 'all', mode = 'INITIAL_CONTACT', ctx = {}, options = {} }) {
  assertPermission(ctx.telegramUserId, 'VIEWER', ctx.env || process.env);
  const spec = options.spec || loadKaylaCourseSpec(options);
  const registry = createTemplateRegistry({ spec });
  const normalized = opportunities.map(normalizeOpportunity);
  const evaluated = normalized.map(record => evaluateEligibility(record, { spec, registry, allRecords: normalized }));
  const contactUsed = new Set();
  const selected = [];
  const excluded = [];
  for (const item of evaluated) {
    if (!item.safe || !item.due || !filterRole(item, roleFilter) || (mode === 'INITIAL_CONTACT' && item.resultClass !== 'ELIGIBLE_INITIAL_TEXT')) { excluded.push(item); continue; }
    if (contactUsed.has(item.contactId)) { excluded.push({ ...item, resultClass: 'BLOCKED_MULTI_PROPERTY_CONTEXT', reason: 'Conservative launch policy: one planned message per contact per dry-run plan.' }); continue; }
    contactUsed.add(item.contactId);
    selected.push(item);
    if (selected.length >= count) break;
  }
  const items = selected.map((item, index) => ({
    number: index + 1,
    opportunityId: item.opportunityId,
    contactId: item.contactId,
    maskedContact: maskContact(item.contactId),
    contactRole: item.contactRole,
    propertyAddress: item.propertyContext,
    currentStage: item.currentStage,
    kaylaRule: item.sourceCitation,
    nextRequiredAction: item.nextCourseApprovedAction,
    classification: item.classification,
    shortcutName: item.requiredScriptOrShortcut,
    renderedPreview: item.renderedPreview,
    senderNumber: `+*******${SELECTED_SENDER_SUFFIX}`,
    status: 'AVAILABLE',
    expectedStageResult: item.resultClass === 'ELIGIBLE_INITIAL_TEXT' ? { proposed: CONTACT_MADE_STAGE_ID, risk: 'BLOCKED_WORKFLOW_SIDE_EFFECT_RISK' } : { proposed: null, risk: 'MANUAL_ACTION_REMAINS_AUTHORITATIVE' },
    workflowRiskSummary: 'Broad GHL stage-change webhook is published; live stage movement remains blocked in dry run.',
    eligibility: item,
  }));
  const core = { mode, requestedCount: count, requestedRoleFilter: roleFilter, selectedRecords: items, excludedRecords: excluded, senderNumberLock: `+*******${SELECTED_SENDER_SUFFIX}`, killSwitchState: getKillSwitch(options).state, dryRunMode: true };
  return { ...core, immutablePlanHash: stableHash(core) };
}

function createSession({ chatId, telegramUserId, mode = 'INITIAL_CONTACT', requestedCount = 10, requestedRoleFilter = 'all', plan = null }, options = {}) {
  const all = readJson(paths(options).sessions, { sessions: [] });
  const session = {
    sessionId: id('session', { chatId, telegramUserId, createdAt: Date.now(), planHash: plan?.immutablePlanHash }),
    telegramChatId: String(chatId),
    telegramUserId: String(telegramUserId),
    createdAt: nowIso(),
    expiresAt: nowIso(Date.now() + 60 * 60 * 1000),
    currentMode: mode,
    requestedCount,
    requestedRoleFilter,
    selectedRecords: plan?.selectedRecords || [],
    heldRecords: [],
    skippedRecords: [],
    excludedRecords: plan?.excludedRecords || [],
    renderedPreviews: (plan?.selectedRecords || []).map(item => ({ number: item.number, preview: item.renderedPreview })),
    kaylaCourseRuleApplied: 'docs/atlas-kayla-course-parity-spec.md',
    senderNumberLock: `+*******${SELECTED_SENDER_SUFFIX}`,
    currentApprovalState: 'NONE',
    killSwitchState: getKillSwitch(options).state,
    dryRunLiveMode: 'DRY_RUN_ONLY',
    immutablePlanHash: plan?.immutablePlanHash || null,
    priorSessionReference: null,
    state: plan ? 'PLANNED' : 'DRAFT',
    approvedNumbers: [],
    simulatedActionIds: [],
  };
  all.sessions = all.sessions.filter(s => s.sessionId !== session.sessionId).concat(session);
  writeJson(paths(options).sessions, all);
  appendJournal({ type: 'SESSION_CREATED', sessionId: session.sessionId, state: session.state, planHash: session.immutablePlanHash }, options);
  return session;
}

function getSession(sessionId, options = {}) {
  return readJson(paths(options).sessions, { sessions: [] }).sessions.find(s => s.sessionId === sessionId) || null;
}

function saveSession(session, options = {}) {
  const all = readJson(paths(options).sessions, { sessions: [] });
  all.sessions = all.sessions.filter(s => s.sessionId !== session.sessionId).concat(session);
  writeJson(paths(options).sessions, all);
  return session;
}

function latestSession(chatId, telegramUserId, options = {}) {
  const sessions = readJson(paths(options).sessions, { sessions: [] }).sessions.filter(s => String(s.telegramChatId) === String(chatId) && String(s.telegramUserId) === String(telegramUserId));
  return sessions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

function updateNumbers(session, numbers, status, options = {}) {
  const set = new Set(numbers.map(Number));
  session.selectedRecords = session.selectedRecords.map(item => set.has(item.number) ? { ...item, status } : item);
  if (status === 'HELD') session.heldRecords = Array.from(new Set([...session.heldRecords, ...numbers.map(Number)])).sort((a, b) => a - b);
  if (status === 'SKIPPED') session.skippedRecords = Array.from(new Set([...session.skippedRecords, ...numbers.map(Number)])).sort((a, b) => a - b);
  if (status === 'AVAILABLE') {
    session.heldRecords = session.heldRecords.filter(n => !set.has(n));
    session.skippedRecords = session.skippedRecords.filter(n => !set.has(n));
  }
  session.state = status === 'AVAILABLE' ? 'PLANNED' : 'PARTIALLY_SELECTED';
  appendJournal({ type: 'SESSION_ITEM_STATUS', sessionId: session.sessionId, numbers: Array.from(set), status }, options);
  return saveSession(session, options);
}

function selectNumbers(session, numbers, options = {}) {
  const available = session.selectedRecords.filter(item => item.status !== 'HELD' && item.status !== 'SKIPPED').map(item => item.number);
  const selected = numbers[0] === 'all' ? available : numbers.map(Number).filter(n => available.includes(n));
  session.approvedNumbers = Array.from(new Set(selected)).sort((a, b) => a - b);
  session.state = 'PARTIALLY_SELECTED';
  appendJournal({ type: 'SESSION_SELECTED', sessionId: session.sessionId, numbers: session.approvedNumbers }, options);
  return saveSession(session, options);
}

function approveDryRun(session, ctx = {}, options = {}) {
  assertPermission(ctx.telegramUserId, 'APPROVER', ctx.env || process.env);
  if (new Date(session.expiresAt).getTime() <= Date.now()) { session.state = 'EXPIRED'; saveSession(session, options); throw new Error('SESSION_EXPIRED'); }
  if (getKillSwitch(options).state === 'PAUSED') throw new Error('OUTREACH_PAUSED');
  if (!session.approvedNumbers.length) session.approvedNumbers = session.selectedRecords.filter(item => item.status === 'AVAILABLE').map(item => item.number);
  session.currentApprovalState = 'APPROVED_DRY_RUN';
  session.state = 'APPROVED_DRY_RUN';
  appendJournal({ type: 'SESSION_APPROVED_DRY_RUN', sessionId: session.sessionId, planHash: session.immutablePlanHash, numbers: session.approvedNumbers }, options);
  return saveSession(session, options);
}

function appendJournal(entry, options = {}) {
  appendJsonl(paths(options).journal, { at: nowIso(), ...entry, liveSends: LIVE_SENDS, productionWrites: PRODUCTION_WRITES, stageMovements: STAGE_MOVEMENTS, workflowModifications: WORKFLOW_MODIFICATIONS, killSwitchState: getKillSwitch(options).state });
}

function executeDryRun(session, ctx = {}, options = {}) {
  assertPermission(ctx.telegramUserId, 'APPROVER', ctx.env || process.env);
  if (session.state !== 'APPROVED_DRY_RUN') throw new Error('SESSION_NOT_APPROVED');
  if (getKillSwitch(options).state === 'PAUSED') throw new Error('OUTREACH_PAUSED');
  const selected = session.selectedRecords.filter(item => session.approvedNumbers.includes(item.number));
  session.state = 'SIMULATED_EXECUTING';
  saveSession(session, options);
  const actions = [];
  const used = new Set(session.simulatedActionIds || []);
  for (const item of selected) {
    const actionId = id('simact', { sessionId: session.sessionId, planHash: session.immutablePlanHash, number: item.number, opportunityId: item.opportunityId });
    if (used.has(actionId)) throw new Error('DUPLICATE_SIMULATED_ACTION_ID');
    used.add(actionId);
    const providerId = id('simprovider', { actionId, sender: SELECTED_SENDER_SUFFIX });
    const stageMoveId = id('simstage', { actionId, from: item.currentStage, to: item.expectedStageResult.proposed });
    const action = { actionId, itemNumber: item.number, opportunityId: item.opportunityId, type: 'SIMULATED_SEND', providerResult: 'SIMULATED_PROVIDER_ACCEPTED', providerId, ghlResult: 'SIMULATED_GHL_CONVERSATION_RESULT', stageResult: item.expectedStageResult.proposed ? 'SIMULATED_STAGE_MOVE' : 'NO_STAGE_MOVE_PROPOSED', simulatedStageMoveId: stageMoveId, liveSends: LIVE_SENDS, productionWrites: PRODUCTION_WRITES, stageMovements: STAGE_MOVEMENTS, workflowModifications: WORKFLOW_MODIFICATIONS };
    appendJournal(action, options);
    actions.push(action);
  }
  session.simulatedActionIds = Array.from(used);
  session.state = 'SIMULATED_COMPLETE';
  saveSession(session, options);
  return { sessionId: session.sessionId, planHash: session.immutablePlanHash, actions, liveSends: LIVE_SENDS, productionWrites: PRODUCTION_WRITES, stageMovements: STAGE_MOVEMENTS, workflowModifications: WORKFLOW_MODIFICATIONS };
}

function parseNumbers(text) {
  const lower = String(text || '').toLowerCase();
  if (/\ball\b/.test(lower)) return ['all'];
  const nums = new Set();
  for (const range of lower.matchAll(/(\d+)\s*(?:-|to|through)\s*(\d+)/g)) {
    const a = Number(range[1]); const b = Number(range[2]);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) nums.add(i);
  }
  for (const n of lower.matchAll(/\b\d+\b/g)) nums.add(Number(n[0]));
  return Array.from(nums).sort((a, b) => a - b);
}

function parseIntent(text) {
  const lower = String(text || '').toLowerCase().trim();
  const countWord = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const count = Number((lower.match(/\b(\d+)\b/) || [])[1]) || Object.entries(countWord).find(([word]) => lower.includes(word))?.[1] || 10;
  if (/pause outreach/.test(lower)) return { intent: 'PAUSE_OUTREACH' };
  if (/resume/.test(lower)) return { intent: 'RESUME_OUTREACH' };
  if (/status|outreach state/.test(lower)) return { intent: 'SHOW_SESSION_STATUS' };
  if (/cancel/.test(lower)) return { intent: 'CANCEL_PLAN' };
  if (/approve/.test(lower)) return { intent: 'APPROVE_DRY_RUN' };
  if (/hold/.test(lower)) return { intent: 'HOLD_PLAN_ITEM', numbers: parseNumbers(lower) };
  if (/skip/.test(lower)) return { intent: 'SKIP_PLAN_ITEM', numbers: parseNumbers(lower) };
  if (/restore/.test(lower)) return { intent: 'RESTORE_PLAN_ITEM', numbers: parseNumbers(lower) };
  if (/select/.test(lower)) return { intent: 'SELECT_PLAN_ITEMS', numbers: parseNumbers(lower) };
  if (/canary/.test(lower) && /preview|plan|show/.test(lower)) return { intent: 'PREVIEW_CANARY', count: Math.min(count, 3) };
  if (/preview/.test(lower)) return { intent: 'PREVIEW_PLAN', count };
  if (/why.*\d+|due/.test(lower) && /why/.test(lower)) return { intent: 'SHOW_COURSE_RULE', numbers: parseNumbers(lower) };
  if (/shortcut|script/.test(lower)) return { intent: 'SHOW_EXACT_SCRIPT', numbers: parseNumbers(lower) };
  if (/what would move|contact made/.test(lower)) return { intent: 'SHOW_EXPECTED_STAGE_MOVES' };
  if (/activity/.test(lower)) return { intent: 'SHOW_TODAYS_SIMULATED_ACTIVITY' };
  if (/follow/.test(lower)) return { intent: 'SHOW_FOLLOW_UPS_DUE', count };
  if (/call/.test(lower)) return { intent: 'SHOW_CALLS_DUE', count };
  if (/text/.test(lower)) return { intent: 'SHOW_TEXTS_DUE', count };
  if (/owner/.test(lower)) return { intent: 'SHOW_OWNERS_DUE', count, roleFilter: 'owners' };
  if (/agent/.test(lower)) return { intent: 'SHOW_AGENTS_DUE', count, roleFilter: 'agents' };
  if (/untouched|work today|kayla says|who should/.test(lower)) return { intent: 'SHOW_UNTOUCHED_LEADS', count, roleFilter: 'all' };
  return { intent: 'CLARIFY', question: 'Do you want me to show leads, preview a plan, select/hold/skip items, approve dry run, or pause/resume outreach?' };
}

function formatPlan(session, limit = null) {
  const items = limit ? session.selectedRecords.slice(0, limit) : session.selectedRecords;
  const lines = [`*Atlas Kayla Dry-Run Plan*`, `Session: ${session.sessionId}`, `State: ${session.state}`, `Plan hash: ${session.immutablePlanHash}`, `Sender: ${session.senderNumberLock}`, ''];
  for (const item of items) {
    lines.push(`${item.number}. ${item.contactRole.role} | ${item.propertyAddress}`);
    lines.push(`Stage: ${item.currentStage} | Action: ${item.nextRequiredAction}`);
    lines.push(`Shortcut: ${item.shortcutName || 'none'} | Status: ${item.status}`);
    lines.push(`Preview: ${item.renderedPreview || '(manual action; no SMS preview)'}`);
    lines.push(`Workflow risk: ${item.workflowRiskSummary}`, '');
  }
  lines.push(`Zero-send proof: live sends ${LIVE_SENDS}; production writes ${PRODUCTION_WRITES}; stage movements ${STAGE_MOVEMENTS}; workflow modifications ${WORKFLOW_MODIFICATIONS}.`);
  return lines.join('\n');
}

function createArtifact(name, payload, options = {}) {
  const dir = options.artifactDir || path.resolve(__dirname, '..', '..', 'lead-tracking', 'atlas-deals', 'audits');
  ensureDir(dir);
  const artifact = { artifactType: name, generatedAt: nowIso(), liveSends: LIVE_SENDS, productionWrites: PRODUCTION_WRITES, stageMovements: STAGE_MOVEMENTS, workflowModifications: WORKFLOW_MODIFICATIONS, killSwitchState: getKillSwitch(options).state, hash: hashMetadata(), payload };
  artifact.canonicalHash = stableHash(artifact);
  const file = path.join(dir, `${name}-${artifact.canonicalHash.slice(0, 12)}.json`);
  writeJson(file, artifact);
  return { file, canonicalHash: artifact.canonicalHash, artifact };
}

module.exports = { SESSION_STATES, MODES, KILL_SWITCH_STATES, paths, roleFromEnv, assertPermission, getKillSwitch, setKillSwitch, normalizeOpportunity, classifyRole, layeredLocks, evaluateEligibility, buildPlan, createSession, getSession, latestSession, saveSession, updateNumbers, selectNumbers, approveDryRun, executeDryRun, parseNumbers, parseIntent, formatPlan, createArtifact, maskContact, LIVE_SENDS, PRODUCTION_WRITES, STAGE_MOVEMENTS, WORKFLOW_MODIFICATIONS };
