# Atlas GHL Production Import Runbook

## Scope

This runbook is GoHighLevel only. Do not use Neon, Divinity CRM, `/api/leads/import`, legacy dashboard storage, or external database idempotency.

## Canonical Command Flow

1. `node ghl-automations/tools/atlas-ghl-import.js preflight --verified-webhook-safety`
2. `node ghl-automations/tools/atlas-ghl-import.js manifest --verified-webhook-safety`
3. Verify the READY-only manifest before any execution approval.
4. Verify manifest hash, source hash, target IDs, field mapping, and webhook safety revision.
5. For future rollout work, use the clean rollout manifest and rerun every per-row gate before writing.

Current accepted manifest: `lead-tracking/atlas-deals/manifests/atlas-20260729-7494e5af022c.json`.

Current clean rollout manifest: `lead-tracking/atlas-deals/manifests/atlas-clean-rollout-20260729-532b0d1f34e1.json`.

Current clean rollout manifest hash: `532b0d1f34e10b502fe49aa2db7e7b2dae02bacbd82aa1d4bde039805ea5b91d`.

Current executable clean eligible rows: 0 after final-55 live execution completed. The final-60 manifest stopped during zero-write preflight at `import-ready:217` before production writes. The authorized final-59 execution attempt stopped before writes because the final-60 prewrite-stop artifact hash gate failed; the corrected final-59 identity review later left `import-ready:273` blocked. Row `import-ready:230` completed as the one-row LIVE_CANARY and must not be re-executed. Blocked rows remain `import-ready:69`, `import-ready:217`, and `import-ready:273`.

## NORMAL ATLAS IMPORT WORKFLOW

Use the reusable Atlas CLI for future batches. Do not rebuild one-off final-N scripts for routine imports.

Required source format:
- CSV with the canonical Atlas headers: `county`, `state`, `address`, `city`, `zip`, `listPrice`, `sqft`, `pricePerSqft`, `propertyType`, `ownership`, `status`, `leadTypes`, `listingAgent`, `agentEmail`, `agentPhone`, `brokerName`, `mlsUrl`, `ghlStatus`.
- Blank source fields must stay blank. Do not fabricate identity, property, or pricing values.
- Contact identity belongs only on contacts. Property identity, Atlas markers, pricing, MLS, and lead metadata belong only on opportunities.

Prepare the manifest:
- Run `node ghl-automations/tools/atlas-import.js prepare --source <path>`.
- The command is read-only and writes a preflight manifest under `lead-tracking/atlas-deals/manifests/`.
- The manifest records source checksum, target locks, auth state, row decisions, contact identity decisions, opportunity payloads, and canonical hash metadata.

Run read-only preflight:
- Run `node ghl-automations/tools/atlas-import.js preflight --manifest <path>`.
- The command hydrates GHL opportunities before custom-field conclusions because list/search payloads can omit custom fields.
- Preflight must return `ATLAS_IMPORT_PREFLIGHT_PASSED_ZERO_WRITE` with write count `0` before any live execution.

Review blocked rows:
- Rows with ambiguous identity, shared phones, generic emails without person-level proof, existing property matches, missing contact methods, source conflicts, or uncertain prior imports stay out of live manifests.
- Review blocked rows from source data, current contacts, current opportunities, source-row markers, source property IDs, fingerprints, exact addresses, normalized addresses, and prior investigation artifacts.
- If a row becomes `SAFE_AFTER_NEW_EVIDENCE`, create a separately reviewable recommendation. Do not execute it inside the closeout or review step.

Owner authorization:
- Any unmistakable owner instruction such as `execute`, `run live`, `proceed`, `continue`, or `finish the approved import` constitutes approval when the approved manifest and preflight artifact are unambiguous.
- Record the authorization text with the manifest path, manifest hash, row count, target locks, and expiration.
- Do not require a magic phrase unless an external legal or compliance contract requires one.

Start live execution:
- Run `node ghl-automations/tools/atlas-import.js execute --manifest <path> --live --authorize "<owner instruction>" --journal <journal-path>`.
- Live execution requires an immutable manifest, exact target locks, `--live`, and owner authorization text.
- Outreach is disabled and locked for Atlas imports.
- Completed rows and blocked rows must not be present in the live manifest.

Journal behavior:
- The journal records row prewrite, contact write, opportunity write, readback, and reconciliation transitions.
- Authorization tokens and secret headers must be redacted.
- Keep journals with the reconciliation artifacts when repository policy permits; otherwise preserve local paths and hashes.

Uncertain writes:
- Do not automatically retry uncertain writes.
- Do not skip a failed row and continue.
- Do not delete, merge, tag, or clean up records automatically.
- Safe recovery uses the journal plus durable row-specific identifiers: source-row marker, source property ID, property fingerprint, exact address plus ZIP, normalized address, or same-row execution nonce.
- Batch and manifest markers are audit metadata only and never independently establish duplication.

Reconciliation verification:
- Run `node ghl-automations/tools/atlas-import.js reconcile --artifact <path>`.
- Verify direct readback, target location, pipeline, initial stage, owner, contact before/after state, populated custom fields, Atlas source-row markers, fingerprints, and side-effect counters.
- SAFE_REUSE contacts are never updated.
- Property data on contacts is a failure.
- Unexpected stage movement is a failure.

Expected terminal statuses:
- `ATLAS_IMPORT_PREPARE_COMPLETE`
- `ATLAS_IMPORT_PREFLIGHT_PASSED_ZERO_WRITE`
- `ATLAS_IMPORT_EXECUTE_COMPLETE`
- `ATLAS_IMPORT_RECONCILE_PASSED`
- Historical final-55 completion: `FINAL_FIFTY_FIVE_RESUME_PASSED_ATLAS_IMPORT_COMPLETE`

Partial contact recovery:
- If contact creation succeeds and opportunity creation does not happen, stop.
- Read back the contact directly and verify identity with country-code-tolerant phone comparison.
- Confirm no property data was written to the contact.
- A future recovery manifest may reuse the partial contact only after fresh review and authorization.

Resume after a confirmed completed row:
- Exclude all completed source-row IDs from the child manifest.
- Prove the completed opportunity exists by direct readback and source-row marker uniqueness.
- Re-run read-only duplicate checks against hydrated opportunities.
- Never reuse a parent manifest that still contains completed rows.

Avoid rerunning completed rows:
- Completed rows must be excluded by source-row ID and by durable opportunity markers.
- The reusable workflow fails live validation when completed rows are named in the execution options.
- If a completed-row marker exists exactly once, treat the row as closed and non-executable.

Verify outreach remained disabled:
- Confirm side-effect counters for SMS, email, calls, voicemail, conversations, notes, tasks, workflows, campaigns, external CRM calls, and unexpected stage movement are zero.
- Continue recording `UNRESOLVED_MESSAGE_BODY_OBSERVABILITY_LIMITATION` because message-body endpoint inspection remains unavailable.

Artifacts to retain:
- Source checksum and prepared manifest.
- Zero-write preflight artifact.
- Owner authorization record.
- Execution journal.
- Reconciliation artifact.
- Blocked-row disposition artifact.
- Closeout artifact.
- Any canary, repair, recovery, or investigation artifacts that establish provenance.

Operator commands:
- `node ghl-automations/tools/atlas-import.js prepare --source <path>`
- `node ghl-automations/tools/atlas-import.js preflight --manifest <path>`
- `node ghl-automations/tools/atlas-import.js execute --manifest <path> --live --authorize "run live" --journal <journal-path>`
- `node ghl-automations/tools/atlas-import.js reconcile --artifact <path>`

## WHEN A NEW CANARY IS REQUIRED

A new canary is required after a material change:
- new GHL location
- new pipeline or stage
- new owner lock
- new opportunity field contract
- replacement live transport
- material identity-rule changes
- material duplicate-rule changes
- changed contact or opportunity API behavior
- changed outreach safeguards

A new canary is not required for a routine batch using the unchanged validated contract.

## OWNER AUTHORIZATION

Any unmistakable owner instruction such as `execute`, `run live`, `proceed`, `continue`, or `finish the approved import` is sufficient when the approved manifest path, manifest hash, target locks, and zero-write preflight artifact are unambiguous.

Do not require a magic phrase unless an external legal or compliance contract requires one.

## DAILY OPERATOR WORKFLOW

1. Place the source CSV in the approved Atlas intake folder.
2. Run `node ghl-automations/tools/atlas-import.js doctor`.
3. Run `node ghl-automations/tools/atlas-import.js prepare --source <path>`.
4. Review the source-validation summary and any generated `atlas-source-validation-<hash>.json` artifact.
5. Review exceptions with `node ghl-automations/tools/atlas-exceptions.js list` and `node ghl-automations/tools/atlas-exceptions.js show --row <row-id>`.
6. Run `node ghl-automations/tools/atlas-import.js preflight --manifest <path>`.
7. Review the approved immutable manifest, row counts, blocked rows, target locks, and hash.
8. Record plain-language owner authorization such as `run live` or `proceed with the approved manifest`.
9. Run `node ghl-automations/tools/atlas-import.js execute --manifest <path> --live --authorize "run live" --journal <journal-path>`.
10. Monitor the journal path printed by the command.
11. Reconcile with `node ghl-automations/tools/atlas-import.js reconcile --artifact <path>`.
12. Run `node ghl-automations/tools/atlas-import.js status`.
13. Retain source validation, manifest, preflight, authorization, journal, reconciliation, exception, and closeout artifacts.
14. Investigate exceptions separately; exception review never imports rows automatically.

## WHAT SHOULD NOT HAPPEN AGAIN

Routine imports must not require rebuilding the live adapter, reinventing artifact hashing, creating one-off final-N scripts, magic approval phrases, rerunning completed rows, using batch markers as duplicate identity, manually inspecting every successful row, broad test rewrites for unchanged behavior, deleting partial records as recovery, or automatic retry of uncertain writes.

## EXPECTED ROUTINE IMPORT TIME

- Source validation: automatic.
- Preflight: automatic.
- Manual review: blocked rows only.
- Execution: automatic and sequential.
- Reconciliation: automatic.
- Final review: summary and artifacts.

## Retired Paths

`prolific-ghl-webhook/import-ghl-leads.js` is retired with a hard stop because it wrote property-specific fields to reusable contacts.

## Production Rollout Gates

Atlas contact identity must be proven before any write. Shared phone numbers, generic brokerage emails, or matching contact channels cannot override a conflicting person name. Identity uncertainty always blocks before contact or opportunity creation. A missing optional contact identifier is not a conflict. A different non-empty identifier is a conflict. Preflight, execution, and reconciliation must use the same canonical identity decision.

Atlas artifact authorization uses one versioned canonical hashing implementation. Raw-file hashes are diagnostic only unless explicitly declared. Immutable artifacts and manifests are never edited to repair a hash mismatch. A mismatch requires provenance investigation and a new attestation, replacement artifact, or child manifest.

- The importer auth gate must return `AUTH_READY`. `AUTH_TOKEN_MALFORMED`, `AUTH_REVOKED_OR_INVALID`, `AUTH_CONTACT_SCOPE_MISSING`, `AUTH_OPPORTUNITY_SCOPE_MISSING`, `AUTH_CUSTOM_FIELD_SCOPE_MISSING`, and `AUTH_WRONG_LOCATION` are hard stops.
- One canonical write path remains: `ghl-automations/modules/atlas-ghl-live-client.js`.
- Legacy importer hard-stops before network access.
- All tests pass.
- Contact payload contains no property-specific data.
- Opportunity payload contains property identity and Atlas markers.
- Live GHL opportunity custom field mapping is verified.
- Full 272-row live read-only preflight completes with zero writes.
- READY-only manifest is generated and hashed.
- Row remains clean-eligible immediately before write and is not completed, malformed/questionable, or original preflight-blocked.
- Webhook marked-import branches remain side-effect-free.
- Live execution modes are explicit: `READ_ONLY_PREFLIGHT`, `LIVE_CANARY`, and `LIVE_MANIFEST`. `LIVE_MANIFEST` requires a successful canary artifact and fresh owner authorization; environment variables alone do not authorize writes.
- Latest adapter validation covered 129/129 fail-closed matrix cases against deterministic local HTTP stubs and the actual importer/live-client path. Live read-only validation passed with `AUTH_READY`, target locks, approved contact readback for rows 230/247, opportunity custom-field readback, and no mutations.
- Synthetic canary is blocked because no existing internal `ATLAS E2E CANARY` contact exists and creating one is not authorized. Owner must select one real final-58 row for `LIVE_CANARY` using `lead-tracking/atlas-deals/reconciliations/atlas-live-canary-selection-required-e0410e884a8f.json`.

## Rollback

Rollback by disabling the import command and using the previous deployed revision if needed. No remaining-row rollout or stopped-selection resumption may run until the user gives explicit new approval and fresh preflight passes.

## Verified Production Results

Completed imports:
- one-row canary
- three-row reuse batch
- twenty-row controlled batch
- fifty-row controlled batch
- stopped partial 75-row attempt: 22 reconciled opportunity imports before contact conflict stop
- stopped partial 53-row resume attempt: 46 reconciled opportunity imports before reused-contact readback stop
- completed 7-row resume batch
- completed final-55 live import: 55 reconciled opportunity imports

Physical GHL opportunities imported so far: 206 Atlas-valid opportunities, plus 7 unrelated target-pipeline opportunities observed during reconciliation

Fully reconciled valid opportunities: 206

Remediation-required opportunities: 0

Total contacts created so far: 171

Total contact reuse decisions: 38

Remaining executable clean unimported rows: 0 after final-55 live execution. The final-60 prewrite attempt produced 0 writes. The final-59 execution attempt produced 0 writes. The row 230 LIVE_CANARY produced 1 reconciled opportunity write. Final-55 produced 55 reconciled opportunity writes.

Blocked malformed/questionable rows: 38

Original preflight-blocked rows: 25

Observed results:
- property fields on contacts: 0
- duplicate prewrite failures: 0
- possible property matches accepted: 0
- field readback failures: 0
- notes: 0
- SMS: 0
- email: 0
- calls: 0
- unexpected stage movement: 0
- dashboard mutations: 0
- external CRM calls: 0

The conversation message-body endpoint returns `401`; treat message-body inspection as an unresolved observability limitation.

`import-ready:69` is blocked for contact identity conflict/source identity defect. Its incorrectly linked opportunity `vEgDkrQJQzEhK4KHeg2J` was deleted by explicit remediation approval; the row remains blocked until corrected source identity is supplied and re-preflighted. Contact conflicts must never be skipped or guessed. The remaining portion of the stopped 75-row selection cannot resume without new explicit approval and fresh preflight.

The 53-row resume attempt stopped at `import-ready:167` after 46 successful/reconciled opportunity imports. Enhanced reconciliation confirmed `import-ready:167` reused existing contact `posNusrN3UsDV7Gncg2v` for readback only and produced no contact write, no opportunity write, and no orphaned record. The root cause was a reused-contact readback rule that treated an absent optional email as a conflict. The corrected canonical rule permits reuse when normalized person name and direct phone agree, existing email is absent, and no non-empty identifier conflicts. The child resume manifest `lead-tracking/atlas-deals/manifests/atlas-7-resume-after-row167-20260729-e1910241de64.json` completed successfully. Reconciliation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-7-resume-after-row167-20260729-reconciliation-fa8c6abdbac2.json`.

The final-60 manifest `lead-tracking/atlas-deals/manifests/atlas-final-60-20260729-9c05b0e80e03.json` was generated with hash `9c05b0e80e03d8172379b22651fa4bf1a23edf9fba42ff85824c4eb4fb75650d`, then stopped during zero-write preflight before any production write. Stopped row: `import-ready:217`. Investigation proved source email `contact@beycome.com` is a generic company inbox and not a person-level email conflict by itself. The row remains blocked because GHL has multiple contacts on the same phone: `qY89ZfUrPowQ9GfpsdRW` (`Steven Koleno`, `steve@beycome.com`) and `x5ul9LVmA0VfovTXiLIT` (`Steven Kelono`, `contact@beycome.com`). Final investigation classification: `MULTIPLE_CONTACT_IDENTITY_CONFLICT`; canonical decision after hardening: `BLOCK_SHARED_PHONE`, reason `SHARED_PHONE`. Prewrite stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-60-20260729-prewrite-stop-c02ab8218f7d.json`. Investigation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-import-ready-217-identity-investigation-6468abbb5d2c.json`. Prepared but not executed 59-row child manifest: `lead-tracking/atlas-deals/manifests/atlas-final-59-after-row217-block-20260729-9fc44ddfd2cf.json`. Do not execute it without fresh owner approval.

The authorized final-59 execution attempt on `lead-tracking/atlas-deals/manifests/atlas-final-59-after-row217-block-20260729-9fc44ddfd2cf.json` stopped before writes. Successful gates before the stop: exact manifest path, canonical manifest hash, 59 unique source row IDs, `import-ready:69` absent, `import-ready:217` absent, source hash, field-map hash, parent final-60 manifest canonical hash, and row-217 investigation artifact canonical hash. Failed gate: final-60 prewrite-stop artifact hash. Expected `c02ab8218f7d14ad1a6e799e1c2a5985e392c8b1b6bc6366d8476059ac0fdc89`; observed raw file hash `845eeecdb7cf85b937983f6fc8c45c6ba8d82ac38e5c22284861ab5c42eb3c46`; observed canonical no-self-hash `45537a4881510b4f0c87d911c9e9320cb9bb2e21a71ce860e33c6537a4d5dc92`. Reconciliation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-59-20260729-prewrite-stop-artifact-hash-gate.json`. Rows attempted: 0. Rows completed: 0. Production writes: 0.

Artifact-integrity investigation resolved the stop as `SELF_HASH_RECURSION_OR_EXCLUSION_MISMATCH`. The expected `c02ab8218f7d14ad1a6e799e1c2a5985e392c8b1b6bc6366d8476059ac0fdc89` is the legacy compact JSON hash after excluding only the self-referential `artifactHash`; operational `manifestHash` must remain included. New canonical standard: `atlas-json-v1`, using `ghl-automations/modules/atlas-artifact-hash.js`, removes only `canonicalHash`, `artifactHash`, and `selfHash`, recursively sorts object keys, preserves array order, serializes deterministic UTF-8 JSON, and hashes with SHA-256. Final-60 stop artifact `atlas-json-v1` hash: `8255e23e1f46182c7c9b313e204706afc6e4a829f6757e691af529f425eaf620`. Historical semantic content changed: false. Investigation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-artifact-integrity-investigation-final60-stop-d3ac20957b0a.json`, hash `d3ac20957b0a219952761c6369ed734d1f3cc31d158cedbb52d0d7c70ce17167`. Attestation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final60-stop-integrity-attestation-3384ab1eccea.json`, hash `3384ab1ecceaf84e79abbb6f9e4a246c6b75b5dfb2d75cecdbb44722f99f0898`. Prepared but not executed corrected child manifest: `lead-tracking/atlas-deals/manifests/atlas-final-59-integrity-corrected-20260729-c06d046a3efa.json`, hash `c06d046a3efa9c4b2fd7f3a3b33288c52b5988043371d936c1450e6c8f7883e4`, row count 59. Do not execute without fresh owner approval.

The authorized corrected final-59 execution attempt stopped before writes during scoped live zero-write preflight. Auth passed with `AUTH_READY`, target locks matched, selected row count was 59, selected row set matched the corrected manifest, and write count remained 0. Identity blockers were found on `import-ready:230`, `import-ready:247`, and `import-ready:273`, all `BLOCK_AMBIGUOUS_IDENTITY`. Identity totals: `SAFE_CREATE` 56, `BLOCK_AMBIGUOUS_IDENTITY` 3. Stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-59-corrected-prewrite-stop-identity-c56ac131f020.json`, hash `c56ac131f020081a409cc393aaaf6776bbc538601d92b75376751e380c78a31b`. Rows attempted: 0. Rows completed: 0. Production writes: 0. Do not create another child manifest or execute around these rows without fresh owner approval.

The three-row identity review resolved `import-ready:230` and `import-ready:247` as `SAFE_REUSE_NAME_PHONE`; both have exact normalized name, direct phone, and person-specific email matches to a single GHL contact. `import-ready:273` remains blocked as `BLOCK_MULTIPLE_CONTACT_CANDIDATES` because two same-name GHL person contacts exist and the source has no email plus a different phone. Investigation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final59-identity-investigation-rows230-247-273-dcf85d5b81b0.json`, hash `dcf85d5b81b0727ceb4f865e372e754441c4fb53542b32581a6e2f7984811cf2`. Prepared but not executed 58-row child manifest: `lead-tracking/atlas-deals/manifests/atlas-final-58-after-row273-block-20260730-9180ab24d365.json`, hash `9180ab24d3655b22d764749929c15483edbd9e836224b5d4cd7406a1f09cba40`. Do not execute without fresh owner approval.

The authorized final-58 execution attempt passed integrity gates, auth, row 230/247 contact locks, and zero-write preflight for all 58 rows, but stopped before writes because live GHL writes were disabled outside mock clients at that time. The canonical live adapter now exists and is tested, but final-58 remains unexecuted. `LIVE_MANIFEST` is still blocked until a successful canary artifact and fresh owner authorization exist. Stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-58-prewrite-stop-live-execution-disabled-10f71f488066.json`, hash `10f71f4880666b5a9bb7bbc17ec0652b85b1c93376385aa31f251162970cb907`. Rows attempted: 0. Rows completed: 0. Production writes: 0.

Adapter validation artifacts: field contract `lead-tracking/atlas-deals/reconciliations/atlas-live-opportunity-field-contract-6c32d8b4c096.json` (`6c32d8b4c096ae6249c6d589233820ac362f4dcdb4b223ce7a75fa378d3b6d7d`) and canary selection required `lead-tracking/atlas-deals/reconciliations/atlas-live-canary-selection-required-e0410e884a8f.json` (`e0410e884a8f557b8a77b1cd8c4479c9e7f89ff78934bb5da104515648878308`).

Row 230 LIVE_CANARY completed successfully and stopped after one row. Manifest: `lead-tracking/atlas-deals/manifests/atlas-live-canary-row230-20260730-64efceffac46.json`, hash `64efceffac46e6f585f76b1790ba0456141cf7b82263e6c5b27dd710b5712cde`. Reconciliation: `lead-tracking/atlas-deals/reconciliations/atlas-live-canary-row230-passed-57e800b84cff.json`, hash `57e800b84cfff6049bbf0ddef14cface0643da1e18e6af2acf1024df3e6ccb0e`. Opportunity `iPQfs1bnZmJeAVRISQWa` was created for locked contact `5cr6syq8vznKer8MhHgk`; contacts created/updated: 0; outreach side effects: 0. Remaining 57 rows require fresh owner approval.

Controlled final-57 LIVE_MANIFEST attempt stopped before writes. Child manifest: `lead-tracking/atlas-deals/manifests/atlas-final-57-after-row230-canary-20260730-474008f199e6.json`, hash `474008f199e68ee994af10b5257ff258efd571812fbf76c9b7765c7524cd6523`. Stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-live-import-final-fifty-seven-stopped-prewrite-failure-47410948b586.json`, hash `47410948b586fb727a5f6db6a702571ba3657f9e0427439358497b8d418e9445`. Stop reason: canary row marker did not resolve exactly once through the pre-write marker-resolution gate. Rows attempted: 0. Rows completed: 0. Additional production writes: 0.

Canary marker-resolution repair completed with zero production writes. The marker is stored on opportunity custom field ID `bNUaLqPpKB2IY7nMx1Gh` with value `import-ready:230`; the failure came from relying on unhydrated `/opportunities/search` list payloads that omit custom-field values. Canonical proof now uses immutable reconciliation hash verification, direct canary opportunity readback, and full-pipeline hydrated uniqueness scanning. Final-57 zero-write preflight passed for existing child manifest `lead-tracking/atlas-deals/manifests/atlas-final-57-after-row230-canary-20260730-474008f199e6.json`. Preflight artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-live-import-preflight-passed-1da4dff25908.json`, hash `1da4dff259080070d0d01f2a85800b878fc7f23a9d67860351896cadce2d0351`.

Approved final-57 LIVE_MANIFEST execution stopped at `import-ready:4` after creating contact `tSehK0gTq7PpovzRtTdF` and before creating any opportunity. Stop reason: contact readback verification failed. Stop artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-live-import-final-fifty-seven-failed-readback-579e7f6d0046.json`, hash `579e7f6d0046c9861fba1af34ed979b98f5aa65a2ff0031c22b0df51513975f5`. Rows attempted: 1. Rows completed: 0. Contacts created: 1. Opportunities created: 0. Remaining rows were not executed. Do not resume, retry, or delete without fresh owner review and approval.

Row-4 read-only investigation artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-row4-readonly-investigation-d1d1c078aa19.json`, hash `d1d1c078aa19772a8e110ca62bc10ce3b519f6bbab5b772cd1d8321ee4ca809f`. Cause: strict verifier phone comparison did not accept GHL's `+1` country-code normalization. Local verifier now uses country-code-tolerant matching and targeted local tests pass. Operational block remains: do not resume final-57 without fresh owner approval that explicitly accounts for existing partial contact `tSehK0gTq7PpovzRtTdF`.

Row-4 controlled recovery completed under fresh owner authorization. The recovery reused existing contact `tSehK0gTq7PpovzRtTdF` and created exactly one opportunity, `sjFaJIiWBXdIsjfakhdt`, then stopped. Recovery artifact: `lead-tracking/atlas-deals/reconciliations/atlas-final-57-row4-recovery-passed-d0c7fee197b6.json`, hash `d0c7fee197b611090bf591dff97aee2149a2f197c864961346eb64210acb0854`. Result token: `FINAL_57_ROW4_RECOVERY_PASSED_AWAITING_RESUME_APPROVAL`. Do not resume the remaining 56 final-57 rows without fresh approval and a new controlled plan.

Final-56 resume manifest was created and zero-write preflight passed: `lead-tracking/atlas-deals/manifests/atlas-final-56-after-row4-recovery-20260730-609a9ecd52b5.json`, hash `609a9ecd52b569ac40bbce9dfa00146969ac35d4d2b99b5415f4918985e5e60b`; preflight artifact `lead-tracking/atlas-deals/reconciliations/atlas-final-56-resume-import-preflight-passed-57824cb96650.json`, hash `57824cb96650c2bb21cfeef3e8b87be348560d0074680e3df78054bb7feee11f`. Execution completed `import-ready:18` only, creating contact `RKy6CDV2mIIxfGxyCiUW` and opportunity `7f4WdgVI73tFWQ5LPa8S`, then stopped before row 24 writes with `FINAL_FIFTY_SIX_RESUME_FAILED_DUPLICATE_RECORD`. Stop artifact `lead-tracking/atlas-deals/reconciliations/atlas-final-56-resume-import-final-fifty-six-resume-failed-duplicate-record-fa96c8ded4c8.json`, hash `fa96c8ded4c8462b7cfc752986ea0e8af887dc40526e94aaa055ccc149378bc5`. Do not continue the remaining 55 rows without fresh approval and a corrected controlled plan.

Final-55 duplicate-rule repair, zero-write preflight, and owner-approved live execution completed. Repair artifact `lead-tracking/atlas-deals/reconciliations/atlas-final-55-duplicate-rule-repair-9ecc8b68936a.json`, hash `9ecc8b68936ae7a1cddb40f3f591e11e6daa2d41fa4bba6418f549d307e48a36`. Resume manifest `lead-tracking/atlas-deals/manifests/atlas-final-55-after-row18-completion-20260730-371c476d0b2f.json`, hash `371c476d0b2fb01ebbe4edd125fe8b2b27ab85d933a173f89d9409354a5891cc`. Preflight artifact `lead-tracking/atlas-deals/reconciliations/atlas-final-55-resume-preflight-passed-df49ac519e93.json`, hash `df49ac519e939a8b0b3c6ab298a803792339501f7270d36de93b870e676f31ed`. Live reconciliation artifact `lead-tracking/atlas-deals/reconciliations/atlas-final-55-live-import-passed-2e14a7cd6564.json`, hash `2e14a7cd65646bc15defd3500c9915284cd293e0f6f129d267ba842236a811b1`. Result: `FINAL_FIFTY_FIVE_RESUME_PASSED_ATLAS_IMPORT_COMPLETE`, rows attempted/completed 55/55, contacts created 54, contacts reused 1, opportunities created 55, outreach/side effects 0, remaining executable rows 0.

Final closeout artifacts: blocked-row disposition `lead-tracking/atlas-deals/reconciliations/atlas-blocked-rows-69-217-273-final-disposition-eac14b494825.json` (`eac14b494825e050ccaffe8a8ad10bf41a685a9e7c0761002b861472ef7bb384`) and master closeout `lead-tracking/atlas-deals/reconciliations/atlas-production-import-closeout-20260730-b969c160bb0b.json` (`b969c160bb0bc98b4e80c59808ada45c1e0c738b756660e079822594625804d8`). Closeout production writes: 0. Outreach remained disabled.
