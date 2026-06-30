-- ============================================================
-- GridVision AI — IFE Analysis Tables
-- Migration 015 · INFRA-004: IFE analysis and results schema
-- ============================================================
-- These tables store the inputs, outputs, and outcome tracking
-- for the Interconnection Feasibility Engine (IFE).
--
-- Table hierarchy:
--   ife_analyses (parent)
--     ├── ife_hosting_capacity
--     ├── ife_upgrade_results
--     ├── ife_time_to_power
--     ├── ife_confidence_risk
--     └── ife_explanations
--   ife_outcome_tracking (feedback loop for model validation)
-- ============================================================

-- ── ife_analysis_status enum ──────────────────────────────────────────────────

CREATE TYPE ife_analysis_status AS ENUM (
  'pending',
  'running',
  'completed',
  'failed'
);

-- ── ife_analyses ──────────────────────────────────────────────────────────────
-- One row per IFE analysis request.
-- All child tables foreign-key to this table.

CREATE TABLE ife_analyses (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID              NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Input specification
  network_model_id UUID             NOT NULL REFERENCES network_models(id) ON DELETE RESTRICT,
  poi_bus_id       UUID             NOT NULL REFERENCES network_buses(id) ON DELETE RESTRICT,
  iso_id           TEXT             NOT NULL REFERENCES isos(id),

  capacity_mw      NUMERIC(10,2)    NOT NULL,
  project_type     project_type     NOT NULL,
  target_cod       DATE,

  -- Point-in-time snapshot of all inputs (for auditability and replication)
  input_snapshot   JSONB            NOT NULL DEFAULT '{}',

  -- Pipeline state
  status           ife_analysis_status NOT NULL DEFAULT 'pending',
  progress_pct     SMALLINT         NOT NULL DEFAULT 0,
  error_message    TEXT,

  -- Timing
  queued_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,

  -- Idempotency: client-supplied key prevents duplicate submissions
  idempotency_key  TEXT             UNIQUE,

  created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT ife_analyses_capacity_positive  CHECK (capacity_mw > 0),
  CONSTRAINT ife_analyses_progress_range     CHECK (progress_pct BETWEEN 0 AND 100),
  CONSTRAINT ife_analyses_timing_order
    CHECK (started_at IS NULL OR started_at >= queued_at),
  CONSTRAINT ife_analyses_completed_order
    CHECK (completed_at IS NULL OR started_at IS NOT NULL)
);

CREATE INDEX idx_ife_analyses_tenant_id
  ON ife_analyses(tenant_id, queued_at DESC);

CREATE INDEX idx_ife_analyses_status
  ON ife_analyses(tenant_id, status)
  WHERE status IN ('pending', 'running');

CREATE INDEX idx_ife_analyses_poi_bus
  ON ife_analyses(poi_bus_id);

CREATE TRIGGER trg_ife_analyses_updated_at
  BEFORE UPDATE ON ife_analyses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── ife_hosting_capacity ──────────────────────────────────────────────────────
-- Hosting capacity estimates from the deterministic and Monte Carlo analyses.

CREATE TABLE ife_hosting_capacity (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id           UUID          NOT NULL REFERENCES ife_analyses(id) ON DELETE CASCADE,
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Deterministic result (Section 1: closed-form PTDF/LODF calculation)
  hc_deterministic_mw   NUMERIC(10,2),
  binding_line_id       UUID          REFERENCES network_branches(id) ON DELETE SET NULL,
  binding_contingency_id UUID         REFERENCES network_branches(id) ON DELETE SET NULL,

  -- Probabilistic results (Section 2: Monte Carlo with stochastic scenarios)
  hc_p10_mw             NUMERIC(10,2),
  hc_p50_mw             NUMERIC(10,2),
  hc_p90_mw             NUMERIC(10,2),
  mc_scenarios_run      INTEGER,
  mc_convergence_pct    NUMERIC(5,2), -- % scenarios that converged

  -- At the requested capacity_mw, what is the probability of violation?
  violation_probability  NUMERIC(5,4),

  -- Voltage headroom at the POI bus
  vmin_headroom_pu      NUMERIC(6,4),
  vmax_headroom_pu      NUMERIC(6,4),

  computed_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT ife_hc_p10_le_p50   CHECK (hc_p10_mw IS NULL OR hc_p50_mw IS NULL OR hc_p10_mw <= hc_p50_mw),
  CONSTRAINT ife_hc_p50_le_p90   CHECK (hc_p50_mw IS NULL OR hc_p90_mw IS NULL OR hc_p50_mw <= hc_p90_mw),
  CONSTRAINT ife_hc_violation_range
    CHECK (violation_probability IS NULL OR violation_probability BETWEEN 0 AND 1),
  CONSTRAINT ife_hc_mc_nonneg    CHECK (mc_scenarios_run IS NULL OR mc_scenarios_run >= 0)
);

CREATE INDEX idx_ife_hc_analysis_id ON ife_hosting_capacity(analysis_id);

-- ── ife_upgrade_results ───────────────────────────────────────────────────────
-- Network upgrade requirements and cost estimates.

CREATE TABLE ife_upgrade_results (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id            UUID         NOT NULL REFERENCES ife_analyses(id) ON DELETE CASCADE,
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Cost estimates (in $M)
  cost_p10_m             NUMERIC(10,2),
  cost_p50_m             NUMERIC(10,2),
  cost_p90_m             NUMERIC(10,2),

  -- Allocated share for this specific project (post-Shapley allocation)
  project_share_p50_m    NUMERIC(10,2),

  -- Count of upgrades required
  upgrades_required      INTEGER       NOT NULL DEFAULT 0,

  -- MILP solution details
  milp_optimality_gap_pct NUMERIC(5,2),
  milp_solve_seconds      NUMERIC(8,2),

  -- Detailed upgrade list (one element per required upgrade)
  -- [ { branch_id, branch_name, upgrade_type, capacity_increase_mw, cost_p50_m } ]
  upgrade_details        JSONB         NOT NULL DEFAULT '[]',

  computed_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT ife_upgrades_cost_p10_le_p50
    CHECK (cost_p10_m IS NULL OR cost_p50_m IS NULL OR cost_p10_m <= cost_p50_m),
  CONSTRAINT ife_upgrades_cost_p50_le_p90
    CHECK (cost_p50_m IS NULL OR cost_p90_m IS NULL OR cost_p50_m <= cost_p90_m),
  CONSTRAINT ife_upgrades_nonneg
    CHECK (upgrades_required >= 0)
);

CREATE INDEX idx_ife_upgrades_analysis_id ON ife_upgrade_results(analysis_id);

-- ── ife_time_to_power ─────────────────────────────────────────────────────────
-- Time-to-COD estimates and queue survival analysis.

CREATE TABLE ife_time_to_power (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id            UUID         NOT NULL REFERENCES ife_analyses(id) ON DELETE CASCADE,
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Expected COD dates at different percentiles
  cod_p25                DATE,
  cod_p50                DATE,
  cod_p75                DATE,

  -- Queue metrics
  months_to_study_completion  INTEGER,  -- expected months until study completion
  active_queue_projects_count INTEGER,  -- number of competing projects at POI

  -- Survival probability at key horizons (Cox PH model output)
  survival_12m           NUMERIC(5,4),  -- P(project still active at 12 months)
  survival_24m           NUMERIC(5,4),
  survival_36m           NUMERIC(5,4),

  computed_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT ife_ttp_survival_range
    CHECK (
      (survival_12m IS NULL OR survival_12m BETWEEN 0 AND 1) AND
      (survival_24m IS NULL OR survival_24m BETWEEN 0 AND 1) AND
      (survival_36m IS NULL OR survival_36m BETWEEN 0 AND 1)
    ),
  CONSTRAINT ife_ttp_cod_order
    CHECK (
      cod_p25 IS NULL OR cod_p50 IS NULL OR cod_p25 <= cod_p50
    )
);

CREATE INDEX idx_ife_ttp_analysis_id ON ife_time_to_power(analysis_id);

-- ── ife_confidence_risk ───────────────────────────────────────────────────────
-- Composite confidence and risk scores with component decomposition.

CREATE TABLE ife_confidence_risk (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id            UUID         NOT NULL REFERENCES ife_analyses(id) ON DELETE CASCADE,
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Composite scores (0-100)
  confidence_score       SMALLINT     NOT NULL,
  risk_score             SMALLINT     NOT NULL,

  -- Confidence score components (contribute to overall confidence)
  conf_data_freshness    SMALLINT,    -- how recent is the network model?
  conf_model_calibration SMALLINT,    -- historical accuracy of cost model
  conf_input_completeness SMALLINT,   -- fraction of optional inputs provided
  conf_mc_convergence    SMALLINT,    -- did MC simulation converge well?

  -- Risk score components (higher = more risky)
  risk_cost_uncertainty  SMALLINT,    -- P90/P10 cost spread
  risk_queue_depth       SMALLINT,    -- competing queue depth at POI
  risk_congestion_trend  SMALLINT,    -- worsening congestion trend
  risk_withdrawal        SMALLINT,    -- this project's own withdrawal probability

  -- Detailed breakdown for UI/API explainability
  component_breakdown    JSONB        NOT NULL DEFAULT '{}',

  computed_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT ife_cr_confidence_range CHECK (confidence_score BETWEEN 0 AND 100),
  CONSTRAINT ife_cr_risk_range       CHECK (risk_score BETWEEN 0 AND 100)
);

CREATE INDEX idx_ife_cr_analysis_id ON ife_confidence_risk(analysis_id);

-- ── ife_explanations ─────────────────────────────────────────────────────────
-- SHAP-based natural language and feature-level explanations.

CREATE TABLE ife_explanations (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id            UUID         NOT NULL REFERENCES ife_analyses(id) ON DELETE CASCADE,
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Withdrawal probability explanation (Cox PH model SHAP values)
  baseline_withdrawal_prob   NUMERIC(5,4),
  predicted_withdrawal_prob  NUMERIC(5,4),

  -- SHAP feature contributions
  -- [ { feature, value, shap_value, direction, rank } ]
  withdrawal_shap_values JSONB        NOT NULL DEFAULT '[]',

  -- Top drivers for cost uncertainty
  cost_drivers           JSONB        NOT NULL DEFAULT '[]',

  -- Key assumptions and caveats
  assumptions            TEXT[],

  -- Model versions used (for auditability)
  cox_model_version      TEXT,
  cost_model_version     TEXT,

  computed_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT ife_exp_baseline_range
    CHECK (baseline_withdrawal_prob IS NULL OR baseline_withdrawal_prob BETWEEN 0 AND 1),
  CONSTRAINT ife_exp_predicted_range
    CHECK (predicted_withdrawal_prob IS NULL OR predicted_withdrawal_prob BETWEEN 0 AND 1)
);

CREATE INDEX idx_ife_exp_analysis_id ON ife_explanations(analysis_id);

-- ── ife_outcome_tracking ──────────────────────────────────────────────────────
-- Records actual observed outcomes for completed analyses.
-- Used to compute model validation metrics (MAPE, interval coverage, AUC).

CREATE TABLE ife_outcome_tracking (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id            UUID         NOT NULL REFERENCES ife_analyses(id) ON DELETE CASCADE,
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  queue_project_id       UUID         REFERENCES queue_projects(id) ON DELETE SET NULL,

  -- Actual observed values (filled in as they become available)
  actual_cost_m          NUMERIC(10,2),
  actual_cod             DATE,
  actual_feasible        BOOLEAN,    -- did the project actually interconnect?
  actual_withdrawn       BOOLEAN,

  -- When the outcome was observed
  outcome_observed_at    TIMESTAMPTZ,

  -- Residuals (computed by the validation pipeline)
  cost_residual_m        NUMERIC(10,2),  -- actual - p50 estimate
  cod_residual_months    INTEGER,         -- actual COD - p50 COD in months

  -- Whether the actual was within the model's interval
  within_cost_p10_p90    BOOLEAN,
  within_cod_p25_p75     BOOLEAN,

  notes                  TEXT,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ife_ot_analysis_id
  ON ife_outcome_tracking(analysis_id);

CREATE INDEX idx_ife_ot_tenant_observed
  ON ife_outcome_tracking(tenant_id, outcome_observed_at DESC)
  WHERE outcome_observed_at IS NOT NULL;

CREATE TRIGGER trg_ife_ot_updated_at
  BEFORE UPDATE ON ife_outcome_tracking
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Auto-compute residuals on outcome insert ──────────────────────────────────

CREATE OR REPLACE FUNCTION compute_ife_residuals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cost_p50  NUMERIC;
  v_cod_p50   DATE;
BEGIN
  IF NEW.actual_cost_m IS NOT NULL OR NEW.actual_cod IS NOT NULL THEN
    -- Pull the P50 estimates from the results tables
    SELECT ur.cost_p50_m INTO v_cost_p50
    FROM ife_upgrade_results ur
    WHERE ur.analysis_id = NEW.analysis_id
    LIMIT 1;

    SELECT tp.cod_p50 INTO v_cod_p50
    FROM ife_time_to_power tp
    WHERE tp.analysis_id = NEW.analysis_id
    LIMIT 1;

    -- Cost residual
    IF NEW.actual_cost_m IS NOT NULL AND v_cost_p50 IS NOT NULL THEN
      NEW.cost_residual_m := NEW.actual_cost_m - v_cost_p50;
    END IF;

    -- COD residual in months
    IF NEW.actual_cod IS NOT NULL AND v_cod_p50 IS NOT NULL THEN
      NEW.cod_residual_months :=
        EXTRACT(MONTH FROM AGE(NEW.actual_cod::TIMESTAMPTZ, v_cod_p50::TIMESTAMPTZ))::INTEGER;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ife_compute_residuals
  BEFORE INSERT OR UPDATE OF actual_cost_m, actual_cod ON ife_outcome_tracking
  FOR EACH ROW EXECUTE FUNCTION compute_ife_residuals();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE ife_analyses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ife_hosting_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE ife_upgrade_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ife_time_to_power    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ife_confidence_risk  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ife_explanations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ife_outcome_tracking ENABLE ROW LEVEL SECURITY;

-- Helper macro: all 7 tables get identical SELECT + INSERT policies
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ife_analyses',
    'ife_hosting_capacity',
    'ife_upgrade_results',
    'ife_time_to_power',
    'ife_confidence_risk',
    'ife_explanations',
    'ife_outcome_tracking'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated
         USING (tenant_id IN (
           SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
         ))',
      t || '_select', t
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated
         WITH CHECK (tenant_id IN (
           SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
         ))',
      t || '_insert', t
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated
         USING (tenant_id IN (
           SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
         ))',
      t || '_update', t
    );
  END LOOP;
END;
$$;
