'use strict';

function buildRecommendedQuestions(qualificationState = {}, stageContext = {}) {
  const q = qualificationState.qualification || {};
  const questions = [];
  if (q.callback?.status === 'KNOWN' && q.callback.value) questions.push(`You asked for a callback ${q.callback.value} - does that still work for you?`);
  if (q.askingPrice?.status === 'NEEDS_CONFIRMATION') questions.push('Is that price target still accurate?');
  if (q.mortgageBalance?.status !== 'KNOWN') questions.push('Is there a mortgage or payoff we need to account for?');
  if (q.decisionMakers?.status !== 'KNOWN') questions.push('Is anyone else required to approve the sale?');
  if (q.occupancy?.status !== 'KNOWN') questions.push('Is the property vacant, owner occupied, or tenant occupied right now?');
  if (q.propertyCondition?.status !== 'KNOWN') questions.push('What are the biggest repairs or condition issues we should know about?');
  if (stageContext?.stageName === 'Awaiting Photos') questions.push('Were you able to gather the photos we discussed?');
  if (stageContext?.stageName === 'Sent Apt Times to Pitch') questions.push('What is the next step needed to keep the appointment or pitch moving?');
  return [...new Set(questions)].slice(0, 6);
}

module.exports = { buildRecommendedQuestions };
