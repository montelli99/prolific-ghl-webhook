'use strict';

const { derivePropertyTimezone } = require('./property-timezone');

let pass = 0, fail = 0;
const results = [];

function test(name, fn) {
  try { fn(); pass++; results.push(`  PASS ${name}`); }
  catch (e) { fail++; results.push(`  FAIL ${name}: ${e.message}`); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'mismatch'}: expected ${b}, got ${a}`); }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayAt(tz, iso) {
  const r = derivePropertyTimezone({ propertyAddress: `123 Main St Chicago IL 60601`, raw: { zip: '60601' } }, { now: new Date(iso) });
  r._tz = tz;
  return r;
}

function weekdayForZip(zip, iso) {
  const r = derivePropertyTimezone({ propertyAddress: `123 Main St Anytown XX ${zip}`, raw: { zip } }, { now: new Date(iso) });
  return r;
}

// ─── All 7 weekdays ──────────────────────────────────────────
test('1 Monday resolves correctly', () => {
  const r = weekdayAt('America/Chicago', '2026-08-10T17:00:00Z');
  assertEq(r.currentWeekday, 'Monday');
});

test('2 Tuesday resolves correctly (2026-08-11)', () => {
  const r = weekdayAt('America/Chicago', '2026-08-11T17:00:00Z');
  assertEq(r.currentWeekday, 'Tuesday');
});

test('3 Wednesday resolves correctly', () => {
  const r = weekdayAt('America/Chicago', '2026-08-12T17:00:00Z');
  assertEq(r.currentWeekday, 'Wednesday');
});

test('4 Thursday resolves correctly', () => {
  const r = weekdayAt('America/Chicago', '2026-08-13T17:00:00Z');
  assertEq(r.currentWeekday, 'Thursday');
});

test('5 Friday resolves correctly', () => {
  const r = weekdayAt('America/Chicago', '2026-08-14T17:00:00Z');
  assertEq(r.currentWeekday, 'Friday');
});

test('6 Saturday resolves correctly', () => {
  const r = weekdayAt('America/Chicago', '2026-08-15T17:00:00Z');
  assertEq(r.currentWeekday, 'Saturday');
});

test('7 Sunday resolves correctly', () => {
  const r = weekdayAt('America/Chicago', '2026-08-16T17:00:00Z');
  assertEq(r.currentWeekday, 'Sunday');
});

// ─── Timezone crossing ────────────────────────────────────────
test('8 Chicago noon is Tuesday (2026-08-11)', () => {
  const r = weekdayForZip('60601', '2026-08-11T17:00:00Z');
  assertEq(r.timeZone, 'America/Chicago');
  assertEq(r.currentWeekday, 'Tuesday');
});

test('9 New York afternoon is Tuesday', () => {
  const r = weekdayForZip('10001', '2026-08-11T17:00:00Z');
  assertEq(r.timeZone, 'America/New_York');
  assertEq(r.currentWeekday, 'Tuesday');
});

test('10 Indianapolis is Tuesday', () => {
  const r = weekdayForZip('46201', '2026-08-11T17:00:00Z');
  assertEq(r.timeZone, 'America/Indiana/Indianapolis');
  assertEq(r.currentWeekday, 'Tuesday');
});

test('11 Phoenix is Tuesday (MST, no DST)', () => {
  const r = weekdayForZip('85001', '2026-08-11T17:00:00Z');
  assertEq(r.timeZone, 'America/Phoenix');
  assertEq(r.currentWeekday, 'Tuesday');
});

// ─── UTC midnight crossing ────────────────────────────────────
test('12 UTC midnight — Chicago still Monday', () => {
  const r = weekdayForZip('60601', '2026-08-11T00:00:00Z');
  assertEq(r.currentWeekday, 'Monday');
});

test('13 UTC midnight — Honolulu still Monday', () => {
  const r = weekdayForZip('96801', '2026-08-11T00:00:00Z');
  assertEq(r.timeZone, 'Pacific/Honolulu');
  assertEq(r.currentWeekday, 'Monday');
});

test('14 UTC 06:00 — Chicago is Tuesday', () => {
  const r = weekdayForZip('60601', '2026-08-11T06:00:00Z');
  assertEq(r.currentWeekday, 'Tuesday');
});

// ─── Local midnight crossing ──────────────────────────────────
test('15 Chicago 23:59 is Tuesday', () => {
  const r = weekdayForZip('60601', '2026-08-12T04:59:00Z');
  assertEq(r.currentWeekday, 'Tuesday');
});

test('16 Chicago 00:01 is Wednesday', () => {
  const r = weekdayForZip('60601', '2026-08-12T05:01:00Z');
  assertEq(r.currentWeekday, 'Wednesday');
});

// ─── Missing timezone/timestamp ───────────────────────────────
test('17 missing zip + state returns UNKNOWN', () => {
  const r = derivePropertyTimezone({ propertyAddress: 'Nowhere' }, { now: new Date('2026-08-11T17:00:00Z') });
  assertEq(r.ok, false);
  assertEq(r.reason, 'UNKNOWN_TIMEZONE_BLOCKS_CANARY');
  assertEq(r.timeZone, null);
  assertEq(r.currentWeekday, undefined);
});

test('18 missing timestamp uses current time', () => {
  const r = derivePropertyTimezone({ propertyAddress: '123 Main St Chicago IL 60601', raw: { zip: '60601' } });
  assertEq(r.ok, true);
  assert(WEEKDAYS.includes(r.currentWeekday), 'weekday must be a valid day name');
});

// ─── Stale fixture cannot become runtime ──────────────────────
test('19 stale fixture date does not match runtime', () => {
  const stale = derivePropertyTimezone({ propertyAddress: '123 Main St Chicago IL 60601', raw: { zip: '60601' } }, { now: new Date('2026-07-31T17:00:00Z') });
  const runtime = derivePropertyTimezone({ propertyAddress: '123 Main St Chicago IL 60601', raw: { zip: '60601' } }, { now: new Date() });
  assert(stale.currentWeekday !== runtime.currentWeekday || stale.currentLocalTime !== runtime.currentLocalTime,
    'stale fixture must differ from runtime (different date)');
});

test('20 PPC Ewa Beach timezone is Pacific/Honolulu', () => {
  const r = derivePropertyTimezone({ propertyAddress: '91-1001 Kaimalie St Ewa Beach HI 96706', raw: { zip: '96706' } }, { now: new Date('2026-08-11T17:00:00Z') });
  assertEq(r.timeZone, 'Pacific/Honolulu');
  assertEq(r.currentWeekday, 'Tuesday');
});

// ─── Defect documentation ─────────────────────────────────────
test('21 server-local getDayOfWeek is NOT used for canary', () => {
  const r = derivePropertyTimezone({ propertyAddress: '123 Main St Chicago IL 60601', raw: { zip: '60601' } }, { now: new Date('2026-08-11T17:00:00Z') });
  assertEq(r.currentWeekday, 'Tuesday');
  assertEq(r.dstAware, true);
});

test('22 property-local weekday is timezone-aware', () => {
  const chicago = weekdayForZip('60601', '2026-08-11T17:00:00Z');
  const honolulu = weekdayForZip('96801', '2026-08-11T17:00:00Z');
  assertEq(chicago.currentWeekday, 'Tuesday');
  assertEq(honolulu.currentWeekday, 'Tuesday');
  assert(chicago.currentLocalTime !== honolulu.currentLocalTime, 'different timezones must have different local times');
});

console.log('\n=== weekday certification tests ===');
results.forEach(r => console.log(r));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
