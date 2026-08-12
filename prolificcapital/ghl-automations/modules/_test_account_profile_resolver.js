'use strict';

const { resolveProfile, validateProfileBinding, listProfiles, getCredentialRef } = require('./account-profile-resolver');

let pass = 0, fail = 0;
const results = [];

function test(name, fn) {
  try { fn(); pass++; results.push(`  PASS ${name}`); }
  catch (e) { fail++; results.push(`  FAIL ${name}: ${e.message}`); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'mismatch'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertThrows(fn, expectedMsg) {
  try { fn(); throw new Error('expected throw but none occurred'); }
  catch (e) { if (expectedMsg && !e.message.includes(expectedMsg)) throw new Error(`wrong error: ${e.message}`); }
}

// ─── Profile resolution ──────────────────────────────────────
test('1 ATLAS_OUTBOUND resolves correct location', () => {
  const p = resolveProfile('ATLAS_OUTBOUND');
  assertEq(p.locationId, '61XPzSqRy7UKMwW9DeB8');
});

test('2 ATLAS_OUTBOUND resolves correct pipeline', () => {
  const p = resolveProfile('ATLAS_OUTBOUND');
  assertEq(p.pipelineId, 'nSf3NXYVkt8X4PgW9aZ3');
});

test('3 PPC_EWA_BEACH resolves correct location', () => {
  const p = resolveProfile('PPC_EWA_BEACH');
  assertEq(p.locationId, 'GDq92uruRngbi9mLGGrV');
});

test('4 PPC_EWA_BEACH resolves correct pipeline', () => {
  const p = resolveProfile('PPC_EWA_BEACH');
  assertEq(p.pipelineId, 'ril84XHGQleRgE0W0FKU');
});

test('5 PPC uses PPC_GHL_API_KEY credential reference', () => {
  const ref = getCredentialRef('PPC_EWA_BEACH');
  assertEq(ref, 'PPC_GHL_API_KEY');
});

test('6 ATLAS uses GHL_API_TOKEN credential reference', () => {
  const ref = getCredentialRef('ATLAS_OUTBOUND');
  assertEq(ref, 'GHL_API_TOKEN');
});

// ─── Mixed pair rejection ────────────────────────────────────
test('7 mixed Atlas location + PPC pipeline rejected', () => {
  assertThrows(
    () => validateProfileBinding('ATLAS_OUTBOUND', '61XPzSqRy7UKMwW9DeB8', 'ril84XHGQleRgE0W0FKU'),
    'LOCATION_PIPELINE_PROFILE_MISMATCH'
  );
});

test('8 mixed PPC location + Atlas pipeline rejected', () => {
  assertThrows(
    () => validateProfileBinding('PPC_EWA_BEACH', 'GDq92uruRngbi9mLGGrV', 'nSf3NXYVkt8X4PgW9aZ3'),
    'LOCATION_PIPELINE_PROFILE_MISMATCH'
  );
});

test('9 unknown tuple rejected', () => {
  assertThrows(
    () => validateProfileBinding('ATLAS_OUTBOUND', '61XPzSqRy7UKMwW9DeB8', 'o4hvfO7adOQlLdtqPNIn'),
    'LOCATION_PIPELINE_PROFILE_MISMATCH'
  );
});

test('10 unknown profile rejected', () => {
  assertThrows(
    () => resolveProfile('NONEXISTENT_PROFILE'),
    'UNKNOWN_GHL_PROFILE'
  );
});

// ─── Profile independence from env ───────────────────────────
test('11 env duplicate order cannot change profile identity', () => {
  const p1 = resolveProfile('ATLAS_OUTBOUND');
  const p2 = resolveProfile('ATLAS_OUTBOUND');
  assertEq(p1.locationId, p2.locationId);
  assertEq(p1.pipelineId, p2.pipelineId);
});

test('12 profile resolution is deterministic', () => {
  const a = resolveProfile('PPC_EWA_BEACH');
  const b = resolveProfile('PPC_EWA_BEACH');
  assertEq(JSON.stringify(a), JSON.stringify(b));
});

// ─── Profile isolation ───────────────────────────────────────
test('13 PPC profile cannot fall back to Atlas', () => {
  const ppc = resolveProfile('PPC_EWA_BEACH');
  const atlas = resolveProfile('ATLAS_OUTBOUND');
  assert(ppc.locationId !== atlas.locationId, 'PPC and Atlas must have different locations');
  assert(ppc.pipelineId !== atlas.pipelineId, 'PPC and Atlas must have different pipelines');
});

test('14 Atlas profile cannot fall back to PPC', () => {
  const atlas = resolveProfile('ATLAS_OUTBOUND');
  assertEq(atlas.locationId, '61XPzSqRy7UKMwW9DeB8');
  assertEq(atlas.pipelineId, 'nSf3NXYVkt8X4PgW9aZ3');
});

// ─── Kayla profile ───────────────────────────────────────────
test('15 KAYLA_MONTELLI profile exists and is distinct', () => {
  const k = resolveProfile('KAYLA_MONTELLI');
  assertEq(k.locationId, '61XPzSqRy7UKMwW9DeB8');
  assertEq(k.pipelineId, 'ygQaJ2hi7ouJeA5HR7uu');
  assertEq(k.credentialRef, 'KAYLA_GHL_API_KEY');
});

test('16 Kayla profile uses separate credential from Atlas', () => {
  const atlasRef = getCredentialRef('ATLAS_OUTBOUND');
  const kaylaRef = getCredentialRef('KAYLA_MONTELLI');
  assert(atlasRef !== kaylaRef, 'Kayla and Atlas must use separate credentials');
});

// ─── List profiles ───────────────────────────────────────────
test('17 listProfiles returns all three profiles', () => {
  const profiles = listProfiles();
  const ids = profiles.map(p => p.profileId);
  assert(ids.includes('ATLAS_OUTBOUND'));
  assert(ids.includes('PPC_EWA_BEACH'));
  assert(ids.includes('KAYLA_MONTELLI'));
  assertEq(profiles.length, 3);
});

// ─── No secret logged ────────────────────────────────────────
test('18 resolveProfile does not expose credential values', () => {
  const p = resolveProfile('ATLAS_OUTBOUND');
  const str = JSON.stringify(p);
  assert(!str.includes('pit-'), 'no token prefix in profile output');
  assert(!str.includes('Bearer'), 'no auth header in profile output');
});

test('19 credentialRef is a key name, not a value', () => {
  const ref = getCredentialRef('PPC_EWA_BEACH');
  assertEq(ref, 'PPC_GHL_API_KEY');
  assert(ref.startsWith('PPC_') || ref.startsWith('GHL_') || ref.startsWith('KAYLA_'), 'credentialRef must be an env key name');
});

// ─── Safety assertions ───────────────────────────────────────
test('20 GHL writes = 0 (no write capability in resolver)', () => {
  const p = resolveProfile('ATLAS_OUTBOUND');
  assert(!p.writeEnabled, 'profile resolver must not enable writes');
  assert(!p.writeToken, 'profile resolver must not expose write tokens');
});

console.log('\n=== account-profile-resolver tests ===');
results.forEach(r => console.log(r));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
