'use strict';

const { loadKaylaCourseSpec, SHORTCUT_BODIES } = require('./kayla-course-spec');

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

function createTemplateRegistry(options = {}) {
  const spec = options.spec || loadKaylaCourseSpec(options);
  return Object.entries(SHORTCUT_BODIES).map(([shortcutName, body]) => ({
    shortcutName,
    audience: AUDIENCE_BY_SHORTCUT[shortcutName] || ['unknown'],
    stage: STAGE_BY_SHORTCUT[shortcutName] || null,
    actionType: ['INT', 'NOA', 'LOI', 'LOI2DAYS', 'SD', 'PEND', 'F50', 'F10', 'DNCT'].includes(shortcutName) ? 'TEXT' : 'TEXT_AFTER_CALL',
    body,
    variables: variablesFor(body),
    requiredContext: variablesFor(body).map(v => v === 'address' || v === 'property address' ? 'propertyAddress' : v === 'name' ? 'contactName' : v),
    source: 'docs/atlas-kayla-course-parity-spec.md#script-inventory',
    status: 'APPROVED_BY_COURSE',
    allowedChannel: 'JustCall SMS dry-run only',
    callBeforeAfterRule: shortcutName === 'INT' ? 'CALL_AFTER_TEXT' : shortcutName === 'CCC' ? 'TEXT_AFTER_CALL' : 'MANUAL_REVIEW',
    followUpInterval: shortcutName === 'LOI2DAYS' ? '48h after no answer in feedback sequence' : shortcutName === 'SD' ? '96h escalation or seller declined' : null,
    manualReviewRequirement: 'Required before any live send; dry-run approval only in this phase.',
    courseRuleCitation: spec.courseRules.map(rule => rule.citation)[0],
  }));
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
