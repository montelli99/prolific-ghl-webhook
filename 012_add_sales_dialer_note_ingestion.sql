-- Migration 012: Sales Dialer transcript → GHL note ingestion ledger
-- Purpose: Durable idempotency + state tracking for the "Sales Dialer call
-- transcript → GHL note" pipeline. One row per (call_id, opportunity_id) so a
-- repeated webhook/reconciler pass can NEVER create a duplicate GHL note.
-- Created: 2026-09-03
-- Reversible: YES (additive table only)

-- ============================================================================
-- ppc_sales_dialer_note_ingestion — per-call note ingestion state
-- ============================================================================
CREATE TABLE IF NOT EXISTS ppc_sales_dialer_note_ingestion (
  id BIGSERIAL PRIMARY KEY,
  call_id TEXT NOT NULL,                 -- Sales Dialer call_id (numeric string)
  call_sid TEXT,
  opportunity_id TEXT,                   -- GHL opportunity (null when UNMATCHED)
  contact_id TEXT,
  agent_id TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  contact_number TEXT,
  contact_name TEXT,
  call_date TEXT,
  call_time TEXT,
  disposition TEXT,
  duration_seconds INTEGER,
  recording_url TEXT,
  answered BOOLEAN,
  transcript_status TEXT,                -- TRANSCRIPT_READY | TRANSCRIPT_PENDING | TRANSCRIPT_UNAVAILABLE
  match_status TEXT,                     -- MATCHED | AMBIGUOUS_NEEDS_REVIEW | UNMATCHED
  ingestion_state TEXT NOT NULL,         -- PENDING_TRANSCRIPT | READY_TO_WRITE | NOTE_WRITTEN | AMBIGUOUS | UNMATCHED | FAILED_RETRYABLE
  ghl_note_id TEXT,
  transcript_text TEXT,                  -- full verbatim transcript (durable copy)
  summary_text TEXT,                     -- structured summary derived from transcript
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppc_sd_ingest_call ON ppc_sales_dialer_note_ingestion (call_id);
CREATE INDEX IF NOT EXISTS idx_ppc_sd_ingest_opp ON ppc_sales_dialer_note_ingestion (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_ppc_sd_ingest_state ON ppc_sales_dialer_note_ingestion (ingestion_state);
CREATE INDEX IF NOT EXISTS idx_ppc_sd_ingest_agent ON ppc_sales_dialer_note_ingestion (agent_id);

-- Idempotency: one ingestion record per (call_id, opportunity_id). A call that
-- is UNMATCHED has opportunity_id NULL; a single NULL row per call_id is
-- enforced by the partial unique index below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ppc_sd_ingest_dedupe
  ON ppc_sales_dialer_note_ingestion (call_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ppc_sd_ingest_dedupe_unmatched
  ON ppc_sales_dialer_note_ingestion (call_id)
  WHERE opportunity_id IS NULL;

-- ROLLBACK
-- DROP TABLE IF EXISTS ppc_sales_dialer_note_ingestion;
