// transcriptor.js — handles GHL call recordings + JustCall real-time transcripts
// Extracts structured data from calls for automatic pipeline actions

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { KEY_CONTACTS, TEXT_SHORTCUTS, PIPELINE_STAGES } = require('./config');

const TRANSCRIPT_DIR = path.join(__dirname, 'data', 'transcripts');
if (!fs.existsSync(TRANSCRIPT_DIR)) fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });

// ── GHL Webhook: Call recording completed ──
// GHL sends: { type: "call", recording_url, contact_id, opportunity_id, duration, phone }
async function processGhlCall(callData) {
  const transcript = await transcribeRecording(callData.recordingUrl);
  const extracted = extractCallData(transcript);
  return {
    source: 'ghl',
    callSid: callData.callSid || `GHL_${Date.now()}`,
    transcript,
    extracted,
    contactId: callData.contactId,
    opportunityId: callData.opportunityId
  };
}

// ── JustCall Webhook: Real-time call transcript ──
// JustCall streams: { call_id, transcript: "full call text", phone, contact_name }
async function processJustCallTranscript(event) {
  // JustCall delivers full transcript at call end or live segments
  const transcript = event.transcript || event.text || '';
  const extracted = extractCallData(transcript);

  return {
    source: 'justcall',
    callSid: event.call_id || `JC_${Date.now()}`,
    transcript,
    extracted,
    phone: event.phone || event.client_number,
    contactName: event.contact_name || event.caller_name
  };
}

// ── Transcription via local Whisper ──
async function transcribeRecording(recordingUrl) {
  // For GHL recordings: download → whisper
  const outFile = path.join(TRANSCRIPT_DIR, `call_${Date.now()}.wav`);
  const outText = path.join(TRANSCRIPT_DIR, `call_${Date.now()}.txt`);

  try {
    // Download the recording
    const downloadCmd = `curl -s -L "${recordingUrl}" -o "${outFile}"`;
    await execCmd(downloadCmd);

    // Transcribe via local whisper
    const whisperCmd = `whisper "${outFile}" --model base --output_format txt --output_dir "${TRANSCRIPT_DIR}" --language en`;
    await execCmd(whisperCmd);

    if (fs.existsSync(outText)) {
      return fs.readFileSync(outText, 'utf8');
    }
    return '[Transcription failed]';
  } catch (err) {
    console.error('Transcription error:', err.message);
    return '[Transcription error: ' + err.message + ']';
  }
}

// ── Structured Data Extraction from Call Transcript ──
function extractCallData(transcript) {
  const t = transcript.toLowerCase();

  const extracted = {
    address: extractAddress(transcript),
    agentName: null,
    agentEmail: null,
    agentPhone: null,
    propertyType: 'unknown',
    occupied: null,
    rentAmount: null,
    roofAge: null,
    hvacAge: null,
    feedback: null,
    otherProperties: false,
    intent: 'unknown',
    nextAction: 'qualify',
    textShortcutsNeeded: []
  };

  // Property type detection
  if (t.includes('turnkey') || t.includes('move in ready') || t.includes('tenant in place'))
    extracted.propertyType = 'turnkey';
  else if (t.includes('renovation') || t.includes('rehab') || t.includes('fix') || t.includes('repair'))
    extracted.propertyType = 'reno';
  else if (t.includes('livable') || t.includes('decent') || t.includes('okay condition'))
    extracted.propertyType = 'livable';

  // Occupancy
  if (t.includes('vacant') || t.includes('empty') || t.includes('nobody living'))
    extracted.occupied = false;
  else if (t.includes('occupied') || t.includes('tenant') || t.includes('rented') || t.includes('living'))
    extracted.occupied = true;

  // Rent amount — find dollar amounts near "rent"
  const rentMatch = transcript.match(/\$?(\d{3,4})\s*(?:a\s*month|month|per month|in rent|rent|rents for)/i);
  if (rentMatch) extracted.rentAmount = parseInt(rentMatch[1]);

  // Roof/HVAC
  if (t.includes('roof')) {
    const roofMatch = transcript.match(/roof[^.]*?(\d+)\s*(?:year|yr|old|ago)/i);
    if (roofMatch) extracted.roofAge = `${roofMatch[1]} years`;
  }
  if (t.includes('hvac') || t.includes('heating') || t.includes('ac')) {
    const hvacMatch = transcript.match(/(?:hvac|heating|ac)[^.]*?(\d+)\s*(?:year|yr|old|ago)/i);
    if (hvacMatch) extracted.hvacAge = `${hvacMatch[1]} years`;
  }

  // Name extraction
  const nameMatch = transcript.match(/(?:hi|hello|hey)\s+(?:there\s+)?(\w+)/i);
  if (nameMatch && !['there', 'how', 'i\'m', 'this', 'happy', 'good', 'thanks'].includes(nameMatch[1].toLowerCase()))
    extracted.agentName = nameMatch[1];

  // Email extraction
  const emailMatch = transcript.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) extracted.agentEmail = emailMatch[1];

  // Other properties
  if (t.includes('other propert') || t.includes('another propert') || t.includes('portfolio') || t.includes('more than one'))
    extracted.otherProperties = true;

  // Feedback detection
  if (t.includes('feedback') || t.includes('other buyers') || t.includes('why hasn\'t it sold'))
    extracted.feedback = 'asked';

  // Intent detection
  if (t.includes('send') && (t.includes('offer') || t.includes('loi')))
    { extracted.intent = 'send_offer'; extracted.nextAction = 'loi_request'; }
  else if (t.includes('call you back') || t.includes('get back to you'))
    { extracted.intent = 'callback'; extracted.nextAction = 'follow_up'; }
  else if (t.includes('not interested') || t.includes('sold') || t.includes('no longer'))
    { extracted.intent = 'dead'; extracted.nextAction = 'mark_dead'; }
  else if (t.includes('send') && t.includes('offer'))
    { extracted.intent = 'send_offer'; extracted.nextAction = 'loi_request'; }

  // Text shortcuts needed
  extracted.textShortcutsNeeded.push('INT'); // always start with INT
  if (!t.includes('not interested'))
    extracted.textShortcutsNeeded.push('CCC');
  if (extracted.intent === 'send_offer')
    extracted.textShortcutsNeeded.push('GCJ');
  if (extracted.intent === 'dead')
    extracted.textShortcutsNeeded.push('SD');

  return extracted;
}

// ── Extract Address ──
function extractAddress(text) {
  // Common patterns: "123 Main St" or "property at 123 Main Street"
  const patterns = [
    /(\d+)\s+(\w+)\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|way|place|pl|boulevard|blvd|circle|cir|highway|hwy)/i,
    /property\s+(?:at|on|for)\s+(\d+[^.,!?]{10,40})/i,
    /(?:address|located)\s+(?:at|is)\s+(\d+[^.,!?]{10,40})/i
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].replace(/property\s+(?:at|on|for)\s+|(?:address|located)\s+(?:at|is)\s+/i, '').trim();
  }
  return null;
}

function execCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// ── LOI Email Draft Generator (post-transcript) ──
function draftLoiEmail(leadData, extracted) {
  const address = leadData.address || extracted.address || '[ADDRESS]';
  const rent = extracted.rentAmount || leadData.rentAmount || '[TBD]';
  const roof = extracted.roofAge || leadData.roofAge || '[TBD]';
  const hvac = extracted.hvacAge || leadData.hvacAge || '[TBD]';
  const occupancy = extracted.occupied === true ? 'Occupied (rented)' :
    extracted.occupied === false ? 'Vacant' : '[TBD]';
  const condition = leadData.propertyType || extracted.propertyType || '[TBD]';

  const subject = condition === 'reno' || condition === 'renovation'
    ? `Renovation - LOI Request ${address}`
    : `FB LOI Request ${address}`;

  const body = `Seth,

Property: ${address}
Purchase Price: $${typeof leadData.price === 'number' ? leadData.price.toLocaleString() : leadData.price || '[TBD]'}
Property Type: ${condition}
Occupancy: ${occupancy}
${rent !== '[TBD]' ? `Monthly Rent: $${typeof rent === 'number' ? rent.toLocaleString() : rent}` : ''}
Roof Age: ${roof}
HVAC: ${hvac}
${leadData.feedback ? `Buyer Feedback: ${leadData.feedback}` : ''}

${leadData.notes ? `Additional Notes: ${leadData.notes}` : ''}

Thanks,
Montelli`;

  return { subject, body, to: KEY_CONTACTS.seth.email };
}

module.exports = {
  processGhlCall, processJustCallTranscript,
  extractCallData, draftLoiEmail
};
