'use strict';

const DELIVERY_STATES = Object.freeze({
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  DELIVERED: 'DELIVERED',
  UNDELIVERED: 'UNDELIVERED',
  FAILED_LANDLINE: 'FAILED_LANDLINE',
  FAILED_INVALID_NUMBER: 'FAILED_INVALID_NUMBER',
  FAILED_CARRIER: 'FAILED_CARRIER',
  UNCERTAIN_RESULT: 'UNCERTAIN_RESULT',
});

const TERMINAL_STATES = new Set([
  DELIVERY_STATES.DELIVERED,
  DELIVERY_STATES.FAILED_LANDLINE,
  DELIVERY_STATES.FAILED_INVALID_NUMBER,
]);

function resolveDeliveryState(providerResult) {
  const {
    providerId,
    deliveryStatus,
    carrierError,
    cost,
    accepted,
  } = providerResult;

  if (!providerId && !accepted) {
    return {
      state: DELIVERY_STATES.UNCERTAIN_RESULT,
      terminal: false,
      reason: 'NO_PROVIDER_RESPONSE',
      canRetry: false,
      waitingForReply: false,
      smsEligible: null,
    };
  }

  if (carrierError && /landline/i.test(carrierError)) {
    return {
      state: DELIVERY_STATES.FAILED_LANDLINE,
      terminal: true,
      reason: 'LANDLINE_CONFIRMED',
      canRetry: false,
      waitingForReply: false,
      smsEligible: false,
      carrierError,
    };
  }

  if (carrierError && /invalid.*number|not.*valid/i.test(carrierError)) {
    return {
      state: DELIVERY_STATES.FAILED_INVALID_NUMBER,
      terminal: true,
      reason: 'INVALID_NUMBER',
      canRetry: false,
      waitingForReply: false,
      smsEligible: false,
      carrierError,
    };
  }

  if (carrierError) {
    return {
      state: DELIVERY_STATES.FAILED_CARRIER,
      terminal: false,
      reason: 'CARRIER_ERROR',
      canRetry: false,
      waitingForReply: false,
      smsEligible: null,
      carrierError,
    };
  }

  if (deliveryStatus === 'delivered') {
    return {
      state: DELIVERY_STATES.DELIVERED,
      terminal: true,
      reason: 'PROVIDER_CONFIRMED_DELIVERY',
      canRetry: false,
      waitingForReply: true,
      smsEligible: true,
      providerId,
    };
  }

  if (deliveryStatus === 'undelivered') {
    return {
      state: DELIVERY_STATES.UNDELIVERED,
      terminal: false,
      reason: 'PROVIDER_REPORTED_UNDELIVERED',
      canRetry: false,
      waitingForReply: false,
      smsEligible: null,
      providerId,
      manualNumberValidationRequired: true,
    };
  }

  if (providerId && !deliveryStatus) {
    return {
      state: DELIVERY_STATES.PROVIDER_ACCEPTED,
      terminal: false,
      reason: 'PROVIDER_ACCEPTED_AWAITING_STATUS',
      canRetry: false,
      waitingForReply: false,
      smsEligible: null,
      providerId,
    };
  }

  return {
    state: DELIVERY_STATES.UNCERTAIN_RESULT,
    terminal: false,
    reason: 'UNKNOWN_PROVIDER_STATE',
    canRetry: false,
    waitingForReply: false,
    smsEligible: null,
  };
}

function countDelivered(results) {
  return results.filter(r => r.state === DELIVERY_STATES.DELIVERED).length;
}

function countProviderAccepted(results) {
  return results.filter(r => r.providerId).length;
}

module.exports = { DELIVERY_STATES, TERMINAL_STATES, resolveDeliveryState, countDelivered, countProviderAccepted };
