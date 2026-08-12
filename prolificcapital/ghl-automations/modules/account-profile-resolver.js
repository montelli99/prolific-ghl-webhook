'use strict';

const path = require('path');
const fs = require('fs');

const REGISTRY_PATH = path.resolve(__dirname, '..', 'config', 'account-registry.json');

let _registry = null;

function loadRegistry() {
  if (_registry) return _registry;
  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error('ACCOUNT_REGISTRY_MISSING');
  }
  _registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  if (!_registry.profiles || !_registry.validPairs) {
    throw new Error('ACCOUNT_REGISTRY_INVALID');
  }
  return _registry;
}

function resolveProfile(profileId) {
  const registry = loadRegistry();
  const profile = registry.profiles[profileId];
  if (!profile) {
    throw new Error(`UNKNOWN_GHL_PROFILE: ${profileId}`);
  }
  return {
    profileId: profile.profileId,
    locationId: profile.locationId,
    pipelineId: profile.pipelineId,
    credentialRef: profile.credentialRef,
    workflowType: profile.workflowType,
    label: profile.label,
  };
}

function validateProfileBinding(profileId, locationId, pipelineId) {
  const registry = loadRegistry();
  const profile = registry.profiles[profileId];
  if (!profile) {
    throw new Error(`UNKNOWN_GHL_PROFILE: ${profileId}`);
  }
  if (profile.locationId !== locationId || profile.pipelineId !== pipelineId) {
    throw new Error(
      `LOCATION_PIPELINE_PROFILE_MISMATCH: profile ${profileId} expects ` +
      `${profile.locationId}/${profile.pipelineId}, got ${locationId}/${pipelineId}`
    );
  }
  const pairValid = registry.validPairs.some(
    ([l, p]) => l === locationId && p === pipelineId
  );
  if (!pairValid) {
    throw new Error(
      `UNKNOWN_GHL_PROFILE_BINDING: location ${locationId} + pipeline ${pipelineId} ` +
      `is not a known valid pair`
    );
  }
  return true;
}

function listProfiles() {
  const registry = loadRegistry();
  return Object.keys(registry.profiles).map((id) => ({
    profileId: id,
    label: registry.profiles[id].label,
    locationId: registry.profiles[id].locationId,
    pipelineId: registry.profiles[id].pipelineId,
  }));
}

function getCredentialRef(profileId) {
  const profile = resolveProfile(profileId);
  return profile.credentialRef;
}

module.exports = {
  resolveProfile,
  validateProfileBinding,
  listProfiles,
  getCredentialRef,
  loadRegistry,
};
