-- ============================================================
-- GridVision AI — Production Hardening
-- Migration 016 · Fixes to INFRA-001 through INFRA-004
-- ============================================================
-- Fixes three categories of critical production issues:
--
-- 1. O(n²) trigger: Replace row-level topology_hash trigger with
--    a statement-level trigger using transition tables (PostgreSQL 10+).
--    A 10,000-branch batch insert drops from O(n²) to O(n).
--
-- 2. EXTRACT(MONTH FROM AGE) bug: The expression returns only the
--    month component of an interval, not total months.
--    "2 years 3 months" returns 3, not 27.
--    Fixed in queue_project_status_history and ife_outcome_tracking.
--
-- 3. LMP price uniqueness: Add a unique index on lmp_prices to
--    prevent duplicate rows from cron retries corrupting the
--    lmp_hourly continuous aggregate.
-- ============================================================

-- ── 1. Fix O(n²) topology_hash trigger ───────────────────────────────────────

-- Drop the old row-level trigger and its function.
DROP TRIGGER IF EXISTS trg_branches_topology_hash ON network_branches;
DROP FUNCTION IF EXISTS refresh_topology_hash();

-- Statement-level function using transition tables.
-- Fires exactly ONCE per DML statement regardless of affected row count.
-- `affected_rows` is aliased from the transition table in each CREATE TRIGGER below.
CREATE OR REPLACE FUNCTION refresh_topology_hash_stmt()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE network_models nm
  SET
    topology_hash = sub.new_hash,
    ptdf_valid    = FALSE,
    lodf_valid    = FALSE,
    branch_count  = sub.total_count,
    updated_at    = NOW()
  FROM (
    SELECT
      aff.model_id,
      COALESCE(
        MD5(
          string_agg(
            b.from_bus_id::TEXT || '|' || b.to_bus_id::TEXT || '|' || b.x_pu::TEXT,
            ',' ORDER BY b.from_bus_id, b.to_bus_id, b.branch_number
          )
        ),
        MD5('')  -- empty model still gets a deterministic hash
      )                                                AS new_hash,
      (SELECT COUNT(*) FROM network_branches WHERE model_id = aff.model_id)
                                                       AS total_count
    FROM (SELECT DISTINCT model_id FROM affected_rows) aff
    LEFT JOIN network_branches b
           ON b.model_id = aff.model_id AND b.in_service = TRUE
    GROUP BY aff.model_id
  ) sub
  WHERE nm.id = sub.model_id
    AND (nm.topology_hash IS DISTINCT FROM sub.new_hash OR nm.topology_hash IS NULL);

  RETURN NULL; -- statement-level triggers must return NULL
END;
$$;

-- Three triggers: one per DML verb, each aliasing its transition table as `affected_rows`.
CREATE TRIGGER trg_branches_topology_hash_insert
  AFTER INSERT ON network_branches
  REFERENCING NEW TABLE AS affected_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_topology_hash_stmt();

CREATE TRIGGER trg_branches_topology_hash_update
  AFTER UPDATE ON network_branches
  REFERENCING NEW TABLE AS affected_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_topology_hash_stmt();

CREATE TRIGGER trg_branches_topology_hash_delete
  AFTER DELETE ON network_branches
  REFERENCING OLD TABLE AS affected_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_topology_hash_stmt();


-- ── 2. Fix EXTRACT(MONTH FROM AGE) bug in queue history trigger ───────────────

-- Original: EXTRACT(MONTH FROM AGE(NOW(), queue_date)) → returns only the
-- month component (0-11) of the interval, not total months elapsed.
-- A project queued 2 years 3 months ago showed months_in_queue = 3 (not 27).
--
-- Fix: multiply years by 12 and add months component.

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
      -- Total months in queue = years * 12 + months component
      (
        EXTRACT(YEAR  FROM AGE(NOW(), NEW.queue_date::TIMESTAMPTZ)) * 12 +
        EXTRACT(MONTH FROM AGE(NOW(), NEW.queue_date::TIMESTAMPTZ))
      )::INTEGER,
      NEW.network_upgrade_cost_m,
      NEW.project_cost_share_m,
      'trigger'
    );
  END IF;
  RETURN NEW;
END;
$$;


-- ── 3. Fix EXTRACT(MONTH FROM AGE) bug in IFE residual trigger ───────────────

-- Same bug: cod_residual_months would return only the month component,
-- not the total months between actual_cod and the P50 estimate.

CREATE OR REPLACE FUNCTION compute_ife_residuals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cost_p50  NUMERIC;
  v_cod_p50   DATE;
BEGIN
  IF NEW.actual_cost_m IS NOT NULL OR NEW.actual_cod IS NOT NULL THEN
    SELECT ur.cost_p50_m INTO v_cost_p50
    FROM ife_upgrade_results ur
    WHERE ur.analysis_id = NEW.analysis_id
    LIMIT 1;

    SELECT tp.cod_p50 INTO v_cod_p50
    FROM ife_time_to_power tp
    WHERE tp.analysis_id = NEW.analysis_id
    LIMIT 1;

    IF NEW.actual_cost_m IS NOT NULL AND v_cost_p50 IS NOT NULL THEN
      NEW.cost_residual_m := NEW.actual_cost_m - v_cost_p50;
    END IF;

    -- Total months = years * 12 + month component (not just month component)
    IF NEW.actual_cod IS NOT NULL AND v_cod_p50 IS NOT NULL THEN
      NEW.cod_residual_months := (
        EXTRACT(YEAR  FROM AGE(NEW.actual_cod::TIMESTAMPTZ, v_cod_p50::TIMESTAMPTZ)) * 12 +
        EXTRACT(MONTH FROM AGE(NEW.actual_cod::TIMESTAMPTZ, v_cod_p50::TIMESTAMPTZ))
      )::INTEGER;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ── 4. Unique index on lmp_prices to prevent ingestion duplicates ─────────────

-- Without this, a cron retry inserts duplicate LMP rows, and the lmp_hourly
-- continuous aggregate double-counts them. All ingestion should use
-- ON CONFLICT DO NOTHING against this constraint.
--
-- TimescaleDB requires the partitioning column (ts) in unique indexes.
-- interval_min is included because the same pnode can have RT 5-min and DA
-- hourly rows for the same hour, which are different records.

CREATE UNIQUE INDEX IF NOT EXISTS idx_lmp_prices_unique
  ON lmp_prices (ts, tenant_id, iso_id, pnode_id, market_type, interval_min);

-- Unique index on scada_readings.
-- bus_id and branch_id can be NULL; using COALESCE makes NULLs comparable.
-- The nil UUID is used as a sentinel for "no association".
CREATE UNIQUE INDEX IF NOT EXISTS idx_scada_readings_unique
  ON scada_readings (
    ts,
    tenant_id,
    COALESCE(bus_id,    '00000000-0000-0000-0000-000000000000'),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'),
    measurement_type,
    source
  );


-- ── 5. DELETE policies for IFE tables ────────────────────────────────────────

-- The IFE tables were created with SELECT + INSERT + UPDATE policies but no
-- DELETE policy. Without DELETE, tenants cannot clean up failed or test analyses
-- through the authenticated client. Adding explicit policies here.

CREATE POLICY ife_analyses_delete ON ife_analyses
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY ife_hosting_capacity_delete ON ife_hosting_capacity
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY ife_upgrade_results_delete ON ife_upgrade_results
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY ife_time_to_power_delete ON ife_time_to_power
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY ife_confidence_risk_delete ON ife_confidence_risk
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY ife_explanations_delete ON ife_explanations
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY ife_outcome_tracking_delete ON ife_outcome_tracking
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));
