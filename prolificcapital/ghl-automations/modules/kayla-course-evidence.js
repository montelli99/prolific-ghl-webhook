'use strict';

const RULE_CLASSIFICATIONS = Object.freeze({
  COURSE_EXPLICIT: 'COURSE_EXPLICIT',
  COURSE_DERIVED: 'COURSE_DERIVED',
  COURSE_CONFLICT: 'COURSE_CONFLICT',
  COURSE_MISSING: 'COURSE_MISSING',
  TECHNICAL_SAFETY_POLICY: 'TECHNICAL_SAFETY_POLICY',
  LEGAL_OR_COMPLIANCE_RULE: 'LEGAL_OR_COMPLIANCE_RULE',
});

const COURSE_RULES = Object.freeze({
  INT_BEFORE_CALL: {
    ruleId: 'INT_BEFORE_CALL',
    behavior: 'Send INT text before calling.',
    classification: 'COURSE_EXPLICIT',
    sourceFile: 'airei-course-notes/AIREI_MASTER_PLAYBOOK.md',
    sourceLines: '70-73',
    supportingText: 'Before calling: Send "INT" text shortcut first ... Call the client twice.',
    implementationPath: 'kayla-template-registry.js INT template and Telegram canary preview',
    tests: ['_test_kayla_telegram_dry_run.js', '_test_atlas_ghl_telegram_live_guards.js'],
    unresolvedConflict: null,
  },
  TWO_CALLS_BEFORE_NOA: {
    ruleId: 'TWO_CALLS_BEFORE_NOA',
    behavior: 'Call twice before no-answer handling; then voice memo and NOA are the documented no-answer sequence.',
    classification: 'COURSE_EXPLICIT',
    sourceFile: 'ghl-automations/TRACK_STUDENT.md',
    sourceLines: '45-66',
    supportingText: 'IF NO ANSWER after 2 calls: Send voice memo ... Send NOA text.',
    implementationPath: 'post-send next-step display only; no automatic NOA send',
    tests: ['_test_atlas_ghl_telegram_live_guards.js'],
    unresolvedConflict: null,
  },
  CCC_AFTER_CALL: {
    ruleId: 'CCC_AFTER_CALL',
    behavior: 'Send CCC and contact card after every call.',
    classification: 'COURSE_EXPLICIT',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '235-237',
    supportingText: 'ALWAYS do: Send INT before every call ... Send CCC + contact card after every call.',
    implementationPath: 'CCC is registered but blocked unless call trigger exists',
    tests: ['_test_atlas_ghl_telegram_live_guards.js'],
    unresolvedConflict: null,
  },
  STAGE1_EXIT_AFTER_INT: {
    ruleId: 'STAGE1_EXIT_AFTER_INT',
    behavior: 'Production stage movement after initial INT SMS.',
    classification: 'COURSE_CONFLICT',
    sourceFile: 'ghl-automations/TRACK_STUDENT.md; memory/REI_STAGE_BY_STAGE_GUIDE.md; memory/FULL_COURSE_AUDIT.md',
    sourceLines: 'TRACK_STUDENT.md 19-49; REI_STAGE_BY_STAGE_GUIDE.md 24-29; FULL_COURSE_AUDIT.md 169-175',
    supportingText: 'TRACK_STUDENT says INT Sent advances to Stage 2, while summaries describe INT, call, collect information, CCC, notes, then move to Contact Made.',
    implementationPath: 'atlas-ghl-telegram-live-guards.js stageMovementCapability',
    tests: ['_test_atlas_ghl_telegram_live_guards.js', '_test_kayla_telegram_dry_run.js'],
    unresolvedConflict: 'No source cleanly proves outbound INT SMS alone always equals Contact Made or that unanswered INT must remain Lead Entered.',
  },
});

const SCRIPT_REGISTRY = Object.freeze({
  INT: {
    shortcutName: 'INT',
    exactSourceWording: '[Name], are you still accepting offers for [address]? My name is [your name], I\'m looking to purchase this as a rental for my portfolio.',
    intendedAudience: ['agent', 'owner', 'broker'],
    pipelineStage: 1,
    triggerCondition: 'Before every call.',
    requiredVariables: ['Name', 'address', 'your name'],
    callBeforeRule: 'None; this is sent before the call.',
    callAfterRule: 'Call after INT.',
    followUpRule: 'If no answer after two calls, voice memo and NOA.',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '10, 235-237',
    courseClassification: 'COURSE_EXPLICIT_APPROVED',
    currentApprovalStatus: 'APPROVED_BY_COURSE_SOURCE',
  },
  NOA: {
    shortcutName: 'NOA',
    exactSourceWording: 'Are you still accepting offers for [ADDRESS]?',
    intendedAudience: ['agent', 'owner', 'broker'],
    pipelineStage: 1,
    triggerCondition: 'After two unanswered calls.',
    requiredVariables: ['ADDRESS'],
    callBeforeRule: 'Requires two unanswered calls first.',
    callAfterRule: 'No automatic call-after rule in source.',
    followUpRule: 'No production automatic follow-up implemented.',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '11, 176-180',
    courseClassification: 'COURSE_EXPLICIT_APPROVED',
    currentApprovalStatus: 'APPROVED_BY_COURSE_SOURCE',
  },
  CCC: {
    shortcutName: 'CCC',
    exactSourceWording: 'It is great aligning with you [name], I look forward to connecting the dots with you shortly at [address]. Feel free to browse through our closings with similar clients on our website — [course source website reference]',
    intendedAudience: ['agent', 'owner', 'broker'],
    pipelineStage: 2,
    triggerCondition: 'After every call.',
    requiredVariables: ['name', 'address'],
    callBeforeRule: 'Requires completed call trigger.',
    callAfterRule: 'None.',
    followUpRule: 'Evaluate deal facts after contact.',
    sourceFile: 'lead-tracking/AIREI_SCRIPTS_REFERENCE.md',
    sourceLines: '13, 235-237',
    courseClassification: 'COURSE_EXPLICIT_APPROVED',
    currentApprovalStatus: 'APPROVED_BY_COURSE_SOURCE',
  },
});

function getCourseRule(ruleId) { return COURSE_RULES[ruleId] || null; }
function getProductionScript(shortcutName) { return SCRIPT_REGISTRY[shortcutName] || null; }
function productionActionAllowed(ruleId) {
  const rule = getCourseRule(ruleId);
  return Boolean(rule && ['COURSE_EXPLICIT', 'COURSE_DERIVED'].includes(rule.classification));
}

module.exports = { RULE_CLASSIFICATIONS, COURSE_RULES, SCRIPT_REGISTRY, getCourseRule, getProductionScript, productionActionAllowed };
