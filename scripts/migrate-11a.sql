-- =============================================================================
-- GridVision AI — Phase 11A Migration
-- Real Utility Asset Database
--
-- Safe to run multiple times (idempotent).
-- Tables: substations · transformers · feeders · capital_projects
-- =============================================================================

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. substations ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS substations (
  id                TEXT        PRIMARY KEY,
  name              TEXT        NOT NULL,
  region            TEXT        NOT NULL,
  voltage_kv        NUMERIC     NOT NULL,
  nameplate_mva     NUMERIC     NOT NULL,
  peak_load_mw      NUMERIC     NOT NULL,
  n1_capacity_mw    NUMERIC     NOT NULL,
  annual_growth_pct NUMERIC     NOT NULL,
  latitude          NUMERIC     NOT NULL,
  longitude         NUMERIC     NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS substations_region_idx ON substations (region);

ALTER TABLE substations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON substations;
CREATE POLICY "service_role_all" ON substations
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 2. transformers ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transformers (
  id             TEXT        PRIMARY KEY,
  substation_id  TEXT        NOT NULL REFERENCES substations (id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  rated_mva      NUMERIC     NOT NULL,
  peak_load_mva  NUMERIC     NOT NULL,
  load_factor    NUMERIC     NOT NULL,
  age_years      INTEGER     NOT NULL,
  n1_compliant   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transformers_substation_idx ON transformers (substation_id);

ALTER TABLE transformers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON transformers;
CREATE POLICY "service_role_all" ON transformers
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 3. feeders ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feeders (
  id                   TEXT        PRIMARY KEY,
  substation_id        TEXT        NOT NULL REFERENCES substations (id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  hosting_capacity_mw  NUMERIC     NOT NULL,
  committed_load_mw    NUMERIC     NOT NULL,
  queued_load_mw       NUMERIC     NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feeders_substation_idx ON feeders (substation_id);

ALTER TABLE feeders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON feeders;
CREATE POLICY "service_role_all" ON feeders
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 4. capital_projects ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS capital_projects (
  id                    TEXT        PRIMARY KEY,
  substation_id         TEXT        NOT NULL REFERENCES substations (id),
  project_name          TEXT        NOT NULL,
  upgrade_type          TEXT        NOT NULL
    CHECK (upgrade_type IN (
      'transformer-replacement',
      'substation-expansion',
      'feeder-reconductor',
      'new-substation',
      'cable-replacement'
    )),
  estimated_cost_usd    BIGINT      NOT NULL CHECK (estimated_cost_usd > 0),
  added_capacity_mw     INTEGER     NOT NULL CHECK (added_capacity_mw > 0),
  implementation_months INTEGER     NOT NULL CHECK (implementation_months > 0),
  risk_reduction        INTEGER     NOT NULL CHECK (risk_reduction BETWEEN 0 AND 100),
  priority_score        INTEGER     NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
  status                TEXT        NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','approved','in-progress','completed','cancelled')),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS capital_projects_substation_idx
  ON capital_projects (substation_id);
CREATE INDEX IF NOT EXISTS capital_projects_status_idx
  ON capital_projects (status);
CREATE INDEX IF NOT EXISTS capital_projects_priority_idx
  ON capital_projects (priority_score DESC);

ALTER TABLE capital_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON capital_projects;
CREATE POLICY "service_role_all" ON capital_projects
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =============================================================================
-- SEED DATA
-- All INSERT statements use ON CONFLICT DO NOTHING so they are safe to re-run.
-- =============================================================================

-- ── Substations ───────────────────────────────────────────────────────────────

INSERT INTO substations
  (id, name, region, voltage_kv, nameplate_mva, peak_load_mw,
   n1_capacity_mw, annual_growth_pct, latitude, longitude)
VALUES
  ('ss-boston-north',     'Boston North 115/13.8 kV',    'North Shore',           115, 450, 342, 405, 3.2, 42.4671, -70.9437),
  ('ss-cambridge-central','Cambridge Central 115/27 kV',  'Inner Metro',           115, 420, 398, 378, 4.8, 42.3626, -71.0857),
  ('ss-somerville-east',  'Somerville East 27/13.8 kV',   'Inner Metro',            27, 290, 287, 261, 5.6, 42.3898, -71.0747),
  ('ss-waltham-west',     'Waltham West 115/13.8 kV',     'Route 128 Corridor',    115, 380, 215, 342, 6.2, 42.3765, -71.2356)
ON CONFLICT (id) DO NOTHING;

-- ── Transformers ──────────────────────────────────────────────────────────────

INSERT INTO transformers
  (id, substation_id, name, rated_mva, peak_load_mva, load_factor, age_years, n1_compliant)
VALUES
  ('tx-bn-1',  'ss-boston-north',     'T1 150 MVA',  150, 118, 0.92, 22, TRUE),
  ('tx-bn-2',  'ss-boston-north',     'T2 150 MVA',  150, 112, 0.92, 22, TRUE),
  ('tx-cc-1',  'ss-cambridge-central','T1 100 MVA',  100,  94, 0.95, 38, FALSE),
  ('tx-cc-2',  'ss-cambridge-central','T2 100 MVA',  100,  88, 0.95, 38, FALSE),
  ('tx-se-1',  'ss-somerville-east',  'T1 75 MVA',    75,  74, 0.97, 31, TRUE),
  ('tx-ww-1',  'ss-waltham-west',     'T1 125 MVA',  125,  98, 0.90, 18, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── Feeders ───────────────────────────────────────────────────────────────────

INSERT INTO feeders
  (id, substation_id, name, hosting_capacity_mw, committed_load_mw, queued_load_mw)
VALUES
  ('fd-bn-12', 'ss-boston-north',     'Feeder 12 — Lynn',           45, 28,  8),
  ('fd-cc-7',  'ss-cambridge-central','Feeder 7 — Kendall Sq',      32, 30, 12),
  ('fd-se-3',  'ss-somerville-east',  'Feeder 3 — Assembly Row',    18, 16,  6),
  ('fd-ww-5',  'ss-waltham-west',     'Feeder 5 — Route 128 Tech',  55, 22, 28)
ON CONFLICT (id) DO NOTHING;

-- ── Capital Projects ──────────────────────────────────────────────────────────

INSERT INTO capital_projects
  (id, substation_id, project_name, upgrade_type,
   estimated_cost_usd, added_capacity_mw, implementation_months,
   risk_reduction, priority_score, status)
VALUES
  -- Cambridge Central (N-1 violations, most constrained)
  ('cp-001', 'ss-cambridge-central',
   'Cambridge Central T1/T2 Transformer Replacement',
   'transformer-replacement',  8500000,  60, 18, 38, 92, 'planned'),

  ('cp-002', 'ss-cambridge-central',
   'Cambridge Central Third Transformer Bank',
   'substation-expansion',    22000000, 150, 36, 55, 84, 'planned'),

  ('cp-007', 'ss-cambridge-central',
   'Cambridge–Waltham 115 kV Cable Upgrade',
   'cable-replacement',       12000000,  80, 24, 28, 68, 'planned'),

  -- Somerville East (transformer at 97% loading)
  ('cp-003', 'ss-somerville-east',
   'Somerville East T1 Emergency Replacement',
   'transformer-replacement',  5200000,  40, 12, 32, 88, 'planned'),

  ('cp-004', 'ss-somerville-east',
   'Assembly Row Feeder 3 Reconductor',
   'feeder-reconductor',       3100000,  25,  6, 18, 72, 'planned'),

  -- Boston North (moderate risk, aging assets)
  ('cp-005', 'ss-boston-north',
   'Lynn Feeder 12 Reconductor & Protection Upgrade',
   'feeder-reconductor',       2400000,  20,  9, 12, 58, 'planned'),

  ('cp-008', 'ss-boston-north',
   'North Shore New 115/13.8 kV Substation',
   'new-substation',          45000000, 250, 48, 62, 65, 'planned'),

  -- Waltham West (data center growth corridor)
  ('cp-006', 'ss-waltham-west',
   'Route 128 Corridor Substation Expansion',
   'substation-expansion',    18000000, 150, 30, 45, 76, 'planned')

ON CONFLICT (id) DO NOTHING;

-- ── updated_at trigger (optional quality-of-life) ─────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['substations','transformers','feeders','capital_projects']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_' || tbl || '_updated_at'
        AND tgrelid = tbl::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %s
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        tbl, tbl
      );
    END IF;
  END LOOP;
END;
$$;
