// engine.js — core pipeline logic
// Handles lead creation, stage transitions, action generation

const { PIPELINE_STAGES, STAGE_CHECKLISTS, TEXT_SHORTCUTS } = require('./config');
const { loadLeads, saveLeads, logEvent } = require('./users');

function findLead(userId, address) {
  const leads = loadLeads(userId);
  return leads.find(l =>
    l.address.toLowerCase().trim() === address.toLowerCase().trim()
  );
}

function createLead(userId, leadData) {
  const leads = loadLeads(userId);
  const now = new Date().toISOString();

  const lead = {
    id: `LEAD_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    address: leadData.address,
    stage: 'NEW_LEAD',
    stageEnteredAt: now,
    history: [{ stage: 'NEW_LEAD', at: now, note: 'Lead created' }],

    // Property info
    price: leadData.price || null,
    propertyType: leadData.propertyType || null,    // turnkey, reno, livable
    population: leadData.population || null,
    condition: leadData.condition || null,

    // Contact info
    agentName: leadData.agentName || null,
    agentPhone: leadData.agentPhone || null,
    agentEmail: leadData.agentEmail || null,
    contactType: leadData.contactType || 'agent',   // agent, seller, fb

    // Qualification data
    roofAge: leadData.roofAge || null,
    hvacAge: leadData.hvacAge || null,
    occupied: leadData.occupied || null,
    rentAmount: leadData.rentAmount || null,
    leaseType: leadData.leaseType || null,
    utilitiesOn: leadData.utilitiesOn || null,
    feedback: leadData.feedback || null,

    // Underwriting
    rentalComps: leadData.rentalComps || null,
    onePercentRule: leadData.onePercentRule || null,
    cashOfferMath: leadData.cashOfferMath || null,
    loiRequestedAt: null,
    loiApprovedAt: null,

    // Offer tracking
    offerSentAt: null,
    offerAmount: leadData.offerAmount || null,
    followup48hrDue: null,
    declinedAt: null,
    domDays: leadData.domDays || null,
    domExpiryAlert: null,

    // Text shortcuts sent
    intSent: false,
    cccSent: false,
    gcjSent: false,
    sdSent: false,

    // Closing
    underContractAt: null,
    inspectionDate: null,
    closedAt: null,
    assignmentFee: null,

    // Meta
    notes: leadData.notes || '',
    source: leadData.source || 'manual',  // manual, ghl_webhook, justcall
    lastUpdated: now
  };

  leads.push(lead);
  saveLeads(userId, leads);
  logEvent(userId, { type: 'lead_created', leadId: lead.id, address: lead.address });

  return { lead, action: generateAction(lead, 'created') };
}

function advanceStage(userId, address, newStage, note = '') {
  const leads = loadLeads(userId);
  const lead = leads.find(l => l.address.toLowerCase().trim() === address.toLowerCase().trim());

  if (!lead) return { error: `Lead "${address}" not found` };
  if (!PIPELINE_STAGES[newStage]) return { error: `Unknown stage: ${newStage}` };

  const oldStage = lead.stage;
  if (oldStage === newStage) return { lead, action: { type: 'no_change', message: `${lead.address} already at ${PIPELINE_STAGES[newStage].label}` } };

  const now = new Date().toISOString();
  lead.stage = newStage;
  lead.stageEnteredAt = now;
  lead.lastUpdated = now;

  lead.history.push({
    stage: newStage,
    at: now,
    from: oldStage,
    note: note || `Advanced from ${oldStage} to ${newStage}`
  });

  // Stage-specific side effects
  if (newStage === 'LOI_REQUESTED') lead.loiRequestedAt = now;
  if (newStage === 'OFFER_SENT') {
    lead.offerSentAt = now;
    lead.followup48hrDue = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  }
  if (newStage === 'UNDER_CONTRACT') lead.underContractAt = now;
  if (newStage === 'CLOSED') lead.closedAt = now;
  if (newStage === 'DEAD') lead.declinedAt = now;

  saveLeads(userId, leads);
  logEvent(userId, { type: 'stage_change', leadId: lead.id, address, from: oldStage, to: newStage, note });

  return { lead, action: generateAction(lead, 'stage_change', oldStage, newStage) };
}

function updateLead(userId, address, updates) {
  const leads = loadLeads(userId);
  const lead = leads.find(l => l.address.toLowerCase().trim() === address.toLowerCase().trim());
  if (!lead) return { error: `Lead "${address}" not found` };

  Object.assign(lead, updates, { lastUpdated: new Date().toISOString() });
  saveLeads(userId, leads);
  logEvent(userId, { type: 'lead_updated', leadId: lead.id, address, updates: Object.keys(updates) });

  return { lead };
}

function generateAction(lead, event, oldStage, newStage) {
  const s = PIPELINE_STAGES;

  if (event === 'created') {
    return {
      type: 'qualify_lead',
      priority: 'high',
      message: `**🆕 New Lead: ${lead.address}**\nPrice: $${lead.price?.toLocaleString() || 'N/A'} | Type: ${lead.propertyType || 'unknown'}\n\n📋 Next: Send INT text → call → qualify → enter GHL\n⚠️ Population check first (>10K or discard)`,
      topic: 'pipeline',
      steps: ['Send INT text', 'Call (max 2x)', `Check population: ${lead.population || 'unchecked'}`, 'Enter GHL as Opportunity']
    };
  }

  if (event === 'stage_change') {
    const stage = s[newStage];
    const checklist = STAGE_CHECKLISTS[newStage] || [];

    const actions = {
      QUALIFIED: {
        type: 'qualified_to_loi',
        priority: 'high',
        message: `**✅ ${lead.address} — Qualified**\n\n📋 Next: Send LOI request to Seth\n✉️ claytoninvestmentsolutions@gmail.com\nSubject: "FB LOI Request ${lead.address}"\n\nInclude: price, rental income, roof/HVAC, occupancy`,
        topic: 'deal_room',
        steps: ['Draft LOI email to Seth', 'Include all property details', 'Update GHL to LOI Requested']
      },
      LOI_REQUESTED: {
        type: 'loi_pending',
        priority: 'medium',
        message: `**📤 LOI Requested: ${lead.address}**\n\nWaiting on Seth's approval. Check back in 24-48 hours.`,
        topic: 'pipeline',
        steps: ['Wait for Seth response', 'Check email for approved LOI']
      },
      LOI_APPROVED: {
        type: 'offer_ready',
        priority: 'high',
        message: `**👍 LOI Approved: ${lead.address}**\n\n📋 Send GCJ text → create group chat with Jaxon\n📱 TEXT: "${TEXT_SHORTCUTS.GCJ(lead.address, lead.agentName || 'there')}"\n\nMove to "Active Negotiation" in GHL.`,
        topic: 'pipeline',
        steps: ['Send GCJ text', 'Create group chat w/ Jaxon + client', 'Move to Offer Sent in GHL', 'Set 48hr follow-up']
      },
      OFFER_SENT: {
        type: 'offer_sent',
        priority: 'high',
        message: `**📨 Offer Sent: ${lead.address}**\n\n⏰ 48-hour follow-up due: ${new Date(Date.now() + 48 * 60 * 60 * 1000).toLocaleString()}\n📋 GHL status: "Active Negotiation"\n\nAt ${lead.followup48hrDue ? new Date(lead.followup48hrDue).toLocaleString() : '48hr from now'}, call and use the realign script.`,
        topic: 'pipeline',
        steps: ['Wait 48 hours', 'Follow-up call: "finding some time to realign"', 'Collect feedback', 'Relay questions to Jaxon']
      },
      NEGOTIATING: {
        type: 'negotiating',
        priority: 'medium',
        message: `**🔄 Negotiating: ${lead.address}**\n\nAwaiting feedback. Questions relayed to Jaxon.\nIf declined: send SD text, note DOM, set DOM-181 calendar reminder.`,
        topic: 'pipeline',
        steps: ['Track feedback', 'Relay to Jaxon as needed', 'If declined: SD text + DOM-181']
      },
      UNDER_CONTRACT: {
        type: 'under_contract',
        priority: 'low',
        message: `**📝 Under Contract: ${lead.address}**\n\nKayla's TC handles from here: agreements, inspections, appraisals, JV\n\nYour job: 7-day check-in. Ask "any other properties?"\n\nCheck GHL in 7 days — confirm earnest money wired, inspections completed.`,
        topic: 'deal_room',
        steps: ['7-day UC follow-up', 'Confirm earnest money', 'Confirm inspections', 'Ask about other properties']
      },
      CLOSED: {
        type: 'closed',
        priority: 'low',
        message: `**🏁 CLOSED: ${lead.address}**\n\nFee: $${lead.assignmentFee?.toLocaleString() || 'TBD'}\n\n🎯 Ask: "Any other properties to offload?" (double/triple dip)\n📦 Archive in GHL. Document lessons learned.`,
        topic: 'deal_room',
        steps: ['Archive in GHL', 'Ask about other properties', 'Document lessons']
      },
      DEAD: {
        type: 'dead',
        priority: 'low',
        message: `**⚰️ Dead: ${lead.address}**\n\nDeclined. DOM: ${lead.domDays || 'unknown'} days.\n📅 Set calendar: DOM - 181 = circle back when listing approaches expiration.\n📱 Send SD text shortcut.`,
        topic: 'pipeline',
        steps: ['Send SD text', 'Note DOM', 'Set DOM-181 calendar reminder', 'Archive after expiration']
      }
    };

    return actions[newStage] || { type: 'stage_change', priority: 'medium', message: `${s[newStage].emoji} ${lead.address} → ${s[newStage].label}`, topic: 'pipeline', steps: checklist };
  }

  return { type: 'unknown', priority: 'low', message: 'Action unclear', topic: 'pipeline', steps: [] };
}

function getPipelineStatus(userId) {
  const leads = loadLeads(userId);
  const byStage = {};
  Object.keys(PIPELINE_STAGES).forEach(k => { byStage[k] = []; });

  leads.forEach(l => {
    if (byStage[l.stage]) byStage[l.stage].push(l);
    else byStage[l.stage] = [l];
  });

  const now = Date.now();
  const followups44to52hr = leads.filter(l => {
    if (!l.followup48hrDue) return false;
    const due = new Date(l.followup48hrDue).getTime();
    return due >= now - 4 * 60 * 60 * 1000 && due <= now + 4 * 60 * 60 * 1000;
  });

  const stalled = leads.filter(l => {
    if (['CLOSED', 'ARCHIVED', 'DEAD'].includes(l.stage)) return false;
    const last = new Date(l.lastUpdated).getTime();
    return now - last > 72 * 60 * 60 * 1000; // >3 days
  });

  return {
    total: leads.length,
    byStage,
    activeCount: leads.filter(l => !['CLOSED', 'ARCHIVED', 'DEAD'].includes(l.stage)).length,
    followupsDue: followups44to52hr,
    stalledDeals: stalled
  };
}

module.exports = { createLead, advanceStage, updateLead, findLead, getPipelineStatus };
