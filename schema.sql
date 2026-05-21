-- Neon Database Schema — AI REI Pipeline
-- Run: psql <connection_string> -f schema.sql

-- ── Users (mentees + admins) ──
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- montelli, mentee_2
  name TEXT NOT NULL,                     -- Montelli Scott
  telegram_id BIGINT UNIQUE,             -- 718718959
  role TEXT NOT NULL DEFAULT 'mentee',   -- admin | mentee
  status TEXT NOT NULL DEFAULT 'active', -- active | suspended | cancelled
  plan TEXT DEFAULT 'free',              -- free | pro
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ                 -- NULL = never
);

-- ── User connections (GHL, JustCall, Sheets) ──
CREATE TABLE IF NOT EXISTS user_connections (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                -- ghl | justcall | google_sheets
  api_key TEXT,                           -- encrypted in production
  location_id TEXT,                       -- GHL location ID
  account_id TEXT,                        -- JustCall account ID
  sheet_id TEXT,                          -- Google Sheets ID
  sheet_range TEXT DEFAULT 'Sheet1',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- ── Pipeline leads ──
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,                    -- LEAD_177928...XXXX
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'NEW_LEAD',
  stage_entered_at TIMESTAMPTZ DEFAULT NOW(),

  -- Property
  price NUMERIC,
  property_type TEXT,                    -- turnkey | reno | livable
  population INTEGER,
  condition TEXT,

  -- Contact
  agent_name TEXT,
  agent_phone TEXT,
  agent_email TEXT,
  contact_type TEXT DEFAULT 'agent',

  -- Qualification
  roof_age TEXT,
  hvac_age TEXT,
  occupied BOOLEAN,
  rent_amount NUMERIC,
  lease_type TEXT,
  utilities_on BOOLEAN,
  feedback TEXT,

  -- Underwriting
  rental_comps JSONB,
  one_percent_rule BOOLEAN,
  cash_offer_math JSONB,

  -- LOI
  loi_requested_at TIMESTAMPTZ,
  loi_approved_at TIMESTAMPTZ,

  -- Offer
  offer_sent_at TIMESTAMPTZ,
  offer_amount NUMERIC,
  followup_48hr_due TIMESTAMPTZ,

  -- Text shortcuts
  int_sent BOOLEAN DEFAULT false,
  ccc_sent BOOLEAN DEFAULT false,
  gcj_sent BOOLEAN DEFAULT false,
  sd_sent BOOLEAN DEFAULT false,

  -- Closing
  under_contract_at TIMESTAMPTZ,
  inspection_date TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  assignment_fee NUMERIC,

  -- Dead lead tracking
  declined_at TIMESTAMPTZ,
  dom_days INTEGER,
  dom_expiry_alert TIMESTAMPTZ,

  -- Meta
  notes TEXT,
  source TEXT DEFAULT 'manual',
  ghl_opportunity_id TEXT,
  ghl_pipeline_stage_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Lead stage history ──
CREATE TABLE IF NOT EXISTS lead_history (
  id SERIAL PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  from_stage TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Pipeline events (audit log) ──
CREATE TABLE IF NOT EXISTS pipeline_events (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Stage mappings (GHL pipelineStageId → our stage) ──
CREATE TABLE IF NOT EXISTS stage_mappings (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pipeline_stage_id TEXT NOT NULL,
  pipeline_name TEXT,
  mapped_stage TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, pipeline_stage_id)
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_leads_user_stage ON leads(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_leads_address ON leads(user_id, address);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(followup_48hr_due) WHERE followup_48hr_due IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_history_lead ON lead_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_events_user ON pipeline_events(user_id, created_at DESC);

-- ── Initial user (Montelli) ──
INSERT INTO users (id, name, telegram_id, role, status, plan)
VALUES ('montelli', 'Montelli Scott', 718718959, 'admin', 'active', 'pro')
ON CONFLICT (id) DO NOTHING;
