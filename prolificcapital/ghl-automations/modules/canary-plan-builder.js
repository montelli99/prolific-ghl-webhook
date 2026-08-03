'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { GhlAuthoritativeHydrator } = require('./ghl-authoritative-pipeline-hydrator');
const { normalizeOpportunity, classifyRole } = require('./telegram-outreach-dry-run');
const { derivePropertyTimezone } = require('./property-timezone');
const { resolveCompliance, PASSING_STATES } = require('./outreach-compliance-resolver');
const { JustCallSuppressionReadService } = require('./justcall-suppression-read-service');
const { JustCallTextHistoryReadService } = require('./justcall-text-history-read-service');
const { LocalSuppressionRegistry } = require('./local-suppression-registry');
const { getTemplate, renderTemplate } = require('./kayla-template-registry');
const { SELECTED_SENDER_SUFFIX } = require('./kayla-course-spec');

const POLICY_VERSION = 'OP-2026-08-02-v1';
const TEMPLATE_ID = 'OWNER_APPROVED_PIPELINE_INT';
const MAX_CANARY = 3;
const PLAN_DIR = path.resolve(__dirname, '..', 'data', 'canary-plans');

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

class CanaryPlanBuilder {
  constructor(config = {}) {
    this.ghlToken = config.ghlToken || process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || '';
    this.locationId = config.locationId || process.env.GHL_LOCATION_ID || '61XPzSqRy7UKMwW9DeB8';
    this.pipelineId = config.pipelineId || 'nSf3NXYVkt8X4PgW9aZ3';
    this.suppression = config.suppression || new JustCallSuppressionReadService();
    this.history = config.history || new JustCallTextHistoryReadService({ senderSuffix: SELECTED_SENDER_SUFFIX });
    this.localRegistry = config.localRegistry || new LocalSuppressionRegistry();
    this.template = getTemplate(TEMPLATE_ID);
  }

  async buildPreview(options = {}) {
    const now = options.now || new Date();
    const hydrator = new GhlAuthoritativeHydrator({
      token: this.ghlToken,
      locationId: this.locationId,
      pipelineId: this.pipelineId,
    });

    const hydration = await hydrator.hydrate('CANARY');
    const records = hydration.records || [];

    const production = records.filter(r => {
      const cls = r.classification || {};
      return cls.recordClass === 'PRODUCTION';
    });

    let globalBlacklist = null;
    let globalTexts = null;
    if (this.suppression.isConfigured()) {
      globalBlacklist = await this.suppression.fetchBlacklist();
    }
    if (this.history.isConfigured()) {
      globalTexts = await this.history.fetchAllTexts({ perPage: 5, maxPages: 20 });
    }

    const candidates = [];
    for (const record of production) {
      const normalized = normalizeOpportunity(record);
      if (!normalized.phone || !normalized.contactName || !normalized.propertyAddress) continue;
      if (normalized.currentStageId !== '7067148a-2ee8-4e5b-93c8-31e0253fea68') continue;

      const timezone = derivePropertyTimezone(normalized, { now });
      if (!timezone.ok) continue;

      const roleEvidence = classifyRole(normalized);
      if (!['agent', 'owner', 'broker'].includes(roleEvidence.role)) continue;

      const phone = normalized.phone;
      const normalizedPhone = this.suppression.normalizePhone(phone);

      let jcSuppression = null;
      if (globalBlacklist && globalBlacklist.ok) {
        const inBlacklist = globalBlacklist.blacklistedPhones.has(normalizedPhone);
        jcSuppression = {
          dnc: inBlacklist ? 'BLOCKED' : 'CLEAR',
          optOut: inBlacklist ? 'BLOCKED' : 'CLEAR',
          contactDnd: 'UNKNOWN',
        };
      }

      let jcHistory = null;
      if (globalTexts && globalTexts.ok) {
        const candidateTexts = (globalTexts.allTexts || []).filter(t => {
          const contactNum = this.history.normalizePhone(t.contact_number || '');
          const justcallNum = this.history.normalizePhone(t.justcall_number || '');
          return contactNum === normalizedPhone || justcallNum === normalizedPhone;
        });
        const outbound = candidateTexts.filter(t => String(t.direction || '').toLowerCase() === 'outgoing');
        const inbound = candidateTexts.filter(t => String(t.direction || '').toLowerCase() === 'incoming');
        const senderTexts = outbound.filter(t => {
          const num = this.history.normalizePhone(t.justcall_number || '');
          return num.includes(SELECTED_SENDER_SUFFIX);
        });
        jcHistory = {
          outboundHistory: senderTexts.length > 0 ? 'PRIOR_SEND_FOUND' : outbound.length > 0 ? 'PRIOR_SEND_FOUND' : 'CLEAR_NO_PRIOR_SEND',
          pendingReply: inbound.length > 0 ? 'INBOUND_REPLY_REQUIRES_HUMAN' : 'CLEAR',
          deliveryState: senderTexts.length > 0 ? 'NOT_APPLICABLE' : 'NOT_APPLICABLE',
        };
      }

      const localLookup = {};
      for (const type of ['DNC', 'STOP', 'OPT_OUT', 'WRONG_NUMBER', 'PENDING_REPLY', 'ACTIVE_HUMAN_WORK', 'PRIOR_OUTREACH']) {
        localLookup[type] = this.localRegistry.lookup(phone, type).state;
      }

      const compliance = resolveCompliance(record, {
        justcallSuppression: jcSuppression,
        justcallHistory: jcHistory,
        localRegistry: localLookup,
        allRecords: production,
        now,
        policyVersion: POLICY_VERSION,
      });

      const rendered = this.template ? renderTemplate(this.template, {
        contactName: normalized.contactName,
        propertyAddress: normalized.propertyAddress,
        senderName: 'Montelli',
        day: timezone.currentWeekday || '[day]',
      }) : null;

      candidates.push({
        opportunityId: normalized.opportunityId,
        contactId: normalized.contactId,
        propertyAddress: normalized.propertyAddress,
        contactName: normalized.contactName,
        contactRole: roleEvidence.role,
        phone: phone ? `${phone.slice(0, 4)}***${phone.slice(-4)}` : null,
        timezone: timezone.timeZone,
        timezoneConfidence: timezone.confidence,
        renderedMessage: rendered,
        compliance,
        passed: compliance.passed,
        blockedReasons: Object.entries(compliance.guards)
          .filter(([, g]) => !PASSING_STATES.has(g.state))
          .map(([name, g]) => ({ guard: name, state: g.state, blockerCode: g.blockerCode })),
      });
    }

    const selected = candidates.filter(c => c.passed).slice(0, MAX_CANARY);
    const blocked = candidates.filter(c => !c.passed);

    const planId = `plan_${stableHash({ at: now.toISOString(), policyVersion: POLICY_VERSION, templateId: TEMPLATE_ID }).slice(0, 16)}`;
    const plan = {
      planId,
      planHash: stableHash({ planId, selected: selected.map(s => s.opportunityId), policyVersion: POLICY_VERSION, templateId: TEMPLATE_ID }),
      schema: 'canary-plan-v1',
      policyVersion: POLICY_VERSION,
      templateId: TEMPLATE_ID,
      templateVersion: stableHash(this.template?.body || ''),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      executable: false,
      productionEffects: { sends: 0, ghlWrites: 0, stageMovements: 0 },
      totalCandidates: candidates.length,
      selectedCount: selected.length,
      blockedCount: blocked.length,
      selected,
      blockerDistribution: buildBlockerDistribution(blocked),
      sourceSnapshot: {
        hydrationTimestamp: hydration.hydratedAt || now.toISOString(),
        pipelineId: this.pipelineId,
        locationId: this.locationId,
      },
    };

    return plan;
  }

  savePlan(plan) {
    fs.mkdirSync(PLAN_DIR, { recursive: true });
    const filePath = path.join(PLAN_DIR, `${plan.planId}.json`);
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(plan, null, 2) + '\n');
    fs.renameSync(tmp, filePath);
    return plan;
  }
}

function buildBlockerDistribution(blocked) {
  const dist = {};
  for (const candidate of blocked) {
    for (const reason of candidate.blockedReasons) {
      const key = reason.guard;
      dist[key] = (dist[key] || 0) + 1;
    }
  }
  return dist;
}

module.exports = { CanaryPlanBuilder, POLICY_VERSION, TEMPLATE_ID, MAX_CANARY };
