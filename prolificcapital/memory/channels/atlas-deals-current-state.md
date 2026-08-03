# Atlas Deals Current State

Verified: 2026-08-03

This is the authoritative operational inventory for Ai Rei Topic 769. Load it with
`memory/channels/atlas-deals.md` before answering any Atlas status, capability, todo, or
replacement question. Searchable memory can add detail, but it does not supersede this file.

## Identity and mission

Atlas Deals owns the deal-sourcing lifecycle from saved-search discovery through a controlled
handoff of qualified, tracked leads. Its responsibilities are sourcing, export, source/address
tracking, enrichment, qualification, safe batch preparation, and explicit handoffs. Comps owns
valuation analysis, Pipeline owns lifecycle follow-up, Deal Room owns active-deal execution, and
GHL writes remain separately authorized and safety-gated.

## Existing systems

### PropWire saved-search sourcing

- Historical saved-search evidence:
  `tmp/propwire-saved-searches-reverify-29-2026-07-23.json` and
  `tmp/propwire-creative-financing-lists-2026-07-23.json`.
- Inputs: visible authenticated PropWire saved searches and Creative Financing filters.
- Outputs: saved-search result extracts and raw county CSVs under
  `lead-tracking/atlas-deals/raw-scraped/`.
- Completed evidence: local saved-search exports and raw files exist.
- Current status: partial and historical. Current login, search availability, result counts,
  credits, and DataDome behavior have not been reverified without a live browser action.
- Reusable: the visible-browser sourcing approach is reusable, but no single canonical browser
  command currently reproduces every saved-search export.

### Resume exporter

- Script: `lead-tracking/atlas-deals/scraper-resume.js`.
- Invocation from the workspace root:
  `node lead-tracking/atlas-deals/scraper-resume.js`.
- Inputs: `lead-tracking/atlas-deals/raw-scraped/<county>-<state>.csv`,
  `scraper-progress.json`, and `agent-progress.json`.
- Output: `lead-tracking/atlas-deals/agent-leads.csv`.
- Successful completion: the existing export contains 272 PropWire lead rows.
- Reusable status: lead export is working and reusable as an existing system. Before another
  run, validate its checkpoint and raw-input coverage. The retained progress file currently uses
  `done` while the script reads `completed`, and only four of nine raw county files remain, so do
  not blindly rerun it or imply the current raw files can reconstruct all 272 rows.
- Important distinction: `scraper-resume.js` assembles saved-search raw CSVs; it is not itself the
  visible-browser extractor.

### 272-lead export

- Output: `lead-tracking/atlas-deals/agent-leads.csv`.
- Verified local count: 272 data rows.
- Verified quality: 271 rows have an address; one malformed Fulton row lacks an address and other
  identity fields. Listing-agent/contact and MLS URL fields are populated for most, not all, rows.
- Evidence: the file exists locally; its recorded SHA-256 begins `8077560f6bd5`, matching the
  Atlas read-validation documentation.
- Current status: completed output with a known quality exception.
- Reusable: yes, after excluding or correcting malformed rows and applying fresh validation.

### Detail URL enrichment

- Script: `lead-tracking/atlas-deals/add-detail-urls.mjs`.
- Invocation from the workspace root:
  `node lead-tracking/atlas-deals/add-detail-urls.mjs`.
- Input: `lead-tracking/atlas-deals/agent-leads.csv`.
- Output: `lead-tracking/atlas-deals/agent-leads-with-detail-urls.csv`.
- Successful completion: the output contains 272 rows; 250 rows have a nonblank detail URL
  derived from an MLS listing URL.
- Current status: completed enrichment file with missing URLs where source MLS URLs were absent.
- Reusable: yes for the same CSV schema.

### Numeric equity extraction

- Preserved attempts:
  `scrape-property-equity.mjs`, `scrape-equity-real-chrome.mjs`,
  `scrape-equity-fetch.mjs`, `scrape-equity-listview.mjs`, `scrape-equity-final.mjs`,
  `scrape-equity-zillow.mjs`, and `scrape-equity-redfin.mjs` under
  `lead-tracking/atlas-deals/`.
- Inputs: the 272-lead export, detail URLs, visible or CDP browser state, and attempted public
  fallback sources.
- Outputs: `property-equity-*.csv`, `equity-*-progress.json`, and `equity-*-log.txt`.
- Verified result: no reliable batch of numeric property value, mortgage balance, equity, and
  equity percentage was produced.
- Current blocker: PropWire detail-page automation encounters DataDome/captcha protection;
  Zillow and Redfin fallbacks did not produce a reliable equivalent batch.
- Reusable: scripts and logs are diagnostic evidence, not a production numeric-equity system.

Lead export is working and reusable.
Only automated numeric-equity extraction from detail pages is blocked.
The blocker does not invalidate or replace the existing export pipeline.

### Skip tracing

- Candidate scripts include `tmp/propwire-extract-and-skiptrace.mjs` and
  `research/test_skip_trace.js`.
- No successful Atlas owner skip-trace export or completion artifact was verified.
- Listing-agent phone/email values in `agent-leads.csv` are not proof of owner skip tracing.
- Current status: not verified as completed; provider credits and current live behavior are
  unknown. On-market leads may require listing-agent handling rather than seller skip tracing.
- Reusable: no production-safe reusable skip-trace workflow is currently verified.

### Buy-box qualification

- Authority: `memory/MONTELLI_BUY_BOX.md` and `research/propwire-search-strategy.md`.
- Inputs: property/source facts, price, geography, condition, equity, beds, HOA, pool, flood, and
  population evidence.
- Evidence: manual qualification notes exist, including `memory/atlas-deals-hyper-qualified.md`.
- Current status: partial. The 272-row export does not contain enough evidence to prove complete
  buy-box qualification for every row, especially numeric equity and several property-risk fields.
- Reusable: the criteria are reusable; a complete automated qualification pipeline is not
  verified.

### Deduplication, tracking, and controlled batch preparation

- Canonical CLI: `ghl-automations/tools/atlas-import.js`.
- Safe commands:
  - `node ghl-automations/tools/atlas-import.js prepare --source <path>`
  - `node ghl-automations/tools/atlas-import.js preflight --manifest <path>`
  - `node ghl-automations/tools/atlas-import.js reconcile --artifact <path>`
- Live execution exists but remains WRITE_GATED and requires explicit owner authorization plus
  the existing manifest, canary, identity, and safety gates.
- Inputs: prepared source CSV, field map, identity evidence, manifests, and read-only preflight.
- Outputs: immutable manifests, journals, reconciliations, opportunity tracking fields, and the
  current exception queue.
- Completed evidence: `docs/releases/atlas-ghl-production-import-2026-07-30.md` and
  `lead-tracking/atlas-deals/reconciliations/atlas-production-import-closeout-20260730-b969c160bb0b.json`.
- Verified closeout: 206 Atlas-valid opportunities, 213 physical target-pipeline opportunities,
  zero remaining executable rows, and zero unauthorized outreach side effects.
- Current exceptions: `import-ready:69`, `import-ready:217`, and `import-ready:273`; see
  `lead-tracking/atlas-deals/reports/atlas-exception-queue-current.md`.
- Reusable: yes, through the canonical CLI and its safety gates. Legacy dedup/upload scripts are
  not the authority.

### Handoff workflow

- Contract: `memory/channels/ai-rei-handoffs.md`.
- Historical ledger/template: `research/atlas-deals-handoff-ledger-2026-07-22.md`.
- Current status: handoff roles and templates exist, but no complete row-level handoff ledger for
  all 272 source rows was verified.
- Reusable: the handoff structure is reusable; execution completeness is partial.

## Completed work

- Built and used the saved-search lead-export system represented by `scraper-resume.js`.
- Produced `agent-leads.csv` with 272 PropWire lead rows.
- Produced `agent-leads-with-detail-urls.csv` with 272 rows and 250 nonblank detail URLs.
- Preserved source, address, status, listing-agent, and source URL fields where available.
- Built the guarded Atlas import CLI, immutable manifests, journals, and reconciliation chain.
- Completed the approved production import closeout with 206 Atlas-valid opportunities and no
  remaining executable rows.
- Preserved three blocked source rows in an explicit exception queue rather than forcing unsafe
  identity matches.

## In-progress or partial work

- Revalidating live PropWire saved searches and retaining a canonical browser export command.
- Repairing or normalizing the resume checkpoint schema before another exporter run.
- Filling 22 missing detail URLs and correcting the malformed blank-address source row.
- Completing evidence-backed buy-box qualification for the full source set.
- Establishing a complete row-level handoff ledger.
- Resolving the three source/identity exceptions if new source-backed evidence becomes available.

## Blocked work

- Automated batch numeric-equity extraction from PropWire detail pages is blocked by
  DataDome/captcha behavior.
- Existing Zillow and Redfin fallback attempts did not produce a reliable replacement batch.
- Current live PropWire state, credits, and captcha behavior are unknown until explicitly
  reverified; do not claim historical blockers are current without checking.

## Not verified as started or completed

- A successful owner skip-trace batch for the 272 leads.
- Complete automated buy-box qualification for all 272 rows.
- A reliable non-PropWire numeric-equity source integrated into the batch workflow.
- Complete row-level downstream handoff evidence for every source row.

## Required reasoning order

Before answering "what remains," "what can you do," "what have you built," or any equivalent
status question:

1. Load `memory/channels/atlas-deals.md`.
2. Load `memory/channels/atlas-deals-current-state.md`.
3. Check repository or file evidence for every named system or output relevant to the answer.
4. Separate completed/reusable, partial, blocked, and not-started or unverified work.
5. Never describe one blocked stage as if the entire pipeline is blocked.
6. Never propose a replacement before naming the working existing system and its limitations.
7. State uncertainty when current or live evidence is incomplete.
8. For the 272-lead workflow, mention the working exporter and outputs before the numeric-equity
   blocker.

## Operational checklist

| Stage | Current implementation status |
| --- | --- |
| saved-search sourcing | Partial/historical: exports exist; current live searches are unverified |
| lead export | Completed: 272-row `agent-leads.csv`; exporter reuse requires checkpoint/input validation |
| deduplication/tracking | Completed for the approved guarded-import closeout; canonical CLI is reusable |
| detail URL enrichment | Completed file: 272 rows, 250 nonblank detail URLs |
| equity/value enrichment | Blocked for reliable automated numeric batch extraction |
| skip tracing | Not verified as completed for the 272-lead set |
| buy-box qualification | Partial; full 272-row evidence is incomplete |
| controlled batch preparation | Completed for the approved import closeout; future live use is WRITE_GATED |
| handoff | Partial; roles/templates exist, complete row-level evidence was not verified |

## Actions before replacement approaches

1. Inspect `agent-leads.csv`, `agent-leads-with-detail-urls.csv`, `scraper-resume.js`, and the
   relevant progress file before proposing a new exporter.
2. Preserve and reuse the existing export output; do not rerun or overwrite it merely because
   equity enrichment is blocked.
3. Validate checkpoint schema and raw-input coverage before invoking `scraper-resume.js` again.
4. Use the existing detail-URL script for compatible future exports.
5. Use the canonical guarded import CLI and current exception queue for batch/import status.
6. Propose a new data source only for a capability the existing system does not provide, such as
   reliable numeric-equity enrichment.

## Evidence and claim rules

- A named script proves code exists, not that its current inputs or credentials work.
- A generated CSV plus local row count proves an output exists; it does not prove current live
  provider state.
- A reconciliation/closeout artifact proves the recorded controlled import result.
- Historical memory does not prove current provider availability, credits, or captcha behavior.
- When evidence conflicts, cite both sources, prefer the current-state file for classification,
  and verify the underlying file before making an operational claim.

## Safety

Mode: `WRITE_GATED`.

- Read-only inspection, local file verification, qualification analysis, batch preparation, and
  handoff reporting are allowed without separate authorization.
- Never send provider or Telegram messages, write GHL, move stages, modify workflows, trigger
  outreach, rerun PropWire scraping, or execute a live import without explicit owner authorization
  and the existing safety-gated path.
- The current kill switch and all provider/GHL safety controls remain authoritative.
