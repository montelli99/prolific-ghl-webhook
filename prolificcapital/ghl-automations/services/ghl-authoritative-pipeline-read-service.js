'use strict';

const { GhlAuthoritativeHydrator } = require('../modules/ghl-authoritative-pipeline-hydrator');

function getHydrator(env = process.env) {
  return new GhlAuthoritativeHydrator({
    token: env.GHL_API_TOKEN || env.GHL_API_KEY || env.GHL_TOKEN,
    locationId: env.GHL_LOCATION_ID,
    pipelineId: env.GHL_ATLAS_PIPELINE_ID || env.GHL_PIPELINE_ID,
    apiVersion: env.GHL_API_VERSION || '2021-07-28'
  });
}

async function getLiveInventory(profile = 'INVENTORY', env = process.env) {
  const hydrator = getHydrator(env);
  const { summary, records } = await hydrator.hydrate(profile);
  return { summary, records };
}

function classifyRecord(record) {
  return GhlAuthoritativeHydrator.classifyRecord(record);
}

module.exports = {
  getLiveInventory,
  classifyRecord,
  getHydrator
};
