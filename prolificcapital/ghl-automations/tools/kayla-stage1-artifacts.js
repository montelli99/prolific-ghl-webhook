#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { calculateCanonicalArtifactHash, hashMetadata } = require('../modules/atlas-artifact-hash');
const { CONTACT_PATHS } = require('../modules/kayla-stage1-contact-path');
const { SCRIPT_REGISTRY } = require('../modules/kayla-stage1-scripts');
const { FIELD_SCHEMA } = require('../modules/kayla-stage1-information');
const { STATES, STAGE_MOVEMENT_STATUS } = require('../modules/kayla-stage1-transaction');
const { parseStage1Intent } = require('../modules/kayla-telegram-outreach');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'ghl-automations', 'reports', 'kayla-stage1');

function writeArtifact(name, payload) {
  const artifact = { artifactType: name, generatedAt: new Date().toISOString(), ...hashMetadata(), payload };
  artifact.canonicalHash = calculateCanonicalArtifactHash(artifact);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `${name}-${artifact.canonicalHash.slice(0, 12)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2) + '\n');
  return { filePath, canonicalHash: artifact.canonicalHash };
}

const telegramExamples = [
  'Show me my Stage 1 leads.',
  'Start the first lead.',
  'Who am I supposed to contact?',
  'This is the listing agent.',
  'This is a direct seller.',
  'I need to research who the contact is.',
  'Show the INT shortcut.',
  'I sent INT.',
  'Show the agent script.',
  'Show the seller script.',
  'Start the first call.',
  'No answer.',
  'I called again and there was no answer.',
  'Show the voice memo.',
  'I sent the voice memo and NOA.',
  'They answered.',
  'Show me the questions.',
  'The roof is 10 years old and HVAC is 6 years old.',
  'Show CCC.',
  'I sent CCC and the contact card.',
  'Show the notes.',
  'I entered the notes.',
  'What does Kayla say to do next?',
  'Show the stage conflict.',
  'Cancel Stage 1 session.',
];

const cleanup = {
  filesInspected: [
    'ghl-automations/modules/kayla-course-evidence.js',
    'ghl-automations/modules/kayla-role-classifier.js',
    'ghl-automations/modules/property-timezone.js',
    'ghl-automations/modules/atlas-sender-verification.js',
    'ghl-automations/modules/_test_kayla_exact_course_canary.js',
    'ghl-automations/modules/kayla-production-data-loader.js',
    'ghl-automations/tools/atlas-telegram-production-snapshot.js',
    '.learnings/CHANGELOG.md',
    '.learnings/ERRORS.md',
    '.learnings/LEARNINGS.md',
    'memory/REI_STAGE_BY_STAGE_GUIDE.md',
  ],
  classifications: {
    PIPELINE_FIRST_VALID: [],
    ABANDONED_ATLAS_ROLE_RECOVERY: [
      'kayla-role-classifier.js import-source role evidence hunks',
      'kayla-production-data-loader.js import-ready role index hunks',
      'atlas-telegram-production-snapshot.js import-ready join hunks',
      'atlas-sender-verification.js env-loader hunk from abandoned sender recovery',
      '_test_kayla_exact_course_canary.js import role tests',
    ],
    BUG_FIX_REQUIRED: ['raw is not defined was fixed by removing the abandoned classifier hunk'],
    UNRELATED: ['.learnings/* existing edits', 'memory/REI_STAGE_BY_STAGE_GUIDE.md existing edit'],
    UNKNOWN: [],
  },
  preservedHunks: ['Unrelated existing user/workspace edits were left untouched.'],
  revertedHunks: ['All abandoned role-recovery edits in pipeline files were restored to fbb7b69 baseline before Stage 1 implementation.'],
  defectRootCause: 'The abandoned classifier hunk called sourceEvidence(raw, ...) inside classifyRole without a raw binding in scope. It also made Stage 1 depend on import-ready role evidence, which was out of scope.',
};

const artifacts = {
  cleanup: writeArtifact('kayla-stage1-abandoned-drift-cleanup', cleanup),
  transactionModel: writeArtifact('kayla-stage1-transaction-model', { schema: 'kayla-stage1-transaction-v1', states: STATES, stageMovementStatus: STAGE_MOVEMENT_STATUS, externalActions: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 } }),
  contactPathDecisionMap: writeArtifact('kayla-stage1-contact-path-decision-map', { paths: CONTACT_PATHS, rule: 'Select a property-specific contact path from explicit transaction evidence or prompt research required.' }),
  scriptRegistry: writeArtifact('kayla-stage1-script-registry', SCRIPT_REGISTRY),
  questionFieldSchema: writeArtifact('kayla-stage1-question-field-schema', FIELD_SCHEMA),
  telegramIntentMap: writeArtifact('kayla-stage1-telegram-intent-map', telegramExamples.map(text => ({ text, parsed: parseStage1Intent(text) }))),
  testReport: writeArtifact('kayla-stage1-test-report', { commands: ['node ghl-automations/modules/_test_kayla_stage1_transaction.js', 'node ghl-automations/modules/_test_kayla_exact_course_canary.js', 'node ghl-automations/modules/_test_kayla_telegram_dry_run.js', 'node ghl-automations/modules/_test_atlas_ghl_telegram_live_guards.js', 'node ghl-automations/modules/_test_intent_router.js', 'node ghl-automations/modules/_test_justcall_integration.js', 'node ghl-automations/modules/_test_atlas_ghl_import.js', 'node ghl-automations/tools/_test_pipeline_telegram_review.js', 'node ghl-automations/modules/_test_atlas_operations_v1.js', 'node atlas-ghl-webhook-safety.test.js'], status: 'PASS_RECORDED_IN_SESSION' }),
  unresolvedConflict: writeArtifact('kayla-stage1-unresolved-stage-exit-conflict', { status: STAGE_MOVEMENT_STATUS, explanation: 'Kayla course documents conflict on the exact event that moves Stage 1 to Contact Made. The operator console records work but does not move production opportunities.' }),
};

console.log(JSON.stringify({ ok: true, artifacts }, null, 2));
