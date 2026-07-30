# Atlas GHL Production Import Report

## Current Status

The guarded importer and webhook safety tests pass locally. A valid local GHL credential was found in the established secret source and passed Atlas read scopes for location `61XPzSqRy7UKMwW9DeB8` and pipeline `nSf3NXYVkt8X4PgW9aZ3`. The required Atlas opportunity fields were created or safely reused, read back, and frozen in `ghl-automations/config/atlas-opportunity-field-map.json`. Full live read-only preflight passed and a READY-only manifest was generated. The one-row canary, three-row reuse batch, twenty-row controlled batch, fifty-row controlled batch, stopped partial 75-row attempt, stopped partial 53-row resume, and completed 7-row resume have been reconciled.

## Verified Production Results

Completed imports:
- one-row canary
- three-row reuse batch
- twenty-row controlled batch
- fifty-row controlled batch
- stopped partial 75-row attempt: 22 reconciled opportunity imports before contact conflict stop
- stopped partial 53-row resume attempt: 46 reconciled opportunity imports before reused-contact readback stop
- completed 7-row resume batch: 7 reconciled opportunity imports
- completed final-55 live import: 55 reconciled opportunity imports

Physical GHL opportunities imported so far: 206 Atlas-valid opportunities, plus 7 unrelated target-pipeline opportunities observed during reconciliation

Fully reconciled valid opportunities: 206

Remediation-required opportunities: 0

Total contacts created so far: 171

Total contact reuse decisions: 38

Remaining executable clean unimported rows: 0 after the completed final-55 live import. Blocked rows remain `import-ready:69`, `import-ready:217`, and `import-ready:273`.

Blocked malformed/questionable rows: 38

Original preflight-blocked rows: 25

Observed results:
- property fields on contacts: 0
- duplicate prewrite failures: 0
- possible property matches accepted: 0
- field readback failures: 0 for populated expected fields and required Atlas markers. `import-ready:195` had blank source `ownership`, so 19 populated opportunity fields were read back for that row.
- notes: 0
- SMS: 0
- email: 0
- calls: 0
- unexpected stage movement: 0
- dashboard mutations: 0
- external CRM calls: 0

Stopped rows:
- `import-ready:69` is blocked for contact identity conflict/source identity defect. It produced opportunity `vEgDkrQJQzEhK4KHeg2J` linked to conflicting contact `vikcBqKuhkZsI4BvVA9Z`; that opportunity was deleted after separate explicit approval. The row remains blocked until corrected source identity is supplied and re-preflighted.
- `import-ready:217` blocked the final-60 zero-write preflight before production writes. Investigation proved source email `contact@beycome.com` is a generic company inbox and not a person-level email conflict by itself. The row remains blocked because GHL has multiple contacts on the same phone: `qY89ZfUrPowQ9GfpsdRW` (`Steven Koleno`, `steve@beycome.com`) and `x5ul9LVmA0VfovTXiLIT` (`Steven Kelono`, `contact@beycome.com`). Final investigation classification: `MULTIPLE_CONTACT_IDENTITY_CONFLICT`; canonical decision after hardening: `BLOCK_SHARED_PHONE` with reason `SHARED_PHONE`.

Final-60 prewrite stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-60-20260729-prewrite-stop-c02ab8218f7d.json`.

Row-217 investigation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-import-ready-217-identity-investigation-6468abbb5d2c.json`.

Prepared but not executed 59-row child manifest: `lead-tracking/atlas-deals/manifests/atlas-final-59-after-row217-block-20260729-9fc44ddfd2cf.json`.

Final-59 prewrite stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-59-20260729-prewrite-stop-artifact-hash-gate.json`. Rows attempted: 0. Rows completed: 0. Production writes: 0. Stop reason: required final-60 prewrite-stop artifact hash did not match the value recorded in the final-59 manifest.

Constitutional identity rule: Atlas contact identity must be proven before any write. Shared phone numbers, generic brokerage emails, or matching contact channels cannot override a conflicting person name. Identity uncertainty always blocks before contact or opportunity creation. A missing optional contact identifier is not a conflict. A different non-empty identifier is a conflict. Preflight, execution, and reconciliation must use the same canonical identity decision.

Artifact integrity rule: Atlas artifact authorization uses one versioned canonical hashing implementation. Raw-file hashes are diagnostic only unless explicitly declared. Immutable artifacts and manifests are never edited to repair a hash mismatch. A mismatch requires provenance investigation and a new attestation, replacement artifact, or child manifest.

Final-59 artifact-integrity investigation: root cause `SELF_HASH_RECURSION_OR_EXCLUSION_MISMATCH`. The historical expected final-60 stop hash `c02ab8218f7d14ad1a6e799e1c2a5985e392c8b1b6bc6366d8476059ac0fdc89` is reproducible as `sha256(JSON.stringify(parsedJsonWithoutArtifactHash))` while retaining operational `manifestHash`. Raw-file hash remains `845eeecdb7cf85b937983f6fc8c45c6ba8d82ac38e5c22284861ab5c42eb3c46`. New canonical `atlas-json-v1` hash is `8255e23e1f46182c7c9b313e204706afc6e4a829f6757e691af529f425eaf620`. Historical semantic content changed: false. Production writes during the investigation: 0.

Integrity investigation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-artifact-integrity-investigation-final60-stop-d3ac20957b0a.json`, hash `d3ac20957b0a219952761c6369ed734d1f3cc31d158cedbb52d0d7c70ce17167`.

Integrity attestation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final60-stop-integrity-attestation-3384ab1eccea.json`, hash `3384ab1ecceaf84e79abbb6f9e4a246c6b75b5dfb2d75cecdbb44722f99f0898`.

Prepared but not executed integrity-corrected final-59 child manifest: `lead-tracking/atlas-deals/manifests/atlas-final-59-integrity-corrected-20260729-c06d046a3efa.json`, hash `c06d046a3efa9c4b2fd7f3a3b33288c52b5988043371d936c1450e6c8f7883e4`, row count 59. Do not execute without fresh owner approval.

Corrected final-59 prewrite identity-stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-59-corrected-prewrite-stop-identity-c56ac131f020.json`, hash `c56ac131f020081a409cc393aaaf6776bbc538601d92b75376751e380c78a31b`. Rows attempted: 0. Rows completed: 0. Production writes: 0. Identity decision totals in scoped live preflight: `SAFE_CREATE` 56, `BLOCK_AMBIGUOUS_IDENTITY` 3. Blocked selected rows: `import-ready:230`, `import-ready:247`, `import-ready:273`.

Three-row identity review resolved `import-ready:230` and `import-ready:247` as safe contact reuse and kept `import-ready:273` blocked as `BLOCK_MULTIPLE_CONTACT_CANDIDATES`. Investigation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final59-identity-investigation-rows230-247-273-dcf85d5b81b0.json`, hash `dcf85d5b81b0727ceb4f865e372e754441c4fb53542b32581a6e2f7984811cf2`. Prepared but not executed 58-row child manifest: `lead-tracking/atlas-deals/manifests/atlas-final-58-after-row273-block-20260730-9180ab24d365.json`, hash `9180ab24d3655b22d764749929c15483edbd9e836224b5d4cd7406a1f09cba40`.

Authorized final-58 execution stopped before writes after all integrity, auth, identity-lock, and zero-write preflight gates passed because live GHL writes were disabled outside mock clients at that time. The canonical live adapter now exists and is tested, but final-58 remains unexecuted. `LIVE_MANIFEST` is still blocked until a successful canary artifact and fresh owner authorization exist. Stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-58-prewrite-stop-live-execution-disabled-10f71f488066.json`, hash `10f71f4880666b5a9bb7bbc17ec0652b85b1c93376385aa31f251162970cb907`. Rows attempted: 0. Rows completed: 0. Production writes: 0.

Latest live-execution adapter validation covered 129/129 fail-closed matrix cases against deterministic local HTTP stubs and the actual importer/live-client path. Live read-only validation passed with `AUTH_READY`, target locks, row 230/247 contact readback, known opportunity readback with custom fields, all 20 required opportunity field definitions visible, and target-pipeline pagination of 155 physical opportunities. Field contract artifact: `lead-tracking/atlas-deals/reconciliations/atlas-live-opportunity-field-contract-6c32d8b4c096.json`, hash `6c32d8b4c096ae6249c6d589233820ac362f4dcdb4b223ce7a75fa378d3b6d7d`. Synthetic canary is not available because no existing internal `ATLAS E2E CANARY` contact was found and creating one is not authorized. Canary selection artifact: `lead-tracking/atlas-deals/reconciliations/atlas-live-canary-selection-required-e0410e884a8f.json`, hash `e0410e884a8f557b8a77b1cd8c4479c9e7f89ff78934bb5da104515648878308`.

Fresh owner-approved row 230 LIVE_CANARY completed successfully. Manifest: `lead-tracking/atlas-deals/manifests/atlas-live-canary-row230-20260730-64efceffac46.json`, hash `64efceffac46e6f585f76b1790ba0456141cf7b82263e6c5b27dd710b5712cde`. Opportunity created: `iPQfs1bnZmJeAVRISQWa`. Reconciliation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-live-canary-row230-passed-57e800b84cff.json`, hash `57e800b84cfff6049bbf0ddef14cface0643da1e18e6af2acf1024df3e6ccb0e`. Rows attempted: 1. Rows completed: 1. Contacts created: 0. Contacts reused: 1. Opportunities created: 1. Outreach side-effect counters: 0. Remaining rows were not executed.

The controlled final-57 LIVE_MANIFEST attempt created immutable child manifest `lead-tracking/atlas-deals/manifests/atlas-final-57-after-row230-canary-20260730-474008f199e6.json`, hash `474008f199e68ee994af10b5257ff258efd571812fbf76c9b7765c7524cd6523`, then stopped before writes. Failed pre-write gate: canary row marker did not resolve exactly once through the batch preflight marker-resolution check, although the canary opportunity exists by ID. Stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-live-import-final-fifty-seven-stopped-prewrite-failure-47410948b586.json`, hash `47410948b586fb727a5f6db6a702571ba3657f9e0427439358497b8d418e9445`. Rows attempted: 0. Rows completed: 0. Additional production writes: 0. Remaining executable rows: 57.

The canary marker-resolution gate was repaired without mutation. Root cause: live `/opportunities/search` list rows do not reliably include opportunity custom fields, while direct `GET /opportunities/{id}` exposes the markers. The canonical verifier now validates the immutable canary reconciliation hash, direct canary readback, marker/lock values, then hydrates the full target pipeline by direct readback and requires exactly one durable canary match. Zero-write final-57 preflight passed for the existing child manifest. Preflight artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-live-import-preflight-passed-1da4dff25908.json`, hash `1da4dff259080070d0d01f2a85800b878fc7f23a9d67860351896cadce2d0351`. Production writes during repair: 0. Final-57 import has not executed.

The approved final-57 LIVE_MANIFEST execution stopped on the first row, `import-ready:4`, after contact creation and before opportunity creation. Stop reason: contact readback verification failed. Confirmed partial contact from read-only lookup: `tSehK0gTq7PpovzRtTdF` (`Nestor Nemecio Mora`, `listhub@exprealty.com`, `+18885197431`, source `atlas_guarded_importer`). Stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-live-import-final-fifty-seven-failed-readback-579e7f6d0046.json`, hash `579e7f6d0046c9861fba1af34ed979b98f5aa65a2ff0031c22b0df51513975f5`. Rows attempted: 1. Rows completed: 0. Contacts created: 1. Opportunities created: 0. Remaining rows were not executed. No retry, deletion, or resume was performed.

Read-only investigation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-row4-readonly-investigation-d1d1c078aa19.json`, hash `d1d1c078aa19772a8e110ca62bc10ce3b519f6bbab5b772cd1d8321ee4ca809f`. Root cause confirmed: `verifyContact` required strict normalized phone equality and rejected expected `8885197431` versus GHL readback `+18885197431`; email, source, tags, and no-property-data checks passed. Local verifier has been fixed to use the existing country-code-tolerant phone equivalence helper. Targeted tests passed: importer `95 passed, 0 failed`; live client matrix `20 passed`, `129/129` cases. Final-57 remains blocked pending fresh owner approval for any resume/retry plan.

Fresh owner-approved row-4 recovery completed exactly one missing opportunity by reusing partial contact `tSehK0gTq7PpovzRtTdF`. No contact create/update/delete occurred. Opportunity created: `sjFaJIiWBXdIsjfakhdt`. Recovery artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-row4-recovery-passed-d0c7fee197b6.json`, hash `d0c7fee197b611090bf591dff97aee2149a2f197c864961346eb64210acb0854`. Preflight artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-row4-recovery-passed-a2ffd55cbc05.json`, hash `a2ffd55cbc057cf2d6585813ba40ea9583afe6f37a19defa3b16eb64c633278d`. Result token: `FINAL_57_ROW4_RECOVERY_PASSED_AWAITING_RESUME_APPROVAL`. Rows attempted: 1. Rows completed: 1. Contacts created: 0. Contacts reused: 1. Opportunities created: 1. Side-effect counters: 0. Contact before/after matched. All populated custom fields reconciled. Completed before recovery: `import-ready:230`. Remaining uncompleted final-57 rows: 56. No other row executed and outreach remained disabled.

Fresh owner-approved final-56 resume preflight passed zero-write gates for immutable manifest `lead-tracking/atlas-deals/manifests/atlas-final-56-after-row4-recovery-20260730-609a9ecd52b5.json`, hash `609a9ecd52b569ac40bbce9dfa00146969ac35d4d2b99b5415f4918985e5e60b`. Preflight artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-56-resume-import-preflight-passed-57824cb96650.json`, hash `57824cb96650c2bb21cfeef3e8b87be348560d0074680e3df78054bb7feee11f`. Live execution completed `import-ready:18` then stopped at `import-ready:24` with result `FINAL_FIFTY_SIX_RESUME_FAILED_DUPLICATE_RECORD`. Stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-56-resume-import-final-fifty-six-resume-failed-duplicate-record-fa96c8ded4c8.json`, hash `fa96c8ded4c8462b7cfc752986ea0e8af887dc40526e94aaa055ccc149378bc5`. Completed row 18 contact: `RKy6CDV2mIIxfGxyCiUW`; opportunity: `7f4WdgVI73tFWQ5LPa8S`. Rows attempted: 1. Rows completed: 1. Contacts created: 1. Opportunities created: 1. Row 24 had no contact or opportunity write in this run. The duplicate stop was caused by the common final-56 batch marker matching the just-created row 18 opportunity during intra-run duplicate checks. No retry, skip, or continuation was performed. Current verified counts after row 18: Atlas-valid opportunities 151, physical target-pipeline opportunities 158, remaining executable rows 55.

Duplicate classifier repaired with zero production writes before execution. Shared batch, manifest hash, manifest marker, execution mode, source prefix, pipeline, stage, owner, seller name alone, city/state alone, house number alone, and insufficient street-only matches no longer independently establish duplication. Durable duplicate evidence now requires row/property-specific identity: source-row marker, source property ID, property fingerprint, sufficiently specific normalized address, exact address plus ZIP, same-row execution nonce, or verified returned opportunity ID. Repair artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-55-duplicate-rule-repair-9ecc8b68936a.json`, hash `9ecc8b68936ae7a1cddb40f3f591e11e6daa2d41fa4bba6418f549d307e48a36`. Final-55 manifest: `lead-tracking/atlas-deals/manifests/atlas-final-55-after-row18-completion-20260730-371c476d0b2f.json`, hash `371c476d0b2fb01ebbe4edd125fe8b2b27ab85d933a173f89d9409354a5891cc`. Final-55 zero-write preflight artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-55-resume-preflight-passed-df49ac519e93.json`, hash `df49ac519e939a8b0b3c6ab298a803792339501f7270d36de93b870e676f31ed`. Row 18 versus row 24 classification: `NO_DUPLICATE`. Row 247 identity: `VERIFIED` locked to `uK50fisyiqxNMnNyseMl`. Tests passed: duplicate classifier `22/22`, importer `95/95`, live client `20/20`, read-only client `27/27`, artifact hash `15/15`. Owner-approved final-55 live execution completed with reconciliation artifact `lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-passed-2e14a7cd6564.json`, hash `2e14a7cd65646bc15defd3500c9915284cd293e0f6f129d267ba842236a811b1`. Result: `FINAL_FIFTY_FIVE_RESUME_PASSED_ATLAS_IMPORT_COMPLETE`, rows attempted/completed 55/55, contacts created 54, contacts reused 1, opportunities created 55, outreach/side effects 0. Final counts: Atlas-valid 206, physical target-pipeline 213, remaining executable 0.

Final closeout audit passed read-only with 575 checks, 548 journal entries parsed, 213 hydrated target-pipeline opportunities, 206 Atlas-valid opportunities, remaining executable rows 0, and production writes during closeout 0. Blocked-row disposition artifact: `lead-tracking/atlas-deals/reconciliations/atlas-blocked-rows-69-217-273-final-disposition-eac14b494825.json`, hash `eac14b494825e050ccaffe8a8ad10bf41a685a9e7c0761002b861472ef7bb384`. Classifications: `import-ready:69` = `SOURCE_DATA_CONFLICT`; `import-ready:217` = `PERMANENT_IDENTITY_AMBIGUITY`; `import-ready:273` = `PERMANENT_IDENTITY_AMBIGUITY`. Master closeout artifact: `lead-tracking/atlas-deals/reconciliations/atlas-production-import-closeout-20260730-b969c160bb0b.json`, hash `b969c160bb0bc98b4e80c59808ada45c1e0c738b756660e079822594625804d8`. Reusable CLI: `ghl-automations/tools/atlas-import.js`.

## Current Clean Rollout Manifest

Path: `lead-tracking/atlas-deals/manifests/atlas-clean-rollout-20260729-532b0d1f34e1.json`

Hash: `532b0d1f34e10b502fe49aa2db7e7b2dae02bacbd82aa1d4bde039805ea5b91d`

Parent manifest hash: `7494e5af022c1c6c6ccfe5322705961d39b9d52abfcb7b3023959a8314252c1f`

Current executable clean eligible rows: 57, subject to fresh ledger verification and owner approval. The final-60 manifest `lead-tracking/atlas-deals/manifests/atlas-final-60-20260729-9c05b0e80e03.json` stopped at zero-write preflight due `import-ready:217` identity conflict. The final-59 execution attempt stopped before writes on a required artifact-hash gate; the corrected final-59 identity review later left `import-ready:273` blocked. Row `import-ready:230` completed as the one-row LIVE_CANARY and must not be re-executed.

## Canonical Path

`ghl-automations/tools/atlas-ghl-import.js` is the canonical CLI and `ghl-automations/modules/atlas-ghl-import.js` is the canonical importer module. `prolific-ghl-webhook/import-ghl-leads.js` is retired.

## Test Summary

Local test command:

`node ghl-automations/modules/_test_atlas_ghl_import.js`

`node ghl-automations/modules/_test_atlas_dedupe_unification.js`

`node --test "prolific-ghl-webhook/atlas-ghl-webhook-safety.test.js" "prolific-ghl-webhook/montelli-stage-map.test.js"`

Latest accepted full preflight: 272 rows checked, 247 READY, 25 blocked/existing, `AUTH_READY`, zero writes. READY-only manifest: `lead-tracking/atlas-deals/manifests/atlas-20260729-7494e5af022c.json`. Manifest hash: `7494e5af022c1c6c6ccfe5322705961d39b9d52abfcb7b3023959a8314252c1f`. Field map hash: `f3b3f867a0b3dbf7420c816fd007a23a69f137cd3b65abedcf3e0e15b20af5ae`. Source hash: `028fb019b0e70c695451ca3077df6269e72b1403d2a32a774eb6a5a24494e01b`.

The read-only client now caches identical paginated reads and backs off on `429` responses so live preflight does not hammer GHL.

## Live Work Remaining

- Do not resume the remaining portion of the stopped 75-row selection without explicit new owner approval and fresh preflight.
- Do not include `import-ready:69` in any future automatic batch until source identity is corrected and owner-approved remediation is complete.
- Do not start the final 60 clean rows without explicit new owner approval and fresh preflight.
- Do not execute the integrity-corrected final-59 child manifest without explicit new owner approval and fresh preflight.
- Do not execute final-58 in `LIVE_MANIFEST` mode until a successful `LIVE_CANARY` reconciliation artifact exists and fresh owner authorization names the exact manifest path and canonical hash.
- Owner selection of exactly one real final-58 row is required before `LIVE_CANARY`; synthetic canary remains blocked.
- Use a GHL-only execution path. The local `prolific-ghl-webhook/deploy-render.js` provisions `DATABASE_URL`, so it must not be used for Atlas imports.
- Before any additional import, rerun auth/source/field-map/manifest/target-lock checks and per-row duplicate/contact/payload/readback gates.
- Continue to document the conversation message-body endpoint `401` as an unresolved observability limitation.
