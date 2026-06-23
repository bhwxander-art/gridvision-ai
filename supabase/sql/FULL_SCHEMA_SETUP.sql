-- ============================================================
-- GridVision AI — Full Schema Setup
-- Combines migrations 001 through 006 in order.
--
-- Run this once in a fresh Supabase project via:
--   Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Safe to re-run: tables use IF NOT EXISTS, inserts use
-- ON CONFLICT DO UPDATE / DO NOTHING.
-- ============================================================


-- ============================================================
-- MIGRATION 001 · Initial Schema
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Helpers ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── substations ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS substations (
  id                   TEXT          PRIMARY KEY,
  name                 TEXT          NOT NULL,
  region               TEXT          NOT NULL,
  voltage_kv           NUMERIC(6,1)  NOT NULL,
  nameplate_mva        NUMERIC(8,2)  NOT NULL,
  peak_load_mw         NUMERIC(8,2)  NOT NULL,
  n1_capacity_mw       NUMERIC(8,2)  NOT NULL,
  annual_growth_pct    NUMERIC(5,2)  NOT NULL,
  latitude             NUMERIC(10,6) NOT NULL,
  longitude            NUMERIC(10,6) NOT NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_substations_region ON substations(region);

DROP TRIGGER IF EXISTS trg_substations_updated_at ON substations;
CREATE TRIGGER trg_substations_updated_at
  BEFORE UPDATE ON substations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── transformers ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transformers (
  id                   TEXT          PRIMARY KEY,
  substation_id        TEXT          NOT NULL REFERENCES substations(id) ON DELETE CASCADE,
  name                 TEXT          NOT NULL,
  rated_mva            NUMERIC(8,2)  NOT NULL,
  peak_load_mva        NUMERIC(8,2)  NOT NULL,
  load_factor          NUMERIC(4,3)  NOT NULL,
  age_years            INTEGER       NOT NULL,
  n1_compliant         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT transformers_load_factor_range CHECK (load_factor BETWEEN 0 AND 1),
  CONSTRAINT transformers_age_positive      CHECK (age_years >= 0)
);

CREATE INDEX IF NOT EXISTS idx_transformers_substation_id ON transformers(substation_id);

DROP TRIGGER IF EXISTS trg_transformers_updated_at ON transformers;
CREATE TRIGGER trg_transformers_updated_at
  BEFORE UPDATE ON transformers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── feeders ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feeders (
  id                   TEXT          PRIMARY KEY,
  substation_id        TEXT          NOT NULL REFERENCES substations(id) ON DELETE CASCADE,
  name                 TEXT          NOT NULL,
  hosting_capacity_mw  NUMERIC(8,2)  NOT NULL,
  committed_load_mw    NUMERIC(8,2)  NOT NULL DEFAULT 0,
  queued_load_mw       NUMERIC(8,2)  NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT feeders_hosting_positive  CHECK (hosting_capacity_mw > 0),
  CONSTRAINT feeders_committed_non_neg CHECK (committed_load_mw >= 0),
  CONSTRAINT feeders_queued_non_neg    CHECK (queued_load_mw >= 0)
);

CREATE INDEX IF NOT EXISTS idx_feeders_substation_id ON feeders(substation_id);

DROP TRIGGER IF EXISTS trg_feeders_updated_at ON feeders;
CREATE TRIGGER trg_feeders_updated_at
  BEFORE UPDATE ON feeders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── grid_load_history ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grid_load_history (
  id           BIGSERIAL     PRIMARY KEY,
  territory_id TEXT          NOT NULL DEFAULT 'eastern-ma',
  recorded_at  TIMESTAMPTZ   NOT NULL,
  load_mw      NUMERIC(10,2) NOT NULL,
  source       TEXT          NOT NULL,
  interval_min SMALLINT      NOT NULL DEFAULT 60
                 CHECK (interval_min IN (5, 15, 60)),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grid_load_territory_time
  ON grid_load_history(territory_id, recorded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_grid_load_unique_reading
  ON grid_load_history(territory_id, source, interval_min, recorded_at);

-- ── data_center_queue ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_center_queue (
  id                     TEXT         PRIMARY KEY,
  project_name           TEXT         NOT NULL,
  developer              TEXT,
  requested_mw           NUMERIC(8,2) NOT NULL,
  load_factor            NUMERIC(4,3) NOT NULL,
  target_cod             TEXT         NOT NULL,
  status                 TEXT         NOT NULL
                           CHECK (status IN ('study','ia-executed','construction','energized')),
  affected_substation_id TEXT         REFERENCES substations(id),
  affected_feeder_id     TEXT         REFERENCES feeders(id),
  ramp_months            INTEGER      NOT NULL DEFAULT 12,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT dc_queue_load_factor_range  CHECK (load_factor BETWEEN 0 AND 1),
  CONSTRAINT dc_queue_requested_positive CHECK (requested_mw > 0)
);

CREATE INDEX IF NOT EXISTS idx_dc_queue_status        ON data_center_queue(status);
CREATE INDEX IF NOT EXISTS idx_dc_queue_substation_id ON data_center_queue(affected_substation_id);

DROP TRIGGER IF EXISTS trg_dc_queue_updated_at ON data_center_queue;
CREATE TRIGGER trg_dc_queue_updated_at
  BEFORE UPDATE ON data_center_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── forecast_runs ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forecast_runs (
  id            BIGSERIAL    PRIMARY KEY,
  territory_id  TEXT         NOT NULL DEFAULT 'eastern-ma',
  run_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  horizon_years SMALLINT     NOT NULL CHECK (horizon_years IN (3, 5, 10)),
  inputs        JSONB        NOT NULL,
  result        JSONB        NOT NULL,
  model_version TEXT         NOT NULL DEFAULT '1.0',
  source        TEXT         NOT NULL DEFAULT 'gridvision',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_territory_time
  ON forecast_runs(territory_id, run_at DESC);

-- ── View: v_substation_summary ───────────────────────────────

CREATE OR REPLACE VIEW v_substation_summary AS
SELECT
  s.id,
  s.name,
  s.region,
  s.voltage_kv,
  s.nameplate_mva,
  s.peak_load_mw,
  s.n1_capacity_mw,
  s.annual_growth_pct,
  s.latitude,
  s.longitude,
  ROUND((s.peak_load_mw / NULLIF(s.nameplate_mva, 0)) * 100, 1) AS utilization_pct,
  (s.nameplate_mva - s.peak_load_mw)                              AS headroom_mw,
  (s.n1_capacity_mw - s.peak_load_mw)                            AS n1_headroom_mw,
  COUNT(DISTINCT t.id)                                            AS transformer_count,
  COUNT(DISTINCT f.id)                                            AS feeder_count
FROM substations s
LEFT JOIN transformers t ON t.substation_id = s.id
LEFT JOIN feeders      f ON f.substation_id = s.id
GROUP BY s.id;


-- ============================================================
-- MIGRATION 002 · Seed Data (Eastern Massachusetts)
-- ============================================================

INSERT INTO substations
  (id, name, region, voltage_kv, nameplate_mva, peak_load_mw,
   n1_capacity_mw, annual_growth_pct, latitude, longitude)
VALUES
  ('ss-boston-north',
   'Boston North 115/13.8 kV',   'North Shore',        115.0, 450.0, 342.0, 405.0, 3.2,
   42.4671, -70.9437),
  ('ss-cambridge-central',
   'Cambridge Central 115/27 kV', 'Inner Metro',        115.0, 420.0, 398.0, 378.0, 4.8,
   42.3626, -71.0857),
  ('ss-somerville-east',
   'Somerville East 27/13.8 kV',  'Inner Metro',         27.0, 290.0, 287.0, 261.0, 5.6,
   42.3898, -71.0747),
  ('ss-waltham-west',
   'Waltham West 115/13.8 kV',   'Route 128 Corridor', 115.0, 380.0, 215.0, 342.0, 6.2,
   42.3765, -71.2356)
ON CONFLICT (id) DO UPDATE SET
  name              = EXCLUDED.name,
  region            = EXCLUDED.region,
  voltage_kv        = EXCLUDED.voltage_kv,
  nameplate_mva     = EXCLUDED.nameplate_mva,
  peak_load_mw      = EXCLUDED.peak_load_mw,
  n1_capacity_mw    = EXCLUDED.n1_capacity_mw,
  annual_growth_pct = EXCLUDED.annual_growth_pct,
  latitude          = EXCLUDED.latitude,
  longitude         = EXCLUDED.longitude,
  updated_at        = NOW();

INSERT INTO transformers
  (id, substation_id, name, rated_mva, peak_load_mva, load_factor, age_years, n1_compliant)
VALUES
  ('tx-bn-1', 'ss-boston-north',      'T1 150 MVA', 150.0, 118.0, 0.92, 22, TRUE),
  ('tx-bn-2', 'ss-boston-north',      'T2 150 MVA', 150.0, 112.0, 0.92, 22, TRUE),
  ('tx-cc-1', 'ss-cambridge-central', 'T1 100 MVA', 100.0,  94.0, 0.95, 38, FALSE),
  ('tx-cc-2', 'ss-cambridge-central', 'T2 100 MVA', 100.0,  88.0, 0.95, 38, FALSE),
  ('tx-se-1', 'ss-somerville-east',   'T1 75 MVA',   75.0,  74.0, 0.97, 31, TRUE),
  ('tx-ww-1', 'ss-waltham-west',      'T1 125 MVA', 125.0,  98.0, 0.90, 18, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  rated_mva     = EXCLUDED.rated_mva,
  peak_load_mva = EXCLUDED.peak_load_mva,
  load_factor   = EXCLUDED.load_factor,
  age_years     = EXCLUDED.age_years,
  n1_compliant  = EXCLUDED.n1_compliant,
  updated_at    = NOW();

INSERT INTO feeders
  (id, substation_id, name, hosting_capacity_mw, committed_load_mw, queued_load_mw)
VALUES
  ('fd-bn-12', 'ss-boston-north',      'Feeder 12 — Lynn',          45.0, 28.0,  8.0),
  ('fd-cc-7',  'ss-cambridge-central', 'Feeder 7 — Kendall Sq',     32.0, 30.0, 12.0),
  ('fd-se-3',  'ss-somerville-east',   'Feeder 3 — Assembly Row',   18.0, 16.0,  6.0),
  ('fd-ww-5',  'ss-waltham-west',      'Feeder 5 — Route 128 Tech', 55.0, 22.0, 28.0)
ON CONFLICT (id) DO UPDATE SET
  name                = EXCLUDED.name,
  hosting_capacity_mw = EXCLUDED.hosting_capacity_mw,
  committed_load_mw   = EXCLUDED.committed_load_mw,
  queued_load_mw      = EXCLUDED.queued_load_mw,
  updated_at          = NOW();

INSERT INTO data_center_queue
  (id, project_name, developer, requested_mw, load_factor,
   target_cod, status, affected_substation_id, affected_feeder_id, ramp_months)
VALUES
  ('dc-001',
   'Project Helix — AI Training Campus', 'Undisclosed Hyperscaler',
   180.0, 0.96, '2028-Q2', 'study',
   'ss-waltham-west', 'fd-ww-5', 18),
  ('dc-002',
   'Kendall Inference Hub', 'Cloud Provider JV',
   45.0, 0.94, '2027-Q4', 'ia-executed',
   'ss-cambridge-central', 'fd-cc-7', 12),
  ('dc-003',
   'Assembly Edge DC', 'Regional Colo Operator',
   22.0, 0.88, '2027-Q1', 'construction',
   'ss-somerville-east', 'fd-se-3', 6),
  ('dc-004',
   'North Shore Enterprise DC', 'Enterprise Tenant',
   15.0, 0.85, '2026-Q4', 'study',
   'ss-boston-north', 'fd-bn-12', 9)
ON CONFLICT (id) DO UPDATE SET
  project_name           = EXCLUDED.project_name,
  developer              = EXCLUDED.developer,
  requested_mw           = EXCLUDED.requested_mw,
  load_factor            = EXCLUDED.load_factor,
  target_cod             = EXCLUDED.target_cod,
  status                 = EXCLUDED.status,
  affected_substation_id = EXCLUDED.affected_substation_id,
  affected_feeder_id     = EXCLUDED.affected_feeder_id,
  ramp_months            = EXCLUDED.ramp_months,
  updated_at             = NOW();

INSERT INTO grid_load_history (territory_id, recorded_at, load_mw, source, interval_min)
VALUES ('eastern-ma', '2026-06-10 14:00:00+00', 16842.0, 'manual', 60)
ON CONFLICT (territory_id, source, interval_min, recorded_at) DO NOTHING;


-- ============================================================
-- MIGRATION 003 · Scenarios Table
-- ============================================================

CREATE TABLE IF NOT EXISTS scenarios (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT        NOT NULL,
  inputs     JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scenarios_created_at ON scenarios(created_at DESC);

COMMENT ON TABLE scenarios IS
  'User-saved planning scenarios from the /enterprise/scenarios tool.';
COMMENT ON COLUMN scenarios.inputs IS
  'ScenarioInputs JSON: dataCenterLoadMW, evGrowthPct, populationGrowthPct, commercialGrowthPct.';


-- ============================================================
-- MIGRATION 004 · Row-Level Security
-- ============================================================

ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scenarios_select" ON scenarios;
DROP POLICY IF EXISTS "scenarios_insert" ON scenarios;
DROP POLICY IF EXISTS "scenarios_delete" ON scenarios;

CREATE POLICY "scenarios_select"
  ON scenarios FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "scenarios_insert"
  ON scenarios FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "scenarios_delete"
  ON scenarios FOR DELETE
  TO authenticated
  USING (true);


-- ============================================================
-- MIGRATION 005 · Scenario Ownership (user_id)
-- ============================================================

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scenarios_user_id ON scenarios(user_id);

-- Replace permissive policies with owner-scoped ones
DROP POLICY IF EXISTS "scenarios_select" ON scenarios;
DROP POLICY IF EXISTS "scenarios_insert" ON scenarios;
DROP POLICY IF EXISTS "scenarios_delete" ON scenarios;

CREATE POLICY "scenarios_select"
  ON scenarios FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "scenarios_insert"
  ON scenarios FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "scenarios_delete"
  ON scenarios FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- MIGRATION 006 · ISO-NE Load Import (raw_type column)
-- ============================================================

ALTER TABLE grid_load_history
  ADD COLUMN IF NOT EXISTS raw_type TEXT;

COMMENT ON COLUMN grid_load_history.raw_type IS
  'Original Type field from ISO-NE export (e.g. "Real-Time Demand", "Day-Ahead Demand"). NULL for readings from other sources.';


-- ============================================================
-- VERIFICATION QUERIES
-- Run these after the script to confirm everything created.
-- ============================================================

-- Table row counts
SELECT 'substations'       AS "table", COUNT(*) AS rows FROM substations
UNION ALL
SELECT 'transformers',                  COUNT(*)         FROM transformers
UNION ALL
SELECT 'feeders',                       COUNT(*)         FROM feeders
UNION ALL
SELECT 'grid_load_history',             COUNT(*)         FROM grid_load_history
UNION ALL
SELECT 'data_center_queue',             COUNT(*)         FROM data_center_queue
UNION ALL
SELECT 'forecast_runs',                 COUNT(*)         FROM forecast_runs
UNION ALL
SELECT 'scenarios',                     COUNT(*)         FROM scenarios
ORDER BY "table";
