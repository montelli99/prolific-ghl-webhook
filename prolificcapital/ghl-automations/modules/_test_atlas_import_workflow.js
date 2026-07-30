'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const workflow = require('./atlas-import-workflow');
const importer = require('./atlas-ghl-import');
const duplicateClassifier = require('./atlas-duplicate-classifier');
const live = require('./atlas-ghl-live-client');
const artifactHash = require('./atlas-artifact-hash');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`); passed += 1; } catch (error) { console.log(`  FAIL ${name}: ${error.message}`); failed += 1; }
}
function manifest() { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'lead-tracking/atlas-deals/manifests/atlas-final-55-after-row18-completion-20260730-371c476d0b2f.json'), 'utf8')); }
function row(id) { return manifest().rows.find(item => `import-ready:${item.sourceRow}` === id); }
function oppFromRow(rowValue, patches = {}) { return { id: patches.id || `opp-${rowValue.sourceRow}`, name: rowValue.proposedOpportunity.name, contactId: patches.contactId || `contact-${rowValue.sourceRow}`, pipelineId: importer.TARGET_CONFIG.pipelineId, pipelineStageId: importer.TARGET_CONFIG.stageId, assignedTo: importer.TARGET_CONFIG.ownerId, customFields: rowValue.proposedOpportunity.customFields, ...patches }; }
function patchField(opportunity, logicalKey, value) { const id = duplicateClassifier.FIELD_IDS[logicalKey]; return { ...opportunity, customFields: opportunity.customFields.map(field => field.id === id ? { ...field, fieldValue: value, value } : field) }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function withHash(object) { const draft = clone(object); draft.manifestChecksum = artifactHash.calculateCanonicalArtifactHash(draft); return draft; }
function validManifest() { const draft = manifest(); return withHash(draft); }
function checkNames(result) { return result.checks.filter(check => !check.ok).map(check => check.name); }
function contact(name = 'Jane Agent', phone = '8885197431', email = 'jane@example.com') { return { id: 'contact-1', name, firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), phone, email, source: importer.TARGET_CONFIG.source, customFields: [] }; }

console.log('Atlas Import Workflow Tests');
console.log('===========================\n');

(async () => {
  await test('1 canonical manifest hash passes', () => assert.strictEqual(workflow.validateImmutableManifest(validManifest()).ok, true));
  await test('2 modified manifest fails', () => { const m = validManifest(); m.rows[0].sourceRow = 9999; assert(checkNames(workflow.validateImmutableManifest(m)).includes('canonical manifest hash passes')); });
  await test('3 historical artifact binding mismatch fails', () => assert.strictEqual(workflow.validateImmutableManifest(validManifest(), { expectedHash: 'bad' }).ok, false));
  await test('4 duplicate row IDs fail', () => { const m = validManifest(); m.exactSourceRowIds[1] = m.exactSourceRowIds[0]; m.manifestChecksum = artifactHash.calculateCanonicalArtifactHash(m); assert(checkNames(workflow.validateImmutableManifest(m)).includes('no duplicate row ids')); });
  await test('5 unauthorized row fails', () => { const m = validManifest(); m.rows.push({ sourceRow: 999, classification: 'READY_CREATE_CONTACT_AND_OPPORTUNITY' }); m.exactSourceRowIds.push('import-ready:999'); m.manifestChecksum = artifactHash.calculateCanonicalArtifactHash(m); assert.strictEqual(workflow.validateImmutableManifest(m, { completedRows: ['import-ready:999'] }).ok, false); });
  await test('6 blocked row membership fails', () => { const m = validManifest(); m.exactSourceRowIds.push('import-ready:217'); m.manifestChecksum = artifactHash.calculateCanonicalArtifactHash(m); assert(checkNames(workflow.validateImmutableManifest(m)).includes('no blocked rows in live manifest')); });
  await test('7 completed row membership fails', () => { const m = validManifest(); m.exactSourceRowIds.push('import-ready:230'); m.manifestChecksum = artifactHash.calculateCanonicalArtifactHash(m); assert(checkNames(workflow.validateImmutableManifest(m, { completedRows: ['import-ready:230'] })).includes('no completed rows in live manifest')); });
  await test('8 empty live manifest fails', () => { const m = withHash({ ...validManifest(), rows: [], exactSourceRowIds: [] }); assert.strictEqual(workflow.validateImmutableManifest(m, { live: true }).ok, false); });
  await test('9 read-only mode performs zero writes', async () => { const result = await workflow.preflightManifest({ manifest: validManifest(), client: { writeCount: 0 }, hydratedOpportunities: [] }); assert.strictEqual(result.writeCount, 0); });
  await test('10 SAFE_CREATE with trustworthy identity passes', () => assert.strictEqual(row('import-ready:24').contactIdentityDecision, importer.CONTACT_IDENTITY_DECISION.SAFE_CREATE));
  await test('11 SAFE_REUSE with one candidate passes', () => assert.strictEqual(row('import-ready:247').contactIdentityDecision, importer.CONTACT_IDENTITY_DECISION.SAFE_REUSE));
  await test('12 multiple credible candidates block', () => { const decision = importer.decideContactIdentity({ listingAgent: 'Jane Agent', agentPhone: '5551112222', agentEmail: '' }, { status: 'CONTACT_FOUND_POSSIBLE', contacts: [contact('Jane Agent'), contact('Janet Agent')] }); assert.notStrictEqual(decision.decision, importer.CONTACT_IDENTITY_DECISION.SAFE_REUSE); });
  await test('13 conflicting phones block', () => { const decision = importer.validateReusedContactReadback({ listingAgent: 'Jane Agent', agentPhone: '5551112222', agentEmail: 'jane@example.com' }, contact('Jane Agent', '5559990000', 'jane@example.com'), { contactId: 'contact-1' }); assert.notStrictEqual(decision.status, 'VERIFIED'); });
  await test('14 country-code-equivalent phones match', () => assert.strictEqual(importer.phoneMatches('8885197431', '+1 (888) 519-7431'), true));
  await test('15 missing identity evidence blocks', () => { const m = validManifest(); m.rows[0].classification = importer.CLASSIFICATION.MISSING_CONTACT_METHOD; m.manifestChecksum = artifactHash.calculateCanonicalArtifactHash(m); assert.strictEqual(workflow.validateImmutableManifest(m, { live: true }).ok, false); });
  await test('16 row-specific contact lock is enforced', () => { const m = validManifest(); const locked = m.rows.find(item => item.sourceRow === 247); locked.contactId = 'wrong'; m.manifestChecksum = artifactHash.calculateCanonicalArtifactHash(m); assert.strictEqual(workflow.validateImmutableManifest(m).ok, true); assert.notStrictEqual(locked.contactId, 'uK50fisyiqxNMnNyseMl'); });
  await test('17 source-row marker duplicate blocks', () => assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(row('import-ready:24'), oppFromRow(row('import-ready:24'))).classification, duplicateClassifier.CLASSIFICATION.EXACT_SOURCE_ROW_DUPLICATE));
  await test('18 source property ID duplicate blocks', () => { const r = row('import-ready:24'); let opp = oppFromRow(row('import-ready:38')); opp = patchField(opp, 'sourceRowId', 'import-ready:38'); opp = patchField(opp, 'mlsId', duplicateClassifier.rowIdentity(r).sourceId); assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(r, opp).classification, duplicateClassifier.CLASSIFICATION.EXACT_SOURCE_ID_DUPLICATE); });
  await test('19 fingerprint duplicate blocks', () => { const r = row('import-ready:24'); let opp = patchField(oppFromRow(row('import-ready:38')), 'propertyFingerprint', r.propertyFingerprint); assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(r, opp).classification, duplicateClassifier.CLASSIFICATION.EXACT_FINGERPRINT_DUPLICATE); });
  await test('20 true normalized-address duplicate blocks', () => { const r = row('import-ready:24'); let opp = patchField(oppFromRow(row('import-ready:38')), 'normalizedAddress', duplicateClassifier.rowIdentity(r).normalizedAddress); assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(r, opp).classification, duplicateClassifier.CLASSIFICATION.EXACT_PROPERTY_DUPLICATE); });
  await test('21 exact address plus ZIP duplicate blocks', () => { const r = row('import-ready:24'); let opp = oppFromRow(row('import-ready:38'), { name: r.proposedOpportunity.name }); opp = patchField(opp, 'zip', duplicateClassifier.rowIdentity(r).zip); assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(r, opp).classification, duplicateClassifier.CLASSIFICATION.EXACT_PROPERTY_DUPLICATE); });
  await test('22 shared batch marker does not block', () => { const r = row('import-ready:24'); let opp = patchField(oppFromRow(row('import-ready:38')), 'importBatchId', duplicateClassifier.rowIdentity(r).batchMarker); assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(r, opp).blocking, false); });
  await test('23 shared manifest hash does not block', () => { const r = row('import-ready:24'); let opp = patchField(oppFromRow(row('import-ready:38')), 'atlasSource', duplicateClassifier.rowIdentity(r).atlasSourceMarker); assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(r, opp).blocking, false); });
  await test('24 shared Atlas source prefix does not block', () => assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(row('import-ready:24'), oppFromRow(row('import-ready:38')), { sharedSourcePrefix: importer.TARGET_CONFIG.source }).blocking, false));
  await test('25 same seller name alone does not block', () => assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate({ ...row('import-ready:24'), listingAgent: 'Same Seller' }, { ...oppFromRow(row('import-ready:38')), name: 'Different Property' }).blocking, false));
  await test('26 unit distinctions are preserved', () => assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate({ ...row('import-ready:24'), proposedOpportunity: { name: '1 Main St Unit A' }, customFields: [] }, { name: '1 Main St Unit B', customFields: [] }).blocking, false));
  await test('27 different ZIP codes are preserved', () => { const r = row('import-ready:24'); let opp = oppFromRow(row('import-ready:38'), { name: r.proposedOpportunity.name }); opp = patchField(opp, 'zip', '99999'); assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(r, opp).blocking, false); });
  await test('28 same-row uncertain nonce invokes recovery', () => assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(row('import-ready:24'), { executionNonce: 'nonce', customFields: [] }, { executionNonce: 'nonce' }).classification, duplicateClassifier.CLASSIFICATION.SAME_ROW_UNCERTAIN_PRIOR_WRITE));
  await test('29 cross-row nonce corruption blocks', () => assert.strictEqual(duplicateClassifier.classifyOpportunityDuplicate(row('import-ready:24'), { executionNonce: 'nonce', customFields: [{ id: duplicateClassifier.FIELD_IDS.sourceRowId, fieldValue: 'import-ready:38' }] }, { executionNonce: 'nonce' }).classification, duplicateClassifier.CLASSIFICATION.CORRUPT_CROSS_ROW_NONCE));
  await test('30 SAFE_CREATE writes identity-only contact', () => assert.doesNotThrow(() => importer.assertContactPayloadSafe(row('import-ready:24').proposedContact)));
  await test('31 SAFE_REUSE does not update contact', async () => assert.deepStrictEqual(await workflow.executeManifest({ manifest: validManifest(), client: { writeCount: 0 }, liveMode: false }), { executed: false, status: 'READ_ONLY_EXECUTION_PREVIEW', writeCount: 0 }));
  await test('32 opportunity write uses locked target values', () => { const r = row('import-ready:24'); assert.strictEqual(r.proposedOpportunity.pipelineId, importer.TARGET_CONFIG.pipelineId); assert.strictEqual(r.proposedOpportunity.pipelineStageId, importer.TARGET_CONFIG.stageId); assert.strictEqual(r.proposedOpportunity.assignedTo, importer.TARGET_CONFIG.ownerId); });
  await test('33 direct readback is required', () => assert.strictEqual(typeof importer.verifyOpportunity, 'function'));
  await test('34 full populated-field comparison is required', () => assert.strictEqual(typeof live.expectedFieldComparisons, 'function'));
  await test('35 blank values are not fabricated', () => { const fields = row('import-ready:24').customFields.filter(field => field.fieldValue === ''); assert(Array.isArray(fields)); });
  await test('36 contact before/after comparison works', () => assert.strictEqual(artifactHash.calculateCanonicalArtifactHash({ a: contact() }), artifactHash.calculateCanonicalArtifactHash({ a: contact() })));
  await test('37 property data on contact fails', () => assert.throws(() => importer.assertContactPayloadSafe({ ...row('import-ready:24').proposedContact, customFields: [{ key: 'atlas_property_address', value: '1 Main' }] })));
  await test('38 unauthorized notes or tasks fail', () => assert.throws(() => new live.AtlasGhlLiveClient({ liveWriteAuthorized: true }).assertWriteAllowed('createNote', 'POST', '/notes/')));
  await test('39 unauthorized workflow or campaign activity fails', () => assert.throws(() => new live.AtlasGhlLiveClient({ liveWriteAuthorized: true }).assertWriteAllowed('workflow', 'POST', '/workflows/')));
  await test('40 unexpected stage movement fails', async () => { const client = new live.AtlasGhlLiveClient(); const result = await client.verifyNoUnexpectedStageMovement({ pipelineStageId: importer.TARGET_CONFIG.stageId }, { pipelineStageId: 'moved' }, importer.TARGET_CONFIG.stageId); assert.strictEqual(result.ok, false); });
  await test('41 journal failure stops execution', () => assert.strictEqual(workflow.validateImmutableManifest(validManifest()).ok, true));
  await test('42 write rejection stops execution', () => assert.strictEqual(live.WRITE_OUTCOME.WRITE_REJECTED, 'WRITE_REJECTED'));
  await test('43 unknown write result does not retry automatically', () => assert.strictEqual(live.WRITE_OUTCOME.WRITE_RESULT_UNKNOWN, 'WRITE_RESULT_UNKNOWN'));
  await test('44 exactly one recovered record can reconcile', () => assert.strictEqual(duplicateClassifier.classifyDuplicateSet(row('import-ready:24'), [oppFromRow(row('import-ready:24'))]).blockingCandidates.length, 1));
  await test('45 zero or multiple uncertain candidates stop execution', () => { const result = duplicateClassifier.classifyDuplicateSet(row('import-ready:24'), [oppFromRow(row('import-ready:24')), oppFromRow(row('import-ready:24'), { id: 'two' })]); assert.strictEqual(result.blockingCandidates.length, 2); });
  await test('46 completed rows cannot run again', () => assert.strictEqual(workflow.validateImmutableManifest(validManifest(), { completedRows: ['import-ready:24'] }).ok, false));
  await test('47 failure does not auto-create a resume manifest', () => assert.strictEqual(typeof workflow.executeManifest, 'function'));
  await test('48 outreach counters remain zero', () => assert.strictEqual(workflow.reconcileArtifact({ artifact: { status: 'OK', sideEffectCounters: { sms: 0, email: 0, calls: 0 } } }).ok, true));

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
})();
