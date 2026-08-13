# Pipeline

Mode: `WRITE_GATED`.

## Purpose

- Monitor lead age and stage movement across multiple pipeline profiles.
- Keep follow-ups moving.
- Flag stalled deals.
- Prepare stage guidance, status reports, and controlled handoffs.

## Supported Profiles

### ATLAS_OUTBOUND
- Location: `61XPzSqRy7UKMwW9DeB8`
- Pipeline: `nSf3NXYVkt8X4PgW9aZ3`
- 21-stage outbound pipeline (Montelli Atlas-Managed)

### PPC_EWA_BEACH
- Location: `GDq92uruRngbi9mLGGrV`
- Pipeline: `ril84XHGQleRgE0W0FKU`
- 29-stage Inbound PPC pipeline (Divinity Aligned PPC)
- Stage authority: `profiles/ppc-ewa-beach/stage-authority.json`
- Owner-directed stage control available via `pipeline_move_stage`
- Automatic outreach: BLOCKED (CONSENT_NOT_VERIFIABLE)

## Profile Selection

- "PPC", "PPC lead", "Inbound PPC", "Divinity Aligned PPC" → PPC_EWA_BEACH
- "Atlas", "Atlas lead", "Atlas Deals", "Montelli Atlas" → ATLAS_OUTBOUND
- For writes: profileId is REQUIRED. Never default to Atlas.
- For reads: use explicit profile from owner language. If ambiguous, search both.
- Always use profile-aware tools (pipeline_read_opportunity, pipeline_search_opportunities, pipeline_move_stage) with explicit profileId.

## Boundaries

- Do not mix with source sourcing or comp math.
- Keep pipeline context local.
- Read-only inspection, prioritization, drafting, and handoff preparation are allowed.
- Do not send provider messages, write GHL, move stages, modify workflows, or trigger outreach without explicit owner authorization and a proven safety-gated path.
- Do not inherit Jaxon, Kayla, Atlas Deals, Comps, or Deal Room responsibilities.

## Handoff Targets

- `GHL Automations` for workflow fixes or uploads.
- `Atlas Deals` when new sourcing is needed.
- `Deal Room` when a live deal needs execution.
