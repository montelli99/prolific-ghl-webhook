'use strict';

const assert = require('assert');
const { classifyRecipient, RECIPIENT_TYPES } = require('../modules/recipient-classifier');
const { renderGreeting } = require('../modules/greeting-renderer');

function validateTemplateQuality(rendered, recipientType) {
  if (!rendered) return { ok: false, reason: 'MISSING_RENDERED_MESSAGE' };
  const errors = [];
  if (/\{\{[^}]+\}\}/.test(rendered)) errors.push('UNRESOLVED_PLACEHOLDER');
  const ABBREVIATED_WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  const FULL_WEEKDAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  if (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(rendered) && !FULL_WEEKDAYS.has(rendered.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/)?.[0])) {
    const found = rendered.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)?.[0];
    if (found && ABBREVIATED_WEEKDAYS.has(found)) errors.push('ABBREVIATED_WEEKDAY_' + found);
  }
  if (/[!?.]{2,}/.test(rendered)) errors.push('DUPLICATED_PUNCTUATION');
  if (!/Montelli/.test(rendered)) errors.push('MISSING_SENDER_IDENTITY');
  if (rendered.length < 20) errors.push('MESSAGE_TOO_SHORT');

  if (recipientType) {
    const orgTypes = new Set([RECIPIENT_TYPES.TEAM, RECIPIENT_TYPES.BROKERAGE, RECIPIENT_TYPES.COMPANY, RECIPIENT_TYPES.LLC, RECIPIENT_TYPES.TRUST, RECIPIENT_TYPES.ESTATE, RECIPIENT_TYPES.GOVERNMENT]);
    if (orgTypes.has(recipientType)) {
      if (/^Happy \w+, \w/.test(rendered)) errors.push('RECIPIENT_TYPE_ORG_GREETED_AS_PERSON');
      if (/,\s+\w+\s+\w+!/.test(rendered)) errors.push('RECIPIENT_TYPE_FULL_NAME_GREETING_FOR_ORG');
    }
    if (recipientType === RECIPIENT_TYPES.UNKNOWN) {
      if (/^Happy \w+,/.test(rendered)) errors.push('RECIPIENT_TYPE_UNKNOWN_GREETED_WITH_NAME');
    }
  }

  return { ok: errors.length === 0, errors };
}

// ============================================================
// CLASSIFICATION TESTS
// ============================================================

// Test 1: Verified person classified PERSON
{
  const result = classifyRecipient({
    contactName: 'Tamara Harper',
    firstName: 'Tamara',
    lastName: 'Harper',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.PERSON, 'Test 1: Tamara Harper should be PERSON');
  assert.strictEqual(result.confidence, 'HIGH');
  console.log('PASS 1: Verified person classified PERSON');
}

// Test 2: Team string classified TEAM
{
  const result = classifyRecipient({
    contactName: 'Just Say Home KC Team',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.TEAM, 'Test 2: Just Say Home KC Team should be TEAM');
  assert.strictEqual(result.confidence, 'HIGH');
  assert.ok(result.evidence.some(e => e.pattern === 'TEAM_INDICATOR'), 'Test 2: should have TEAM_INDICATOR evidence');
  console.log('PASS 2: Team string classified TEAM');
}

// Test 3: GROUP string classified COMPANY (GROUP is org indicator, not team)
{
  const result = classifyRecipient({
    contactName: 'KC RESOURCE GROUP',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.COMPANY, 'Test 3: KC RESOURCE GROUP should be COMPANY');
  console.log('PASS 3: GROUP string classified COMPANY');
}

// Test 4: LLC classified LLC
{
  const result = classifyRecipient({
    contactName: 'ABC Properties LLC',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.LLC, 'Test 4: ABC Properties LLC should be LLC');
  console.log('PASS 4: LLC classified LLC');
}

// Test 5: Group/company name never treated as first name
{
  const result = classifyRecipient({
    contactName: 'Just Say Home KC Team',
    firstName: 'Just',
    lastName: '',
  });
  assert.notStrictEqual(result.recipientType, RECIPIENT_TYPES.PERSON, 'Test 5: should not classify as PERSON when name has TEAM indicator');
  console.log('PASS 5: Group/company name never treated as first name');
}

// Test 6: Ambiguous record falls back UNKNOWN
{
  const result = classifyRecipient({
    contactName: 'xyz123',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.UNKNOWN, 'Test 6: xyz123 should be UNKNOWN');
  console.log('PASS 6: Ambiguous record falls back UNKNOWN');
}

// Test 7: Brokerage classified BROKERAGE
{
  const result = classifyRecipient({
    contactName: 'Keller Williams Realty',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.BROKERAGE, 'Test 7: Keller Williams Realty should be BROKERAGE');
  console.log('PASS 7: Brokerage classified BROKERAGE');
}

// Test 8: Person with separate company field still PERSON
{
  const result = classifyRecipient({
    contactName: 'Steve Parker',
    firstName: 'Steve',
    lastName: 'Parker',
    company: 'P4RealtyPartners',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.PERSON, 'Test 8: Steve Parker with company should still be PERSON');
  console.log('PASS 8: Person with separate company field still PERSON');
}

// ============================================================
// GREETING RENDERING TESTS
// ============================================================

const opts = { weekday: 'Thursday', propertyAddress: '123 Main St, Anytown MO 64000', senderName: 'Montelli' };

// Test 9: Team greeting is natural
{
  const msg = renderGreeting({ contactName: 'Just Say Home KC Team', firstName: '', lastName: '' }, opts);
  assert.ok(msg.startsWith('Happy Thursday! Is the Just Say Home KC Team'), 'Test 9: Team greeting should start with "Happy Thursday! Is the..."');
  assert.ok(!msg.includes('Happy Thursday,'), 'Test 9: Team greeting should NOT use comma-name pattern');
  assert.ok(msg.includes('Montelli'), 'Test 9: should include Montelli');
  assert.ok(msg.includes('rental for my portfolio'), 'Test 9: should include rental/portfolio intent');
  console.log('PASS 9: Team greeting is natural');
}

// Test 10: Brokerage greeting is natural
{
  const msg = renderGreeting({ contactName: 'KC RESOURCE GROUP', firstName: '', lastName: '' }, opts);
  assert.ok(msg.startsWith('Happy Thursday! Is KC RESOURCE GROUP'), 'Test 10: Brokerage greeting should start with "Happy Thursday! Is..."');
  assert.ok(!msg.includes('Happy Thursday,'), 'Test 10: Brokerage greeting should NOT use comma-name pattern');
  assert.ok(msg.includes('Montelli'), 'Test 10: should include Montelli');
  console.log('PASS 10: Brokerage greeting is natural');
}

// Test 11: Unknown greeting omits recipient name safely
{
  const msg = renderGreeting({ contactName: 'xyz123', firstName: '', lastName: '' }, opts);
  assert.ok(msg.startsWith('Happy Thursday! Are you still accepting'), 'Test 11: Unknown greeting should use generic "Are you"');
  assert.ok(!msg.includes('xyz123'), 'Test 11: Unknown greeting should NOT include the name');
  assert.ok(msg.includes('Montelli'), 'Test 11: should include Montelli');
  console.log('PASS 11: Unknown greeting omits recipient name safely');
}

// Test 12: Person greeting remains owner-policy compliant
{
  const msg = renderGreeting({ contactName: 'Tamara Harper', firstName: 'Tamara', lastName: 'Harper' }, opts);
  assert.ok(msg.startsWith('Happy Thursday, Tamara!'), 'Test 12: Person greeting should use first name only');
  assert.ok(!msg.includes('Tamara Harper'), 'Test 12: Person greeting should NOT use full name');
  assert.ok(msg.includes('Montelli'), 'Test 12: should include Montelli');
  assert.ok(msg.includes('rental for my portfolio'), 'Test 12: should include rental/portfolio intent');
  console.log('PASS 12: Person greeting remains owner-policy compliant');
}

// Test 13: Person with only contactName (no firstName) uses first word
{
  const msg = renderGreeting({ contactName: 'Sydney Tilford', firstName: '', lastName: '' }, opts);
  assert.ok(msg.startsWith('Happy Thursday, Sydney!'), 'Test 13: should use first word of contactName');
  console.log('PASS 13: Person with only contactName uses first word');
}

// ============================================================
// TEMPLATE QUALITY GATE TESTS
// ============================================================

// Test 14: Full weekday required
{
  const bad = 'Happy Thu, Tamara! Are you still accepting offers for 123 Main St? My name is Montelli, and I\'m looking to purchase it as a rental for my portfolio.';
  const result = validateTemplateQuality(bad, RECIPIENT_TYPES.PERSON);
  assert.strictEqual(result.ok, false, 'Test 14: abbreviated weekday should fail');
  assert.ok(result.errors.some(e => e.startsWith('ABBREVIATED_WEEKDAY')), 'Test 14: should have ABBREVIATED_WEEKDAY error');
  console.log('PASS 14: Full weekday required');
}

// Test 15: Organization greeting cannot use comma-name pattern
{
  const bad = 'Happy Thursday, KC RESOURCE GROUP! Are you still accepting offers for 123 Main St? My name is Montelli, and I\'m looking to purchase it as a rental for my portfolio.';
  const result = validateTemplateQuality(bad, RECIPIENT_TYPES.TEAM);
  assert.strictEqual(result.ok, false, 'Test 15: org greeted as person should fail');
  assert.ok(result.errors.includes('RECIPIENT_TYPE_ORG_GREETED_AS_PERSON'), 'Test 15: should have ORG_GREETED_AS_PERSON error');
  console.log('PASS 15: Organization greeting cannot use comma-name pattern');
}

// Test 16: No unresolved placeholders
{
  const bad = 'Happy Thursday! Is {{Name}} still accepting offers for 123 Main St? My name is Montelli.';
  const result = validateTemplateQuality(bad, RECIPIENT_TYPES.TEAM);
  assert.strictEqual(result.ok, false, 'Test 16: unresolved placeholder should fail');
  assert.ok(result.errors.includes('UNRESOLVED_PLACEHOLDER'), 'Test 16: should have UNRESOLVED_PLACEHOLDER error');
  console.log('PASS 16: No unresolved placeholders');
}

// Test 17: Exact property preserved
{
  const msg = renderGreeting({ contactName: 'Just Say Home KC Team', firstName: '', lastName: '' }, {
    weekday: 'Thursday',
    propertyAddress: '6104 E 136th St, Grandview MO 64030',
    senderName: 'Montelli',
  });
  assert.ok(msg.includes('6104 E 136th St, Grandview MO 64030'), 'Test 17: exact property address preserved');
  console.log('PASS 17: Exact property preserved');
}

// Test 18: Montelli identity preserved
{
  const msg = renderGreeting({ contactName: 'KC RESOURCE GROUP', firstName: '', lastName: '' }, opts);
  assert.ok(msg.includes('My name is Montelli'), 'Test 18: Montelli identity preserved');
  console.log('PASS 18: Montelli identity preserved');
}

// Test 19: Rental/portfolio intent preserved
{
  const msg = renderGreeting({ contactName: 'Tamara Harper', firstName: 'Tamara', lastName: 'Harper' }, opts);
  assert.ok(msg.includes('rental for my portfolio'), 'Test 19: rental/portfolio intent preserved');
  console.log('PASS 19: Rental/portfolio intent preserved');
}

// Test 20: Valid person message passes quality gate
{
  const msg = renderGreeting({ contactName: 'Tamara Harper', firstName: 'Tamara', lastName: 'Harper' }, opts);
  const result = validateTemplateQuality(msg, RECIPIENT_TYPES.PERSON);
  assert.strictEqual(result.ok, true, 'Test 20: valid person message should pass quality gate');
  console.log('PASS 20: Valid person message passes quality gate');
}

// Test 21: Valid team message passes quality gate
{
  const msg = renderGreeting({ contactName: 'Just Say Home KC Team', firstName: '', lastName: '' }, opts);
  const result = validateTemplateQuality(msg, RECIPIENT_TYPES.TEAM);
  assert.strictEqual(result.ok, true, 'Test 21: valid team message should pass quality gate');
  console.log('PASS 21: Valid team message passes quality gate');
}

// Test 22: Valid unknown message passes quality gate
{
  const msg = renderGreeting({ contactName: 'xyz123', firstName: '', lastName: '' }, opts);
  const result = validateTemplateQuality(msg, RECIPIENT_TYPES.UNKNOWN);
  assert.strictEqual(result.ok, true, 'Test 22: valid unknown message should pass quality gate');
  console.log('PASS 22: Valid unknown message passes quality gate');
}

// Test 23: Unknown greeting with comma-name fails
{
  const bad = 'Happy Thursday, xyz123! Are you still accepting offers for 123 Main St? My name is Montelli, and I\'m looking to purchase it as a rental for my portfolio.';
  const result = validateTemplateQuality(bad, RECIPIENT_TYPES.UNKNOWN);
  assert.strictEqual(result.ok, false, 'Test 23: unknown with comma-name should fail');
  assert.ok(result.errors.includes('RECIPIENT_TYPE_UNKNOWN_GREETED_WITH_NAME'), 'Test 23: should have UNKNOWN_GREETED_WITH_NAME error');
  console.log('PASS 23: Unknown greeting with comma-name fails');
}

// Test 24: Duplicated punctuation fails
{
  const bad = 'Happy Thursday! Is KC RESOURCE GROUP still accepting offers?? My name is Montelli, and I\'m looking to purchase it as a rental for my portfolio.';
  const result = validateTemplateQuality(bad, RECIPIENT_TYPES.TEAM);
  assert.strictEqual(result.ok, false, 'Test 24: duplicated punctuation should fail');
  assert.ok(result.errors.includes('DUPLICATED_PUNCTUATION'), 'Test 24: should have DUPLICATED_PUNCTUATION error');
  console.log('PASS 24: Duplicated punctuation fails');
}

// Test 25: Missing sender identity fails
{
  const bad = 'Happy Thursday! Is KC RESOURCE GROUP still accepting offers for 123 Main St? I\'m looking to purchase it as a rental for my portfolio.';
  const result = validateTemplateQuality(bad, RECIPIENT_TYPES.TEAM);
  assert.strictEqual(result.ok, false, 'Test 25: missing sender identity should fail');
  assert.ok(result.errors.includes('MISSING_SENDER_IDENTITY'), 'Test 25: should have MISSING_SENDER_IDENTITY error');
  console.log('PASS 25: Missing sender identity fails');
}

// Test 26: TRUST classified TRUST
{
  const result = classifyRecipient({
    contactName: 'Smith Family Trust',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.TRUST, 'Test 26: Smith Family Trust should be TRUST');
  console.log('PASS 26: TRUST classified TRUST');
}

// Test 27: ESTATE classified ESTATE
{
  const result = classifyRecipient({
    contactName: 'Johnson Estate',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.ESTATE, 'Test 27: Johnson Estate should be ESTATE');
  console.log('PASS 27: ESTATE classified ESTATE');
}

// Test 28: GOVERNMENT classified GOVERNMENT
{
  const result = classifyRecipient({
    contactName: 'City of Springfield Housing Authority',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.GOVERNMENT, 'Test 28: City of Springfield Housing Authority should be GOVERNMENT');
  console.log('PASS 28: GOVERNMENT classified GOVERNMENT');
}

// Test 29: COMPANY fallback for generic org indicator
{
  const result = classifyRecipient({
    contactName: 'Acme Investments',
    firstName: '',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.COMPANY, 'Test 29: Acme Investments should be COMPANY');
  console.log('PASS 29: COMPANY fallback for generic org indicator');
}

// Test 30: Person with first name only (no org indicator in name)
{
  const result = classifyRecipient({
    contactName: 'Montelli',
    firstName: 'Montelli',
    lastName: '',
  });
  assert.strictEqual(result.recipientType, RECIPIENT_TYPES.PERSON, 'Test 30: Montelli with first name only should be PERSON');
  console.log('PASS 30: Person with first name only classified PERSON');
}

// Test 31: Just Say Home KC Team exact expected message
{
  const msg = renderGreeting({ contactName: 'Just Say Home KC Team', firstName: '', lastName: '' }, {
    weekday: 'Thursday',
    propertyAddress: '6104 E 136th St, Grandview MO 64030',
    senderName: 'Montelli',
  });
  const expected = 'Happy Thursday! Is the Just Say Home KC Team still accepting offers for 6104 E 136th St, Grandview MO 64030? My name is Montelli, and I\'m looking to purchase it as a rental for my portfolio.';
  assert.strictEqual(msg, expected, 'Test 31: Just Say Home KC Team exact expected message');
  console.log('PASS 31: Just Say Home KC Team exact expected message');
}

// Test 32: KC RESOURCE GROUP exact expected message
{
  const msg = renderGreeting({ contactName: 'KC RESOURCE GROUP', firstName: '', lastName: '' }, {
    weekday: 'Thursday',
    propertyAddress: '42 E 106th St, Kansas City MO 64114',
    senderName: 'Montelli',
  });
  const expected = 'Happy Thursday! Is KC RESOURCE GROUP still accepting offers for 42 E 106th St, Kansas City MO 64114? My name is Montelli, and I\'m looking to purchase it as a rental for my portfolio.';
  assert.strictEqual(msg, expected, 'Test 32: KC RESOURCE GROUP exact expected message');
  console.log('PASS 32: KC RESOURCE GROUP exact expected message');
}

// Test 33: Tamara Harper exact expected message
{
  const msg = renderGreeting({ contactName: 'Tamara Harper', firstName: 'Tamara', lastName: 'Harper' }, {
    weekday: 'Thursday',
    propertyAddress: '123 Main St, Anytown MO 64000',
    senderName: 'Montelli',
  });
  const expected = 'Happy Thursday, Tamara! Are you still accepting offers for 123 Main St, Anytown MO 64000? My name is Montelli, and I\'m looking to purchase it as a rental for my portfolio.';
  assert.strictEqual(msg, expected, 'Test 33: Tamara Harper exact expected message');
  console.log('PASS 33: Tamara Harper exact expected message');
}

// Test 34: Sydney Tilford exact expected message
{
  const msg = renderGreeting({ contactName: 'Sydney Tilford', firstName: '', lastName: '' }, {
    weekday: 'Thursday',
    propertyAddress: '456 Oak Ave, Othertown MO 64001',
    senderName: 'Montelli',
  });
  const expected = 'Happy Thursday, Sydney! Are you still accepting offers for 456 Oak Ave, Othertown MO 64001? My name is Montelli, and I\'m looking to purchase it as a rental for my portfolio.';
  assert.strictEqual(msg, expected, 'Test 34: Sydney Tilford exact expected message');
  console.log('PASS 34: Sydney Tilford exact expected message');
}

// Test 35: No duplicated words in greeting
{
  const msg = renderGreeting({ contactName: 'Just Say Home KC Team', firstName: '', lastName: '' }, opts);
  const words = msg.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    assert.notStrictEqual(words[i].toLowerCase(), words[i + 1].toLowerCase(), `Test 35: duplicated word "${words[i]}" at position ${i}`);
  }
  console.log('PASS 35: No duplicated words in greeting');
}

// Test 36: No malformed capitalization
{
  const msg = renderGreeting({ contactName: 'KC RESOURCE GROUP', firstName: '', lastName: '' }, opts);
  assert.ok(!/[a-z][A-Z]/.test(msg.replace('KC RESOURCE GROUP', '')), 'Test 36: no malformed capitalization');
  console.log('PASS 36: No malformed capitalization');
}

// Test 37: Valid punctuation (no double punctuation)
{
  const msg = renderGreeting({ contactName: 'Tamara Harper', firstName: 'Tamara', lastName: 'Harper' }, opts);
  assert.ok(!/[!?.]{2,}/.test(msg), 'Test 37: no duplicated punctuation');
  console.log('PASS 37: Valid punctuation');
}

// Test 38: No empty recipient reference
{
  const msg = renderGreeting({ contactName: 'Just Say Home KC Team', firstName: '', lastName: '' }, opts);
  assert.ok(msg.length > 0, 'Test 38: message not empty');
  assert.ok(!msg.includes('  '), 'Test 38: no double spaces');
  console.log('PASS 38: No empty recipient reference');
}

// Test 39: Brokerage greeting with "the" article
{
  const msg = renderGreeting({ contactName: 'Keller Williams Realty', firstName: '', lastName: '' }, opts);
  assert.ok(msg.includes('Is Keller Williams Realty'), 'Test 39: brokerage name included in question');
  console.log('PASS 39: Brokerage greeting with proper article');
}

// Test 40: LLC greeting is natural
{
  const msg = renderGreeting({ contactName: 'ABC Properties LLC', firstName: '', lastName: '' }, opts);
  assert.ok(msg.startsWith('Happy Thursday! Is ABC Properties LLC'), 'Test 40: LLC greeting is natural');
  assert.ok(!msg.includes('Happy Thursday,'), 'Test 40: LLC should not use comma-name pattern');
  console.log('PASS 40: LLC greeting is natural');
}

console.log('\n=== ALL 40 TESTS PASSED ===');
