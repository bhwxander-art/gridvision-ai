-- ============================================================
-- GridVision AI — Initial Database Schema
-- Migration 001 · Eastern Massachusetts service territory
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Helpers ───────────────────────────────────────────────────────────────────
-- Trigger function that keeps updated_at current on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── substations ──────────────────────────────────────────────────────────────
-- One row per physical substation in the service territory.
-- Corresponds to SubstationPlan in lib/planning-engine.ts.

CREATE TABLE substations (
  id                   TEXT        PRIMARY KEY,           -- "ss-boston-north"
  name                 TEXT        NOT NULL,              -- "Boston North 115/13.8 kV"
  region               TEXT        NOT NULL,              -- "North Shore"
  voltage_kv           NUMERIC(6,1) NOT NULL,             -- 115.0
  nameplate_mva        NUMERIC(8,2) NOT NULL,             -- 450.00
  peak_load_mw         NUMERIC(8,2) NOT NULL,             -- 342.00
  n1_capacity_mw       NUMERIC(8,2) NOT NULL,             -- 405.00
  annual_growth_pct    NUMERIC(5,2) NOT NULL,             -- 3.20
  latitude             NUMERIC(10,6) NOT NULL,            -- 42.467100
  longitude            NUMERIC(10,6) NOT NULL,            -- -70.943700
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_substations_region ON substations(region);

CREATE TRIGGER trg_substations_updated_at
  BEFORE UPDATE ON substations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── transformers ─────────────────────────────────────────────────────────────
-- One row per transformer bank.  Multiple transformers per substation.
-- Corresponds to TransformerAsset in lib/planning-engine.ts.

CREATE TABLE transformers (
  id                   TEXT        PRIMARY KEY,           -- "tx-bn-1"
  substation_id        TEXT        NOT NULL REFERENCES substations(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,              -- "T1 150 MVA"
  rated_mva            NUMERIC(8,2) NOT NULL,             -- 150.00
  peak_load_mva        NUMERIC(8,2) NOT NULL,             -- 118.00
  load_factor          NUMERIC(4,3) NOT NULL,             -- 0.920
  age_years            INTEGER     NOT NULL,              -- 22
  n1_compliant         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT transformers_load_factor_range CHECK (load_factor BETWEEN 0 AND 1),
  CONSTRAINT transformers_age_positive     CHECK (age_years >= 0)
);

CREATE INDEX idx_transformers_substation_id ON transformers(substation_id);

CREATE TRIGGER trg_transformers_updated_at
  BEFORE UPDATE ON transformers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── feeders ──────────────────────────────────────────────────────────────────
-- One row per distribution feeder circuit.
-- Corresponds to FeederCircuit in lib/planning-engine.ts.

CREATE TABLE feeders (
  id                   TEXT        PRIMARY KEY,           -- "fd-bn-12"
  substation_id        TEXT        NOT NULL REFERENCES substations(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,              -- "Feeder 12 — Lynn"
  hosting_capacity_mw  NUMERIC(8,2) NOT NULL,             -- 45.00
  committed_load_mw    NUMERIC(8,2) NOT NULL DEFAULT 0,   -- 28.00
  queued_load_mw       NUMERIC(8,2) NOT NULL DEFAULT 0,   -- 8.00
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT feeders_hosting_positive    CHECK (hosting_capacity_mw > 0),
  CONSTRAINT feeders_committed_non_neg   CHECK (committed_load_mw >= 0),
  CONSTRAINT feeders_queued_non_neg      CHECK (queued_load_mw >= 0)
);

CREATE INDEX idx_feeders_substation_id ON feeders(substation_id);

CREATE TRIGGER trg_feeders_updated_at
  BEFORE UPDATE ON feeders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── grid_load_history ────────────────────────────────────────────────────────
-- Append-only time-series of system-wide load readings.
-- Sources: ISO-NE 5-min/hourly API, SCADA historian, or manual entry.
-- Partition by month in production once volume exceeds ~1 M rows.

CREATE TABLE grid_load_history (
  id                   BIGSERIAL   PRIMARY KEY,
  territory_id         TEXT        NOT NULL DEFAULT 'eastern-ma',
  recorded_at          TIMESTAMPTZ  NOT NULL,
  load_mw              NUMERIC(10,2) NOT NULL,
  source               TEXT        NOT NULL,              -- "ISO-NE", "SCADA", "manual"
  interval_min         SMALLINT    NOT NULL DEFAULT 60    -- 5, 15, 60
                         CHECK (interval_min IN (5, 15, 60)),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast queries: latest reading, history by territory+time range
CREATE INDEX idx_grid_load_territory_time
  ON grid_load_history(territory_id, recorded_at DESC);

-- Enforce uniqueness: one reading per source per interval per timestamp
CREATE UNIQUE INDEX idx_grid_load_unique_reading
  ON grid_load_history(territory_id, source, interval_min, recorded_at);

-- ── data_center_queue ────────────────────────────────────────────────────────
-- Interconnection applications and their current study/build status.
-- Corresponds to DataCenterInterconnection in lib/planning-engine.ts.

CREATE TABLE data_center_queue (
  id                     TEXT        PRIMARY KEY,         -- "dc-001"
  project_name           TEXT        NOT NULL,
  developer              TEXT,
  requested_mw           NUMERIC(8,2) NOT NULL,
  load_factor            NUMERIC(4,3) NOT NULL,
  target_cod             TEXT        NOT NULL,            -- "2028-Q2"
  status                 TEXT        NOT NULL
                           CHECK (status IN ('study','ia-executed','construction','energized')),
  affected_substation_id TEXT        REFERENCES substations(id),
  affected_feeder_id     TEXT        REFERENCES feeders(id),
  ramp_months            INTEGER     NOT NULL DEFAULT 12,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT dc_queue_load_factor_range CHECK (load_factor BETWEEN 0 AND 1),
  CONSTRAINT dc_queue_requested_positive CHECK (requested_mw > 0)
);

CREATE INDEX idx_dc_queue_status        ON data_center_queue(status);
CREATE INDEX idx_dc_queue_substation_id ON data_center_queue(affected_substation_id);

CREATE TRIGGER trg_dc_queue_updated_at
  BEFORE UPDATE ON data_center_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── forecast_runs ────────────────────────────────────────────────────────────
-- Audit log of every load forecast computation.
-- Stores the full inputs and outputs so planners can reproduce results.

CREATE TABLE forecast_runs (
  id                   BIGSERIAL   PRIMARY KEY,
  territory_id         TEXT        NOT NULL DEFAULT 'eastern-ma',
  run_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  horizon_years        SMALLINT    NOT NULL CHECK (horizon_years IN (3, 5, 10)),
  inputs               JSONB       NOT NULL,
    -- { cityName, currentPeakLoad, populationGrowthRate, evGrowthRate, dataCenterLoad }
  result               JSONB       NOT NULL,
    -- { futureLoad, increasePercent, riskLevel, ... }
  model_version        TEXT        NOT NULL DEFAULT '1.0',
  source               TEXT        NOT NULL DEFAULT 'gridvision',
    -- "gridvision" | "iso-ne-celt" | "eia-steo"
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forecast_runs_territory_time
  ON forecast_runs(territory_id, run_at DESC);

-- ── Convenience view ─────────────────────────────────────────────────────────
-- Materialises the SubstationPlan shape (sans transformer/feeder arrays) for
-- quick SELECT without JOINs.

CREATE VIEW v_substation_summary AS
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
LEFT JOIN feeders     f ON f.substation_id = s.id
GROUP BY s.id;
