---
name: pipeline-tools
description: GHL Pipeline operations tools for Prolific Capital. Use when the owner asks about pipeline status, leads, opportunities, stages, or stage movement. ALL pipeline operations MUST use the dedicated pipeline tools (pipeline_read_opportunity, pipeline_search_opportunities, pipeline_list_stages, pipeline_move_stage, pipeline_current_state, etc.). NEVER use exec/PowerShell/curl to call the GHL API directly. The pipeline tools handle authentication, profile routing, and safety gates. NO direct SMS tool exists.
---

# Pipeline Tools — Prolific Capital GHL Operations

## CRITICAL: Use the Registered Pipeline Tools

You have access to dedicated pipeline tools registered in the OpenClaw gateway. These are the ONLY supported path for GHL pipeline operations. Do NOT use `exec`, PowerShell, or raw HTTP to call the GHL API.

### Available Pipeline Tools

| Tool | Purpose | Required Params |
|------|---------|----------------|
| `pipeline_read_opportunity` | Read a single opportunity by ID | profileId, opportunityId |
| `pipeline_search_opportunities` | Search opportunities by stage/contact/query | profileId, optional: stageId, contactId, query |
| `pipeline_list_stages` | List all stages for a profile | profileId |
| `pipeline_move_stage` | Move an opportunity to a target stage (OWNER ONLY) | profileId, opportunityId, targetStage |
| `pipeline_current_state` | Get current pipeline state | none |
| `pipeline_work_summary` | Get work priorities | none |
| `pipeline_stage_guidance` | Get Kayla stage guidance | stage (number) |
| `pipeline_kayla_script` | Get Kayla script for a stage | stage (number) |
| `pipeline_kill_switch` | Read kill switch state | none |
| `pipeline_pause` | Pause all outreach | none |
| `pipeline_dry_run` | Enable dry run mode | none |
| `pipeline_provider_status` | Get JustCall provider status | none |
| `pipeline_memory_provenance` | Get memory provenance | none |
| `pipeline_canary_candidates` | List canary candidates | none |
| `pipeline_canary_preview` | Create canary preview | records |
| `pipeline_canary_review` | Review canary plan | planId |
| `pipeline_canary_expire` | Expire canary plan | planId |
| `pipeline_canary_approve` | Approve canary plan | planId, itemNumbers |
| `pipeline_canary_execute` | Execute canary item (SENDS SMS) | planId, itemNumber |
| `pipeline_canary_reconcile` | Get canary reconciliation | planId |
| `pipeline_record_correction` | Record a correction | text, scope |
| `pipeline_session_status` | Get session status | none |

### Profile Selection

- "PPC", "PPC lead", "Inbound PPC", "Divinity Aligned PPC" → profileId: `PPC_EWA_BEACH`
- "Atlas", "Atlas lead", "Atlas Deals", "Montelli Atlas" → profileId: `ATLAS_OUTBOUND`
- For writes: profileId is REQUIRED. Never default to Atlas.
- For reads: use explicit profile from owner language.

### Critical Rules

1. **NEVER use exec/PowerShell/curl for GHL API calls.** Use the pipeline tools.
2. **NO DIRECT SMS TOOL EXISTS.** Production SMS requires canary plan + owner approval.
3. **PPC_EWA_BEACH** has 29 stages. **ATLAS_OUTBOUND** has 21 stages.
4. **Stage movement is OWNER-DIRECTED only.** Requires explicit owner authorization.
5. **Automatic outreach is BLOCKED** (CONSENT_NOT_VERIFIABLE for PPC).
6. **Answer naturally.** Use tools when relevant, answer conversationally otherwise.
