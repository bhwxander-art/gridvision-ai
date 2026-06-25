-- ============================================================================
-- GridVision - SAFE Migration Patch
-- Fixes: "column tenant_id does not exist" error
--
-- ROOT CAUSE:
-- - 001_initial_schema.sql created substations, transformers, feeders WITHOUT tenant_id
-- - New migrations expect tenant_id column for multi-tenant support
-- - Previous SQL tried to INSERT into tenant_id before column existed
--
-- SOLUTION:
-- 1. Create tenants table (if not exists)
-- 2. ALTER existing tables to ADD tenant_id column (if not exists)
-- 3. Backfill demo tenant UUID
-- 4. Create indexes and RLS policies
-- ============================================================================

-- ============================================================================
-- STEP 1: Create tenants table (required first)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'business',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- STEP 2: Create auth support tables
-- ============================================================================

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
-- STEP 3: ALTER existing tables to ADD tenant_id column
-- These tables already exist from 001_initial_schema.sql
-- ============================================================================

ALTER TABLE substations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE transformers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES substations(id) ON DELETE CASCADE;
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES substations(id) ON DELETE CASCADE;

-- ============================================================================
-- STEP 4: Create capital_projects if it doesn't exist
-- ============================================================================

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

-- ============================================================================
-- STEP 5: Create scenarios if it doesn't exist
-- ============================================================================

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- STEP 6: Create indexes for tenant-scoped queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_substations_tenant ON substations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transformers_tenant ON transformers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_feeders_tenant ON feeders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_capital_projects_tenant ON capital_projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_user ON user_tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_tenant ON user_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON import_jobs(tenant_id);

-- ============================================================================
-- STEP 7: Enable RLS on all tables
-- ============================================================================

ALTER TABLE substations ENABLE ROW LEVEL SECURITY;
ALTER TABLE transformers ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeders ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 8: Create RLS Policies for tenant isolation
-- ============================================================================

DROP POLICY IF EXISTS substations_tenant_isolation ON substations;
CREATE POLICY substations_tenant_isolation ON substations
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS transformers_tenant_isolation ON transformers;
CREATE POLICY transformers_tenant_isolation ON transformers
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS feeders_tenant_isolation ON feeders;
CREATE POLICY feeders_tenant_isolation ON feeders
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS capital_projects_tenant_isolation ON capital_projects;
CREATE POLICY capital_projects_tenant_isolation ON capital_projects
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- STEP 9: Seed demo tenant (required for fallback)
-- ============================================================================

INSERT INTO tenants (id, slug, name, type)
VALUES ('00000000-0000-0000-0000-000000000000', 'demo', 'GridVision Demo', 'demo')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STEP 10: Backfill tenant_id for existing substations
-- All existing rows get assigned to demo tenant
-- ============================================================================

UPDATE substations
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

UPDATE transformers
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

UPDATE feeders
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

-- ============================================================================
-- STEP 11: Add NOT NULL constraint to tenant_id
-- (Only after backfill completes)
-- ============================================================================

ALTER TABLE substations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE transformers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE feeders ALTER COLUMN tenant_id SET NOT NULL;

-- ============================================================================
-- STEP 12: Seed demo substations (if they don't exist)
-- ============================================================================

INSERT INTO substations (id, tenant_id, name, region, voltage_kv, nameplate_mva, peak_load_mw, latitude, longitude)
VALUES
  ('ss-boston-north', '00000000-0000-0000-0000-000000000000', 'Boston North 115/13.8 kV', 'North Shore', 115, 450, 342, 42.50, -70.95),
  ('ss-cambridge-central', '00000000-0000-0000-0000-000000000000', 'Cambridge Central 115/27 kV', 'Inner Metro', 115, 420, 398, 42.46, -71.12),
  ('ss-somerville-east', '00000000-0000-0000-0000-000000000000', 'Somerville East 27/13.8 kV', 'Inner Metro', 27, 290, 287, 42.47, -71.08),
  ('ss-waltham-west', '00000000-0000-0000-0000-000000000000', 'Waltham West 115/27 kV', 'Metro West', 115, 380, 315, 42.37, -71.26)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- VERIFICATION: Run these queries to confirm migration succeeded
-- ============================================================================

-- SELECT 'Migration Status' as check;
-- SELECT count(*) as tenants FROM tenants;
-- SELECT count(*) as substations FROM substations WHERE tenant_id IS NOT NULL;
-- SELECT count(*) as transformers FROM transformers WHERE tenant_id IS NOT NULL;
-- SELECT count(*) as feeders FROM feeders WHERE tenant_id IS NOT NULL;
-- SELECT id, name, tenant_id FROM substations LIMIT 5;
