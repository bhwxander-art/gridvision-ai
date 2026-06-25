-- ============================================================================
-- GridVision - SAFE Migration Patch V2
-- FULLY IDEMPOTENT - Safe to run multiple times
--
-- This migration:
-- ✅ Uses IF NOT EXISTS for all DDL operations
-- ✅ Does NOT drop any tables or columns
-- ✅ Does NOT overwrite any existing data
-- ✅ Can be safely re-run if interrupted
-- ✅ Validates schema before making changes
-- ============================================================================

-- ============================================================================
-- STEP 1: Create tenants table (if not exists)
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
-- STEP 2: Create auth support tables (if not exist)
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
-- STEP 3: Add tenant_id column to existing tables (if column doesn't exist)
-- These tables were created by 001_initial_schema.sql without tenant_id
-- ============================================================================

-- Add tenant_id to substations (if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'substations' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE substations ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add tenant_id to transformers (if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transformers' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE transformers ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add tenant_id to feeders (if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'feeders' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE feeders ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- STEP 4: Create capital_projects and scenarios tables (if not exist)
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

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- STEP 5: Create indexes (if not exist)
-- These are for tenant-scoped queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_substations_tenant ON substations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transformers_tenant ON transformers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_feeders_tenant ON feeders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_capital_projects_tenant ON capital_projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_capital_projects_substation ON capital_projects(substation_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_user ON user_tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_tenant ON user_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON import_jobs(tenant_id);

-- ============================================================================
-- STEP 6: Enable RLS on all tables (idempotent - no error if already enabled)
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
-- STEP 7: Create RLS policies (if not exist, drop and recreate for safety)
-- ============================================================================

-- Drop existing policies (if they exist) to avoid "policy already exists" errors
DROP POLICY IF EXISTS substations_tenant_isolation ON substations;
DROP POLICY IF EXISTS transformers_tenant_isolation ON transformers;
DROP POLICY IF EXISTS feeders_tenant_isolation ON feeders;
DROP POLICY IF EXISTS capital_projects_tenant_isolation ON capital_projects;

-- Create policies
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
-- STEP 8: Seed demo tenant (if not exists)
-- Uses ON CONFLICT to avoid duplicate key error
-- ============================================================================

INSERT INTO tenants (id, slug, name, type)
VALUES ('00000000-0000-0000-0000-000000000000', 'demo', 'GridVision Demo', 'demo')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STEP 9: Backfill tenant_id for existing rows (only NULL values)
-- This is SAFE - only updates rows that don't have a tenant_id
-- ============================================================================

UPDATE substations
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL AND EXISTS (
  SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000000'
);

UPDATE transformers
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL AND EXISTS (
  SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000000'
);

UPDATE feeders
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL AND EXISTS (
  SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000000'
);

-- ============================================================================
-- STEP 10: Make tenant_id NOT NULL (if column still allows NULL)
-- Only if there are no NULL values left
-- ============================================================================

DO $$
DECLARE
  null_count INT;
BEGIN
  -- Check for NULL values in substations
  SELECT COUNT(*) INTO null_count FROM substations WHERE tenant_id IS NULL;
  IF null_count = 0 THEN
    -- Safe to add NOT NULL constraint
    ALTER TABLE substations ALTER COLUMN tenant_id SET NOT NULL;
  END IF;

  -- Check for NULL values in transformers
  SELECT COUNT(*) INTO null_count FROM transformers WHERE tenant_id IS NULL;
  IF null_count = 0 THEN
    ALTER TABLE transformers ALTER COLUMN tenant_id SET NOT NULL;
  END IF;

  -- Check for NULL values in feeders
  SELECT COUNT(*) INTO null_count FROM feeders WHERE tenant_id IS NULL;
  IF null_count = 0 THEN
    ALTER TABLE feeders ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- STEP 11: Seed demo substations (if not exist)
-- Uses ON CONFLICT to avoid duplicate key error
-- ============================================================================

INSERT INTO substations (id, tenant_id, name, region, voltage_kv, nameplate_mva, peak_load_mw, latitude, longitude)
VALUES
  ('ss-boston-north', '00000000-0000-0000-0000-000000000000', 'Boston North 115/13.8 kV', 'North Shore', 115, 450, 342, 42.50, -70.95),
  ('ss-cambridge-central', '00000000-0000-0000-0000-000000000000', 'Cambridge Central 115/27 kV', 'Inner Metro', 115, 420, 398, 42.46, -71.12),
  ('ss-somerville-east', '00000000-0000-0000-0000-000000000000', 'Somerville East 27/13.8 kV', 'Inner Metro', 27, 290, 287, 42.47, -71.08),
  ('ss-waltham-west', '00000000-0000-0000-0000-000000000000', 'Waltham West 115/27 kV', 'Metro West', 115, 380, 315, 42.37, -71.26)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- VERIFICATION: Run these queries AFTER migration to confirm success
-- ============================================================================

-- Uncomment to run verification after migration completes:

/*
-- 1. Verify all required tables exist
SELECT 'TABLES' as check_type, table_name as name, 'OK' as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('tenants', 'users', 'user_tenants', 'substations', 'transformers', 'feeders', 'capital_projects')
ORDER BY table_name;

-- 2. Verify tenant_id columns exist
SELECT 'COLUMNS' as check_type, table_name, column_name, 'OK' as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('substations', 'transformers', 'feeders', 'capital_projects')
  AND column_name = 'tenant_id'
ORDER BY table_name;

-- 3. Verify demo tenant exists
SELECT 'DEMO_TENANT' as check_type, name, 'OK' as status
FROM tenants
WHERE id = '00000000-0000-0000-0000-000000000000';

-- 4. Verify demo substations exist
SELECT 'DEMO_DATA' as check_type, COUNT(*)::text as count, 'OK' as status
FROM substations
WHERE tenant_id = '00000000-0000-0000-0000-000000000000';

-- 5. Verify no NULL tenant_ids remain
SELECT 'NULL_CHECK' as check_type, 'PASS' as status
WHERE NOT EXISTS (
  SELECT 1 FROM substations WHERE tenant_id IS NULL
  UNION ALL
  SELECT 1 FROM transformers WHERE tenant_id IS NULL
  UNION ALL
  SELECT 1 FROM feeders WHERE tenant_id IS NULL
);

-- 6. Verify indexes exist
SELECT 'INDEXES' as check_type, COUNT(*)::text as count, 'OK' as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE '%tenant%';

-- 7. Verify RLS policies exist
SELECT 'RLS_POLICIES' as check_type, COUNT(*)::text as count, 'OK' as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('substations', 'transformers', 'feeders', 'capital_projects');
*/

-- ============================================================================
-- END OF MIGRATION
-- This script is safe to run multiple times without causing errors
-- ============================================================================
