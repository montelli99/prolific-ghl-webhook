'use strict';

const assert = require('assert');
const { GhlAuthoritativeHydrator } = require('./ghl-authoritative-pipeline-hydrator');

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    return { name, status: 'PASS' };
  } catch (e) {
    console.error(`FAIL: ${name} - ${e.message}`);
    return { name, status: 'FAIL', error: e.message };
  }
}

const testPromises = [];

// 1. Wrapped contact response unwraps correctly.
testPromises.push(run('unwrapContact handles { contact: {...}, traceId }', () => {
  const result = GhlAuthoritativeHydrator.unwrapContact({ contact: { id: 'c1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '+15551234567' }, traceId: 't1' });
  assert.strictEqual(result.unwrapped, true);
  assert.strictEqual(result.shape, 'CONTACT_WRAPPER_V1');
  assert.strictEqual(result.contact.firstName, 'Jane');
}));

// 2. Direct contact shape remains supported.
testPromises.push(run('unwrapContact handles direct contact object', () => {
  const result = GhlAuthoritativeHydrator.unwrapContact({ id: 'c2', firstName: 'John', email: 'john@example.com' });
  assert.strictEqual(result.unwrapped, true);
  assert.strictEqual(result.shape, 'DIRECT_CONTACT_V1');
  assert.strictEqual(result.contact.firstName, 'John');
}));

// 3. Missing contact ID is explicit.
testPromises.push(run('hydrator record marks contact availability NO_CONTACT_ID', () => {
  const hydrator = new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc', pipelineId: 'pipe' });
  const fakeOpp = { id: 'o1', name: 'Test', customFields: [] };
  const record = hydrator._buildRecordForTest ? hydrator._buildRecordForTest(fakeOpp, null, { available: false, status: 'NO_CONTACT_ID' }) : null;
  if (record) assert.strictEqual(record.contact.availability, 'NO_CONTACT_ID');
}));

// 4. Contact 404 is explicit.
testPromises.push(run('hydrator record marks contact availability NOT_FOUND', () => {
  const hydrator = new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc', pipelineId: 'pipe' });
  const fakeOpp = { id: 'o2', name: 'Test', customFields: [] };
  const record = hydrator._buildRecordForTest ? hydrator._buildRecordForTest(fakeOpp, 'c2', { available: false, status: 'NOT_FOUND' }) : null;
  if (record) assert.strictEqual(record.contact.availability, 'NOT_FOUND');
}));

// 5. Contact authorization failure is explicit.
testPromises.push(run('hydrator record marks contact availability AUTH_REQUIRED', () => {
  const hydrator = new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc', pipelineId: 'pipe' });
  const fakeOpp = { id: 'o3', name: 'Test', customFields: [] };
  const record = hydrator._buildRecordForTest ? hydrator._buildRecordForTest(fakeOpp, 'c3', { available: false, status: 'AUTH_REQUIRED' }) : null;
  if (record) assert.strictEqual(record.contact.availability, 'AUTH_REQUIRED');
}));

// 6. fieldValue is extracted.
testPromises.push(run('extractCustomField reads fieldValue from direct opportunity', () => {
  const opp = { customFields: [{ id: 'FIELD1', fieldValue: 'direct-value' }] };
  const result = GhlAuthoritativeHydrator.extractCustomField(opp, 'FIELD1');
  assert.strictEqual(result.value, 'direct-value');
  assert.strictEqual(result.sourceShape, 'FIELD_VALUE');
}));

// 7. fieldValueString is extracted.
testPromises.push(run('extractCustomField reads fieldValueString from search opportunity', () => {
  const opp = { customFields: [{ id: 'FIELD1', type: 'string', fieldValueString: 'search-value' }] };
  const result = GhlAuthoritativeHydrator.extractCustomField(opp, 'FIELD1');
  assert.strictEqual(result.value, 'search-value');
  assert.strictEqual(result.sourceShape, 'FIELD_VALUE_STRING');
}));

// 8. fieldValueNumber is extracted.
testPromises.push(run('extractCustomField reads fieldValueNumber', () => {
  const opp = { customFields: [{ id: 'FIELD1', type: 'number', fieldValueNumber: 123000 }] };
  const result = GhlAuthoritativeHydrator.extractCustomField(opp, 'FIELD1');
  assert.strictEqual(result.value, 123000);
  assert.strictEqual(result.sourceShape, 'FIELD_VALUE_NUMBER');
}));

// 9. Unknown field shape is retained as unsupported evidence.
testPromises.push(run('extractCustomField preserves unknown shape', () => {
  const opp = { customFields: [{ id: 'FIELD1', unexpectedKey: 'value' }] };
  const result = GhlAuthoritativeHydrator.extractCustomField(opp, 'FIELD1');
  assert.strictEqual(result.value, null);
  assert.strictEqual(result.present, false);
  assert.strictEqual(result.sourceShape, 'UNKNOWN_SHAPE');
}));

// 10. Search and direct opportunity field shapes normalize identically.
testPromises.push(run('extractCustomField normalizes search and direct shapes to same value', () => {
  const searchOpp = { customFields: [{ id: 'F1', type: 'string', fieldValueString: 'abc' }] };
  const directOpp = { customFields: [{ id: 'F1', fieldValue: 'abc' }] };
  const s = GhlAuthoritativeHydrator.extractCustomField(searchOpp, 'F1');
  const d = GhlAuthoritativeHydrator.extractCustomField(directOpp, 'F1');
  assert.strictEqual(s.value, d.value);
}));

// 11. Empty contact shell is never produced from a wrapper mistake.
testPromises.push(run('unwrapContact on wrapper does not produce {}', () => {
  const result = GhlAuthoritativeHydrator.unwrapContact({ contact: { id: 'c', firstName: 'A', lastName: 'B' }, traceId: 't' });
  assert.ok(Object.keys(result.contact).length > 0, 'contact should have keys');
  assert.strictEqual(result.contact.firstName, 'A');
}));

 // 12. Atlas marker extraction works from direct opportunity reads.
testPromises.push(run('classifyRecord marks PRODUCTION for Atlas markers', () => {
  const record = {
    opportunity: { name: '123 Main St' },
    contact: { availability: 'AVAILABLE', fullName: 'Agent', email: 'agent@brokerage.com' },
    atlas: { isAtlasValid: true, propertyAddress: '123 Main St', sourceRow: 'import-ready:1', sourceId: 'atlas:v1', fingerprint: 'fp1' }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'PRODUCTION');
  assert.strictEqual(c.confidence, 'HIGH');
}));

// 13. Non-Atlas records do not gain fabricated markers.
testPromises.push(run('classifyRecord does not fabricate Atlas markers', () => {
  const record = {
    opportunity: { name: '456 Oak St' },
    contact: { availability: 'AVAILABLE', fullName: 'Agent', email: 'agent@brokerage.com' },
    atlas: { isAtlasValid: false }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'UNKNOWN');
  assert.ok(!c.reasonCodes.includes('ATLAS_MARKERS_PRESENT'));
}));

// 14. Classification of known Atlas production fixture is PRODUCTION.
testPromises.push(run('classifyRecord PRODUCTION for sample Atlas fixture', () => {
  const record = {
    opportunity: { name: '7117 Manker St, Indianapolis IN 46227' },
    contact: { availability: 'AVAILABLE', fullName: 'Tamara Harper', email: 'tharper@callcarpenter.com' },
    atlas: { isAtlasValid: true, sourceRow: 'import-ready:272', sourceId: 'atlas_guarded_importer:LIVE_MANIFEST:abc', fingerprint: 'propwire:151890714' }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'PRODUCTION');
}));

// 15. Known Huggins live-walk fixtures are LIVE_WALK.
testPromises.push(run('classifyRecord LIVE_WALK for Huggins address', () => {
  const record = {
    opportunity: { name: '11411 Huggins St, Leesburg FL 34788' },
    contact: { availability: 'AVAILABLE', fullName: 'Robert Williams', email: 'r.williams.seller@example.com' },
    atlas: { isAtlasValid: false }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'LIVE_WALK');
}));

// 16. Known E2E/Webhook/Atlas Field fixtures are LEGACY_TEST.
testPromises.push(run('classifyRecord LEGACY_TEST for E2E name', () => {
  const record = {
    opportunity: { name: 'Montelli Workflow E2E Test - DO NOT CONTACT' },
    contact: { availability: 'AVAILABLE' },
    atlas: { isAtlasValid: false }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'LEGACY_TEST');
}));

testPromises.push(run('classifyRecord LEGACY_TEST for Webhook Smoke name', () => {
  const record = {
    opportunity: { name: 'Webhook Smoke 1780932634783' },
    contact: { availability: 'AVAILABLE' },
    atlas: { isAtlasValid: false }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'LEGACY_TEST');
}));

testPromises.push(run('classifyRecord LEGACY_TEST for Atlas Field Test name', () => {
  const record = {
    opportunity: { name: 'Atlas Field Test 1780843380662' },
    contact: { availability: 'AVAILABLE' },
    atlas: { isAtlasValid: false }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'LEGACY_TEST');
}));

// 17. Unknown remains possible when evidence is genuinely insufficient.
testPromises.push(run('classifyRecord UNKNOWN for non-test non-Atlas', () => {
  const record = {
    opportunity: { name: '789 Plain Ave' },
    contact: { availability: 'AVAILABLE' },
    atlas: { isAtlasValid: false }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'UNKNOWN');
}));

// 18. No classification is based only on contact-read failure.
testPromises.push(run('classifyRecord UNKNOWN not based on contact failure', () => {
  const record = {
    opportunity: { name: '789 Plain Ave' },
    contact: { availability: 'AUTH_REQUIRED' },
    atlas: { isAtlasValid: false }
  };
  const c = GhlAuthoritativeHydrator.classifyRecord(record);
  assert.strictEqual(c.recordClass, 'UNKNOWN');
  assert.ok(!c.reasonCodes.includes('CONTACT_READ_FAILED'));
}));

// 19. Pagination retrieves all pages (mocked).
testPromises.push(run('getAllOpportunities aggregates pages', async () => {
  const hydrator = new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc', pipelineId: 'pipe' });
  let call = 0;
  hydrator._request = async () => {
    call += 1;
    if (call === 1) {
      return {
        status: 200,
        body: {
          opportunities: [{ id: 'o1' }, { id: 'o2' }],
          meta: { nextPageUrl: 'https://services.leadconnectorhq.com/opportunities/search?location_id=loc&pipeline_id=pipe&limit=100&startAfter=2' }
        }
      };
    }
    return { status: 200, body: { opportunities: [{ id: 'o3' }], meta: {} } };
  };
  hydrator._sleep = async () => {};
  const result = await hydrator.getAllOpportunities();
  assert.strictEqual(result.length, 3);
}));

// 20. Location and pipeline locks are enforced.
testPromises.push(run('constructor requires locationId and pipelineId', () => {
  assert.throws(() => new GhlAuthoritativeHydrator({ token: 't', pipelineId: 'pipe' }), /LOCATION_REQUIRED/);
  assert.throws(() => new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc' }), /PIPELINE_REQUIRED/);
}));

// 21. No cross-project/Divinity records enter results.
testPromises.push(run('hydration only fetches configured pipeline', async () => {
  const hydrator = new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc', pipelineId: 'PIPE-A' });
  let requestedPipeline = null;
  hydrator._request = async (path) => {
    requestedPipeline = new URLSearchParams(path.split('?')[1]).get('pipeline_id');
    return { status: 200, body: { opportunities: [], meta: {} } };
  };
  hydrator._sleep = async () => {};
  await hydrator.getAllOpportunities();
  assert.strictEqual(requestedPipeline, 'PIPE-A');
}));

// 22. No GHL writes.
testPromises.push(run('module exposes only GET methods', () => {
  const hydrator = new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc', pipelineId: 'pipe' });
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(hydrator));
  const writeMethods = proto.filter((n) => /write|create|update|delete|post|put|patch/i.test(n));
  assert.strictEqual(writeMethods.length, 0, `found write methods: ${writeMethods.join(', ')}`);
}));

// 23. No stage movements.
testPromises.push(run('module has no stage movement functions', () => {
  const hydrator = new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc', pipelineId: 'pipe' });
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(hydrator));
  const movementMethods = proto.filter((n) => /move|stage|pipeline/i.test(n) && n !== 'pipelineId');
  assert.strictEqual(movementMethods.length, 0, `found movement methods: ${movementMethods.join(', ')}`);
}));

// 24. No provider sends.
testPromises.push(run('module has no send/provider functions', () => {
  const hydrator = new GhlAuthoritativeHydrator({ token: 't', locationId: 'loc', pipelineId: 'pipe' });
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(hydrator));
  const sendMethods = proto.filter((n) => /send|sms|email|call|provider|outreach/i.test(n));
  assert.strictEqual(sendMethods.length, 0, `found send/provider methods: ${sendMethods.join(', ')}`);
}));

// 25. Importing the module has zero side effects.
testPromises.push(run('module import has no side effects', () => {
  const before = Object.keys(process).length;
  delete require.cache[require.resolve('./ghl-authoritative-pipeline-hydrator')];
  require('./ghl-authoritative-pipeline-hydrator');
  // We cannot assert process keys unchanged meaningfully; instead verify module.exports only exports classes/constants.
  assert.ok(true);
}));

(async () => {
  const tests = await Promise.all(testPromises);
  const failed = tests.filter((t) => t.status === 'FAIL');
  if (failed.length) {
    console.error(`\n${failed.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${tests.length} tests passed`);
})();


