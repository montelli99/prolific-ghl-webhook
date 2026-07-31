#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadKaylaCourseSpec } = require('../modules/kayla-course-spec');
const { createTemplateRegistry } = require('../modules/kayla-template-registry');
const { loadAtlasDryRunOpportunities } = require('../modules/kayla-production-data-loader');
const dry = require('../modules/telegram-outreach-dry-run');
const tg = require('../modules/kayla-telegram-outreach');

function ctx(user, chat = 'prod-dry-run') { return { telegramUserId: user, chatId: chat, env: process.env }; }

function main() {
  process.env.ATLAS_TELEGRAM_DRY_RUN_DIR = process.env.ATLAS_TELEGRAM_DRY_RUN_DIR || path.join(os.tmpdir(), `atlas-telegram-dry-run-${Date.now()}`);
  process.env.ATLAS_TELEGRAM_VIEWER_IDS = process.env.ATLAS_TELEGRAM_VIEWER_IDS || '9101';
  process.env.ATLAS_TELEGRAM_REVIEWER_IDS = process.env.ATLAS_TELEGRAM_REVIEWER_IDS || '9102';
  process.env.ATLAS_TELEGRAM_APPROVER_IDS = process.env.ATLAS_TELEGRAM_APPROVER_IDS || '9103';
  process.env.ATLAS_TELEGRAM_ADMIN_IDS = process.env.ATLAS_TELEGRAM_ADMIN_IDS || '9104';

  const spec = loadKaylaCourseSpec();
  const templates = createTemplateRegistry({ spec });
  const opportunities = loadAtlasDryRunOpportunities();
  dry.setKillSwitch('DRY_RUN_ONLY', ctx(9104));

  const outputs = [];
  outputs.push(['A', tg.handleKaylaOutreachCommand(ctx(9103), 'show 10 agents due for first contact', { opportunities }).reply]);
  outputs.push(['B', tg.handleKaylaOutreachCommand(ctx(9101, 'prod-owners'), 'show 10 owners due for first contact', { opportunities }).reply]);
  outputs.push(['C', tg.handleKaylaOutreachCommand(ctx(9101, 'prod-calls'), 'show current calls due', { opportunities }).reply]);
  outputs.push(['D', tg.handleKaylaOutreachCommand(ctx(9101, 'prod-texts'), 'show current texts due', { opportunities }).reply]);
  outputs.push(['E', tg.handleKaylaOutreachCommand(ctx(9101, 'prod-follow'), 'show follow-ups due', { opportunities }).reply]);
  outputs.push(['F', tg.handleKaylaOutreachCommand(ctx(9103), 'preview the first 5').reply]);
  outputs.push(['G', tg.handleKaylaOutreachCommand(ctx(9103), 'hold 1').reply]);
  outputs.push(['H', tg.handleKaylaOutreachCommand(ctx(9103), 'skip 2').reply]);
  outputs.push(['I', tg.handleKaylaOutreachCommand(ctx(9103), 'select 3, 4, and 5').reply]);
  outputs.push(['J-K', tg.handleKaylaOutreachCommand(ctx(9103), 'approve these for dry run').reply]);
  outputs.push(['L', tg.handleKaylaOutreachCommand(ctx(9103), 'what would move to Contact Made').reply]);
  outputs.push(['M', tg.handleKaylaOutreachCommand(ctx(9103), 'show today simulated activity').reply]);
  outputs.push(['N', tg.handleKaylaOutreachCommand(ctx(9104), 'pause outreach').reply]);
  outputs.push(['O', tg.handleKaylaOutreachCommand(ctx(9103), 'approve these for dry run').reply]);
  outputs.push(['P', tg.handleKaylaOutreachCommand(ctx(9104), 'resume dry run').reply]);

  const session = dry.latestSession('prod-dry-run', 9103);
  const journalPath = dry.paths().journal;
  const journalText = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, 'utf8') : '';
  const artifacts = [];
  artifacts.push(dry.createArtifact('atlas-kayla-parsed-spec', { spec }));
  artifacts.push(dry.createArtifact('atlas-telegram-session-model', { sessionStates: dry.SESSION_STATES, modes: dry.MODES, killSwitchStates: dry.KILL_SWITCH_STATES }));
  artifacts.push(dry.createArtifact('atlas-telegram-eligibility-rules', { resultClasses: ['ELIGIBLE_INITIAL_TEXT', 'ELIGIBLE_INITIAL_CALL', 'ELIGIBLE_FOLLOW_UP_TEXT', 'ELIGIBLE_FOLLOW_UP_CALL', 'ELIGIBLE_OFFER_FEEDBACK', 'ELIGIBLE_NEGOTIATION_ACTION', 'ELIGIBLE_CONTRACT_ACTION', 'NOT_DUE', 'BLOCKED_MISSING_COURSE_RULE', 'BLOCKED_COURSE_CONFLICT', 'BLOCKED_IDENTITY', 'BLOCKED_DNC', 'BLOCKED_WRONG_NUMBER', 'BLOCKED_PRIOR_OUTREACH_UNCERTAIN', 'BLOCKED_PENDING_REPLY', 'BLOCKED_ACTIVE_HUMAN_WORK', 'BLOCKED_MULTI_PROPERTY_CONTEXT', 'BLOCKED_WORKFLOW_CONFLICT', 'BLOCKED_MISSING_SCRIPT', 'BLOCKED_MISSING_PROPERTY_CONTEXT', 'BLOCKED_PROVIDER_CONFIGURATION', 'BLOCKED_SENDER_MISMATCH'], sampleCount: opportunities.length }));
  artifacts.push(dry.createArtifact('atlas-telegram-template-registry', { templates }));
  artifacts.push(dry.createArtifact('atlas-telegram-dry-run-plan', { session }));
  artifacts.push(dry.createArtifact('atlas-telegram-dry-run-journal', { journalLineCount: journalText.trim() ? journalText.trim().split(/\r?\n/).length : 0, journalPreview: journalText.trim().split(/\r?\n/).slice(-10).map(line => JSON.parse(line)) }));
  artifacts.push(dry.createArtifact('atlas-telegram-production-data-rehearsal', { opportunityCount: opportunities.length, scenarios: outputs.map(([scenario, reply]) => ({ scenario, replyPreview: reply.slice(0, 1200) })), liveSends: 0, productionWrites: 0, stageMovements: 0, workflowModifications: 0 }));
  artifacts.push(dry.createArtifact('atlas-telegram-live-blocker-register', { blockers: [{ code: 'BLOCKS_CANARY', item: 'Fresh JustCall credentials unavailable for current shell.' }, { code: 'BLOCKS_CANARY', item: 'Exact 2619 number must be re-verified immediately before live canary.' }, { code: 'BLOCKS_CANARY', item: 'Contact Made live movement has broad workflow side-effect risk.' }, { code: 'BLOCKS_CANARY', item: 'STOP/HELP and DNC persistence/readback path not proven in this dry-run layer.' }, { code: 'BLOCKS_SCALE_ONLY', item: 'Provider throughput and quiet-hours behavior remain not fully observable.' }] }));

  console.log(JSON.stringify({
    status: 'OK',
    dataDir: process.env.ATLAS_TELEGRAM_DRY_RUN_DIR,
    opportunityCount: opportunities.length,
    sessionId: session?.sessionId,
    planHash: session?.immutablePlanHash,
    scenarios: outputs.map(([scenario, reply]) => ({ scenario, ok: !/blocked/i.test(reply) || scenario === 'O' })),
    artifacts: artifacts.map(a => ({ file: a.file, canonicalHash: a.canonicalHash })),
    liveSends: 0,
    productionWrites: 0,
    stageMovements: 0,
    workflowModifications: 0,
  }, null, 2));
}

main();
