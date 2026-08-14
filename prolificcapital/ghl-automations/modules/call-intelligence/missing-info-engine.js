'use strict';

function statusOf(field) {
  return field?.status || 'UNKNOWN';
}

function computeMissing(qualificationState = {}) {
  const q = qualificationState.qualification || {};
  const missingCritical = [];
  const missingBeforeOffer = [];
  const missingImportant = [];
  const niceToHave = [];
  const needsConfirmation = [];
  const conflicts = [];

  const critical = ['motivation', 'timeline', 'askingPrice', 'occupancy', 'propertyCondition', 'decisionMakers'];
  for (const field of critical) if (statusOf(q[field]) === 'UNKNOWN') missingCritical.push(field);
  const beforeOffer = ['mortgageBalance', 'marketStatus', 'callback'];
  for (const field of beforeOffer) if (statusOf(q[field]) === 'UNKNOWN') missingBeforeOffer.push(field);
  const important = ['propertyType', 'bedrooms', 'bathrooms', 'squareFootage', 'yearBuilt', 'minimumPrice', 'creativeFinanceInterest'];
  for (const field of important) if (statusOf(q[field]) === 'UNKNOWN') missingImportant.push(field);
  const nice = ['roofCondition', 'hvacCondition', 'plumbing', 'electrical'];
  for (const field of nice) if (statusOf(q[field]) === 'UNKNOWN') niceToHave.push(field);

  for (const [field, value] of Object.entries(q)) {
    if (!value) continue;
    if (value.status === 'NEEDS_CONFIRMATION') needsConfirmation.push(field);
    if (value.status === 'CONFLICTING') {
      needsConfirmation.push(field);
      conflicts.push(field);
    }
  }

  return { missingCritical, missingBeforeOffer, missingImportant, niceToHave, needsConfirmation, conflicts };
}

module.exports = { computeMissing };
