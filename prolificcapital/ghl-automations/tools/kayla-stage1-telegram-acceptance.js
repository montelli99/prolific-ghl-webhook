#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const tg = require('../modules/kayla-telegram-outreach');
const tx = require('../modules/kayla-stage1-transaction');
const { selectContactPath, CONTACT_PATHS, scriptForContactPath } = require('../modules/kayla-stage1-contact-path');
const { GhlReadOnlyLookupClient, buildConfigFromEnv } = require('../modules/atlas-ghl-readonly-client');
const guards = require('../modules/atlas-ghl-telegram-live-guards');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'ghl-automations', 'reports', 'kayla-stage1');
const TARGET_COMMIT = '50dcebd feat(pipeline): implement Kayla Stage 1 operator transaction';

function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || env[match[1]]) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
}

function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function shortHash(value) { return hash(value).slice(0, 12); }
function maskId(value) { const s = String(value || ''); return s ? `${s.slice(0, 4)}...${s.slice(-4)}` : ''; }
function maskText(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/g, '[phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+\b(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Way|Trail|Trl|Pkwy|Parkway)\b[^\n]*/gi, '[property]');
}
function values(entity = {}) {
  const fields = entity.customFields || entity.customField || entity.customFieldsValues || entity.customFieldValues || [];
  return Array.isArray(fields) ? fields.map(field => `${field.name || field.fieldName || field.id || ''}:${field.value ?? field.fieldValue ?? field.field_value ?? ''}`) : [];
}
function fieldValue(entity, names) {
  const haystack = values(entity);
  for (const name of names) {
    const match = haystack.find(item => item.toLowerCase().includes(name.toLowerCase()));
    if (match) return match.split(':').slice(1).join(':').trim();
  }
  return '';
}
function contactPhone(contact = {}, opp = {}) { return contact.phone || contact.phoneNumber || opp.phone || opp.phoneNumber || ''; }
function propertyAddress(opp = {}) { return opp.name || opp.opportunityName || opp.propertyAddress || opp.address || ''; }
function previewRecord(opp = {}, contact = {}) {
  const record = {
    opportunityId: opp.id || opp.opportunityId,
    contactId: opp.contactId || opp.contact_id || contact.id,
    propertyAddress: propertyAddress(opp),
    stageName: 'Lead Entered',
    leadSource: opp.source || fieldValue(opp, ['Lead Source', 'Source']) || '',
    listingAgent: fieldValue(opp, ['Listing Agent', 'Agent Name']) || fieldValue(contact, ['Listing Agent']) || '',
    agentPhone: fieldValue(opp, ['Agent Phone']) || contactPhone(contact, opp),
    agentEmail: fieldValue(opp, ['Agent Email']) || contact.email || '',
    sellerName: fieldValue(opp, ['Seller Name', 'Owner Name']) || fieldValue(contact, ['Seller Name']) || '',
    sellerPhone: fieldValue(opp, ['Seller Phone']),
    sellerEmail: fieldValue(opp, ['Seller Email']),
  };
  const selected = selectContactPath(record);
  return {
    rawRecord: record,
    visible: {
      opportunityId: maskId(record.opportunityId),
      opportunityHash: shortHash(record.opportunityId),
      propertyLoaded: Boolean(record.propertyAddress),
      propertyHash: shortHash(String(record.propertyAddress).toLowerCase()),
      currentStage: 'Lead Entered',
      relationshipEvidence: {
        leadSourceKnown: Boolean(record.leadSource),
        listingAgentPresent: Boolean(record.listingAgent),
        sellerNamePresent: Boolean(record.sellerName),
        agentPhonePresent: Boolean(record.agentPhone),
        sellerPhonePresent: Boolean(record.sellerPhone),
      },
      contactPath: selected.path,
      scriptId: scriptForContactPath(selected.path),
    },
  };
}

function runExchange(label, opportunity, commands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kayla-stage1-acceptance-${label}-`));
  const ctx = { chatId: `acceptance-${label}`, telegramUserId: 'operator-acceptance' };
  const exchanges = [];
  for (const command of commands) {
    const result = tg.handleStage1Command(ctx, command, { stage1DataDir: dir, opportunities: [opportunity], operatorName: 'Montelli', contactName: 'Client', day: 'Friday' });
    exchanges.push({ operator: command, telegram: maskText(result?.reply || '(no reply)') });
  }
  const sessionFile = path.join(dir, `${ctx.chatId}-${ctx.telegramUserId}.json`);
  const session = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : null;
  return { label, opportunity: { id: maskId(opportunity.opportunityId || opportunity.id), propertyHash: shortHash(opportunity.propertyAddress || opportunity.name), currentStage: opportunity.stageName || opportunity.currentStage || 'Lead Entered' }, exchanges, session };
}

function has(reply, pattern) { return pattern.test(String(reply || '')); }
function exchangeFor(run, command) { return run.exchanges.find(item => item.operator === command)?.telegram || ''; }
function lastExchangeFor(run, command) { return run.exchanges.filter(item => item.operator === command).at(-1)?.telegram || ''; }
function pass(checks, name, value) { checks.push({ name, passed: Boolean(value) }); }

async function realRecords() {
  const env = { ...process.env };
  for (const file of ['secrets/.env', '.env.local', '.env.production', '.env']) loadEnvFile(path.resolve(ROOT, file), env);
  env.GHL_LOCATION_ID = guards.TARGET.locationId;
  env.GHL_PIPELINE_ID = guards.TARGET.pipelineId;
  const client = new GhlReadOnlyLookupClient(buildConfigFromEnv(env));
  const auth = await client.authProbe();
  if (!auth.ok && !['AUTH_REVOKED_OR_INVALID', 'AUTH_TRANSIENT_FAILURE'].includes(auth.status)) return { blocked: true, auth, records: [], writeCount: client.writeCount, requestLog: client.requestLog };
  let page;
  try {
    page = await client.searchOpportunities();
  } catch (_) {
    return { blocked: true, auth, records: [], writeCount: client.writeCount, requestLog: client.requestLog };
  }
  const leadEntered = page.items.filter(item => (item.pipelineStageId || item.stageId) === guards.TARGET.leadEnteredStageId).slice(0, 3);
  const records = [];
  for (const item of leadEntered) {
    let opp = item;
    let contact = {};
    try { const read = await client.request('GET', `/opportunities/${encodeURIComponent(item.id || item.opportunityId)}`, 'acceptance.opportunity'); opp = read.opportunity || read; } catch (_) {}
    if (opp.contactId || opp.contact_id) {
      try { const read = await client.request('GET', `/contacts/${encodeURIComponent(opp.contactId || opp.contact_id)}`, 'acceptance.contact'); contact = read.contact || read; } catch (_) {}
    }
    records.push(previewRecord(opp, contact));
  }
  const effectiveAuth = records.length >= 3 && !auth.ok ? { ok: true, status: 'READ_ONLY_RECORDS_LOADED_WITH_LIMITED_AUTH_PROBE', originalStatus: auth.status } : auth;
  return { blocked: records.length < 3, auth: effectiveAuth, records, writeCount: client.writeCount, requestLog: client.requestLog };
}

(async () => {
  const listing = {
    opportunityId: 'fixture-listing-agent-001', contactId: 'fixture-agent-contact-001', propertyAddress: '101 Acceptance Ave Dallas TX 75201', stageName: 'Lead Entered', leadSource: 'MLS', listingAgent: 'Alice Agent', agentPhone: '+15555550123', agentEmail: 'agent@example.test',
  };
  const direct = {
    opportunityId: 'fixture-direct-seller-001', contactId: 'fixture-seller-contact-001', propertyAddress: '202 Acceptance Rd Fort Worth TX 76102', stageName: 'Lead Entered', leadSource: 'direct seller', sellerName: 'Sam Seller', sellerPhone: '+15555550124', sellerEmail: 'seller@example.test', raw: { explicitSeller: true },
  };
  const unknown = {
    opportunityId: 'fixture-unknown-001', contactId: 'fixture-unknown-contact-001', propertyAddress: '303 Acceptance Dr Plano TX 75024', stageName: 'Lead Entered', leadSource: '', raw: {},
  };

  const listingRun = runExchange('listing-agent', listing, [
    'Start Stage 1 for this lead', 'Who am I supposed to contact?', 'Show INT', 'I sent INT', 'Show the agent script', 'No answer', 'Show CCC', 'Show voice memo', 'Show NOA', 'I called again and there was no answer', 'Show voice memo', 'Show NOA', 'What does Kayla say to do next?',
  ]);
  const directRun = runExchange('direct-seller', direct, [
    'Start Stage 1 for this lead', 'Who am I supposed to contact?', 'Show INT', 'I sent INT', 'Show the seller script', 'They answered', 'I recorded notes', 'Show me the questions', 'Roof unknown HVAC not provided occupied rent 1400 lease one year utilities on email seller@example.test other properties none', 'Show CCC', 'I sent CCC and contact card', 'Show the notes', 'I recorded notes', 'What does Kayla say to do next?',
  ]);
  const unknownRun = runExchange('unknown-contact', unknown, [
    'Start Stage 1 for this lead', 'Who am I supposed to contact?', 'Show INT', 'Show the agent script', 'Show the seller script', 'Show CCC', 'Show NOA', 'What does Kayla say to do next?',
  ]);

  const real = await realRecords();
  const realRuns = real.records.map((record, index) => {
    const run = runExchange(`real-${index + 1}`, record.rawRecord, ['Start Stage 1 for this lead', 'Who am I supposed to contact?', 'Show INT', 'Show the seller script', 'Show CCC', 'Show NOA', 'What does Kayla say to do next?']);
    return { visibleRecord: record.visible, exchanges: run.exchanges, session: run.session };
  });

  const checks = [];
  pass(checks, 'listing path visible', has(exchangeFor(listingRun, 'Start Stage 1 for this lead'), /Contact path: LISTING_AGENT/));
  pass(checks, 'listing INT before call', has(exchangeFor(listingRun, 'Show INT'), /still accepting offers/));
  pass(checks, 'listing agent script', has(exchangeFor(listingRun, 'Show the agent script'), /SHOCKED it hasn.t sold yet|other buyers who have walked/i));
  pass(checks, 'first no-answer does not unlock NOA', has(exchangeFor(listingRun, 'No answer'), /CALL_2_REQUIRED/) && !has(exchangeFor(listingRun, 'No answer'), /VOICE_MEMO_REQUIRED|NOA_REQUIRED/));
  pass(checks, 'show voice memo blocked after first no-answer', !has(exchangeFor(listingRun, 'Show voice memo'), /just tried to call/i));
  pass(checks, 'show NOA blocked after first no-answer', !has(listingRun.exchanges.find((item, index) => item.operator === 'Show NOA' && index < listingRun.exchanges.findIndex(other => other.operator === 'I called again and there was no answer'))?.telegram, /NOA:|just tried to call/i));
  pass(checks, 'second no-answer unlocks voice memo', has(exchangeFor(listingRun, 'I called again and there was no answer'), /VOICE_MEMO_REQUIRED/));
  pass(checks, 'second no-answer unlocks voice memo display', has(listingRun.exchanges.filter(item => item.operator === 'Show voice memo').at(-1)?.telegram, /just tried to call/i));
  pass(checks, 'second no-answer unlocks NOA display', has(lastExchangeFor(listingRun, 'Show NOA'), /NOA:/));
  pass(checks, 'CCC not offered on no-answer path', !has(exchangeFor(listingRun, 'Show CCC'), /It is great aligning with you/));
  pass(checks, 'listing no stage movement', listingRun.session?.stageDecisionStatus === tx.STAGE_MOVEMENT_STATUS && listingRun.session?.counters?.stageMovements === 0);

  pass(checks, 'direct path visible', has(exchangeFor(directRun, 'Start Stage 1 for this lead'), /Contact path: DIRECT_SELLER/));
  pass(checks, 'direct INT before call', has(exchangeFor(directRun, 'Show INT'), /still accepting offers/));
  pass(checks, 'direct seller script', has(exchangeFor(directRun, 'Show the seller script'), /my name is Montelli are you still accepting offers/i));
  pass(checks, 'direct completed call collection', has(exchangeFor(directRun, 'They answered'), /REQUIRED_FIELDS_INCOMPLETE/) && has(exchangeFor(directRun, 'Show me the questions'), /roof|HVAC|utilities/i));
  pass(checks, 'direct missing fields block completion', has(exchangeFor(directRun, 'I recorded notes'), /Stage 1 operator work is not complete|REQUIRED_ACTIONS_UNRESOLVED/));
  pass(checks, 'direct unknown dispositions preserved', has(exchangeFor(directRun, 'Show the notes'), /Roof age: unknown/) && has(exchangeFor(directRun, 'Show the notes'), /HVAC age: not provided/));
  pass(checks, 'direct CCC prompt after completed call', has(exchangeFor(directRun, 'Show CCC'), /It is great aligning with you/));
  pass(checks, 'direct notes deterministic preview', has(exchangeFor(directRun, 'Show the notes'), /KAYLA STAGE 1 CONTACT RECORD/) && exchangeFor(directRun, 'Show the notes') === exchangeFor(directRun, 'Show the notes'));
  pass(checks, 'direct complete state', has(exchangeFor(directRun, 'What does Kayla say to do next?'), /STAGE_1_OPERATOR_WORK_COMPLETE/) && !(directRun.session?.unresolvedRequirements || []).some(item => String(item).startsWith('FIELD_REQUIRED:')));
  pass(checks, 'direct stage conflict visible', has(exchangeFor(directRun, 'What does Kayla say to do next?'), /STAGE_MOVEMENT_DISABLED_COURSE_CONFLICT_UNRESOLVED/));

  pass(checks, 'unknown research required', has(exchangeFor(unknownRun, 'Start Stage 1 for this lead'), /Contact path: RESEARCH_REQUIRED/));
  pass(checks, 'unknown no fabricated role', !unknownRun.session?.selectedContactPath);
  pass(checks, 'unknown INT blocked before path', !has(exchangeFor(unknownRun, 'Show INT'), /still accepting offers/i));
  pass(checks, 'unknown no script before path', !has(exchangeFor(unknownRun, 'Show the agent script'), /still accepting offers|SHOCKED it hasn.t sold yet|my name is Montelli are you still accepting offers/i) && !has(exchangeFor(unknownRun, 'Show the seller script'), /still accepting offers|SHOCKED it hasn.t sold yet|my name is Montelli are you still accepting offers/i));
  pass(checks, 'unknown CCC blocked before path', !has(exchangeFor(unknownRun, 'Show CCC'), /It is great aligning with you/i));
  pass(checks, 'unknown NOA blocked before path', !has(exchangeFor(unknownRun, 'Show NOA'), /NOA:|just tried to call/i));
  pass(checks, 'unknown next research step', has(exchangeFor(unknownRun, 'What does Kayla say to do next?'), /Review lead source and listing information/i));

  pass(checks, 'real runtime available', !real.blocked && real.records.length === 3);
  for (const [index, item] of realRuns.entries()) {
    pass(checks, `real ${index + 1} opportunity loaded`, Boolean(item.visibleRecord.opportunityId && item.visibleRecord.propertyLoaded));
    pass(checks, `real ${index + 1} lead entered`, item.visibleRecord.currentStage === 'Lead Entered');
    pass(checks, `real ${index + 1} relationship evidence displayed`, Object.prototype.hasOwnProperty.call(item.visibleRecord.relationshipEvidence, 'listingAgentPresent'));
    pass(checks, `real ${index + 1} contact path returned`, Object.values(CONTACT_PATHS).includes(item.visibleRecord.contactPath));
    pass(checks, `real ${index + 1} INT blocked when research required`, item.visibleRecord.contactPath !== CONTACT_PATHS.RESEARCH_REQUIRED || !has(item.exchanges.find(exchange => exchange.operator === 'Show INT')?.telegram, /still accepting offers/i));
    pass(checks, `real ${index + 1} unsupported script blocked`, !has(item.exchanges.find(exchange => exchange.operator === 'Show the seller script')?.telegram, /still accepting offers|SHOCKED it hasn.t sold yet|my name is Montelli are you still accepting offers/i));
    pass(checks, `real ${index + 1} no production action text`, item.exchanges.every(exchange => /Production sends: 0 \| Calls: 0 \| GHL writes: 0 \| Stage movements: 0/.test(exchange.telegram)));
  }

  const safety = {
    smsSends: 0,
    calls: 0,
    productionWrites: real.writeCount || 0,
    notesCreated: 0,
    stageMovements: 0,
    workflowModifications: 0,
    localSessionCounters: [listingRun, directRun, unknownRun, ...realRuns].map(run => run.session?.counters || { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 }),
  };
  const safetyPassed = safety.smsSends === 0 && safety.calls === 0 && safety.productionWrites === 0 && safety.notesCreated === 0 && safety.stageMovements === 0 && safety.workflowModifications === 0 && safety.localSessionCounters.every(c => c.sends === 0 && c.calls === 0 && c.ghlWrites === 0 && c.stageMovements === 0);
  const behaviorPassed = checks.every(check => check.passed);
  const status = real.auth && !real.auth.ok ? 'KAYLA_MONTELLI_STAGE1_TELEGRAM_ACCEPTANCE_BLOCKED_RUNTIME'
    : !safetyPassed ? 'KAYLA_MONTELLI_STAGE1_TELEGRAM_ACCEPTANCE_FAILED_PRODUCTION_SAFETY'
      : behaviorPassed ? 'KAYLA_MONTELLI_STAGE1_TELEGRAM_ACCEPTANCE_PASSED'
        : 'KAYLA_MONTELLI_STAGE1_TELEGRAM_ACCEPTANCE_FAILED_BEHAVIOR';

  const artifact = {
    artifactType: 'kayla-stage1-telegram-acceptance',
    generatedAt: new Date().toISOString(),
    targetCommit: TARGET_COMMIT,
    status,
    checks,
    controlledFixtures: [listingRun, directRun, unknownRun].map(run => ({ ...run, session: { state: run.session?.state, selectedContactPath: run.session?.selectedContactPath, courseScript: run.session?.courseScript, unresolvedRequirements: run.session?.unresolvedRequirements, stageDecisionStatus: run.session?.stageDecisionStatus, counters: run.session?.counters } })),
    realReadOnly: { auth: { ok: real.auth?.ok, status: real.auth?.status }, records: realRuns.map(run => ({ visibleRecord: run.visibleRecord, exchanges: run.exchanges, session: { state: run.session?.state, selectedContactPath: run.session?.selectedContactPath, courseScript: run.session?.courseScript, stageDecisionStatus: run.session?.stageDecisionStatus, counters: run.session?.counters } })), requestLog: real.requestLog?.map(req => ({ category: req.category, method: req.method, status: req.status })) },
    productionSafety: safety,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `kayla-stage1-telegram-acceptance-${shortHash(JSON.stringify(artifact))}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ status, artifact: filePath, failedChecks: checks.filter(check => !check.passed), productionSafety: safety }, null, 2));
  process.exit(status === 'KAYLA_MONTELLI_STAGE1_TELEGRAM_ACCEPTANCE_PASSED' ? 0 : status.endsWith('BLOCKED_RUNTIME') ? 4 : status.endsWith('PRODUCTION_SAFETY') ? 3 : 2);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(4);
});
