#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GhlReadOnlyLookupClient, buildConfigFromEnv, normalizePhone } = require('../modules/atlas-ghl-readonly-client');
const { calculateCanonicalArtifactHash, hashMetadata } = require('../modules/atlas-artifact-hash');
const guards = require('../modules/atlas-ghl-telegram-live-guards');
const { loadKaylaCourseSpec, LEAD_ENTERED_STAGE_ID } = require('../modules/kayla-course-spec');
const { createTemplateRegistry, renderTemplate } = require('../modules/kayla-template-registry');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'lead-tracking', 'atlas-deals', 'audits');

function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
}

function sha(value) { return value ? crypto.createHash('sha256').update(String(value)).digest('hex') : ''; }
function maskId(value) { const text = String(value || ''); return text ? `${text.slice(0, 6)}...${text.slice(-4)}` : ''; }
function values(entity = {}) {
  const fields = entity.customFields || entity.customField || entity.customFieldsValues || entity.customFieldValues || [];
  return Array.isArray(fields) ? fields.map(field => String(field.value ?? field.fieldValue ?? field.field_value ?? '')).filter(Boolean) : [];
}
function hasAtlasMarker(opp) {
  const haystack = [opp.source, ...values(opp)].join(' ');
  return /atlas_guarded_importer|import-ready:|propwire:/i.test(haystack);
}
function writeArtifact(name, payload) {
  const artifact = { artifactType: name, generatedAt: new Date().toISOString(), ...hashMetadata(), payload };
  artifact.canonicalHash = calculateCanonicalArtifactHash(artifact);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `${name}-${artifact.canonicalHash.slice(0, 12)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2) + '\n');
  return { filePath, canonicalHash: artifact.canonicalHash };
}
function firstPhone(contact = {}, opp = {}) { return contact.phone || contact.phoneNumber || opp.phone || opp.phoneNumber || ''; }
function contactName(contact = {}, opp = {}) { return contact.name || contact.contactName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || opp.contactName || 'Unknown Atlas Contact'; }
function redactGuard(guard) {
  const roleEvidence = guard.roleEvidence ? {
    role: guard.roleEvidence.role,
    level: guard.roleEvidence.level,
    reasons: guard.roleEvidence.reasons || [],
    conflictingRoles: guard.roleEvidence.conflictingRoles || undefined,
    evidence: {
      explicitRole: guard.roleEvidence.evidence?.explicitRole || '',
      hasSellerName: Boolean(guard.roleEvidence.evidence?.sellerName),
      hasListingAgent: Boolean(guard.roleEvidence.evidence?.listingAgent),
      hasBrokerage: Boolean(guard.roleEvidence.evidence?.brokerage),
      hasCompany: Boolean(guard.roleEvidence.evidence?.company),
      emailDomainHash: guard.roleEvidence.evidence?.email ? sha(String(guard.roleEvidence.evidence.email).split('@').pop()) : '',
      tagCount: guard.roleEvidence.evidence?.tags?.length || 0,
      repeatedPropertyCount: guard.roleEvidence.evidence?.repeatedPropertyCount || 0,
    },
  } : null;
  return {
    ...guard,
    roleEvidence,
    opportunityIdValidation: { ...guard.opportunityIdValidation, opportunityId: maskId(guard.opportunityIdValidation?.opportunityId) },
    contactIdValidation: { ...guard.contactIdValidation, contactId: maskId(guard.contactIdValidation?.contactId) },
  };
}

(async () => {
  const env = { ...process.env };
  for (const file of ['secrets/.env', '.env.local', '.env.production', '.env']) loadEnvFile(path.resolve(ROOT, file), env);
  env.GHL_LOCATION_ID = guards.TARGET.locationId;
  env.GHL_PIPELINE_ID = guards.TARGET.pipelineId;
  const client = new GhlReadOnlyLookupClient(buildConfigFromEnv(env));
  const auth = await client.authProbe();
  const snapshot = {
    target: guards.TARGET,
    auth: { ok: auth.ok, status: auth.status, failedProbe: auth.failedProbe || null },
    counts: { physicalTargetPipelineOpportunities: 0, atlasValidOpportunities: 0, uniqueAtlasContacts: 0, leadEnteredAtlasOpportunities: 0 },
    candidates: [],
    blockers: [],
    limitations: ['UNRESOLVED_MESSAGE_BODY_OBSERVABILITY_LIMITATION'],
    mutationMethodsInvoked: 0,
    liveSends: 0,
    productionWrites: 0,
    stageMovements: 0,
  };
  if (!auth.ok) {
    snapshot.blockers.push('READ_ONLY_GHL_AUTH_NOT_READY');
    const artifact = writeArtifact('atlas-telegram-production-snapshot', snapshot);
    console.log(JSON.stringify({ ok: false, artifact, snapshot }, null, 2));
    return;
  }

  const page = await client.searchOpportunities();
  snapshot.counts.physicalTargetPipelineOpportunities = page.items.length;
  const uniqueContacts = new Set();
  const spec = loadKaylaCourseSpec();
  const registry = createTemplateRegistry({ spec });
  for (const item of page.items) {
    const opportunityId = item.id || item.opportunityId;
    if (!opportunityId) continue;
    let opp = item;
    try {
      const read = await client.request('GET', `/opportunities/${encodeURIComponent(opportunityId)}`, 'telegram.snapshot.opportunity');
      opp = read.opportunity || read;
    } catch (error) {
      snapshot.blockers.push(`OPPORTUNITY_HYDRATION_FAILED:${maskId(opportunityId)}`);
    }
    if (!hasAtlasMarker(opp)) continue;
    const contactId = opp.contactId || opp.contact_id;
    if (contactId) uniqueContacts.add(contactId);
    let contact = {};
    if (contactId) {
      try {
        const read = await client.request('GET', `/contacts/${encodeURIComponent(contactId)}`, 'telegram.snapshot.contact');
        contact = read.contact || read;
      } catch (error) {
        snapshot.blockers.push(`CONTACT_HYDRATION_FAILED:${maskId(contactId)}`);
      }
    }
    const phone = firstPhone(contact, opp);
    const propertyAddress = opp.name || opp.opportunityName || opp.propertyAddress || '';
    const record = {
      opportunityId,
      contactId,
      propertyAddress,
      contactName: contactName(contact, opp),
      contactRole: /agent|realtor/i.test(contactName(contact, opp)) ? 'agent' : 'unknown',
      stageId: opp.pipelineStageId || opp.stageId,
      stageName: (opp.pipelineStageId || opp.stageId) === LEAD_ENTERED_STAGE_ID ? 'Lead Entered' : 'Other',
      phone,
      tags: contact.tags || opp.tags || [],
      dnc: Boolean(contact.dnd || contact.doNotDisturb || contact.dnc),
      wrongNumber: false,
      raw: { locationId: opp.locationId || guards.TARGET.locationId, pipelineId: opp.pipelineId || guards.TARGET.pipelineId, propertyFingerprint: sha(propertyAddress.toLowerCase()) },
      timeZone: contact.timezone || contact.timeZone || opp.timezone || opp.timeZone || '',
    };
    const guard = redactGuard(guards.evaluateGhlCanaryRecord(record, { records: [record], timeZone: record.timeZone, now: new Date(), workflowIsolationProven: false }));
    const template = registry.find(templateItem => templateItem.shortcutName === 'INT');
    snapshot.candidates.push({
      opportunityId: maskId(opportunityId),
      opportunityIdHash: sha(opportunityId),
      contactId: maskId(contactId),
      contactIdHash: sha(contactId),
      propertyHash: sha(propertyAddress.toLowerCase()),
      phoneHash: sha(normalizePhone(phone)),
      hasPhone: Boolean(phone),
      stageId: record.stageId,
      role: record.contactRole,
      tagCount: Array.isArray(record.tags) ? record.tags.length : 0,
      guard,
      previewMessageHash: template ? sha(renderTemplate(template, { contactName: record.contactName, propertyAddress, senderName: 'Montelli', day: '[day]' })) : '',
    });
  }
  snapshot.counts.atlasValidOpportunities = snapshot.candidates.length;
  snapshot.counts.uniqueAtlasContacts = uniqueContacts.size;
  snapshot.counts.leadEnteredAtlasOpportunities = snapshot.candidates.filter(item => item.stageId === LEAD_ENTERED_STAGE_ID).length;
  if (snapshot.counts.atlasValidOpportunities !== 206) snapshot.blockers.push(`ATLAS_VALID_COUNT_MISMATCH:${snapshot.counts.atlasValidOpportunities}`);
  if (snapshot.counts.uniqueAtlasContacts !== 177) snapshot.blockers.push(`UNIQUE_CONTACT_COUNT_MISMATCH:${snapshot.counts.uniqueAtlasContacts}`);
  const sendableCandidates = snapshot.candidates.filter(item => item.guard.passed).slice(0, 3);
  const reviewCandidates = [...snapshot.candidates]
    .sort((a, b) => a.guard.blockedReasons.length - b.guard.blockedReasons.length)
    .slice(0, 3);
  snapshot.canaryPreview = {
    status: sendableCandidates.length === 3 ? 'THREE_CANDIDATES_AVAILABLE_NO_SEND' : 'NOT_CURRENTLY_SENDABLE_TIME_WINDOW_OR_GUARD',
    sendableCandidates,
    reviewCandidates,
    selectedCount: sendableCandidates.length,
    requestedMax: 3,
    noSendProof: { ghlSends: 0, providerSends: 0, productionWrites: 0, stageMovements: 0 },
  };
  const artifact = writeArtifact('atlas-telegram-production-snapshot', snapshot);
  console.log(JSON.stringify({ ok: snapshot.blockers.length === 0, artifact, counts: snapshot.counts, blockers: snapshot.blockers, canaryPreview: snapshot.canaryPreview }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
