'use strict';

const path = require('path');

const PROFILE_DIR = __dirname;

function loadJson(name) {
  return require(path.join(PROFILE_DIR, name));
}

const stageAuthority = loadJson('stage-authority.json');
const scriptAuthority = loadJson('script-authority.json');
const workflowAuthority = loadJson('workflow-authority.json');
const complianceProfile = loadJson('compliance-profile.json');

const PPC_PROFILE = Object.freeze({
  profileId: 'PPC_EWA_BEACH',
  label: 'PPC Ewa Beach (Divinity Aligned PPC)',
  locationId: 'GDq92uruRngbi9mLGGrV',
  pipelineId: 'ril84XHGQleRgE0W0FKU',
  pipelineName: 'Inbound PPC',
  credentialRef: 'PPC_GHL_API_KEY',
  workflowType: 'INBOUND_PPC_FIRST_CONTACT',

  stages: stageAuthority.stages,
  stageCount: stageAuthority.totalStages,
  populatedStageCount: stageAuthority.populatedStages,

  scripts: scriptAuthority.scripts,
  firstContactChannel: scriptAuthority.firstContactChannel,
  groupChatProtocol: scriptAuthority.groupChatProtocol,
  invariants: scriptAuthority.invariants,

  workflows: workflowAuthority.workflows,

  guards: complianceProfile.guards,
  rules: complianceProfile.rules,

  getStageById(stageId) {
    return this.stages.find(s => s.stageId === stageId) || null;
  },

  getScript(scriptId) {
    return this.scripts[scriptId] || null;
  },

  isFirstContactStage(stageId) {
    const stage = this.getStageById(stageId);
    return stage?.outreachEligibility === 'ELIGIBLE_FIRST_CONTACT';
  },

  isCallReady(deliveryState) {
    return deliveryState === 'DELIVERED';
  },

  lastVerified: '2026-08-11T20:00:00Z',
});

module.exports = PPC_PROFILE;
