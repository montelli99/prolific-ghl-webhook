// cli.js — CLI for Atlas to manage the pipeline
// Usage: node cli.js <command> [options]
// Atlas calls this and formats output for Telegram

const { createLead, advanceStage, updateLead, findLead, getPipelineStatus } = require('./engine');
const { TEXT_SHORTCUTS, FOLLOWUP_TEMPLATES, CALL_SCRIPTS, PIPELINE_STAGES, KEY_CONTACTS } = require('./config');

const args = process.argv.slice(2);
const command = args[0];

function flag(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? (args[idx + 1] || true) : null;
}

function json(result) {
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const userId = flag('user') || 'montelli';

  switch (command) {

    // ── Lead Management ──
    case 'create-lead': {
      const lead = {
        address: flag('address'),
        price: flag('price') ? parseInt(flag('price')) : null,
        propertyType: flag('type') || null,
        agentName: flag('agent') || null,
        agentPhone: flag('phone') || null,
        agentEmail: flag('email') || null,
        contactType: flag('contact') || 'agent',
        population: flag('pop') ? parseInt(flag('pop')) : null,
        notes: flag('notes') || ''
      };

      if (!lead.address) {
        json({ error: '--address required' });
        return;
      }

      const result = createLead(userId, lead);
      json(result);
      break;
    }

    case 'qualify': {
      const address = flag('address');
      if (!address) { json({ error: '--address required' }); return; }

      const updates = {};
      ['roofAge','hvacAge','occupied','rentAmount','leaseType','utilitiesOn','feedback'].forEach(f => {
        if (flag(f) !== null) updates[f] = flag(f);
      });

      updateLead(userId, address, updates);
      const result = advanceStage(userId, address, 'QUALIFIED', 'Call completed, data collected');
      json(result);
      break;
    }

    case 'advance': {
      const address = flag('address');
      const stage = flag('stage');
      const note = flag('note') || '';

      if (!address || !stage) {
        json({ error: '--address and --stage required' });
        return;
      }

      const result = advanceStage(userId, address, stage, note);
      json(result);
      break;
    }

    case 'update': {
      const address = flag('address');
      if (!address) { json({ error: '--address required' }); return; }

      const updates = {};
      args.slice(2).forEach(a => {
        const m = a.match(/--(\w+)=(.+)/);
        if (m) { const v = m[2]; updates[m[1]] = isNaN(v) ? v : Number(v); }
      });

      const result = updateLead(userId, address, updates);
      json(result);
      break;
    }

    case 'dead': {
      const address = flag('address');
      const note = flag('note') || 'Declined';
      if (!address) { json({ error: '--address required' }); return; }
      const result = advanceStage(userId, address, 'DEAD', note);
      json(result);
      break;
    }

    // ── Pipeline Status ──
    case 'status': {
      const result = getPipelineStatus(userId);
      json({
        total: result.total,
        activeCount: result.activeCount,
        byStage: Object.fromEntries(
          Object.entries(result.byStage).filter(([,v]) => v.length > 0)
        ),
        followupsDue: result.followupsDue.map(l => ({
          address: l.address,
          stage: l.stage,
          agentName: l.agentName,
          followupDue: l.followup48hrDue,
          offerSentAt: l.offerSentAt
        })),
        stalledDeals: result.stalledDeals.map(l => ({
          address: l.address,
          stage: l.stage,
          daysStalled: Math.round((Date.now() - new Date(l.lastUpdated).getTime()) / (1000 * 60 * 60 * 24)),
          agentName: l.agentName
        }))
      });
      break;
    }

    case 'find': {
      const address = flag('address');
      if (!address) { json({ error: '--address required' }); return; }
      json({ lead: findLead(userId, address) });
      break;
    }

    // ── Call script — the full phone conversation script for a lead ──
    case 'call-script': {
      const address = flag('address');
      if (!address) { json({ error: '--address required' }); return; }
      const lead = findLead(userId, address);
      if (!lead) { json({ error: `Lead "${address}" not found` }); return; }
      const stage = lead.stage;
      const name = lead.agentName || 'there';
      const addr = lead.address;
      const day = require('./config')._day();

      // Pick the right call script based on contact type + property type
      const isRehab = lead.propertyType === 'reno';
      const isAgent = lead.contactType === 'agent';

      let scriptType, scriptText, scriptLabel;

      if (stage === 'NEW_LEAD') {
        if (isRehab) {
          scriptType = 'SELLER_REHAB'; scriptLabel = 'Rehab Seller Script';
          scriptText = CALL_SCRIPTS.SELLER_REHAB(addr, name, day);
        } else if (isAgent) {
          scriptType = 'AGENT_INITIAL'; scriptLabel = 'Agent Initial Script';
          scriptText = CALL_SCRIPTS.AGENT_INITIAL(addr, name, day);
        } else {
          scriptType = 'SELLER_INITIAL'; scriptLabel = 'Seller Initial Script';
          scriptText = CALL_SCRIPTS.SELLER_INITIAL(addr, name, day);
        }
      } else if (stage === 'OFFER_SENT') {
        scriptType = 'GAIN_FEEDBACK'; scriptLabel = 'Gain Feedback Script';
        scriptText = CALL_SCRIPTS.GAIN_FEEDBACK(addr, name, day);
      } else if (stage === 'NEGOTIATING') {
        scriptType = 'GAIN_FEEDBACK'; scriptLabel = 'Gain Feedback / Negotiating';
        scriptText = CALL_SCRIPTS.GAIN_FEEDBACK(addr, name, day);
      } else if (stage === 'UNDER_CONTRACT') {
        scriptType = 'UC_7DAY_CHECK'; scriptLabel = '7-Day UC Check';
        scriptText = CALL_SCRIPTS.UC_7DAY_CHECK(addr, name, day, lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString() : 'earlier this week');
      } else if (stage === 'DEAD') {
        scriptType = 'SELLER_DECLINED'; scriptLabel = 'Seller Declined';
        scriptText = CALL_SCRIPTS.SELLER_DECLINED(addr, name, day);
      } else {
        scriptType = null; scriptLabel = 'No call script for this stage';
        scriptText = `Stage: ${stage}. The text shortcut handles this stage — ask for "dial-script" instead.`;
      }

      json({ address: addr, stage, stageLabel: PIPELINE_STAGES[stage]?.label, contactType: lead.contactType, propertyType: lead.propertyType, scriptType, scriptLabel, script: scriptText });
      break;
    }

    // ── Script for a specific lead (stage-aware) ──
    case 'dial-script': {
      const address = flag('address');
      if (!address) { json({ error: '--address required' }); return; }
      const lead = findLead(userId, address);
      if (!lead) { json({ error: `Lead "${address}" not found` }); return; }
      const stage = lead.stage;
      const name = lead.agentName || 'there';
      const addr = lead.address;
      const scripts = [];
      if (stage === 'NEW_LEAD') {
        scripts.push({ type: 'INT', label: 'Send BEFORE calling', text: TEXT_SHORTCUTS.INT(addr, name), shortcut: 'INT' });
      }
      if (stage === 'QUALIFIED') {
        scripts.push({ type: 'CCC', label: 'Send AFTER call', text: TEXT_SHORTCUTS.CCC(addr, name), shortcut: 'CCC' });
      }
      if (stage === 'LOI_REQUESTED') {
        scripts.push({ type: 'GCJ', label: 'Send BEFORE LOI email', text: TEXT_SHORTCUTS.GCJ(addr, name), shortcut: 'GCJ' });
      }
      if (stage === 'OFFER_SENT') {
        scripts.push({ type: '48hr', label: 'Follow-up — 48hr window', text: FOLLOWUP_TEMPLATES['48hr'](name, addr, new Date().toLocaleDateString()), template: '48hr_followup' });
      }
      if (stage === 'NEGOTIATING') {
        scripts.push({ type: 'LOI', label: 'Gain feedback', text: TEXT_SHORTCUTS.LOI(addr), shortcut: 'LOI' });
        scripts.push({ type: 'SD', label: 'If declined', text: TEXT_SHORTCUTS.SD(), shortcut: 'SD' });
      }
      if (stage === 'UNDER_CONTRACT') {
        scripts.push({ type: 'UC_7DAY', label: '7-Day UC check-in', text: FOLLOWUP_TEMPLATES['7day_uc'](name, addr), template: '7day_uc' });
      }
      if (stage === 'DEAD') {
        scripts.push({ type: 'SD', label: 'Already dead', text: TEXT_SHORTCUTS.SD(), shortcut: 'SD' });
      }
      if (scripts.length === 0) {
        scripts.push({ type: null, label: 'No script needed', text: `Stage: ${stage}. Nothing to send at this stage.` });
      }
      json({ address: addr, stage: stage, stageLabel: PIPELINE_STAGES[stage]?.label, scripts: scripts });
      break;
    }

    // ── Templates ──
    case 'template': {
      const type = flag('type') || 'all';
      const address = flag('address') || '[ADDRESS]';
      const name = flag('agent') || '[NAME]';

      if (type === 'int') {
        json({ text: TEXT_SHORTCUTS.INT(address, name), shortcut: 'INT' });
      } else if (type === 'ccc') {
        json({ text: TEXT_SHORTCUTS.CCC(address, name), shortcut: 'CCC' });
      } else if (type === 'gcj') {
        json({ text: TEXT_SHORTCUTS.GCJ(address, name), shortcut: 'GCJ' });
      } else if (type === 'sd') {
        json({ text: TEXT_SHORTCUTS.SD(), shortcut: 'SD' });
      } else if (type === 'loi') {
        json({ text: TEXT_SHORTCUTS.LOI(address), shortcut: 'LOI' });
      } else if (type === '48hr') {
        json({ text: FOLLOWUP_TEMPLATES['48hr'](name, address, 'Tuesday'), template: '48hr' });
      } else if (type === 'voice') {
        json({ text: FOLLOWUP_TEMPLATES['voice_memo'](name, address), template: 'voice_memo' });
      } else {
        json({
          shortcuts: Object.fromEntries(
            Object.entries(TEXT_SHORTCUTS).map(([k, fn]) => [k, fn(address, name)])
          ),
          templates: Object.fromEntries(
            Object.entries(FOLLOWUP_TEMPLATES).map(([k, fn]) => [k, fn(name, address, 'Tuesday')])
          )
        });
      }
      break;
    }

    // ── LOI Draft ──
    case 'draft-loi': {
      const address = flag('address');
      if (!address) { json({ error: '--address required' }); return; }

      const lead = findLead(userId, address);
      if (!lead) { json({ error: `Lead "${address}" not found` }); return; }

      const { draftLoiEmail } = require('./transcriptor');
      json({ loi: draftLoiEmail(lead, {}) });
      break;
    }

    // ── Daily Brief ──
    case 'brief': {
      const result = getPipelineStatus(userId);
      const stageCounts = Object.entries(result.byStage)
        .filter(([, v]) => v.length > 0 && !['CLOSED', 'ARCHIVED', 'DEAD'].includes(v[0]?.stage))
        .map(([s, v]) => ({ stage: PIPELINE_STAGES[s]?.label || s, emoji: PIPELINE_STAGES[s]?.emoji || '', count: v.length }));

      json({
        date: new Date().toISOString(),
        activeLeads: result.activeCount,
        stageCounts,
        followupsDue: result.followupsDue.length,
        followups: result.followupsDue.map(l => ({ address: l.address, due: l.followup48hrDue })),
        stalledDeals: result.stalledDeals.length,
        stalled: result.stalledDeals.map(l => ({
          address: l.address,
          stage: PIPELINE_STAGES[l.stage]?.label,
          daysStalled: Math.round((Date.now() - new Date(l.lastUpdated).getTime()) / (1000 * 60 * 60 * 24))
        }))
      });
      break;
    }

    // ── Follow-up check (for cron) ──
    case 'followup-check': {
      const result = getPipelineStatus(userId);
      const alerts = [];

      // 48hr follow-ups
      result.followupsDue.forEach(l => {
        alerts.push({
          type: '48hr_followup',
          address: l.address,
          agentName: l.agentName,
          agentPhone: l.agentPhone,
          due: l.followup48hrDue,
          script: FOLLOWUP_TEMPLATES['48hr'](l.agentName || 'there', l.address, new Date(l.offerSentAt || Date.now()).toLocaleDateString())
        });
      });

      // Stalled deals
      result.stalledDeals.forEach(l => {
        const days = Math.round((Date.now() - new Date(l.lastUpdated).getTime()) / (1000 * 60 * 60 * 24));
        alerts.push({
          type: 'stalled',
          address: l.address,
          stage: PIPELINE_STAGES[l.stage]?.label,
          daysStalled: days
        });
      });

      json(alerts);
      break;
    }

    default:
      json({
        usage: {
          commands: [
            'create-lead --address "123 Main St" --price 250000 --type turnkey --agent "John" --phone 555-0001',
            'qualify --address "123 Main St" --roofAge "5 years" --occupied true --rentAmount 2000',
            'advance --address "123 Main St" --stage OFFER_SENT --note "GCJ sent"',
            'update --address "123 Main St" --price=245000 --agentPhone=555-0002',
            'dead --address "123 Main St" --note "Seller declined at $230K"',
            'status',
            'find --address "123 Main St"',
            'brief',
            'followup-check',
            'template --type int --address "123 Main St" --agent "John"',
            'template --type 48hr --address "123 Main St" --agent "John"',
            'draft-loi --address "123 Main St"'
          ]
        }
      });
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
