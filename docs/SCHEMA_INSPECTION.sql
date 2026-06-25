-- ============================================================================
-- GridVision - Current Schema Inspection
-- Run this BEFORE applying SAFE_MIGRATION_PATCH.sql
--
-- This query checks the current state of your Supabase schema
-- and helps identify what already exists vs what needs to be created
-- ============================================================================

-- ============================================================================
-- 1. Check which tables exist
-- ============================================================================
SELECT
  'Tables' as category,
  table_name as name,
  'EXISTS' as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ============================================================================
-- 2. Check tenant_id columns in key tables
-- ============================================================================
SELECT
  'Column Status' as category,
  table_name,
  'tenant_id' as column_name,
  CASE WHEN column_name IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END as status,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name IN ('substations', 'transformers', 'feeders', 'capital_projects', 'scenarios')
  AND column_name = 'tenant_id'
ORDER BY table_name;

-- ============================================================================
-- 3. Check for tables that SHOULD have tenant_id but DON'T
-- ============================================================================
SELECT
  'Missing tenant_id' as category,
  t.table_name,
  'tenant_id' as missing_column,
  'NOT FOUND' as status
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('substations', 'transformers', 'feeders', 'capital_projects', 'scenarios')
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = t.table_name
      AND c.column_name = 'tenant_id'
  )
ORDER BY table_name;

-- ============================================================================
-- 4. Check if tenants table exists
-- ============================================================================
SELECT
  'Core Tables' as category,
  table_name,
  'EXISTS' as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('tenants', 'users', 'user_tenants', 'accounts', 'import_jobs')
ORDER BY table_name;

-- ============================================================================
-- 5. Check existing indexes on tenant_id
-- ============================================================================
SELECT
  'Indexes' as category,
  indexname,
  tablename,
  'EXISTS' as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND (indexname LIKE '%tenant%' OR tablename IN ('substations', 'transformers', 'feeders'))
ORDER BY tablename, indexname;

-- ============================================================================
-- 6. Check existing RLS policies
-- ============================================================================
SELECT
  'RLS Policies' as category,
  policyname,
  tablename,
  'EXISTS' as status,
  cmd as policy_type
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('substations', 'transformers', 'feeders', 'capital_projects')
ORDER BY tablename, policyname;

-- ============================================================================
-- 7. Check RLS enabled status
-- ============================================================================
SELECT
  'RLS Status' as category,
  tablename,
  CASE WHEN rowsecurity THEN 'ENABLED' ELSE 'DISABLED' END as status
FROM pg_class
JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
WHERE pg_namespace.nspname = 'public'
  AND pg_class.relname IN ('substations', 'transformers', 'feeders', 'capital_projects', 'users', 'user_tenants', 'accounts', 'import_jobs')
ORDER BY pg_class.relname;

-- ============================================================================
-- 8. Check if demo tenant exists
-- ============================================================================
SELECT
  'Demo Tenant' as category,
  id,
  name,
  'EXISTS' as status
FROM tenants
WHERE id = '00000000-0000-0000-0000-000000000000'
LIMIT 1;

-- If the above query fails, it means tenants table doesn't exist yet

-- ============================================================================
-- 9. Count rows in key tables
-- ============================================================================
SELECT
  'Row Counts' as category,
  'substations' as table_name,
  COUNT(*) as row_count
FROM substations
UNION ALL
SELECT 'Row Counts', 'transformers', COUNT(*) FROM transformers
UNION ALL
SELECT 'Row Counts', 'feeders', COUNT(*) FROM feeders
UNION ALL
SELECT 'Row Counts', 'capital_projects', COUNT(*) FROM capital_projects
UNION ALL
SELECT 'Row Counts', 'tenants', COUNT(*) FROM tenants
UNION ALL
SELECT 'Row Counts', 'users', COUNT(*) FROM users
UNION ALL
SELECT 'Row Counts', 'user_tenants', COUNT(*) FROM user_tenants
ORDER BY table_name;

-- ============================================================================
-- 10. Check for NULL tenant_id values that need backfill
-- ============================================================================
SELECT
  'NULL Check' as category,
  'substations' as table_name,
  COUNT(*) as null_count
FROM substations
WHERE tenant_id IS NULL
UNION ALL
SELECT 'NULL Check', 'transformers', COUNT(*) FROM transformers WHERE tenant_id IS NULL
UNION ALL
SELECT 'NULL Check', 'feeders', COUNT(*) FROM feeders WHERE tenant_id IS NULL
ORDER BY table_name;

-- ============================================================================
-- SUMMARY SECTION
-- Run the above queries to generate a report
-- Then provide this output when applying SAFE_MIGRATION_PATCH_V2.sql
-- ============================================================================
