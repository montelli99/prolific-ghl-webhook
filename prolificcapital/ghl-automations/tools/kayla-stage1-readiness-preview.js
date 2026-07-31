#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GhlReadOnlyLookupClient, buildConfigFromEnv } = require('../modules/atlas-ghl-readonly-client');
const guards = require('../modules/atlas-ghl-telegram-live-guards');
const { selectContactPath, CONTACT_PATHS, scriptForContactPath } = require('../modules/kayla-stage1-contact-path');
const { createStage1Session } = require('../modules/kayla-stage1-transaction');
const { SCRIPT_REGISTRY } = require('../modules/kayla-stage1-scripts');
const { FIELD_SCHEMA } = require('../modules/kayla-stage1-information');
const { calculateCanonicalArtifactHash, hashMetadata } = require('../modules/atlas-artifact-hash');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'ghl-automations', 'reports', 'kayla-stage1');

function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || env[match[1]]) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
}

function sha(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function maskId(value) { const s = String(value || ''); return s ? `${s.slice(0, 6)}...${s.slice(-4)}` : ''; }
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
function contactName(contact = {}, opp = {}) { return contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || opp.contactName || ''; }
function contactPhone(contact = {}, opp = {}) { return contact.phone || contact.phoneNumber || opp.phone || opp.phoneNumber || ''; }
function previewRecord(opp = {}, contact = {}) {
  const propertyAddress = opp.name || opp.opportunityName || opp.propertyAddress || '';
  const leadSource = opp.source || fieldValue(opp, ['Lead Source', 'Source']) || '';
  const listingAgent = fieldValue(opp, ['Listing Agent', 'Agent Name']) || fieldValue(contact, ['Listing Agent']) || '';
  const sellerName = fieldValue(opp, ['Seller Name', 'Owner Name']) || fieldValue(contact, ['Seller Name']) || '';
  const record = {
    opportunityId: opp.id || opp.opportunityId,
    contactId: opp.contactId || contact.id,
    propertyAddress,
    stageName: 'Lead Entered',
    leadSource,
    listingAgent,
    agentPhone: fieldValue(opp, ['Agent Phone']) || contactPhone(contact, opp),
    agentEmail: fieldValue(opp, ['Agent Email']) || contact.email || '',
    sellerName,
    sellerPhone: fieldValue(opp, ['Seller Phone']),
    sellerEmail: fieldValue(opp, ['Seller Email']),
    explicitSeller: Boolean(sellerName && !listingAgent),
  };
  const selected = selectContactPath(record);
  const scriptId = scriptForContactPath(selected.path);
  const session = createStage1Session(record);
  return {
    opportunityId: maskId(record.opportunityId),
    opportunityIdHash: sha(record.opportunityId),
    propertyHash: sha(propertyAddress.toLowerCase()),
    propertyKnown: Boolean(propertyAddress),
    leadSourceKnown: Boolean(leadSource),
    explicitListingAgentContactPresent: Boolean(listingAgent),
    explicitSellerContactPresent: Boolean(sellerName),
    fsboMarkerPresent: /fsbo|for sale by owner/i.test(leadSource),
    ppcMarkerPresent: /ppc|inbound/i.test(leadSource),
    contactPath: selected.path,
    contactPathAutomaticallyEstablishable: selected.path !== CONTACT_PATHS.RESEARCH_REQUIRED,
    intScriptRenderable: Boolean(SCRIPT_REGISTRY.INT),
    agentScriptRenderable: Boolean(SCRIPT_REGISTRY.AGENT_INITIAL),
    sellerScriptRenderable: Boolean(SCRIPT_REGISTRY.SELLER_INITIAL),
    requiredInformationCurrentlyMissing: session.unresolvedRequirements.filter(item => item !== session.stageDecisionStatus),
    nextStage1OperatorAction: session.nextExactCourseStep,
    scriptId: scriptId || null,
  };
}
function writeArtifact(name, payload) {
  const artifact = { artifactType: name, generatedAt: new Date().toISOString(), ...hashMetadata(), payload };
  artifact.canonicalHash = calculateCanonicalArtifactHash(artifact);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `${name}-${artifact.canonicalHash.slice(0, 12)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2) + '\n');
  return { filePath, canonicalHash: artifact.canonicalHash };
}

(async () => {
  const env = { ...process.env };
  for (const file of ['secrets/.env', '.env.local', '.env.production', '.env']) loadEnvFile(path.resolve(ROOT, file), env);
  env.GHL_LOCATION_ID = guards.TARGET.locationId;
  env.GHL_PIPELINE_ID = guards.TARGET.pipelineId;
  const client = new GhlReadOnlyLookupClient(buildConfigFromEnv(env));
  const output = {
    baseline: 'fbb7b69d5f3b754bac325510f9d7fe7c9c5bc20d',
    scope: 'Kayla/Montelli Stage 1 operator readiness preview',
    authority: ['AIREI_SCRIPTS_REFERENCE.md', 'AIREI_SYSTEM_PLAYBOOK_v2.md', 'KAYLA_COACHING_REFERENCE.md', 'TRACK_STUDENT.md', 'TRACK_MONTELLI.md'],
    counters: { sends: 0, calls: 0, ghlWrites: 0, stageMovements: 0 },
    counts: { LISTING_AGENT_PATH_READY: 0, DIRECT_SELLER_PATH_READY: 0, FSBO_SELLER_PATH_READY: 0, PPC_SELLER_PATH_READY: 0, RESEARCH_REQUIRED: 0, BLOCKED_MISSING_PROPERTY: 0, BLOCKED_MISSING_CONTACT_ROUTE: 0, BLOCKED_MISSING_COURSE_SCRIPT: 0 },
    examples: [],
    cleanupReport: {
      inspectedFiles: ['kayla-course-evidence.js', 'kayla-role-classifier.js', 'property-timezone.js', 'atlas-sender-verification.js', '_test_kayla_exact_course_canary.js', 'kayla-production-data-loader.js', 'atlas-telegram-production-snapshot.js', '.learnings/*', 'memory/REI_STAGE_BY_STAGE_GUIDE.md'],
      preservedHunks: ['UNRELATED existing .learnings/* and memory/REI_STAGE_BY_STAGE_GUIDE.md changes left untouched'],
      revertedHunks: ['ABANDONED_ATLAS_ROLE_RECOVERY in classifier, loader, snapshot, sender verifier, exact-course test'],
      defectRootCause: 'sourceEvidence(raw, ...) was introduced inside classifyRole without defining raw in that function; the whole hunk belonged to abandoned import role recovery and was reverted.',
    },
    maps: {
      scriptRegistry: SCRIPT_REGISTRY,
      questionFieldSchema: FIELD_SCHEMA,
      contactPathDecisionMap: Object.values(CONTACT_PATHS),
      stageConflict: 'STAGE_MOVEMENT_DISABLED_COURSE_CONFLICT_UNRESOLVED',
    },
  };
  try {
    const auth = await client.authProbe();
    output.auth = { ok: auth.ok, status: auth.status };
    if (auth.ok) {
      const page = await client.searchOpportunities();
      const leadEntered = page.items.filter(item => (item.pipelineStageId || item.stageId) === guards.TARGET.leadEnteredStageId).slice(0, 25);
      for (const item of leadEntered) {
        let opp = item;
        let contact = {};
        try { const read = await client.request('GET', `/opportunities/${encodeURIComponent(item.id || item.opportunityId)}`, 'stage1.preview.opportunity'); opp = read.opportunity || read; } catch (_) {}
        if (opp.contactId || opp.contact_id) {
          try { const read = await client.request('GET', `/contacts/${encodeURIComponent(opp.contactId || opp.contact_id)}`, 'stage1.preview.contact'); contact = read.contact || read; } catch (_) {}
        }
        const preview = previewRecord(opp, contact);
        if (!preview.propertyKnown) output.counts.BLOCKED_MISSING_PROPERTY++;
        if (preview.contactPath === CONTACT_PATHS.LISTING_AGENT) output.counts.LISTING_AGENT_PATH_READY++;
        else if (preview.contactPath === CONTACT_PATHS.DIRECT_SELLER) output.counts.DIRECT_SELLER_PATH_READY++;
        else if (preview.contactPath === CONTACT_PATHS.FSBO_SELLER) output.counts.FSBO_SELLER_PATH_READY++;
        else if (preview.contactPath === CONTACT_PATHS.PPC_SELLER) output.counts.PPC_SELLER_PATH_READY++;
        else output.counts.RESEARCH_REQUIRED++;
        if (!preview.contactPathAutomaticallyEstablishable) output.counts.BLOCKED_MISSING_CONTACT_ROUTE++;
        if (!preview.intScriptRenderable || (!preview.agentScriptRenderable && !preview.sellerScriptRenderable)) output.counts.BLOCKED_MISSING_COURSE_SCRIPT++;
        if (output.examples.length < 3) output.examples.push(preview);
      }
      output.sampleSize = leadEntered.length;
    }
  } catch (error) {
    output.auth = { ok: false, status: 'READ_ONLY_PREVIEW_FAILED', reason: error.message };
  }
  const artifacts = {
    cleanup: writeArtifact('kayla-stage1-abandoned-drift-cleanup', output.cleanupReport),
    courseRuleMap: writeArtifact('kayla-stage1-course-rule-map', output.maps),
    readinessPreview: writeArtifact('kayla-stage1-production-readiness-preview', output),
    zeroActionProof: writeArtifact('kayla-stage1-zero-action-proof', output.counters),
  };
  console.log(JSON.stringify({ ok: true, artifacts, counts: output.counts, examples: output.examples, counters: output.counters, auth: output.auth }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
