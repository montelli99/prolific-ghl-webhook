'use strict';

const ROLE_LEVELS = Object.freeze(['CONFIRMED', 'HIGH_CONFIDENCE_INFERRED', 'UNKNOWN', 'CONFLICTING']);

function text(value) { return String(value || '').trim(); }
function lower(value) { return text(value).toLowerCase(); }

function collectEvidence(record = {}) {
  const raw = record.raw || {};
  return {
    explicitRole: lower(record.contactRole || raw.contactRole || raw.contact_type || raw.contactType || raw.role),
    sellerName: text(raw.sellerName || raw.seller_name || raw.ownerName || raw.owner_name),
    listingAgent: text(raw.listingAgent || raw.listing_agent || raw.agentName || raw.agent_name),
    brokerage: text(raw.brokerage || raw.brokerageName || raw.brokerage_name || raw.company),
    company: text(raw.company || record.company),
    contactName: text(record.contactName || raw.contactName || raw.name),
    email: lower(raw.email || raw.agentEmail || raw.sellerEmail || record.email),
    tags: Array.isArray(record.tags || raw.tags) ? (record.tags || raw.tags).map(lower) : [],
    repeatedPropertyCount: Number(raw.repeatedPropertyCount || raw.sameContactPropertyCount || record.sameContactPropertyCount || 0),
  };
}

function classifyRole(record = {}) {
  const evidence = collectEvidence(record);
  const reasons = [];
  const explicit = evidence.explicitRole;
  const explicitMap = { seller: 'seller/owner', owner: 'seller/owner', agent: 'agent', broker: 'broker', investor: 'investor/wholesaler', wholesaler: 'investor/wholesaler', organization: 'organization' };
  if (explicitMap[explicit]) return { role: explicitMap[explicit], level: 'CONFIRMED', evidence, reasons: [`explicit role field: ${explicit}`] };

  const signals = [];
  if (evidence.sellerName && evidence.contactName && lower(evidence.sellerName) === lower(evidence.contactName)) signals.push(['seller/owner', 'contact matches seller/owner source field']);
  if (evidence.listingAgent && evidence.contactName && lower(evidence.listingAgent) === lower(evidence.contactName)) signals.push(['agent', 'contact matches listing-agent source field']);
  if (/agent|realtor|realty|listing/.test(lower(`${evidence.contactName} ${evidence.company} ${evidence.brokerage}`))) signals.push(['agent', 'name/company/brokerage indicates listing agent']);
  if (/broker/.test(lower(`${evidence.contactName} ${evidence.company} ${evidence.brokerage}`))) signals.push(['broker', 'name/company/brokerage indicates broker']);
  if (/llc|inc|holdings|properties|capital|investments/.test(lower(`${evidence.contactName} ${evidence.company}`))) signals.push(['organization', 'name/company indicates organization']);
  if (/invest|wholesale/.test(lower(`${evidence.contactName} ${evidence.company} ${evidence.email}`))) signals.push(['investor/wholesaler', 'name/company/email indicates investor or wholesaler']);
  if (evidence.tags.some(tag => /agent|realtor/.test(tag))) signals.push(['agent', 'contact tag indicates agent']);
  if (evidence.tags.some(tag => /owner|seller/.test(tag))) signals.push(['seller/owner', 'contact tag indicates seller/owner']);
  if (evidence.repeatedPropertyCount >= 4) signals.push(['agent', 'same contact appears across unrelated listings']);

  const roles = [...new Set(signals.map(([role]) => role))];
  if (roles.length > 1) return { role: 'unknown', level: 'CONFLICTING', evidence, reasons: signals.map(([, reason]) => reason), conflictingRoles: roles };
  if (roles.length === 1) return { role: roles[0], level: 'HIGH_CONFIDENCE_INFERRED', evidence, reasons: signals.map(([, reason]) => reason) };
  return { role: 'unknown', level: 'UNKNOWN', evidence, reasons };
}

function roleCanReceiveProductionScript(roleResult, template) {
  if (!roleResult || !template) return { ok: false, reason: 'COURSE_MISSING_SCRIPT' };
  if (!['CONFIRMED', 'HIGH_CONFIDENCE_INFERRED'].includes(roleResult.level)) return { ok: false, reason: 'ROLE_EVIDENCE_NOT_ESTABLISHED' };
  const role = roleResult.role === 'seller/owner' ? 'owner' : roleResult.role;
  if (!template.intendedAudience.includes(role)) return { ok: false, reason: 'COURSE_MISSING_SCRIPT' };
  return { ok: true, reason: 'ROLE_SCRIPT_MATCH' };
}

module.exports = { ROLE_LEVELS, collectEvidence, classifyRole, roleCanReceiveProductionScript };
