-- =============================================================================
-- GridVision AI — Phase 13B Migration
-- Customer Data Platform
--
-- Idempotent — safe to run multiple times.
-- Creates: accounts · import_jobs
-- Requires Phase 13A migration to have been run first (tenants table must exist).
-- =============================================================================

-- ── 1. accounts ───────────────────────────────────────────────────────────────
-- CRM account records owned by a tenant.
-- Static demo data in lib/data/accounts.ts is the fallback when this table is empty.

CREATE TABLE IF NOT EXISTS accounts (
  id                    TEXT        PRIMARY KEY,
  tenant_id             UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  type                  TEXT        NOT NULL DEFAULT 'utility'
    CHECK (type IN (
      'utility','data-center-developer','hyperscaler','industrial-customer','investor'
    )),
  status                TEXT        NOT NULL DEFAULT 'lead'
    CHECK (status IN (
      'lead','qualified','assessment','proposal','negotiation','won'
    )),
  annual_load_mw        NUMERIC     NOT NULL DEFAULT 0,
  projected_growth_mw   NUMERIC     NOT NULL DEFAULT 0,
  territory             TEXT,
  estimated_revenue_usd BIGINT      NOT NULL DEFAULT 0,
  estimated_arr         BIGINT      NOT NULL DEFAULT 0,
  deal_probability      INTEGER     NOT NULL DEFAULT 0
    CHECK (deal_probability BETWEEN 0 AND 100),
  expected_close_date   DATE,
  forecast_quarter      TEXT,
  capacity_required_mw  NUMERIC     NOT NULL DEFAULT 0,
  priority              TEXT        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','strategic')),
  risk_rating           TEXT        NOT NULL DEFAULT 'medium'
    CHECK (risk_rating IN ('low','medium','high')),
  contact_name          TEXT,
  contact_title         TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS accounts_tenant_idx        ON accounts (tenant_id);
CREATE INDEX IF NOT EXISTS accounts_tenant_type_idx   ON accounts (tenant_id, type);
CREATE INDEX IF NOT EXISTS accounts_tenant_status_idx ON accounts (tenant_id, status);
CREATE INDEX IF NOT EXISTS accounts_tenant_created_idx ON accounts (tenant_id, created_at DESC);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON accounts;
CREATE POLICY "service_role_all" ON accounts
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "tenant_isolation" ON accounts;
CREATE POLICY "tenant_isolation" ON accounts FOR SELECT
  USING (
    auth.role() = 'service_role' OR
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ── 2. import_jobs ────────────────────────────────────────────────────────────
-- Audit trail for every CSV import operation.

CREATE TABLE IF NOT EXISTS import_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  entity_type     TEXT        NOT NULL
    CHECK (entity_type IN ('substations','transformers','feeders','accounts')),
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','partial','failed')),
  rows_processed  INTEGER     NOT NULL DEFAULT 0,
  rows_failed     INTEGER     NOT NULL DEFAULT 0,
  error_details   JSONB       NOT NULL DEFAULT '[]',
  filename        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS import_jobs_tenant_idx         ON import_jobs (tenant_id);
CREATE INDEX IF NOT EXISTS import_jobs_tenant_created_idx ON import_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS import_jobs_tenant_type_idx    ON import_jobs (tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS import_jobs_status_idx         ON import_jobs (status);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON import_jobs;
CREATE POLICY "service_role_all" ON import_jobs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "tenant_isolation" ON import_jobs;
CREATE POLICY "tenant_isolation" ON import_jobs FOR SELECT
  USING (
    auth.role() = 'service_role' OR
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ── 3. updated_at trigger for accounts ───────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_accounts_updated_at'
      AND tgrelid = 'accounts'::regclass
  ) THEN
    CREATE TRIGGER trg_accounts_updated_at
      BEFORE UPDATE ON accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ── 4. Seed demo accounts (optional — only if running against demo tenant) ────
-- These mirror lib/data/accounts.ts so that the demo tenant has DB records.
-- Remove this block if you do not want seed data.

INSERT INTO accounts (
  id, tenant_id, name, type, status,
  annual_load_mw, projected_growth_mw, territory,
  estimated_revenue_usd, estimated_arr, deal_probability,
  forecast_quarter, capacity_required_mw,
  priority, risk_rating, contact_name, contact_title, notes
)
SELECT
  id, '00000000-0000-0000-0000-000000000001', name, type, status,
  annual_load_mw, projected_growth_mw, territory,
  estimated_revenue_usd, estimated_arr, deal_probability,
  forecast_quarter, capacity_required_mw,
  priority, risk_rating, contact_name, contact_title, notes
FROM (VALUES
  ('acc-eversource','Eversource Energy','utility','negotiation',12400,1800,'New England',4100000,4100000,90,'2026-Q3',0,'strategic','low','Amanda Pierce','Director, Grid Modernization','Primary territory partner. MSA final stage.'),
  ('acc-aws','Amazon Web Services','hyperscaler','proposal',4200,500,'Eastern MA / New England',3200000,3200000,65,'2026-Q3',500,'strategic','high','Lisa Nguyen','Director, Grid Interconnection & Policy','500 MW across 3 sites. Project Helix at Waltham West.'),
  ('acc-microsoft','Microsoft Azure','hyperscaler','assessment',3800,450,'Eastern MA / New York',2900000,2900000,55,'2026-Q4',450,'strategic','medium','Rachel Simmons','VP, Global Energy & Sustainability','450 MW total pipeline. Kendall Hub Phase II IA-Executed.'),
  ('acc-national-grid','National Grid','utility','negotiation',8200,1100,'New England / New York',2800000,2800000,85,'2026-Q3',0,'strategic','low','Robert Ashe','SVP, Distribution Planning & Innovation','3-year joint planning agreement. MSA red-lines under review.'),
  ('acc-google','Google Cloud','hyperscaler','qualified',2100,320,'New England',2100000,2100000,35,'2027-Q1',320,'strategic','low','Thomas Reilly','Head of Energy & Sustainability, Americas','320 MW Cambridge AI campus. Load factor 0.97.')
) AS v(id,name,type,status,annual_load_mw,projected_growth_mw,territory,estimated_revenue_usd,estimated_arr,deal_probability,forecast_quarter,capacity_required_mw,priority,risk_rating,contact_name,contact_title,notes)
ON CONFLICT (id) DO NOTHING;
