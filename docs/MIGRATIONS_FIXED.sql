-- ============================================================================
-- GridVision Supabase Migrations - FIXED VERSION
-- Apply in Supabase Dashboard → SQL Editor
-- ============================================================================

-- ============================================================================
-- Phase 1: Core Tables (001_initial_schema.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS substations (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  voltage_kv DECIMAL(8, 2) NOT NULL,
  nameplate_mva DECIMAL(10, 2) NOT NULL,
  peak_load_mw DECIMAL(10, 2) NOT NULL,
  n1_capacity_mw DECIMAL(10, 2),
  annual_growth_pct DECIMAL(5, 2),
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transformers (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  substation_id TEXT NOT NULL REFERENCES substations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rated_mva DECIMAL(10, 2) NOT NULL,
  peak_load_mva DECIMAL(10, 2) NOT NULL,
  load_factor DECIMAL(5, 3) NOT NULL,
  age_years INT,
  n1_compliant BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feeders (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  substation_id TEXT NOT NULL REFERENCES substations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hosting_capacity_mw DECIMAL(10, 2) NOT NULL,
  committed_load_mw DECIMAL(10, 2),
  queued_load_mw DECIMAL(10, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capital_projects (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  substation_id TEXT NOT NULL REFERENCES substations(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  upgrade_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  estimated_cost_usd DECIMAL(15, 2),
  added_capacity_mw DECIMAL(10, 2),
  implementation_months INT,
  risk_reduction INT,
  priority_score INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grid_load_history (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  load_mw DECIMAL(10, 2) NOT NULL,
  capacity_mw DECIMAL(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS data_center_queue (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  capacity_mw DECIMAL(10, 2) NOT NULL,
  expected_online_month INT,
  expected_online_year INT,
  region TEXT
);

-- ============================================================================
-- Phase 13A: Multi-Tenant Tables (migrate-13a.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'business',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  is_super_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tenant_id)
);

-- ============================================================================
-- Phase 13B: Additional Tables (migrate-13b.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size INT,
  row_count INT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================================
-- Other Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_substations_tenant ON substations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transformers_tenant ON transformers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transformers_substation ON transformers(substation_id);
CREATE INDEX IF NOT EXISTS idx_feeders_tenant ON feeders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_feeders_substation ON feeders(substation_id);
CREATE INDEX IF NOT EXISTS idx_capital_projects_tenant ON capital_projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_capital_projects_substation ON capital_projects(substation_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_user ON user_tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_tenant ON user_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON import_jobs(tenant_id);

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

ALTER TABLE substations ENABLE ROW LEVEL SECURITY;
ALTER TABLE transformers ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeders ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY substations_tenant_isolation ON substations
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY transformers_tenant_isolation ON transformers
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY feeders_tenant_isolation ON feeders
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY capital_projects_tenant_isolation ON capital_projects
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- Seed Demo Tenant (required for demo/fallback)
-- ============================================================================

INSERT INTO tenants (id, slug, name, type)
VALUES ('00000000-0000-0000-0000-000000000000', 'demo', 'GridVision Demo', 'demo')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Seed Demo Substations - Execute SEPARATELY (one INSERT per statement)
-- ============================================================================

INSERT INTO substations (id, tenant_id, name, region, voltage_kv, nameplate_mva, peak_load_mw, latitude, longitude)
VALUES ('ss-boston-north', '00000000-0000-0000-0000-000000000000', 'Boston North 115/13.8 kV', 'North Shore', 115, 450, 342, 42.50, -70.95)
ON CONFLICT (id) DO NOTHING;

INSERT INTO substations (id, tenant_id, name, region, voltage_kv, nameplate_mva, peak_load_mw, latitude, longitude)
VALUES ('ss-cambridge-central', '00000000-0000-0000-0000-000000000000', 'Cambridge Central 115/27 kV', 'Inner Metro', 115, 420, 398, 42.46, -71.12)
ON CONFLICT (id) DO NOTHING;

INSERT INTO substations (id, tenant_id, name, region, voltage_kv, nameplate_mva, peak_load_mw, latitude, longitude)
VALUES ('ss-somerville-east', '00000000-0000-0000-0000-000000000000', 'Somerville East 27/13.8 kV', 'Inner Metro', 27, 290, 287, 42.47, -71.08)
ON CONFLICT (id) DO NOTHING;

INSERT INTO substations (id, tenant_id, name, region, voltage_kv, nameplate_mva, peak_load_mw, latitude, longitude)
VALUES ('ss-waltham-west', '00000000-0000-0000-0000-000000000000', 'Waltham West 115/27 kV', 'Metro West', 115, 380, 315, 42.37, -71.26)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Verification Queries - Run these after all migrations complete
-- ============================================================================

-- SELECT count(*) as substation_count FROM substations;
-- SELECT count(*) as tenant_count FROM tenants;
-- SELECT id, name FROM tenants;
-- SELECT id, name, latitude, longitude FROM substations WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
