'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CARD_SPEC_PATH = path.resolve(__dirname, '..', '..', 'docs', 'montelli-contact-card.json');
const VCF_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'montelli-scott-divinity-aligned.vcf');
const SELF_TEST_PREVIEW_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'contact-card-self-test-preview.json');
const SELF_TEST_APPROVAL_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'contact-card-self-test-approval.json');
const SELF_TEST_RESULT_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'contact-card-self-test-result.json');

const OWNER_TELEGRAM_ID = '718718959';
const OWNER_CONTROLLED_TEST_PHONE = '+15718140891';
const APPROVED_SENDER = '+15716012619';
const EXPECTED_CARD_HASH = '77bbcbdab80a604d3161d0a898fd92e1832d258c7c91a41349a86a5d18f60065';
const EXPECTED_SPEC_HASH = 'da4d29b570bab1e455527b2478c710a92110fe95c8c400ff49a1b8233093a247';
const PREVIEW_EXPIRY_MS = 5 * 60 * 1000;
const PUBLIC_MEDIA_BASE_URL = process.env.CONTACT_CARD_MEDIA_BASE_URL || 'https://raw.githubusercontent.com';
const PUBLIC_VCF_PATH = '/montelli99/prolific-ghl-webhook/master/public/assets/contact-cards/montelli-scott-divinity-aligned-v2.vcf';
const PUBLIC_MEDIA_URL = `${PUBLIC_MEDIA_BASE_URL}${PUBLIC_VCF_PATH}`;
const TEST_BODY = 'Montelli contact card — tap the attached file to add my contact.';

function loadCardSpec() {
  if (!fs.existsSync(CARD_SPEC_PATH)) return { error: 'CARD_SPEC_NOT_FOUND' };
  try {
    const spec = JSON.parse(fs.readFileSync(CARD_SPEC_PATH, 'utf8'));
    const specForHash = JSON.parse(JSON.stringify(spec));
    delete specForHash.cardHash;
    const computedSpecHash = crypto.createHash('sha256').update(JSON.stringify(specForHash, null, 2)).digest('hex');
    if (computedSpecHash !== EXPECTED_SPEC_HASH) {
      return { error: 'CARD_SPEC_HASH_MISMATCH', expected: EXPECTED_SPEC_HASH, actual: computedSpecHash };
    }
    if (spec.cardHash !== EXPECTED_CARD_HASH) {
      return { error: 'CARD_HASH_MISMATCH', expected: EXPECTED_CARD_HASH, actual: spec.cardHash };
    }
    return spec;
  } catch (e) {
    return { error: 'CARD_SPEC_PARSE_ERROR', message: e.message };
  }
}

function verifyVCF() {
  if (!fs.existsSync(VCF_PATH)) return { error: 'VCF_NOT_FOUND', path: VCF_PATH };
  try {
    const vcf = fs.readFileSync(VCF_PATH, 'utf8');
    const hash = crypto.createHash('sha256').update(vcf).digest('hex');
    if (hash !== EXPECTED_CARD_HASH) {
      return { error: 'VCF_HASH_MISMATCH', expected: EXPECTED_CARD_HASH, actual: hash };
    }
    if (vcf.includes('Prolific Capital') || vcf.includes('ProlificCapital')) {
      return { error: 'VCF_CONTAINS_STALE_COMPANY' };
    }
    if (vcf.includes('CEO') || vcf.includes('Co-Founder') || vcf.includes('Chief Investment')) {
      return { error: 'VCF_CONTAINS_STALE_TITLE' };
    }
    return { ok: true, hash, path: VCF_PATH };
  } catch (e) {
    return { error: 'VCF_READ_ERROR', message: e.message };
  }
}

function verifyCard() {
  const spec = loadCardSpec();
  if (spec.error) return spec;
  const vcf = verifyVCF();
  if (vcf.error) return vcf;
  if (!spec.readyForProduction) return { error: 'CARD_NOT_READY_FOR_PRODUCTION' };
  if (spec.missingRequiredFields && spec.missingRequiredFields.length > 0) {
    return { error: 'CARD_HAS_MISSING_REQUIRED_FIELDS', fields: spec.missingRequiredFields };
  }
  if (spec.blockedReason) return { error: 'CARD_BLOCKED', reason: spec.blockedReason };
  return {
    ok: true,
    status: 'CARD_READY_FOR_OWNER_SELF_TEST',
    cardId: spec.cardId,
    version: spec.version,
    cardHash: spec.cardHash,
    specHash: EXPECTED_SPEC_HASH,
    vcfPath: VCF_PATH,
    fields: {
      fullName: spec.fields.fullName?.value,
      title: spec.fields.title?.value,
      company: spec.fields.company?.value,
      primaryPhone: spec.fields.primaryPhone?.value,
      email: spec.fields.email?.value,
      website: spec.fields.website?.value,
    },
  };
}

function buildSelfTestPreview(ownerId) {
  if (String(ownerId) !== OWNER_TELEGRAM_ID) {
    return { error: 'NOT_OWNER', message: 'Only the owner can initiate a contact-card self-test.' };
  }

  const card = verifyCard();
  if (card.error) return card;

  const preview = {
    type: 'CONTACT_CARD_OWNER_SELF_TEST',
    previewId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PREVIEW_EXPIRY_MS).toISOString(),
    ownerId: OWNER_TELEGRAM_ID,
    recipient: {
      classification: 'OWNER_CONTROLLED_TEST_RECIPIENT',
      display: '(***) ***-0891',
      phone: OWNER_CONTROLLED_TEST_PHONE,
    },
    sender: {
      phone: APPROVED_SENDER,
      display: 'ending 2619',
    },
    card: {
      fullName: card.fields.fullName,
      title: card.fields.title,
      company: card.fields.company,
      phone: card.fields.primaryPhone,
      email: card.fields.email,
      website: card.fields.website,
      cardHash: card.cardHash,
    },
    asset: {
      filename: path.basename(VCF_PATH),
      vcfHash: card.cardHash,
      vcfHashShort: card.cardHash.slice(0, 16),
      publicMediaUrl: PUBLIC_MEDIA_URL,
    },
    method: 'JustCall MMS vCard attachment (POST /v2.1/texts/new with media_url)',
    smsBody: TEST_BODY,
    expectedEffects: {
      ownerTestMessages: 1,
      prospectMessages: 0,
      ghlWrites: 0,
      stageMovements: 0,
      finalState: 'PAUSED',
    },
    approvalPhrase: 'Send the corrected contact card test',
    state: 'PREVIEW_PENDING_APPROVAL',
  };

  fs.mkdirSync(path.dirname(SELF_TEST_PREVIEW_PATH), { recursive: true });
  fs.writeFileSync(SELF_TEST_PREVIEW_PATH, JSON.stringify(preview, null, 2) + '\n');

  return { ok: true, preview };
}

function loadSelfTestPreview() {
  if (!fs.existsSync(SELF_TEST_PREVIEW_PATH)) return null;
  try {
    const preview = JSON.parse(fs.readFileSync(SELF_TEST_PREVIEW_PATH, 'utf8'));
    if (new Date(preview.expiresAt) < new Date()) return { error: 'PREVIEW_EXPIRED' };
    return preview;
  } catch (e) {
    return null;
  }
}

function approveSelfTest(ownerId, message) {
  if (String(ownerId) !== OWNER_TELEGRAM_ID) {
    return { error: 'NOT_OWNER', message: 'Only the owner can approve a contact-card self-test.' };
  }

  const preview = loadSelfTestPreview();
  if (!preview) return { error: 'NO_PREVIEW', message: 'No active self-test preview. Say "Test my Montelli contact card to my phone." first.' };
  if (preview.error) return preview;

  const normalized = (message || '').toLowerCase().trim();
  const approved = (
    normalized.includes('send the corrected contact card test') ||
    normalized.includes('send the contact card test') ||
    normalized.includes('send it to my test phone') ||
    normalized.includes('approve the card self-test')
  );

  if (!approved) {
    return { error: 'AMBIGUOUS_APPROVAL', message: 'To approve, say "Send the contact card test."' };
  }

  const card = verifyCard();
  if (card.error) return card;

  if (card.cardHash !== preview.card.cardHash) {
    return { error: 'CARD_CHANGED_SINCE_PREVIEW', message: 'The contact card has changed since the preview was created. Please request a new preview.' };
  }

  if (preview.recipient.phone !== OWNER_CONTROLLED_TEST_PHONE) {
    return { error: 'RECIPIENT_CHANGED_SINCE_PREVIEW', message: 'The test recipient has changed since the preview was created. Please request a new preview.' };
  }

  if (preview.sender.phone !== APPROVED_SENDER) {
    return { error: 'SENDER_CHANGED_SINCE_PREVIEW', message: 'The sender has changed since the preview was created. Please request a new preview.' };
  }

  const approval = {
    type: 'CONTACT_CARD_SELF_TEST_APPROVAL',
    approvalId: crypto.randomUUID(),
    previewId: preview.previewId,
    approvedAt: new Date().toISOString(),
    ownerId: OWNER_TELEGRAM_ID,
    recipient: preview.recipient.phone,
    sender: preview.sender.phone,
    cardHash: card.cardHash,
    operation: 'SEND_EXACTLY_ONE_MMS',
    scope: 'OWNER_CONTROLLED_TEST_ONLY',
    noProspect: true,
    noGhlWrite: true,
    noStageMovement: true,
    returnToPaused: true,
  };

  fs.mkdirSync(path.dirname(SELF_TEST_APPROVAL_PATH), { recursive: true });
  fs.writeFileSync(SELF_TEST_APPROVAL_PATH, JSON.stringify(approval, null, 2) + '\n');

  return { ok: true, approval };
}

function loadSelfTestApproval() {
  if (!fs.existsSync(SELF_TEST_APPROVAL_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(SELF_TEST_APPROVAL_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function clearSelfTestState() {
  try { fs.unlinkSync(SELF_TEST_PREVIEW_PATH); } catch (_) {}
  try { fs.unlinkSync(SELF_TEST_APPROVAL_PATH); } catch (_) {}
}

function recordSelfTestResult(result) {
  fs.mkdirSync(path.dirname(SELF_TEST_RESULT_PATH), { recursive: true });
  fs.writeFileSync(SELF_TEST_RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
}

function formatPreviewText(preview) {
  const lines = ['*CONTACT CARD SELF-TEST*', ''];
  lines.push('*Recipient:*');
  lines.push(`Test phone ending 0891`);
  lines.push('');
  lines.push('*Sender:*');
  lines.push(`JustCall number ending 2619`);
  lines.push('');
  lines.push('*Card:*');
  lines.push(`${preview.card.fullName}`);
  lines.push(`${preview.card.title}`);
  lines.push(`${preview.card.company}`);
  lines.push(`${preview.card.phone}`);
  lines.push(`${preview.card.email}`);
  lines.push(`${preview.card.website}`);
  lines.push('');
  lines.push('*Delivery:*');
  lines.push('MMS with downloadable `.vcf` attachment');
  lines.push('');
  lines.push('*Attachment filename:*');
  lines.push(`${preview.asset.filename}`);
  lines.push('');
  lines.push('*Public media URL:*');
  lines.push(`${preview.asset.publicMediaUrl}`);
  lines.push('');
  lines.push(`VCF hash: \`${preview.asset.vcfHashShort}\``);
  lines.push('');
  lines.push('*SMS body:*');
  lines.push(`"${preview.smsBody}"`);
  lines.push('');
  lines.push('*Expected effects:*');
  lines.push('- 1 owner-controlled MMS after approval');
  lines.push('- 0 prospect messages');
  lines.push('- 0 GHL writes');
  lines.push('- 0 stage movements');
  lines.push('- return to PAUSED');
  lines.push('');
  lines.push('Nothing has been sent. Tell me "Send the corrected contact card test" to approve this exact self-test.');

  return lines.join('\n');
}

module.exports = {
  CARD_SPEC_PATH,
  VCF_PATH,
  SELF_TEST_PREVIEW_PATH,
  SELF_TEST_APPROVAL_PATH,
  SELF_TEST_RESULT_PATH,
  OWNER_TELEGRAM_ID,
  OWNER_CONTROLLED_TEST_PHONE,
  APPROVED_SENDER,
  EXPECTED_CARD_HASH,
  EXPECTED_SPEC_HASH,
  loadCardSpec,
  verifyVCF,
  verifyCard,
  buildSelfTestPreview,
  loadSelfTestPreview,
  approveSelfTest,
  loadSelfTestApproval,
  clearSelfTestState,
  recordSelfTestResult,
  formatPreviewText,
};
