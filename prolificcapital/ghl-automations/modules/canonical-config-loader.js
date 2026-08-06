'use strict';

const fs = require('fs');
const path = require('path');

const CANONICAL_VARS = Object.freeze({
  GHL_TOKEN: { aliases: ['GHL_API_TOKEN', 'GHL_API_KEY'], required: true, sensitive: true },
  GHL_LOCATION_ID: { aliases: [], required: true, sensitive: false },
  GHL_PIPELINE_ID: { aliases: ['GHL_ATLAS_PIPELINE_ID'], required: true, sensitive: false },
  JUSTCALL_API_KEY: { aliases: [], required: true, sensitive: true },
  JUSTCALL_API_SECRET: { aliases: [], required: true, sensitive: true },
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      result[key] = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      result[key] = value.slice(1, -1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function loadConfig(options = {}) {
  const envDir = options.envDir || path.resolve(__dirname, '..', '..', 'secrets');
  const envFile = path.join(envDir, '.env');
  const env = loadEnvFile(envFile);

  const report = {};
  const config = {};

  for (const [canonicalName, spec] of Object.entries(CANONICAL_VARS)) {
    const candidates = [canonicalName, ...spec.aliases];
    const found = [];
    for (const name of candidates) {
      if (env[name] !== undefined) {
        found.push({ name, value: env[name] });
      }
    }

    if (found.length === 0) {
      report[canonicalName] = spec.required ? 'MISSING' : 'MISSING_OPTIONAL';
      if (spec.required) {
        config[canonicalName] = null;
      }
      continue;
    }

    if (found.length > 1) {
      const values = new Set(found.map(f => f.value));
      if (values.size > 1) {
        report[canonicalName] = 'CONFLICT';
        config[canonicalName] = null;
        continue;
      }
    }

    const value = found[0].value;
    if (!value || value.length === 0) {
      report[canonicalName] = spec.required ? 'MISSING' : 'MISSING_OPTIONAL';
      if (spec.required) config[canonicalName] = null;
      continue;
    }

    report[canonicalName] = 'PRESENT';
    config[canonicalName] = value;
  }

  const ready = Object.values(report).every(s => s === 'PRESENT' || s === 'MISSING_OPTIONAL');

  return {
    ready,
    report,
    config,
    envFile,
    loadedAt: new Date().toISOString(),
  };
}

module.exports = { CANONICAL_VARS, loadConfig, loadEnvFile };
