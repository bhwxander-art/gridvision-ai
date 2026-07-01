-- ============================================================
-- GridVision AI — IFE Scenario Analysis
-- Migration 018 · INFRA-019: what-if scenario schema
-- ============================================================
-- Stores deterministic "what-if" scenario definitions layered on
-- top of the existing IFE pipeline (INFRA-014). A scenario never
-- mutates the tenant's canonical network_models row — it either
-- (a) runs the unmodified orchestrator directly against the base
-- model with modified request fields (POI/capacity/COD/injection
-- overrides), or (b) materializes a cloned network_models row
-- (with a branch-level delta applied) and runs the unmodified
-- orchestrator against that clone instead. No electrical engine,
-- and no existing table, is touched by this migration.
--
-- Table name is deliberately "ife_scenarios" (not "scenarios") to
-- avoid colliding with the pre-existing, unrelated `scenarios`
-- table from migration 003 (enterprise load-growth planning tool).
--
-- status reuses the existing ife_analysis_status enum (migration
-- 015) rather than minting a new one — a scenario's lifecycle
-- (pending/running/completed/failed) is identical in shape.
-- ============================================================

CREATE TABLE ife_scenarios (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  base_network_model_id       UUID          NOT NULL REFERENCES network_models(id) ON DELETE RESTRICT,
  derived_network_model_id    UUID          REFERENCES network_models(id) ON DELETE RESTRICT,
  -- NULL when network_delta was empty (no clone was needed — the base model
  -- was used directly).

  name                        TEXT          NOT NULL,
  description                 TEXT,

  poi_bus_number              INTEGER       NOT NULL,
  iso_id                      TEXT          NOT NULL REFERENCES isos(id),
  capacity_mw                 NUMERIC(10,2) NOT NULL,
  project_type                project_type  NOT NULL,
  target_cod                  DATE,

  injection_overrides_mw      JSONB         NOT NULL DEFAULT '{}',
  -- bus_number (string key) -> MW override, merged over the base model's
  -- baseCaseInjectionsMw before orchestration. Covers POI injection changes,
  -- generator retirement (0 or reduced), and generator addition (new/
  -- increased MW) — none of these require a network_models clone.

  network_delta                JSONB         NOT NULL DEFAULT '[]',
  -- Ordered array of branch-level operations, each one of:
  --   { "op": "set_branch_in_service", "branchNumber": <int>, "inService": <bool> }
  --   { "op": "set_branch_rating", "branchNumber": <int>,
  --     "rateAMw": <number>, "rateBMw": <number|null>, "rateCMw": <number|null> }
  -- A non-empty array triggers materialization of derived_network_model_id.
  network_delta_hash           TEXT,
  -- Deterministic hash of the canonicalized network_delta (stable key order,
  -- stable array order). NULL when network_delta is empty (dedup index below
  -- deliberately excludes NULL rows — no-clone scenarios never need dedup).

  status                        ife_analysis_status NOT NULL DEFAULT 'pending',
  error_message                 TEXT,

  result_analysis_id            UUID          REFERENCES ife_analyses(id) ON DELETE SET NULL,

  idempotency_key                TEXT          UNIQUE,

  created_at                     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT ife_scenarios_capacity_positive CHECK (capacity_mw > 0)
);

-- Dedup lookup index (NOT unique): different scenarios (different name,
-- capacity, injections) may legitimately share an identical network_delta
-- against the same base model — each still gets its own ife_scenarios row,
-- but the pipeline looks up an existing row with a matching hash first and
-- reuses its derived_network_model_id instead of cloning again. A UNIQUE
-- constraint here would incorrectly reject the second scenario's INSERT.
CREATE INDEX idx_ife_scenarios_delta_dedup
  ON ife_scenarios (tenant_id, base_network_model_id, network_delta_hash)
  WHERE network_delta_hash IS NOT NULL;

CREATE INDEX idx_ife_scenarios_tenant_base_model
  ON ife_scenarios (tenant_id, base_network_model_id);

CREATE INDEX idx_ife_scenarios_result_analysis
  ON ife_scenarios (result_analysis_id)
  WHERE result_analysis_id IS NOT NULL;

CREATE TRIGGER trg_ife_scenarios_updated_at
  BEFORE UPDATE ON ife_scenarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Same SELECT/INSERT/UPDATE-only pattern as the 7 IFE tables in migration 015
-- (no DELETE policy there either — scenarios, like analyses, are immutable
-- once created).

ALTER TABLE ife_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY ife_scenarios_select ON ife_scenarios FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY ife_scenarios_insert ON ife_scenarios FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY ife_scenarios_update ON ife_scenarios FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));
