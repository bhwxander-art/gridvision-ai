-- ============================================================
-- GridVision AI — ISO and Interconnection Queue Schema
-- Migration 013 · INFRA-002: isos, queue_projects, history
-- ============================================================
-- Tracks interconnection queue projects across all supported
-- North American ISOs. The withdrawal model (IFE-003) trains
-- on queue_project_status_history. The IFE analysis engine
-- reads queue_projects for active competitors at each POI bus.
-- ============================================================

-- ── isos ─────────────────────────────────────────────────────────────────────
-- Reference table for the 6 supported ISO/RTO regions.
-- Static data — populated by seed, not user-created.

CREATE TABLE isos (
  id           TEXT         PRIMARY KEY,  -- "PJM", "CAISO", etc.
  full_name    TEXT         NOT NULL,
  region       TEXT         NOT NULL,     -- "Mid-Atlantic", "Western", etc.
  timezone     TEXT         NOT NULL,     -- IANA tz: "America/New_York"
  ferc_id      TEXT,                      -- FERC docket prefix, e.g. "ER"
  queue_url    TEXT,                      -- public queue disclosure URL
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_isos_updated_at
  BEFORE UPDATE ON isos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO isos (id, full_name, region, timezone, ferc_id) VALUES
  ('PJM',   'PJM Interconnection',                  'Mid-Atlantic/Midwest',  'America/New_York',    'ER'),
  ('CAISO', 'California ISO',                        'Western',               'America/Los_Angeles',  'ER'),
  ('ERCOT', 'Electric Reliability Council of Texas', 'Texas',                 'America/Chicago',     NULL),
  ('MISO',  'Midcontinent ISO',                      'Midwest/South-Central', 'America/Chicago',     'ER'),
  ('NYISO', 'New York ISO',                          'Northeast',             'America/New_York',    'ER'),
  ('ISONE', 'ISO New England',                       'New England',           'America/New_York',    'ER');

-- ── queue_status enum ─────────────────────────────────────────────────────────

CREATE TYPE queue_status AS ENUM (
  'submitted',
  'study_phase_1',
  'study_phase_2',
  'study_phase_3',
  'executed_ia',    -- Interconnection Agreement executed
  'withdrawn',
  'in_service'
);

-- ── project_type enum ─────────────────────────────────────────────────────────

CREATE TYPE project_type AS ENUM (
  'solar',
  'wind_onshore',
  'wind_offshore',
  'battery_storage',
  'solar_plus_storage',
  'nuclear',
  'natural_gas',
  'hydro',
  'geothermal',
  'other_generation',
  'load'              -- AI data centers, industrial loads
);

-- ── queue_projects ────────────────────────────────────────────────────────────
-- One row per active or historical interconnection project.
-- project_number + iso_id is the natural key (FERC queue number).

CREATE TABLE queue_projects (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  iso_id               TEXT          NOT NULL REFERENCES isos(id),

  -- External identifier as it appears in the ISO queue (e.g. "J2019-001")
  project_number       TEXT          NOT NULL,

  project_name         TEXT          NOT NULL,
  developer            TEXT,
  project_type         project_type  NOT NULL DEFAULT 'other_generation',

  -- Point of interconnection — links to the network model bus if resolvable
  poi_bus_id           UUID          REFERENCES network_buses(id) ON DELETE SET NULL,
  poi_description      TEXT,         -- free-text POI name from ISO queue
  county               TEXT,
  state_abbr           CHAR(2),

  capacity_mw          NUMERIC(10,2) NOT NULL,
  in_service_mw        NUMERIC(10,2),          -- actual MW for in-service projects

  -- Dates (stored as DATE, not TEXT, for reliable range queries)
  queue_date           DATE          NOT NULL,  -- date first submitted to ISO
  study_start_date     DATE,
  target_cod           DATE,         -- commercial operation date
  actual_cod           DATE,         -- null until in service

  current_status       queue_status  NOT NULL DEFAULT 'submitted',

  -- Upgrade cost estimates from the ISO cluster study (when available)
  network_upgrade_cost_m   NUMERIC(10,2),  -- total network upgrade cost in $M
  project_cost_share_m     NUMERIC(10,2),  -- this project's allocated share in $M

  -- IFE enrichment fields (populated by the IFE pipeline, not the queue ingest)
  withdrawal_probability   NUMERIC(5,4),   -- Cox PH model output [0,1]
  ife_last_run_at          TIMESTAMPTZ,

  metadata             JSONB         NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- One queue project number per ISO per tenant
  CONSTRAINT queue_projects_unique_number UNIQUE (tenant_id, iso_id, project_number),

  CONSTRAINT queue_projects_capacity_positive    CHECK (capacity_mw > 0),
  CONSTRAINT queue_projects_cost_share_nonneg    CHECK (project_cost_share_m IS NULL OR project_cost_share_m >= 0),
  CONSTRAINT queue_projects_upgrade_cost_nonneg  CHECK (network_upgrade_cost_m IS NULL OR network_upgrade_cost_m >= 0),
  CONSTRAINT queue_projects_withdrawal_prob_range
    CHECK (withdrawal_probability IS NULL OR withdrawal_probability BETWEEN 0 AND 1),
  CONSTRAINT queue_projects_cod_after_queue
    CHECK (target_cod IS NULL OR target_cod >= queue_date)
);

CREATE INDEX idx_queue_projects_tenant_iso
  ON queue_projects(tenant_id, iso_id);

CREATE INDEX idx_queue_projects_status
  ON queue_projects(tenant_id, current_status);

CREATE INDEX idx_queue_projects_poi_bus
  ON queue_projects(poi_bus_id)
  WHERE poi_bus_id IS NOT NULL;

CREATE INDEX idx_queue_projects_queue_date
  ON queue_projects(tenant_id, queue_date DESC);

CREATE INDEX idx_queue_projects_type_status
  ON queue_projects(tenant_id, project_type, current_status);

CREATE TRIGGER trg_queue_projects_updated_at
  BEFORE UPDATE ON queue_projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── queue_project_status_history ──────────────────────────────────────────────
-- Append-only log of every status transition.
-- This is the primary training dataset for the Cox PH withdrawal model (IFE-003).
-- Never delete rows — only append.

CREATE TABLE queue_project_status_history (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID          NOT NULL REFERENCES queue_projects(id) ON DELETE CASCADE,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  iso_id          TEXT          NOT NULL REFERENCES isos(id),

  from_status     queue_status,                -- NULL for the initial submission event
  to_status       queue_status  NOT NULL,
  transitioned_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Snapshot of key project attributes at transition time (for Cox PH feature vector)
  capacity_mw_snapshot         NUMERIC(10,2),
  months_in_queue_snapshot     INTEGER,
  upgrade_cost_m_snapshot      NUMERIC(10,2),
  cost_share_m_snapshot        NUMERIC(10,2),

  -- Source of the transition record
  source          TEXT          NOT NULL DEFAULT 'queue_ingest',  -- 'queue_ingest' | 'manual' | 'api'
  notes           TEXT,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- History queries: all transitions for a project
CREATE INDEX idx_queue_history_project_id
  ON queue_project_status_history(project_id, transitioned_at ASC);

-- Cox PH training queries: all withdrawals by ISO and project type
CREATE INDEX idx_queue_history_withdrawal
  ON queue_project_status_history(iso_id, to_status, transitioned_at)
  WHERE to_status = 'withdrawn';

-- Tenant-scoped analytics
CREATE INDEX idx_queue_history_tenant_iso
  ON queue_project_status_history(tenant_id, iso_id, transitioned_at DESC);

-- ── Auto-record history on status transitions ─────────────────────────────────
-- When queue_projects.current_status changes, automatically insert a history row.
-- This ensures history is always complete even when updates bypass the repository.

CREATE OR REPLACE FUNCTION record_queue_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    INSERT INTO queue_project_status_history (
      project_id,
      tenant_id,
      iso_id,
      from_status,
      to_status,
      capacity_mw_snapshot,
      months_in_queue_snapshot,
      upgrade_cost_m_snapshot,
      cost_share_m_snapshot,
      source
    ) VALUES (
      NEW.id,
      NEW.tenant_id,
      NEW.iso_id,
      OLD.current_status,
      NEW.current_status,
      NEW.capacity_mw,
      EXTRACT(MONTH FROM AGE(NOW(), NEW.queue_date::TIMESTAMPTZ))::INTEGER,
      NEW.network_upgrade_cost_m,
      NEW.project_cost_share_m,
      'trigger'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_queue_status_history
  AFTER UPDATE OF current_status ON queue_projects
  FOR EACH ROW EXECUTE FUNCTION record_queue_status_change();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE queue_projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_project_status_history ENABLE ROW LEVEL SECURITY;

-- isos is a public reference table — no RLS needed
-- (all authenticated users can read ISO metadata)

CREATE POLICY "queue_projects_select"
  ON queue_projects FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "queue_projects_insert"
  ON queue_projects FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "queue_projects_update"
  ON queue_projects FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "queue_projects_delete"
  ON queue_projects FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "queue_history_select"
  ON queue_project_status_history FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "queue_history_insert"
  ON queue_project_status_history FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );
