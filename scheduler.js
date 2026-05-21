// scheduler.js — cron jobs for follow-up alerts, daily briefs, stalled deals
const cron = require('node-cron');
const { getPipelineStatus, findLead } = require('./engine');
const { FOLLOWUP_TEMPLATES, PIPELINE_STAGES, CHECK_INTERVALS } = require('./config');

// This is called by index.js to register all schedules
function startScheduler(sendToTelegram, getUserId) {
  const userId = getUserId();

  // ── 48hr Follow-Up Check (every 30 min) ──
  cron.schedule(CHECK_INTERVALS.FOLLOWUP_48HR, () => {
    const status = getPipelineStatus(userId);
    status.followupsDue.forEach(lead => {
      const template = FOLLOWUP_TEMPLATES['48hr'](
        lead.agentName || 'there',
        lead.address,
        new Date(lead.offerSentAt).toLocaleDateString()
      );

      const msg = `⏰ **48hr Follow-Up Due**\n📋 ${lead.address}\n💬 ${lead.agentName || 'Unknown contact'} | 📞 ${lead.agentPhone || 'N/A'}\n\n📝 Script:\n${template}`;
      sendToTelegram(msg, 'pipeline');
    });
  });

  // ── Stalled Deal Detection (every 4 hours) ──
  cron.schedule(CHECK_INTERVALS.STALLED_DEALS, () => {
    const status = getPipelineStatus(userId);
    const now = Date.now();

    status.stalledDeals.forEach(lead => {
      const daysSinceAction = Math.round((now - new Date(lead.lastUpdated).getTime()) / (1000 * 60 * 60 * 24));

      const msg = `⚠️ **Stalled Deal — ${daysSinceAction} days**\n📋 ${lead.address}\n📍 Stage: ${PIPELINE_STAGES[lead.stage]?.label || lead.stage}\n\n⚡ Action: Follow up or mark dead. If they're not responding, send SD text and set DOM-181 tracker.`;
      sendToTelegram(msg, 'pipeline');
    });
  });

  // ── DOM Expiry Alert (daily 7am) ──
  cron.schedule(CHECK_INTERVALS.DAILY_BRIEF_MORNING, () => {
    const status = getPipelineStatus(userId);
    const leads = status.byStage.DEAD || [];

    leads.forEach(lead => {
      if (!lead.domDays) return;
      const now = new Date();
      const expiryDate = new Date(lead.declinedAt);
      expiryDate.setDate(expiryDate.getDate() + (lead.domDays - 181));
      const daysUntilExpiry = Math.round((expiryDate - now) / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry <= 7 && daysUntilExpiry >= -1) {
        const template = FOLLOWUP_TEMPLATES['dom_expiry'](lead.agentName || 'there', lead.address, lead.domDays);
        const msg = `🔔 **DOM Expiry Alert — ${daysUntilExpiry} days**\n📋 ${lead.address}\n📅 DOM: ${lead.domDays} | ${lead.declinedAt ? new Date(lead.declinedAt).toLocaleDateString() : 'unknown'}\n\n📝 Script:\n${template}`;
        sendToTelegram(msg, 'pipeline');
      }
    });
  });

  // ── Daily Brief — Morning (7am ET) ──
  cron.schedule(CHECK_INTERVALS.DAILY_BRIEF_MORNING, () => {
    const status = getPipelineStatus(userId);

    const stageCounts = Object.entries(status.byStage)
      .filter(([, leads]) => leads.length > 0 && !['CLOSED', 'ARCHIVED', 'DEAD'].includes(leads[0].stage))
      .map(([stage, leads]) => `${PIPELINE_STAGES[stage]?.emoji || '•'} ${PIPELINE_STAGES[stage]?.label || stage}: ${leads.length}`)
      .join('\n');

    const followupList = status.followupsDue.map(l =>
      `• ${l.address} — 48hr due ${l.followup48hrDue ? new Date(l.followup48hrDue).toLocaleString() : 'now'}`
    ).join('\n') || '• None';

    const stalledList = status.stalledDeals.map(l => {
      const days = Math.round((Date.now() - new Date(l.lastUpdated).getTime()) / (1000 * 60 * 60 * 24));
      return `• ${l.address} (${days}d stalled)`;
    }).join('\n') || '• None';

    const msg = `☀️ **Daily Brief — Morning**\n${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n\n**Pipeline Overview:**\n${stageCounts}\n\n**Follow-Ups Due Today:**\n${followupList}\n\n**Stalled (>3 days):**\n${stalledList}\n\n**Total Active:** ${status.activeCount}`;

    sendToTelegram(msg, 'pipeline');
  });

  // ── Daily Brief — Evening (7pm ET) ──
  cron.schedule(CHECK_INTERVALS.DAILY_BRIEF_EVENING, () => {
    const status = getPipelineStatus(userId);

    // What moved today
    const today = new Date().toISOString().split('T')[0];
    const allLeads = Object.values(status.byStage).flat();
    const movedToday = allLeads.filter(l =>
      l.history && l.history.some(h => h.at.startsWith(today))
    );

    const movedList = movedToday.map(l => {
      const latestMove = l.history.filter(h => h.at.startsWith(today)).pop();
      return `• ${l.address} → ${PIPELINE_STAGES[l.stage]?.emoji || ''} ${PIPELINE_STAGES[l.stage]?.label || l.stage}`;
    }).join('\n') || '• No movement today';

    const msg = `🌙 **Daily Brief — Evening**\n${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n\n**Moved Today:**\n${movedList}\n\n**Active Pipeline:** ${status.activeCount} leads\n${status.followupsDue.length} follow-ups due\n${status.stalledDeals.length} stalled\n\n📋 End of day: Send spreadsheet to Kayla + Jaxon.`;

    sendToTelegram(msg, 'pipeline');
  });

  console.log('Scheduler started — all cron jobs registered');
}

module.exports = { startScheduler };
