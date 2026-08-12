'use strict';

const crypto = require('crypto');
const { GhlAuthoritativeHydrator } = require('./ghl-authoritative-pipeline-hydrator');
const { normalizeOpportunity, classifyRole } = require('./telegram-outreach-dry-run');
const { derivePropertyTimezone } = require('./property-timezone');
const { resolveCompliance, PASSING_STATES } = require('./outreach-compliance-resolver');
const { JustCallSuppressionReadService } = require('./justcall-suppression-read-service');
const { JustCallTextHistoryReadService } = require('./justcall-text-history-read-service');
const { LocalSuppressionRegistry } = require('./local-suppression-registry');
const { getTemplate, renderTemplate } = require('./kayla-template-registry');
const { SELECTED_SENDER_SUFFIX } = require('./kayla-course-spec');
const { PlanStore } = require('./plan-store');
const { evaluateOpportunity } = require('./course-guided-action-engine');
const { renderGreeting } = require('./greeting-renderer');
const { classifyRecipient, RECIPIENT_TYPES } = require('./recipient-classifier');
const { resolveProfile } = require('./account-profile-resolver');

const POLICY_VERSION = 'OP-2026-08-02-v1';
const TEMPLATE_ID = 'OWNER_APPROVED_PIPELINE_INT';
const MAX_CANARY = 3;

const ABBREVIATED_WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const FULL_WEEKDAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

function validateTemplateQuality(rendered, recipientType) {
  if (!rendered) return { ok: false, reason: 'MISSING_RENDERED_MESSAGE' };
  const errors = [];
  if (/\{\{[^}]+\}\}/.test(rendered)) errors.push('UNRESOLVED_PLACEHOLDER');
  if (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(rendered) && !FULL_WEEKDAYS.has(rendered.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/)?.[0])) {
    const found = rendered.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)?.[0];
    if (found && ABBREVIATED_WEEKDAYS.has(found)) errors.push('ABBREVIATED_WEEKDAY_' + found);
  }
  if (/[!?.]{2,}/.test(rendered)) errors.push('DUPLICATED_PUNCTUATION');
  if (!/Montelli/.test(rendered)) errors.push('MISSING_SENDER_IDENTITY');
  if (rendered.length < 20) errors.push('MESSAGE_TOO_SHORT');

  if (recipientType) {
    const orgTypes = new Set([RECIPIENT_TYPES.TEAM, RECIPIENT_TYPES.BROKERAGE, RECIPIENT_TYPES.COMPANY, RECIPIENT_TYPES.LLC, RECIPIENT_TYPES.TRUST, RECIPIENT_TYPES.ESTATE, RECIPIENT_TYPES.GOVERNMENT]);
    if (orgTypes.has(recipientType)) {
      if (/^Happy \w+, \w/.test(rendered)) errors.push('RECIPIENT_TYPE_ORG_GREETED_AS_PERSON');
      if (/,\s+\w+\s+\w+!/.test(rendered)) errors.push('RECIPIENT_TYPE_FULL_NAME_GREETING_FOR_ORG');
    }
    if (recipientType === RECIPIENT_TYPES.UNKNOWN) {
      if (/^Happy \w+,/.test(rendered)) errors.push('RECIPIENT_TYPE_UNKNOWN_GREETED_WITH_NAME');
    }
  }

  return { ok: errors.length === 0, errors };
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

class CanaryPlanBuilder {
  constructor(config = {}) {
    const profile = config.profileId ? resolveProfile(config.profileId) : resolveProfile('ATLAS_OUTBOUND');
    this.profileId = profile.profileId;
    this.ghlToken = config.ghlToken || process.env[profile.credentialRef] || '';
    this.locationId = config.locationId || profile.locationId;
    this.pipelineId = config.pipelineId || profile.pipelineId;
    this.suppression = config.suppression || new JustCallSuppressionReadService();
    this.history = config.history || new JustCallTextHistoryReadService({ senderSuffix: SELECTED_SENDER_SUFFIX });
    this.localRegistry = config.localRegistry || new LocalSuppressionRegistry();
    this.planStore = config.planStore || new PlanStore();
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

    const excludeIds = new Set(options.excludeOpportunityIds || []);

    const candidates = [];
    for (const record of production) {
      const normalized = normalizeOpportunity(record);
      if (!normalized.phone || !normalized.contactName || !normalized.propertyAddress) continue;
      if (normalized.currentStageId !== '7067148a-2ee8-4e5b-93c8-31e0253fea68') continue;
      if (excludeIds.has(normalized.opportunityId)) continue;

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

      const contactForGreeting = {
        contactName: normalized.contactName,
        firstName: ((record.contact || {}).firstName || record.firstName || '').trim(),
        lastName: ((record.contact || {}).lastName || record.lastName || '').trim(),
        company: ((record.contact || {}).companyName || record.company || '').trim(),
      };
      const classification = classifyRecipient(contactForGreeting);
      const rendered = renderGreeting(contactForGreeting, {
        weekday: timezone.currentWeekday || 'Thursday',
        propertyAddress: normalized.propertyAddress,
        senderName: 'Montelli',
      });

      const operator = evaluateOpportunity({
        opportunityId: normalized.opportunityId,
        contactId: normalized.contactId,
        propertyAddress: normalized.propertyAddress,
        currentStage: normalized.currentStageName,
        currentStageId: normalized.currentStageId,
        contactPathStatus: normalized.phone && normalized.contactName ? 'ESTABLISHED' : 'MISSING',
        contactName: normalized.contactName,
        contactRole: roleEvidence.role,
        priorOutboundMessages: jcHistory?.outboundHistory === 'PRIOR_SEND_FOUND' ? 1 : 0,
        inboundReplies: jcHistory?.pendingReply === 'INBOUND_REPLY_REQUIRES_HUMAN' ? 1 : 0,
        deliveryState: jcHistory?.deliveryState || 'NOT_SENT',
        activeHumanWork: localLookup.ACTIVE_HUMAN_WORK === 'BLOCKED',
        complianceStatus: compliance.passed ? 'CLEAR' : 'BLOCKED',
        missingPropertyFacts: deriveMissingPropertyFacts(normalized.raw),
      }, { renderedInt: rendered, day: timezone.currentWeekday || '[day]' });

      candidates.push({
        opportunityId: normalized.opportunityId,
        contactId: normalized.contactId,
        propertyAddress: normalized.propertyAddress,
        contactName: normalized.contactName,
        contactRole: roleEvidence.role,
        phone: phone ? `${phone.slice(0, 4)}***${phone.slice(-4)}` : null,
        timezone: timezone.timeZone,
        timezoneConfidence: timezone.confidence,
        localWeekday: timezone.currentWeekday || null,
        localTime: timezone.currentLocalTime || null,
        renderedMessage: rendered,
        recipientType: classification.recipientType,
        recipientConfidence: classification.confidence,
        recipientEvidence: classification.evidence,
        compliance,
        operatorState: operator.state,
        operatorQueue: operator.queue,
        preparedAction: operator.preparedAction,
        passed: compliance.passed,
        blockedReasons: Object.entries(compliance.guards)
          .filter(([, g]) => !PASSING_STATES.has(g.state))
          .map(([name, g]) => ({ guard: name, state: g.state, blockerCode: g.blockerCode })),
      });
    }

    const eligible = candidates.filter(c => c.passed);
    const preferredIds = new Set(options.preferredOpportunityIds || []);
    const maxItems = options.maxItems || MAX_CANARY;
    const selected = rankCandidates(eligible, preferredIds).slice(0, maxItems);
    const blocked = candidates.filter(c => !c.passed);

    for (const item of selected) {
      const nonPassing = Object.entries(item.compliance.guards)
        .filter(([, g]) => !PASSING_STATES.has(g.state))
        .map(([name, g]) => ({ guard: name, state: g.state, blockerCode: g.blockerCode }));
      if (nonPassing.length > 0) {
        const err = new Error('PLAN_INVARIANT_VIOLATION');
        err.code = 'PLAN_INVARIANT_VIOLATION';
        err.details = {
          opportunityId: item.opportunityId,
          contactName: item.contactName,
          nonPassingGuards: nonPassing,
        };
        throw err;
      }

      const quality = validateTemplateQuality(item.renderedMessage, item.recipientType);
      if (!quality.ok) {
        const err = new Error('TEMPLATE_QUALITY_GATE_FAILED');
        err.code = 'TEMPLATE_QUALITY_GATE_FAILED';
        err.details = { opportunityId: item.opportunityId, contactName: item.contactName, errors: quality.errors };
        throw err;
      }
    }

    const planId = `plan_${stableHash({ at: now.toISOString(), policyVersion: POLICY_VERSION, templateId: TEMPLATE_ID }).slice(0, 16)}`;
    const plan = {
      planId,
      planHash: null,
      status: 'PREVIEW_PENDING_APPROVAL',
      schema: 'canary-plan-v2',
      policyVersion: POLICY_VERSION,
      templateId: TEMPLATE_ID,
      templateVersion: stableHash(this.template?.body || ''),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      executable: false,
      productionEffects: { sends: 0, ghlWrites: 0, stageMovements: 0 },
      canaryScope: {
        firstSupervisedCanary: true,
        allowedActionTypes: ['SEND_INT'],
        downstreamMode: 'COURSE_GUIDED_APPROVAL_GATED',
      },
      sender: `+*******${SELECTED_SENDER_SUFFIX}`,
      ownerId: options.ownerId || null,
      chatId: options.chatId || null,
      topicId: options.topicId || null,
      originatingMessageId: options.originatingMessageId || null,
      runbookId: options.runbookId || null,
      runbookHash: options.runbookHash || null,
      runtimeRevision: options.runtimeRevision || null,
      totalCandidates: candidates.length,
      selectedCount: selected.length,
      blockedCount: blocked.length,
      items: selected.map((s, i) => ({
        number: i + 1,
        opportunityId: s.opportunityId,
        contactId: s.contactId,
        propertyAddress: s.propertyAddress,
        contactName: s.contactName,
        contactRole: s.contactRole,
        phone: s.phone,
        timezone: s.timezone,
        timezoneConfidence: s.timezoneConfidence,
        renderedMessage: s.renderedMessage,
        approvedBodyHash: stableHash(s.renderedMessage),
        recipientType: s.recipientType,
        recipientConfidence: s.recipientConfidence,
        recipientEvidence: s.recipientEvidence,
        localWeekday: s.localWeekday,
        localTime: s.localTime,
        guardEvidence: Object.fromEntries(
          Object.entries(s.compliance.guards).map(([name, g]) => [name, { state: g.state, sources: g.sources.map(src => ({ source: src.source, state: src.state })) }])
        ),
        operatorState: s.operatorState,
        operatorQueue: s.operatorQueue,
        preparedAction: s.preparedAction,
      })),
      blockerDistribution: buildBlockerDistribution(blocked),
      sourceSnapshot: {
        hydrationTimestamp: hydration.summary?.timestamp || now.toISOString(),
        pipelineId: this.pipelineId,
        locationId: this.locationId,
        justcallBlacklistComplete: globalBlacklist?.ok || false,
        justcallHistoryComplete: globalTexts?.paginationCompleteness || 'UNKNOWN',
        justcallTotalCount: globalTexts?.totalCount || null,
        justcallFetchedCount: globalTexts?.fetchedCount || null,
      },
      warnings: [],
    };

    if (plan.expiresAt && new Date(plan.expiresAt) <= now) {
      plan.warnings.push('PLAN_EXPIRED_AT_CREATION');
    }

    plan.planHash = this.planStore.computePlanHash(plan);
    this.planStore.savePlan(plan);

    const readback = this.planStore.loadPlan(plan.planId);
    if (!readback || readback.planHash !== plan.planHash) {
      throw new Error('PLAN_READBACK_VERIFICATION_FAILED');
    }

    for (const item of readback.items) {
      const nonPassing = Object.entries(item.guardEvidence || {})
        .filter(([, g]) => !PASSING_STATES.has(g.state))
        .map(([name, g]) => ({ guard: name, state: g.state }));
      if (nonPassing.length > 0) {
        const err = new Error('PLAN_INVARIANT_VIOLATION_READBACK');
        err.code = 'PLAN_INVARIANT_VIOLATION_READBACK';
        err.details = { opportunityId: item.opportunityId, contactName: item.contactName, nonPassingGuards: nonPassing };
        throw err;
      }
    }

    return plan;
  }

  loadPlan(planId) {
    return this.planStore.loadPlan(planId);
  }

}

function deriveMissingPropertyFacts(raw = {}) {
  const opportunity = raw?.opportunity || raw || {};
  const facts = {
    askingPrice: opportunity.askingPrice || opportunity.price,
    occupancy: opportunity.occupancy,
    condition: opportunity.condition,
    rent: opportunity.rent || opportunity.monthlyRent,
    roof: opportunity.roof || opportunity.roofAge,
    hvac: opportunity.hvac || opportunity.hvacAge,
  };
  return Object.entries(facts).filter(([, value]) => value == null || value === '').map(([name]) => name);
}

function rankCandidates(candidates, preferredIds = new Set()) {
  return candidates
    .map((c, i) => ({ ...c, _sourceIndex: i }))
    .sort((a, b) => {
      const aPref = preferredIds.has(a.opportunityId) ? 0 : 1;
      const bPref = preferredIds.has(b.opportunityId) ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      if (a.contactRole !== b.contactRole) {
        const roleOrder = { agent: 1, broker: 2, owner: 3 };
        return (roleOrder[a.contactRole] || 99) - (roleOrder[b.contactRole] || 99);
      }
      return (a._sourceIndex || 0) - (b._sourceIndex || 0);
    })
    .map((c, i) => ({ ...c, _rank: i + 1 }));
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
