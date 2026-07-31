'use strict';

const { JustCallIntegration } = require('./justcall-integration');
const { SELECTED_SENDER_SUFFIX } = require('./kayla-course-spec');

const REQUIRED_MASK = '+1 (571) ***-2619';

function maskSender(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ***-${digits.slice(-4)}`;
}

function senderMatches(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1571') && digits.endsWith(SELECTED_SENDER_SUFFIX);
}

async function verifyAtlasSender(options = {}) {
  const env = options.env || process.env;
  const configured = options.fromNumber || env.JUSTCALL_FROM_NUMBER || '';
  const base = {
    ok: false,
    requiredSender: REQUIRED_MASK,
    configuredSender: maskSender(configured),
    providerNumberId: null,
    activeStatus: null,
    smsCapability: null,
    complianceStatus: null,
    businessRegistrationStatus: null,
    sendEligibility: null,
    inboundEventAvailability: null,
    messageStatusReadback: null,
    providerDndOptOutSupport: null,
    stopHandling: null,
    authStatus: 'NOT_CHECKED',
    secretsExposed: false,
  };
  if (!senderMatches(configured)) return { ...base, reason: 'SENDER_LOCK_MISMATCH' };
  const client = options.client || new JustCallIntegration({ apiKey: env.JUSTCALL_API_KEY, apiSecret: env.JUSTCALL_API_SECRET, fromNumber: configured });
  if (!client.isConfigured()) return { ...base, authStatus: 'MISSING_CREDENTIALS', reason: 'PROVIDER_CREDENTIALS_MISSING' };
  try {
    const users = await client.listUsers({ per_page: 1 });
    const verifier = options.numberVerifier || (async () => null);
    const number = await verifier(configured, client);
    return {
      ...base,
      ok: Boolean(number && senderMatches(number.phone || number.number || configured) && number.smsCapability !== false && /verified|approved|active/i.test(`${number.complianceStatus || ''} ${number.businessRegistrationStatus || ''} ${number.activeStatus || ''}`)),
      authStatus: users ? 'AUTH_READY' : 'AUTH_UNKNOWN',
      providerNumberId: number?.providerNumberId || number?.id || null,
      activeStatus: number?.activeStatus || number?.status || 'UNKNOWN_FROM_PROVIDER',
      smsCapability: number?.smsCapability ?? null,
      complianceStatus: number?.complianceStatus || null,
      businessRegistrationStatus: number?.businessRegistrationStatus || null,
      sendEligibility: number?.sendEligibility || null,
      inboundEventAvailability: number?.inboundEventAvailability || null,
      messageStatusReadback: number?.messageStatusReadback || null,
      providerDndOptOutSupport: number?.providerDndOptOutSupport || null,
      stopHandling: number?.stopHandling || null,
      reason: number ? 'SENDER_VERIFIED_OR_PROVIDER_METADATA_RETURNED' : 'SENDER_METADATA_VERIFIER_NOT_CONFIGURED',
    };
  } catch (error) {
    return { ...base, authStatus: 'AUTH_FAILED', reason: 'PROVIDER_VERIFICATION_FAILED' };
  }
}

module.exports = { REQUIRED_MASK, maskSender, senderMatches, verifyAtlasSender };
