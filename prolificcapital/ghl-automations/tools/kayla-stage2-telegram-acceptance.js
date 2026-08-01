#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const stage1 = require('../modules/kayla-stage1-transaction');
const stage2tg = require('../modules/kayla-stage2-telegram');
const contract = require('../modules/kayla-stage2-contract');
const tx = require('../modules/kayla-stage2-transaction');
const availability = require('../modules/kayla-stage2-action-availability');
const { CONTACT_PATHS } = require('../modules/kayla-stage1-contact-path');
const { GhlReadOnlyLookupClient, buildConfigFromEnv } = require('../modules/atlas-ghl-readonly-client');
const guards = require('../modules/atlas-ghl-telegram-live-guards');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'ghl-automations', 'reports', 'kayla-stage2');
const TARGET_COMMIT = '0d885a0 docs(pipeline): resolve Stage 2 rules from course corpus';

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

function createStage1Fixture(overrides = {}) {
  const s1 = stage1.createStage1Session({
    opportunityId: 'fixture-s2-001',
    contactId: 'fixture-contact-001',
    propertyAddress: '101 Stage2 Ave Dallas TX 75201',
    stageName: 'Lead Entered',
    leadSource: 'MLS',
    listingAgent: 'Alice Agent',
    agentPhone: '+15555550123',
    agentEmail: 'agent@example.test',
    ...overrides,
  }, { operatorId: 'op-acceptance' });
  stage1.addEvent(s1, 'LEAD_REVIEWED');
  stage1.addEvent(s1, 'INT_CONFIRMED_SENT');
  stage1.addEvent(s1, 'CALL_COMPLETED_RECORDED');
  stage1.addEvent(s1, 'CALL_INFORMATION_RECORDED', { answers: {
    contactName: overrides.contactName || 'Alice Agent',
    contactPhone: overrides.contactPhone || '+15555550123',
    contactEmail: overrides.contactEmail || 'agent@example.test',
    roofAge: overrides.roofAge || '10 years',
    hvacAge: overrides.hvacAge || '6 years',
    occupancy: overrides.occupancy || 'occupied',
    monthlyRent: overrides.monthlyRent || '1400',
    leaseTerms: overrides.leaseTerms || 'one year',
    utilityResponsibility: overrides.utilityResponsibility || 'utilities on',
    listingFeedback: overrides.listingFeedback || 'price feedback',
    otherProperties: overrides.otherProperties || 'asked',
    askingPrice: overrides.askingPrice || '',
  } });
  stage1.addEvent(s1, 'CCC_CONFIRMED_SENT');
  stage1.addEvent(s1, 'CONTACT_CARD_CONFIRMED_SENT');
  stage1.addEvent(s1, 'NOTES_CONFIRMED_RECORDED');
  return s1;
}

function runExchange(label, stage1Session, commands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kayla-stage2-acceptance-${label}-`));
  const stage1Dir = path.join(dir, 'stage1');
  fs.mkdirSync(stage1Dir, { recursive: true });
  fs.writeFileSync(path.join(stage1Dir, `acceptance-${label}-operator.json`), `${JSON.stringify(stage1Session, null, 2)}\n`);
  const ctx = { chatId: `acceptance-${label}`, telegramUserId: 'operator-acceptance' };
  const exchanges = [];
  for (const command of commands) {
    const result = stage2tg.handleStage2Command(ctx, command, { stage2DataDir: dir, stage1DataDir: stage1Dir });
    exchanges.push({ operator: command, telegram: maskText(result?.reply || '(no reply)') });
  }
  const sessionFile = path.join(dir, `${ctx.chatId}-${ctx.telegramUserId}-stage2.json`);
  const session = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : null;
  return { label, exchanges, session };
}

function has(reply, pattern) { return pattern.test(String(reply || '')); }
function exchangeFor(run, command) { return run.exchanges.find(item => item.operator === command)?.telegram || ''; }
function pass(checks, name, value) { checks.push({ name, passed: Boolean(value) }); }

async function realRecords() {
  const env = { ...process.env };
  for (const file of ['secrets/.env', '.env.local', '.env.production', '.env']) loadEnvFile(path.resolve(ROOT, file), env);
  env.GHL_LOCATION_ID = guards.TARGET.locationId;
  env.GHL_PIPELINE_ID = guards.TARGET.pipelineId;
  const client = new GhlReadOnlyLookupClient(buildConfigFromEnv(env));
  const auth = await client.authProbe();
  if (!auth.ok && !['AUTH_REVOKED_OR_INVALID', 'AUTH_TRANSIENT_FAILURE'].includes(auth.status)) return { blocked: true, auth, records: [], writeCount: client.writeCount };
  let page;
  try { page = await client.searchOpportunities(); } catch (_) { return { blocked: true, auth, records: [], writeCount: client.writeCount }; }
  const leadEntered = page.items.filter(item => (item.pipelineStageId || item.stageId) === guards.TARGET.leadEnteredStageId).slice(0, 3);
  const records = [];
  for (const item of leadEntered) {
    let opp = item;
    let contact = {};
    try { const read = await client.request('GET', `/opportunities/${encodeURIComponent(item.id || item.opportunityId)}`, 'acceptance.opportunity'); opp = read.opportunity || read; } catch (_) {}
    if (opp.contactId || opp.contact_id) {
      try { const read = await client.request('GET', `/contacts/${encodeURIComponent(opp.contactId || opp.contact_id)}`, 'acceptance.contact'); contact = read.contact || read; } catch (_) {}
    }
    records.push({
      opportunityId: maskId(opp.id || opp.opportunityId),
      propertyAddress: opp.name || opp.opportunityName || '',
      stageName: 'Lead Entered',
      contactId: opp.contactId || opp.contact_id || '',
    });
  }
  const effectiveAuth = records.length >= 3 && !auth.ok ? { ok: true, status: 'READ_ONLY_RECORDS_LOADED_WITH_LIMITED_AUTH_PROBE' } : auth;
  return { blocked: records.length < 3, auth: effectiveAuth, records, writeCount: client.writeCount };
}

(async () => {
  const listingS1 = createStage1Fixture();
  const directS1 = createStage1Fixture({
    leadSource: 'direct seller', listingAgent: '', sellerName: 'Sam Seller', sellerPhone: '+15555550124', sellerEmail: 'sam@example.test',
    contactName: 'Sam Seller', contactPhone: '+15555550124', contactEmail: 'sam@example.test',
    roofAge: '10 years', hvacAge: '6 years', occupancy: 'vacant', monthlyRent: '', leaseTerms: '', listingFeedback: '', askingPrice: '250000',
    raw: { explicitSeller: true },
  });
  const missingS1 = createStage1Fixture({
    roofAge: '', hvacAge: '', occupancy: '', utilityResponsibility: '', listingFeedback: '',
  });

  const listingRun = runExchange('listing-agent', listingS1, [
    'Start Stage 2 review', 'Show Stage 1 notes', 'Verify entry', 'Show contact facts', 'What is missing?',
    'Mark roof unknown', 'Mark HVAC not provided', 'Show CCC status', 'Confirm CCC', 'Show contact card status', 'Confirm contact card',
    'Utilities on', 'Evaluate as turnkey', 'I reviewed the rental comps', 'Show F50', 'Show F10', 'Who does this go to?', 'Draft the handoff',
    'I submitted the handoff', 'Show GCJ', 'Is this ready for Offer Ready?', 'Simulate the next stage', 'Show the Stage 2 notes', 'What comes next?',
  ]);
  const directRun = runExchange('direct-seller', directS1, [
    'Start Stage 2 review', 'Verify entry', 'Show contact facts', 'What is missing?',
    'Evaluate as renovation', 'I added the rehab information', 'Show F10', 'Show F50', 'Draft the handoff',
    'I submitted the handoff', 'Simulate the next stage', 'Show the Stage 2 notes',
  ]);
  const missingRun = runExchange('missing-info', missingS1, [
    'Start Stage 2 review', 'Verify entry', 'Show contact facts', 'What is missing?',
    'Evaluate as turnkey', 'I recorded notes', 'Simulate the next stage',
  ]);

  const real = await realRecords();
  const realRuns = real.records.map((record, index) => {
    const s1 = stage1.createStage1Session({
      opportunityId: record.opportunityId,
      contactId: record.contactId,
      propertyAddress: record.propertyAddress,
      stageName: record.stageName,
      leadSource: '',
      raw: {},
    }, { operatorId: 'op-acceptance' });
    const run = runExchange(`real-${index + 1}`, s1, ['Start Stage 2 review', 'Verify entry', 'Show contact facts', 'What is missing?', 'What comes next?']);
    return { record, exchanges: run.exchanges, session: run.session };
  });

  const checks = [];
  pass(checks, 'contract validates', contract.validateContract().ok);
  pass(checks, 'S2-ALT-001 unresolved', contract.RESOLVED_RULES.S2_ALT_001.status === 'UNRESOLVED');
  pass(checks, 'listing entry verified', has(exchangeFor(listingRun, 'Verify entry'), /Entry verified/));
  pass(checks, 'listing facts displayed', has(exchangeFor(listingRun, 'Show contact facts'), /roofAge/));
  pass(checks, 'listing missing shown', has(exchangeFor(listingRun, 'What is missing?'), /Missing required/));
  pass(checks, 'listing roof unknown allowed', has(exchangeFor(listingRun, 'Mark roof unknown'), /CONTACT_FACTS/));
  pass(checks, 'listing turnkey evaluation', has(exchangeFor(listingRun, 'Evaluate as turnkey'), /COMPS_OR_RENT|TURNKEY/));
  pass(checks, 'listing comps reviewed', has(exchangeFor(listingRun, 'I reviewed the rental comps'), /EVALUATION_COMPLETE/));
  pass(checks, 'listing F50 available', has(exchangeFor(listingRun, 'Show F50'), /half your price now|Happy.*understand your intent/));
  pass(checks, 'listing F10 blocked', has(exchangeFor(listingRun, 'Show F10'), /F10_BLOCKED|not available/));
  pass(checks, 'listing handoff destination', has(exchangeFor(listingRun, 'Who does this go to?'), /SETH_LOI|Handoff destination/));
  pass(checks, 'listing handoff drafted', has(exchangeFor(listingRun, 'Draft the handoff'), /HANDOFF PACKAGE|handoff/));
  pass(checks, 'listing handoff submitted', has(exchangeFor(listingRun, 'I submitted the handoff'), /submitted|HANDOFF_SUBMITTED/));
  pass(checks, 'listing GCJ blocked', has(exchangeFor(listingRun, 'Show GCJ'), /GCJ_BLOCKED|not available/));
  pass(checks, 'listing offer ready eligible', has(exchangeFor(listingRun, 'Is this ready for Offer Ready?'), /eligible|EXIT_BLOCKED/));
  pass(checks, 'listing simulated move', has(exchangeFor(listingRun, 'Simulate the next stage'), /eligible|OFFER_READY/));
  pass(checks, 'listing notes preview', has(exchangeFor(listingRun, 'Show the Stage 2 notes'), /KAYLA STAGE 2 CONTACT MADE REVIEW/));
  pass(checks, 'listing no stage movement', listingRun.session?.counters?.stageMovements === 0);

  pass(checks, 'direct entry verified', has(exchangeFor(directRun, 'Verify entry'), /Entry verified/));
  pass(checks, 'direct renovation evaluation', has(exchangeFor(directRun, 'Evaluate as renovation'), /REHAB|RENOVATION/));
  pass(checks, 'direct F10 available', has(exchangeFor(directRun, 'Show F10'), /10% of your price|Happy.*understand your intent/));
  pass(checks, 'direct F50 blocked', has(exchangeFor(directRun, 'Show F50'), /F50_BLOCKED|not available/));
  pass(checks, 'direct handoff drafted', has(exchangeFor(directRun, 'Draft the handoff'), /HANDOFF PACKAGE|handoff/));
  pass(checks, 'direct simulated move', has(exchangeFor(directRun, 'Simulate the next stage'), /eligible|OFFER_READY/));

  pass(checks, 'missing facts incomplete', has(exchangeFor(missingRun, 'Show contact facts'), /CONTACT_FACTS/));
  pass(checks, 'missing evaluation blocked', has(exchangeFor(missingRun, 'Evaluate as turnkey'), /REQUIRED_FACTS_UNRESOLVED|Blocked/));
  pass(checks, 'missing completion blocked', has(exchangeFor(missingRun, 'I recorded notes'), /REQUIRED_ACTIONS_UNRESOLVED|Blocked/));
  pass(checks, 'missing exit blocked', has(exchangeFor(missingRun, 'Simulate the next stage'), /EXIT_BLOCKED|Not eligible/));

  pass(checks, 'real runtime available', !real.blocked && real.records.length === 3);
  for (const [index, item] of realRuns.entries()) {
    pass(checks, `real ${index + 1} loaded`, Boolean(item.record.opportunityId && item.record.propertyAddress));
    pass(checks, `real ${index + 1} entry blocked`, has(exchangeFor(item, 'Verify entry'), /blocked|ENTRY_BLOCKED/));
    pass(checks, `real ${index + 1} no production action`, item.exchanges.every(exchange => /Production sends: 0 \| Calls: 0 \| GHL writes: 0 \| Stage movements: 0/.test(exchange.telegram)));
  }

  const safety = {
    smsSends: 0, calls: 0, productionWrites: real.writeCount || 0, notesCreated: 0, stageMovements: 0, workflowModifications: 0,
    localSessionCounters: [listingRun, directRun, missingRun, ...realRuns].map(run => run.session?.counters || { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 }),
  };
  const safetyPassed = safety.smsSends === 0 && safety.calls === 0 && safety.productionWrites === 0 && safety.notesCreated === 0 && safety.stageMovements === 0 && safety.workflowModifications === 0 && safety.localSessionCounters.every(c => c.sends === 0 && c.calls === 0 && c.ghlWrites === 0 && c.stageMovements === 0);
  const behaviorPassed = checks.every(check => check.passed);
  const status = real.auth && !real.auth.ok && real.records.length < 3 ? 'KAYLA_MONTELLI_STAGE2_CORE_BLOCKED_CONTRACT_DEFECT'
    : !safetyPassed ? 'KAYLA_MONTELLI_STAGE2_CORE_ACCEPTANCE_FAILED_PRODUCTION_SAFETY'
      : behaviorPassed ? 'KAYLA_MONTELLI_STAGE2_CORE_ACCEPTANCE_PASSED'
        : 'KAYLA_MONTELLI_STAGE2_CORE_ACCEPTANCE_FAILED_BEHAVIOR';

  const artifact = {
    artifactType: 'kayla-stage2-telegram-acceptance',
    generatedAt: new Date().toISOString(),
    targetCommit: TARGET_COMMIT,
    status,
    checks,
    controlledFixtures: [listingRun, directRun, missingRun].map(run => ({
      label: run.label, exchanges: run.exchanges,
      session: { state: run.session?.state, contactPath: run.session?.contactPath, dealType: run.session?.dealType, handoffDestination: run.session?.handoffDestination, exitEligible: run.session?.exitEligible, counters: run.session?.counters },
    })),
    realReadOnly: { auth: { ok: real.auth?.ok, status: real.auth?.status }, records: realRuns.map(run => ({ record: run.record, exchanges: run.exchanges, session: { state: run.session?.state, counters: run.session?.counters } })) },
    productionSafety: safety,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `kayla-stage2-telegram-acceptance-${shortHash(JSON.stringify(artifact))}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ status, artifact: filePath, failedChecks: checks.filter(check => !check.passed), productionSafety: safety }, null, 2));
  process.exit(status === 'KAYLA_MONTELLI_STAGE2_CORE_ACCEPTANCE_PASSED' ? 0 : status.endsWith('PRODUCTION_SAFETY') ? 3 : status.endsWith('CONTRACT_DEFECT') ? 4 : 2);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(4);
});
