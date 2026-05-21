require('./scenarios');

// Build GHL-friendly reference grouped by stage
const STAGE_MAP = {
  'NEW_LEAD': { stage: 'NEW_LEAD', triggers: ['seller answered', 'call started', 'initial contact'], scripts: ['INT'] },
  'QUALIFIED': { stage: 'QUALIFIED', triggers: ['call completed', 'agent info gathered', 'roof/HVAC noted'], scripts: ['CCC'] },
  'LOI_REQUESTED': { stage: 'LOI_REQUESTED', triggers: ['offer drafted', 'ready to send', 'LOI submitted'], scripts: ['GCJ', 'LOI'] },
  'OFFER_SENT': { stage: 'OFFER_SENT', triggers: ['awaiting response', '48hr follow-up due', 'no confirmation'], scripts: ['LOI', '48hr'] },
  'NEGOTIATING': { stage: 'NEGOTIATING', triggers: ['counter offered', 'seller reviewing', 'feedback received'], scripts: ['LOI', '48hr', 'SD'] },
  'UNDER_CONTRACT': { stage: 'UNDER_CONTRACT', triggers: ['UC confirmed', 'inspection done', 'appraisal complete'], scripts: ['UC_CHECK', 'CLOSING'] },
  'PENDING': { stage: 'PENDING', triggers: ['property went pending', 'listing off market'], scripts: ['PEND'] },
  'CLOSED': { stage: 'CLOSED', triggers: ['deal closed', 'funds wired'], scripts: ['CLOSING', 'FUTURE'] },
};

const SCRIPTS_BY_STAGE = {
  'NEW_LEAD': [
    { id: 'INT', name: 'Intro — send before every call', text: require('./config').TEXT_SHORTCUTS.INT('[agent name]', '[address]') }
  ],
  'QUALIFIED': [
    { id: 'CCC', name: 'Contact Card — send after every call', text: require('./config').TEXT_SHORTCUTS.CCC('[agent name]', '[address]') }
  ],
  'LOI_REQUESTED': [
    { id: 'GCJ', name: 'Group Chat w/ Jaxon', text: require('./config').TEXT_SHORTCUTS.GCJ('[agent name]', '[address]') },
    { id: 'LOI', name: 'LOI Follow-up', text: require('./config').TEXT_SHORTCUTS.LOI('[address]') }
  ],
  'OFFER_SENT': [
    { id: '48hr', name: '48hr Follow-up', text: require('./config').FOLLOWUP_TEMPLATES['48hr']('[agent name]', '[address]', 'Wednesday') },
    { id: 'LOI', name: 'LOI Follow-up', text: require('./config').TEXT_SHORTCUTS.LOI('[address]') }
  ],
  'NEGOTIATING': [
    { id: 'SD', name: 'Seller Declined', text: require('./config').TEXT_SHORTCUTS.SD() },
    { id: 'LOI', name: 'LOI Follow-up', text: require('./config').TEXT_SHORTCUTS.LOI('[address]') }
  ],
  'UNDER_CONTRACT': [
    { id: 'UC_7DAY', name: '7-Day UC Check-in', text: require('./config').FOLLOWUP_TEMPLATES['7day_uc']('[agent name]', '[address]') },
    { id: 'CLOSING', name: 'Closing Congrats', text: 'Congratulations — glad it all aligned well. It was great connecting with you and if you aren\'t opposed I\'d love to explore opportunities with you in the future. Do you have any other properties you\'re looking to offload?' }
  ],
  'PENDING': [
    { id: 'PEND', name: 'Pending — Stay in Pocket', text: require('./config').TEXT_SHORTCUTS.PEND('[address]') }
  ],
  'CLOSED': [
    { id: 'CLOSING', name: 'Closing — Plant Future Seed', text: 'Congratulations on the smooth closing! It was great working with you. Do you have any other properties you\'re looking to offload? Our model works best with owned-outright or short-sale situations.' },
    { id: 'FUTURE', name: 'Future Deals', text: 'Always looking for off-market deals. If you hear of anything that fits — SFH or small multi-family, Red States, $150K-$550K, 3+ bed, 10K+ pop — send them my way.' }
  ]
};

function buildGHLReference() {
  console.log('=== GHL PIPELINE SCRIPTS REFERENCE ===\n');
  Object.entries(SCRIPTS_BY_STAGE).forEach(([stage, scripts]) => {
    console.log(`## ${stage}`);
    scripts.forEach(s => {
      console.log(`\n[${s.id}] ${s.name}`);
      console.log(`"${s.text}"`);
    });
    console.log('\n---\n');
  });
}

buildGHLReference();