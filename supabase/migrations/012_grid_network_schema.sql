-- ============================================================
-- GridVision AI — Grid Network Schema
-- Migration 012 · INFRA-001: network models, buses, branches
-- ============================================================
-- Stores transmission network topology models sourced from
-- CIM XML, PSS/E, or manual entry. These tables are the
-- foundation for PTDF/LODF computation, IFE analysis,
-- hosting capacity estimation, and the digital twin.
-- ============================================================

-- ── network_models ───────────────────────────────────────────────────────────
-- One row per network topology snapshot (e.g. "PJM Summer 2025 Peak").
-- A single tenant may have multiple models (different ISOs, vintages).

CREATE TYPE iso_region AS ENUM (
  'PJM', 'CAISO', 'ERCOT', 'MISO', 'NYISO', 'ISONE'
);

CREATE TYPE network_model_source AS ENUM (
  'CIM_XML', 'PSSE_RAW', 'MATPOWER', 'MANUAL'
);

CREATE TABLE network_models (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  iso              iso_region    NOT NULL,
  name             TEXT          NOT NULL,
  version          TEXT          NOT NULL DEFAULT '1.0',
  base_mva         NUMERIC(8,2)  NOT NULL DEFAULT 100.0,
  model_date       DATE          NOT NULL,
  source           network_model_source NOT NULL DEFAULT 'MANUAL',

  -- Topology fingerprint: SHA-256 of sorted (from_bus, to_bus, x_pu) tuples.
  -- Stale when NULL. Used by PTDF cache invalidation.
  topology_hash    TEXT,

  -- Cache validity flags. Set to FALSE when topology or parameters change.
  ptdf_valid       BOOLEAN       NOT NULL DEFAULT FALSE,
  lodf_valid       BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Number of buses and branches — denormalised for quick capacity checks.
  bus_count        INTEGER       NOT NULL DEFAULT 0,
  branch_count     INTEGER       NOT NULL DEFAULT 0,

  metadata         JSONB         NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT network_models_base_mva_positive  CHECK (base_mva > 0),
  CONSTRAINT network_models_bus_count_nonneg   CHECK (bus_count >= 0),
  CONSTRAINT network_models_branch_count_nonneg CHECK (branch_count >= 0)
);

CREATE INDEX idx_network_models_tenant_iso
  ON network_models(tenant_id, iso);

CREATE INDEX idx_network_models_model_date
  ON network_models(tenant_id, model_date DESC);

CREATE TRIGGER trg_network_models_updated_at
  BEFORE UPDATE ON network_models
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── network_buses ─────────────────────────────────────────────────────────────
-- One row per bus (node) in the network model.
-- bus_type follows the PSS/E / MATPOWER convention:
--   1 = PQ (load bus)
--   2 = PV (voltage-controlled, generator)
--   3 = Slack (reference bus, one per island)

CREATE TYPE bus_type_enum AS ENUM ('PQ', 'PV', 'SLACK');

CREATE TABLE network_buses (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id         UUID          NOT NULL REFERENCES network_models(id) ON DELETE CASCADE,
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- External bus identifier as it appears in the source model file.
  bus_number       INTEGER       NOT NULL,
  name             TEXT          NOT NULL,

  -- Per-unit base voltage (kV). Used to convert pu quantities to physical.
  base_kv          NUMERIC(8,3)  NOT NULL,

  bus_type         bus_type_enum NOT NULL DEFAULT 'PQ',

  -- Geographic location for electrical-distance mapping and UI display.
  latitude         NUMERIC(10,6),
  longitude        NUMERIC(10,6),

  -- ISO control area subdivisions for congestion zone analysis.
  zone             TEXT,
  area             TEXT,

  -- Normal operating voltage bounds (per-unit).
  vmin_pu          NUMERIC(6,4)  NOT NULL DEFAULT 0.95,
  vmax_pu          NUMERIC(6,4)  NOT NULL DEFAULT 1.05,

  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- One bus_number per model.
  CONSTRAINT network_buses_unique_number UNIQUE (model_id, bus_number),

  CONSTRAINT network_buses_base_kv_positive    CHECK (base_kv > 0),
  CONSTRAINT network_buses_vmin_positive       CHECK (vmin_pu > 0),
  CONSTRAINT network_buses_vmax_gt_vmin        CHECK (vmax_pu > vmin_pu),
  CONSTRAINT network_buses_vmin_reasonable     CHECK (vmin_pu BETWEEN 0.5 AND 1.0),
  CONSTRAINT network_buses_vmax_reasonable     CHECK (vmax_pu BETWEEN 1.0 AND 1.5)
);

-- Primary access pattern: all buses for a model
CREATE INDEX idx_network_buses_model_id
  ON network_buses(model_id);

-- Supports RLS and tenant-scoped queries without joining network_models
CREATE INDEX idx_network_buses_tenant_id
  ON network_buses(tenant_id);

-- Geospatial queries for electrical-distance mapping
CREATE INDEX idx_network_buses_location
  ON network_buses(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE TRIGGER trg_network_buses_updated_at
  BEFORE UPDATE ON network_buses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── network_branches ──────────────────────────────────────────────────────────
-- One row per transmission element (line, transformer, phase-shifting transformer).
-- Impedance stored in per-unit on the system base (base_mva from network_models).

CREATE TYPE branch_type_enum AS ENUM ('LINE', 'TRANSFORMER', 'PHASE_SHIFTER');

CREATE TABLE network_branches (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id         UUID          NOT NULL REFERENCES network_models(id) ON DELETE CASCADE,
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  branch_number    INTEGER       NOT NULL,
  name             TEXT          NOT NULL,
  branch_type      branch_type_enum NOT NULL DEFAULT 'LINE',

  -- Bus endpoints — both must belong to the same model.
  from_bus_id      UUID          NOT NULL REFERENCES network_buses(id) ON DELETE RESTRICT,
  to_bus_id        UUID          NOT NULL REFERENCES network_buses(id) ON DELETE RESTRICT,

  -- Impedance in per-unit (system base). x_pu must be nonzero.
  r_pu             NUMERIC(10,7) NOT NULL DEFAULT 0.0,
  x_pu             NUMERIC(10,7) NOT NULL,
  b_pu             NUMERIC(10,7) NOT NULL DEFAULT 0.0,   -- shunt charging susceptance

  -- Thermal ratings in MW (MVA for transformers). rate_a is the binding limit
  -- for N-0 security; rate_b for short-term emergency; rate_c for load-dump.
  rate_a_mw        NUMERIC(8,2)  NOT NULL,
  rate_b_mw        NUMERIC(8,2),
  rate_c_mw        NUMERIC(8,2),

  -- Transformer parameters (1.0 and 0.0 for plain lines).
  tap_ratio        NUMERIC(8,5)  NOT NULL DEFAULT 1.0,
  phase_shift_deg  NUMERIC(8,4)  NOT NULL DEFAULT 0.0,

  in_service       BOOLEAN       NOT NULL DEFAULT TRUE,

  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT network_branches_unique_number    UNIQUE (model_id, branch_number),
  CONSTRAINT network_branches_no_self_loop     CHECK (from_bus_id <> to_bus_id),
  CONSTRAINT network_branches_x_nonzero        CHECK (x_pu <> 0),
  CONSTRAINT network_branches_rate_a_positive  CHECK (rate_a_mw > 0),
  CONSTRAINT network_branches_tap_positive     CHECK (tap_ratio > 0)
);

-- Primary access: all branches for a model
CREATE INDEX idx_network_branches_model_id
  ON network_branches(model_id);

-- RLS support
CREATE INDEX idx_network_branches_tenant_id
  ON network_branches(tenant_id);

-- Contingency analysis: branches connected to a given bus
CREATE INDEX idx_network_branches_from_bus
  ON network_branches(from_bus_id) WHERE in_service = TRUE;

CREATE INDEX idx_network_branches_to_bus
  ON network_branches(to_bus_id) WHERE in_service = TRUE;

-- In-service subset — used heavily by PTDF computation
CREATE INDEX idx_network_branches_in_service
  ON network_branches(model_id, in_service);

CREATE TRIGGER trg_network_branches_updated_at
  BEFORE UPDATE ON network_branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Topology hash maintenance ─────────────────────────────────────────────────
-- Recomputes the topology fingerprint and invalidates PTDF/LODF caches
-- whenever the branch set changes.

CREATE OR REPLACE FUNCTION refresh_topology_hash()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_model_id UUID;
  v_new_hash TEXT;
BEGIN
  -- Determine which model was affected
  IF TG_OP = 'DELETE' THEN
    v_model_id := OLD.model_id;
  ELSE
    v_model_id := NEW.model_id;
  END IF;

  -- Compute deterministic hash of all in-service branch parameters.
  -- Uses MD5 for speed (not security); collision probability negligible for
  -- network models which change by human action, not adversarial input.
  SELECT MD5(
    string_agg(
      from_bus_id::TEXT || '|' || to_bus_id::TEXT || '|' || x_pu::TEXT,
      ',' ORDER BY from_bus_id, to_bus_id, branch_number
    )
  )
  INTO v_new_hash
  FROM network_branches
  WHERE model_id = v_model_id AND in_service = TRUE;

  -- Update the model's hash and invalidate caches if topology changed
  UPDATE network_models
  SET
    topology_hash = v_new_hash,
    ptdf_valid    = FALSE,
    lodf_valid    = FALSE,
    branch_count  = (
      SELECT COUNT(*) FROM network_branches WHERE model_id = v_model_id
    ),
    updated_at    = NOW()
  WHERE id = v_model_id
    AND (topology_hash IS DISTINCT FROM v_new_hash OR topology_hash IS NULL);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_branches_topology_hash
  AFTER INSERT OR UPDATE OR DELETE ON network_branches
  FOR EACH ROW EXECUTE FUNCTION refresh_topology_hash();

-- Maintain bus_count on the model when buses are added/removed
CREATE OR REPLACE FUNCTION refresh_bus_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_model_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_model_id := OLD.model_id;
  ELSE
    v_model_id := NEW.model_id;
  END IF;

  UPDATE network_models
  SET bus_count = (SELECT COUNT(*) FROM network_buses WHERE model_id = v_model_id),
      updated_at = NOW()
  WHERE id = v_model_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_buses_count
  AFTER INSERT OR DELETE ON network_buses
  FOR EACH ROW EXECUTE FUNCTION refresh_bus_count();

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Service-role key (used by all API routes) bypasses RLS.
-- These policies protect direct anon/authenticated access.

ALTER TABLE network_models   ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_buses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_branches ENABLE ROW LEVEL SECURITY;

-- ── network_models policies ───────────────────────────────────────────────────

CREATE POLICY "network_models_select"
  ON network_models FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_models_insert"
  ON network_models FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_models_update"
  ON network_models FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_models_delete"
  ON network_models FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

-- ── network_buses policies ────────────────────────────────────────────────────
-- Denormalised tenant_id on buses avoids a join to network_models on every RLS
-- check, which would be prohibitively expensive on large networks.

CREATE POLICY "network_buses_select"
  ON network_buses FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_buses_insert"
  ON network_buses FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_buses_update"
  ON network_buses FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_buses_delete"
  ON network_buses FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

-- ── network_branches policies ─────────────────────────────────────────────────

CREATE POLICY "network_branches_select"
  ON network_branches FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_branches_insert"
  ON network_branches FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_branches_update"
  ON network_branches FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "network_branches_delete"
  ON network_branches FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    )
  );
