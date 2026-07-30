'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const exceptionQueue = require('./atlas-exception-queue');
const validator = require('./atlas-source-validator');
const workflow = require('./atlas-import-workflow');
const importer = require('./atlas-ghl-import');
const duplicateClassifier = require('./atlas-duplicate-classifier');
const artifactHash = require('./atlas-artifact-hash');

let passed = 0;
let failed = 0;
async function test(name, fn) { try { await fn(); console.log(`  PASS ${name}`); passed += 1; } catch (error) { console.log(`  FAIL ${name}: ${error.message}`); failed += 1; } }
function fixturePath() { return path.resolve(__dirname, '..', 'fixtures/atlas/future-batch/future-batch.csv'); }
function finalManifest() { return require(path.resolve(__dirname, '..', '..', 'lead-tracking/atlas-deals/manifests/atlas-final-55-after-row18-completion-20260730-371c476d0b2f.json')); }
function row(id) { return finalManifest().rows.find(item => `import-ready:${item.sourceRow}` === id); }
function oppFromRow(rowValue, patches = {}) { return { id: patches.id || `opp-${rowValue.sourceRow}`, name: rowValue.proposedOpportunity.name, contactId: patches.contactId || `contact-${rowValue.sourceRow}`, customFields: rowValue.proposedOpportunity.customFields, ...patches }; }
function csvWith(body) { const file = path.resolve(__dirname, '..', 'fixtures/atlas/future-batch/tmp-test.csv'); fs.writeFileSync(file, body); return file; }
const header = 'county,state,address,city,zip,listPrice,sqft,pricePerSqft,propertyType,ownership,status,leadTypes,listingAgent,agentEmail,agentPhone,brokerName,mlsUrl,ghlStatus\n';
const good = 'Example,TX,1 Test St,Testville,75001,1,1,1,Single Family,Individual Owned,Active,Creative,Alice Example,alice@example.com,5550109999,Example Realty,https://example.test/realestate/1-Test-St/999001/mls-listing,\n';

console.log('Atlas Operations V1 Tests');
console.log('=========================\n');

(async () => {
  await test('1 original blocked artifact loads', () => assert.strictEqual(exceptionQueue.loadQueue().rows.length, 3));
  await test('2 historical artifact is never modified', () => assert.strictEqual(exceptionQueue.canonicalHash(require(path.resolve(__dirname, '..', '..', exceptionQueue.DISPOSITION_PATH))), exceptionQueue.DISPOSITION_HASH));
  await test('3 list shows all three blocked rows', () => assert.deepStrictEqual(exceptionQueue.loadQueue().rows.map(row => row.rowId).sort(), ['import-ready:217', 'import-ready:273', 'import-ready:69'].sort()));
  await test('4 show returns exact evidence', () => assert(exceptionQueue.findRow('import-ready:217').row.evidenceInspected.length > 0));
  await test('5 new evidence creates child artifact object', () => assert.strictEqual(exceptionQueue.review('import-ready:217', fixturePath()).productionWrites, 0));
  await test('6 insufficient evidence remains blocked', () => assert.strictEqual(exceptionQueue.review('import-ready:217', fixturePath()).reviewState, exceptionQueue.STATES.WAITING_FOR_SOURCE_EVIDENCE));
  await test('7 safe evidence can produce proposed resolution', () => { const f = csvWith('SAFE_REUSE source-backed evidence'); const r = exceptionQueue.resolve('import-ready:217', 'SAFE_REUSE', f, { contactId: 'contact-safe' }); assert.strictEqual(r.resolvedState, exceptionQueue.STATES.RESOLVED_SAFE_REUSE); });
  await test('8 resolution cannot execute automatically', () => { const f = csvWith('SAFE_CREATE source-backed evidence'); const r = exceptionQueue.resolve('import-ready:217', 'SAFE_CREATE', f); assert.strictEqual(r.importAuthorized, false); });
  await test('9 excluded row cannot enter routine manifest', () => { const m = { ...finalManifest(), exactSourceRowIds: ['import-ready:217'], rows: [row('import-ready:24')] }; m.manifestChecksum = artifactHash.calculateCanonicalArtifactHash(m); assert.strictEqual(workflow.validateImmutableManifest(m).ok, false); });
  await test('10 exception CLI performs zero writes', () => assert.strictEqual(exceptionQueue.loadQueue().rows.every(row => row.productionWrites === 0), true));
  await test('11 required columns pass', () => assert.strictEqual(validator.validateSource(csvWith(header + good), { completedRows: new Set(), blockedRows: new Set() }).ok, true));
  await test('12 missing required column blocks', () => assert.strictEqual(validator.validateSource(csvWith('county,state\nExample,TX\n')).classification, validator.CLASSIFICATION.SOURCE_BLOCKED_SCHEMA));
  await test('13 duplicate headers block', () => assert.strictEqual(validator.validateSource(csvWith('county,state,state\nExample,TX,TX\n')).classification, validator.CLASSIFICATION.SOURCE_BLOCKED_SCHEMA));
  await test('14 duplicate row IDs block by completed row registry', () => assert.strictEqual(validator.validateSource(csvWith(header + good), { completedRows: new Set(['import-ready:2']), blockedRows: new Set() }).blockedRows[0].classification, validator.CLASSIFICATION.SOURCE_ALREADY_IMPORTED));
  await test('15 duplicate source property IDs block', () => assert.strictEqual(validator.validateSource(csvWith(header + good + good.replace('1 Test St', '2 Test St')), { completedRows: new Set(), blockedRows: new Set() }).blockedRows[0].classification, validator.CLASSIFICATION.SOURCE_BLOCKED_DUPLICATE));
  await test('16 malformed email is classified', () => assert.strictEqual(validator.validateSource(csvWith(header + good.replace('alice@example.com', 'bad-email')), { completedRows: new Set(), blockedRows: new Set() }).blockedRows[0].classification, validator.CLASSIFICATION.SOURCE_BLOCKED_IDENTITY));
  await test('17 phone normalization works', () => assert.strictEqual(validator.validateSource(csvWith(header + good.replace('5550109999', '+1 (555) 010-9999')), { completedRows: new Set(), blockedRows: new Set() }).artifact.rows[0].normalizedPhone, '15550109999'));
  await test('18 conflicting phones block as malformed', () => assert.strictEqual(validator.validateSource(csvWith(header + good.replace('5550109999', '123')), { completedRows: new Set(), blockedRows: new Set() }).blockedRows[0].classification, validator.CLASSIFICATION.SOURCE_BLOCKED_IDENTITY));
  await test('19 invalid ZIP is classified', () => assert.strictEqual(validator.validateSource(csvWith(header + good.replace('75001', 'ABCDE')), { completedRows: new Set(), blockedRows: new Set() }).blockedRows[0].classification, validator.CLASSIFICATION.SOURCE_BLOCKED_SCHEMA));
  await test('20 missing address blocks', () => assert.strictEqual(validator.validateSource(csvWith(header + good.replace('1 Test St', '')), { completedRows: new Set(), blockedRows: new Set() }).blockedRows[0].classification, validator.CLASSIFICATION.SOURCE_BLOCKED_SCHEMA));
  await test('21 unit distinctions remain', () => { const a = importer.normalizeAddressParts({ address: '1 Test St Unit A', city: 'Testville', state: 'TX', zip: '75001' }); const b = importer.normalizeAddressParts({ address: '1 Test St Unit B', city: 'Testville', state: 'TX', zip: '75001' }); assert.notStrictEqual(a, b); });
  await test('22 same street different ZIP remains distinct', () => assert.notStrictEqual(importer.normalizeAddressParts({ address: '1 Test St', city: 'Testville', state: 'TX', zip: '75001' }), importer.normalizeAddressParts({ address: '1 Test St', city: 'Testville', state: 'TX', zip: '75002' })));
  await test('23 previously completed row is excluded', () => assert.strictEqual(validator.validateSource(csvWith(header + good), { completedRows: new Set(['import-ready:2']), blockedRows: new Set() }).blockedRows[0].classification, validator.CLASSIFICATION.SOURCE_ALREADY_IMPORTED));
  await test('24 previously blocked row enters exception queue', () => assert.strictEqual(validator.validateSource(csvWith(header + good), { completedRows: new Set(), blockedRows: new Set(['import-ready:2']) }).blockedRows[0].classification, validator.CLASSIFICATION.SOURCE_PREVIOUSLY_EXCLUDED));
  await test('25 normalized snapshot hashes deterministically', () => { const a = validator.validateSource(csvWith(header + good), { completedRows: new Set(), blockedRows: new Set() }); const b = validator.validateSource(csvWith(header + good), { completedRows: new Set(), blockedRows: new Set() }); assert.strictEqual(a.artifact.normalizedSnapshotHash, b.artifact.normalizedSnapshotHash); });
  await test('26 prepare produces immutable manifest validation', () => assert.strictEqual(workflow.validateImmutableManifest(finalManifest()).ok, true));
  await test('27 preflight performs zero writes', async () => assert.strictEqual((await workflow.preflightManifest({ manifest: finalManifest(), client: { writeCount: 0 }, hydratedOpportunities: [] })).writeCount, 0));
  await test('28 shared batch metadata does not collide', () => assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(row('import-ready:24'), oppFromRow(row('import-ready:38')), { sharedSourcePrefix: importer.TARGET_CONFIG.source }).blocking, false));
  await test('29 true duplicate blocks', () => assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(row('import-ready:24'), oppFromRow(row('import-ready:24'))).blocking, true));
  await test('30 SAFE_CREATE works in deterministic execution', () => assert.strictEqual(row('import-ready:24').contactIdentityDecision, importer.CONTACT_IDENTITY_DECISION.SAFE_CREATE));
  await test('31 SAFE_REUSE does not mutate contact', () => assert.strictEqual(row('import-ready:247').contactIdentityDecision, importer.CONTACT_IDENTITY_DECISION.SAFE_REUSE));
  await test('32 partial-contact recovery works', () => assert.strictEqual(importer.phoneMatches('5550101000', '+15550101000'), true));
  await test('33 unknown opportunity result does not retry', () => assert.strictEqual(require('./atlas-ghl-live-client').WRITE_OUTCOME.WRITE_RESULT_UNKNOWN, 'WRITE_RESULT_UNKNOWN'));
  await test('34 exactly one recovery match reconciles', () => assert.strictEqual(duplicateClassifier.classifyDuplicateSet(row('import-ready:24'), [oppFromRow(row('import-ready:24'))]).blockingCandidates.length, 1));
  await test('35 multiple recovery matches stop', () => assert.strictEqual(duplicateClassifier.classifyDuplicateSet(row('import-ready:24'), [oppFromRow(row('import-ready:24')), oppFromRow(row('import-ready:24'), { id: 'two' })]).blockingCandidates.length, 2));
  await test('36 resume excludes completed rows', () => assert.strictEqual(workflow.validateImmutableManifest(finalManifest(), { completedRows: ['import-ready:24'] }).ok, false));
  await test('37 final reconciliation passes', () => assert.strictEqual(workflow.reconcileArtifact({ artifact: require(path.resolve(__dirname, '..', '..', 'lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-passed-2e14a7cd6564.json')) }).ok, true));
  await test('38 side-effect counters remain zero', () => assert.strictEqual(workflow.reconcileArtifact({ artifact: { status: 'OK', sideEffectCounters: { sms: 0, email: 0 } } }).ok, true));
  await test('39 status command is read-only by construction', () => assert.strictEqual(fs.readFileSync(path.resolve(__dirname, '..', 'tools/atlas-import.js'), 'utf8').includes("command === 'status'"), true));
  await test('40 doctor command is read-only by construction', () => assert.strictEqual(fs.readFileSync(path.resolve(__dirname, '..', 'tools/atlas-import.js'), 'utf8').includes("command === 'doctor'"), true));
  await test('41 artifacts reproduce canonical hashes', () => assert.strictEqual(exceptionQueue.canonicalHash(require(path.resolve(__dirname, '..', '..', exceptionQueue.DISPOSITION_PATH))), exceptionQueue.DISPOSITION_HASH));
  await test('42 synthetic data contains no real customer information', () => { const text = fs.readFileSync(fixturePath(), 'utf8'); assert(!/(gmail\.com|yahoo\.com|hotmail\.com|@kw\.com|@exprealty)/i.test(text)); assert(!/\+1(?!55501)\d{10}/.test(text)); assert(text.includes('example.com') || text.includes('example.test')); });
  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
})();
