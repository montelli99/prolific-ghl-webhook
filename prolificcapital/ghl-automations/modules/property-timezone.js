'use strict';

const SINGLE_ZONE_STATES = Object.freeze({
  AL: 'America/Chicago', AR: 'America/Chicago', AZ: 'America/Phoenix', CO: 'America/Denver', CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', IA: 'America/Chicago', IL: 'America/Chicago', LA: 'America/Chicago', MA: 'America/New_York', MD: 'America/New_York', ME: 'America/New_York', MN: 'America/Chicago', MO: 'America/Chicago', MS: 'America/Chicago', MT: 'America/Denver', NC: 'America/New_York', ND: 'America/Chicago', NE: 'America/Chicago', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NV: 'America/Los_Angeles', NY: 'America/New_York', OH: 'America/New_York', OK: 'America/Chicago', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', TN: 'America/Chicago', UT: 'America/Denver', VA: 'America/New_York', VT: 'America/New_York', WA: 'America/Los_Angeles', WI: 'America/Chicago', WV: 'America/New_York', WY: 'America/Denver',
});

const ZIP_PREFIX_ZONES = Object.freeze({
  '75': 'America/Chicago', '76': 'America/Chicago', '77': 'America/Chicago', '78': 'America/Chicago', '79': 'America/Chicago',
  '80': 'America/Denver', '81': 'America/Denver', '82': 'America/Denver', '83': 'America/Boise', '84': 'America/Denver', '85': 'America/Phoenix', '86': 'America/Phoenix', '87': 'America/Denver', '88': 'America/Denver', '89': 'America/Los_Angeles',
  '90': 'America/Los_Angeles', '91': 'America/Los_Angeles', '92': 'America/Los_Angeles', '93': 'America/Los_Angeles', '94': 'America/Los_Angeles', '95': 'America/Los_Angeles', '96': 'America/Los_Angeles', '97': 'America/Los_Angeles', '98': 'America/Los_Angeles', '99': 'America/Anchorage',
  '32': 'America/New_York', '33': 'America/New_York', '34': 'America/New_York',
  '35': 'America/Chicago', '36': 'America/Chicago', '37': 'America/Chicago', '38': 'America/Chicago', '39': 'America/Chicago',
  '40': 'America/New_York', '41': 'America/New_York', '42': 'America/Chicago', '46': 'America/Indiana/Indianapolis', '47': 'America/Indiana/Indianapolis',
});

function parseStateZip(record = {}) {
  const raw = record.raw || {};
  const text = [record.propertyAddress, raw.address, raw.city, raw.state, raw.zip].filter(Boolean).join(' ');
  const state = String(raw.state || (text.match(/\b([A-Z]{2})\b\s*\d{5}(?:-\d{4})?\b/) || [])[1] || '').toUpperCase();
  const zip = String(raw.zip || (text.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || '');
  return { state, zip };
}

function localParts(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return { weekday: parts.find(part => part.type === 'weekday')?.value || '', localTime: `${parts.find(part => part.type === 'hour')?.value || '00'}:${parts.find(part => part.type === 'minute')?.value || '00'}` };
}

function derivePropertyTimezone(record = {}, options = {}) {
  const { state, zip } = parseStateZip(record);
  let timeZone = '';
  let confidence = 'UNKNOWN';
  let derivationSource = 'property address state/ZIP parse';
  if (zip && ZIP_PREFIX_ZONES[zip.slice(0, 2)]) { timeZone = ZIP_PREFIX_ZONES[zip.slice(0, 2)]; confidence = 'HIGH_CONFIDENCE_INFERRED'; derivationSource = 'ZIP prefix timezone dataset'; }
  else if (state && SINGLE_ZONE_STATES[state]) { timeZone = SINGLE_ZONE_STATES[state]; confidence = 'HIGH_CONFIDENCE_INFERRED'; derivationSource = 'single-zone US state timezone dataset'; }
  if (!timeZone) return { ok: false, reason: 'UNKNOWN_TIMEZONE_BLOCKS_CANARY', state: state || null, zip: zip || null, timeZone: null, confidence, derivationSource };
  try {
    const local = localParts(timeZone, options.now || new Date());
    return { ok: true, reason: 'PROPERTY_TIMEZONE_DERIVED', state: state || null, zip: zip || null, timeZone, confidence, derivationSource, dstAware: true, currentWeekday: local.weekday, currentLocalTime: local.localTime };
  } catch (error) {
    return { ok: false, reason: 'UNKNOWN_TIMEZONE_BLOCKS_CANARY', state: state || null, zip: zip || null, timeZone: null, confidence: 'UNKNOWN', derivationSource };
  }
}

module.exports = { SINGLE_ZONE_STATES, ZIP_PREFIX_ZONES, parseStateZip, derivePropertyTimezone };
