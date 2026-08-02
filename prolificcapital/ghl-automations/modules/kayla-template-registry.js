'use strict';

const { loadKaylaCourseSpec, SHORTCUT_BODIES } = require('./kayla-course-spec');
const { getProductionScript } = require('./kayla-course-evidence');

const AUDIENCE_BY_SHORTCUT = Object.freeze({
  INT: ['agent', 'owner', 'broker'],
  NOA: ['agent', 'owner', 'broker'],
  DNCT: ['agent', 'owner', 'broker'],
  CCC: ['agent', 'owner', 'broker'],
  GCJ: ['agent', 'owner', 'broker'],
  LOI: ['agent', 'owner', 'broker'],
  LOI2DAYS: ['agent', 'owner', 'broker'],
  INLOI: ['agent', 'owner', 'broker'],
  F50: ['owner'],
  F10: ['owner'],
  PEND: ['agent', 'broker'],
  SD: ['agent', 'owner', 'broker'],
});

const STAGE_BY_SHORTCUT = Object.freeze({
  INT: 1,
  NOA: 1,
  DNCT: 1,
  CCC: 2,
  GCJ: 4,
  LOI: 6,
  LOI2DAYS: 7,
  INLOI: 6,
  F50: 2,
  F10: 2,
  PEND: 14,
  SD: 8,
});

function variablesFor(body) {
  const vars = new Set();
  for (const match of String(body).matchAll(/\[([^\]]+)\]/g)) vars.add(match[1].toLowerCase());
  return Array.from(vars).sort();
}

const OWNER_APPROVED_PIPELINE_INT_BODY = 'Happy [day], [Name]! Are you still accepting offers for [address]? My name is [your name], I\'m looking to purchase this as a rental for my portfolio.';

function createTemplateRegistry(options = {}) {
  const spec = options.spec || loadKaylaCourseSpec(options);
  const entries = Object.entries(SHORTCUT_BODIES).map(([shortcutName, body]) => ({
    ...(getProductionScript(shortcutName) || {}),
    shortcutName,
    audience: AUDIENCE_BY_SHORTCUT[shortcutName] || ['unknown'],
    stage: STAGE_BY_SHORTCUT[shortcutName] || null,
    actionType: ['INT', 'NOA', 'LOI', 'LOI2DAYS', 'SD', 'PEND', 'F50', 'F10', 'DNCT'].includes(shortcutName) ? 'TEXT' : 'TEXT_AFTER_CALL',
    body,
    variables: variablesFor(body),
    requiredContext: variablesFor(body).map(v => v === 'address' || v === 'property address' ? 'propertyAddress' : v === 'name' ? 'contactName' : v),
    source: getProductionScript(shortcutName)?.sourceFile || 'docs/atlas-kayla-course-parity-spec.md#script-inventory',
    sourceLines: getProductionScript(shortcutName)?.sourceLines || null,
    status: getProductionScript(shortcutName)?.courseClassification === 'COURSE_EXPLICIT_APPROVED' ? 'APPROVED_BY_COURSE' : 'COURSE_MISSING',
    allowedChannel: 'JustCall SMS dry-run only',
    callBeforeAfterRule: shortcutName === 'INT' ? 'CALL_AFTER_TEXT' : shortcutName === 'CCC' ? 'TEXT_AFTER_CALL' : 'MANUAL_REVIEW',
    followUpInterval: shortcutName === 'LOI2DAYS' ? '48h after no answer in feedback sequence' : shortcutName === 'SD' ? '96h escalation or seller declined' : null,
    manualReviewRequirement: 'Required before any live send; dry-run approval only in this phase.',
    courseRuleCitation: getProductionScript(shortcutName)?.sourceFile || spec.courseRules.map(rule => rule.citation)[0],
  }));

  entries.push({
    shortcutName: 'OWNER_APPROVED_PIPELINE_INT',
    audience: ['agent', 'owner', 'broker'],
    stage: 1,
    actionType: 'TEXT',
    body: OWNER_APPROVED_PIPELINE_INT_BODY,
    variables: variablesFor(OWNER_APPROVED_PIPELINE_INT_BODY),
    requiredContext: ['day', 'contactName', 'propertyAddress', 'senderName'],
    source: 'docs/OWNER_OPERATIONAL_POLICY.md#int-template',
    sourceLines: null,
    status: 'OWNER_APPROVED',
    allowedChannel: 'JustCall SMS production',
    callBeforeAfterRule: 'CALL_AFTER_TEXT',
    followUpInterval: null,
    manualReviewRequirement: 'Explicit owner approval required before every production send.',
    courseRuleCitation: 'docs/OWNER_OPERATIONAL_POLICY.md',
    provenance: 'OWNER_POLICY — explicitly approved project variant derived from the owner\'s operating preference. Combines the \'Happy [day]\' greeting from the SELLER_INITIAL call script with the INT shortcut body. It is not Kayla\'s original SMS wording.',
  });

  return entries;
}

function getTemplate(shortcutName, options = {}) {
  return createTemplateRegistry(options).find(template => template.shortcutName === shortcutName) || null;
}

function renderTemplate(template, context = {}) {
  if (!template) throw new Error('TEMPLATE_REQUIRED');
  const contactName = context.contactName || context.name || '[Name]';
  const propertyAddress = context.propertyAddress || context.address || '[address]';
  const senderName = context.senderName || '[your name]';
  const day = context.day || '[day]';
  return template.body
    .replace(/\[Name\]/g, contactName)
    .replace(/\[name\]/g, contactName)
    .replace(/\[your name\]/g, senderName)
    .replace(/\[address\]/g, propertyAddress)
    .replace(/\[ADDRESS\]/g, propertyAddress)
    .replace(/\[property address\]/g, propertyAddress)
    .replace(/\[day\]/g, day);
}

module.exports = { createTemplateRegistry, getTemplate, renderTemplate, variablesFor };
