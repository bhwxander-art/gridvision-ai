# GridVision Migration Deployment Guide

## Pre-Deployment Checklist

### Step 1: Inspect Current Schema

**File**: `docs/SCHEMA_INSPECTION.sql`

**What to do**:
1. Go to Supabase Dashboard
2. Open SQL Editor → New Query
3. Copy entire content of `SCHEMA_INSPECTION.sql`
4. Click "Run"
5. Review output and save/screenshot results

**Expected Output**:
```
Tables
─────────────────────────────────────
substations    EXISTS
transformers   EXISTS
feeders        EXISTS
[other tables...]

Column Status
─────────────────────────────────────
substations    tenant_id    MISSING (or EXISTS)
transformers   tenant_id    MISSING (or EXISTS)
feeders        tenant_id    MISSING (or EXISTS)

Row Counts
─────────────────────────────────────
substations    4 (or more)
transformers   0+ 
feeders        0+
```

**What it tells you**:
- ✅ Which tables exist
- ✅ Which tables are missing `tenant_id` column
- ✅ How many rows need backfill
- ✅ Which RLS policies exist
- ✅ Which indexes exist

---

## Deployment Process

### Step 2: Apply Migration Patch V2

**File**: `docs/SAFE_MIGRATION_PATCH_V2.sql`

**Why V2?**:
- ✅ 100% idempotent (safe to run multiple times)
- ✅ Uses IF NOT EXISTS for all DDL
- ✅ Only updates NULL values during backfill
- ✅ Does NOT drop tables or columns
- ✅ Does NOT overwrite existing data

**Deployment steps**:

1. **Open Supabase SQL Editor**
   - Go to https://supabase.com/dashboard
   - Select GridVision project
   - Click SQL Editor → New Query

2. **Copy the migration**
   - Open `docs/SAFE_MIGRATION_PATCH_V2.sql`
   - Select all (Ctrl+A)
   - Copy (Ctrl+C)

3. **Paste into Supabase**
   - In Supabase SQL Editor, paste (Ctrl+V)
   - You should see the entire migration script

4. **Execute**
   - Click the "Run" button
   - Wait for completion (should take < 15 seconds)
   - You should see: "SUCCESS" or similar confirmation

5. **Check for errors**
   - Scroll through output
   - Look for any error messages
   - If you see errors like "column already exists", that's SAFE and expected (means it was already there)

---

## Post-Deployment Verification

### Step 3: Verify Migration Success

**Run verification queries** (uncommented version at bottom of `SAFE_MIGRATION_PATCH_V2.sql`):

```sql
-- 1. Verify all tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('tenants', 'substations', 'transformers', 'feeders', 'capital_projects')
ORDER BY table_name;

-- Expected: 5 rows (tenants, substations, transformers, feeders, capital_projects)

-- 2. Verify tenant_id columns exist
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('substations', 'transformers', 'feeders')
  AND column_name = 'tenant_id'
ORDER BY table_name;

-- Expected: 3 rows (one for each table)

-- 3. Verify demo tenant
SELECT id, name FROM tenants WHERE id = '00000000-0000-0000-0000-000000000000';

-- Expected: 1 row with name = 'GridVision Demo'

-- 4. Verify no NULL tenant_ids
SELECT COUNT(*) as null_count FROM substations WHERE tenant_id IS NULL;
SELECT COUNT(*) as null_count FROM transformers WHERE tenant_id IS NULL;
SELECT COUNT(*) as null_count FROM feeders WHERE tenant_id IS NULL;

-- Expected: All should return 0

-- 5. Verify RLS policies
SELECT policyname FROM pg_policies 
WHERE tablename IN ('substations', 'transformers', 'feeders', 'capital_projects')
ORDER BY tablename, policyname;

-- Expected: 4 policies (one per table)
```

---

## Safety Guarantees

### Data Safety

| Aspect | Guarantee | Why |
|--------|-----------|-----|
| **No Data Deletion** | ✅ Zero rows deleted | Migration only uses INSERT/UPDATE/ALTER |
| **No Data Overwrite** | ✅ Only updates NULL values | WHERE tenant_id IS NULL condition protects existing data |
| **No Table Drop** | ✅ Uses CREATE TABLE IF NOT EXISTS | Existing tables preserved |
| **No Column Drop** | ✅ Only ADD COLUMN IF NOT EXISTS | Existing columns never removed |
| **Rollback Safe** | ✅ Can re-run migration | All operations are idempotent |

### Idempotency Guarantees

The migration uses:
- `CREATE TABLE IF NOT EXISTS` - Safe if table exists
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` - Safe if column exists
- `CREATE INDEX IF NOT EXISTS` - Safe if index exists
- `INSERT ... ON CONFLICT DO NOTHING` - Safe if rows exist
- `UPDATE WHERE IS NULL` - Safe if values already set
- `DROP POLICY IF EXISTS` then `CREATE POLICY` - Safe policy recreation

**Can this migration be run twice?** ✅ YES  
**Will it damage anything if run twice?** ✅ NO

---

## Troubleshooting

### Issue: "column already exists"

**Cause**: Column was added in a previous run  
**Action**: SAFE TO IGNORE - Migration will skip it  
**Example output**: `ERROR: column "tenant_id" of relation "substations" already exists`

### Issue: "policy already exists"

**Cause**: RLS policy already created  
**Action**: SAFE - Migration drops and recreates it  
**This is intentional** to ensure policies are correct

### Issue: "foreign key constraint failed"

**Cause**: Trying to add FK to non-existent tenants table  
**Action**: Should not happen - Migration creates tenants table first  
**If it occurs**: Check that tenants table was created in Step 1

### Issue: Migration times out (> 30 seconds)

**Cause**: Large dataset backfill on slow connection  
**Action**: Try again - Safe to re-run  
**If it happens repeatedly**: May have network issues with Supabase

---

## Validation Summary

### Before Migration

Run `SCHEMA_INSPECTION.sql`:
- [ ] Check current table status
- [ ] Identify missing columns
- [ ] Check row counts
- [ ] Save output

### During Migration

Run `SAFE_MIGRATION_PATCH_V2.sql`:
- [ ] Copy entire script to Supabase
- [ ] Click Run
- [ ] Wait for completion
- [ ] Note: Warnings about "already exists" are normal

### After Migration

Run verification queries:
- [ ] All 5 tables exist (tenants, substations, transformers, feeders, capital_projects)
- [ ] All 3 tables have tenant_id column (substations, transformers, feeders)
- [ ] Demo tenant exists (UUID: 00000000-0000-0000-0000-000000000000)
- [ ] No NULL tenant_ids remain
- [ ] 4 RLS policies created
- [ ] 8 indexes created

---

## Timeline

| Phase | Action | Time |
|-------|--------|------|
| 1 | Run schema inspection | 10 sec |
| 2 | Run migration patch | < 15 sec |
| 3 | Verify with queries | 10 sec |
| **Total** | **Complete deployment** | **< 40 seconds** |

---

## What Happens Next

After successful migration:

✅ **Grid Map** will work with database data  
✅ **`/api/substations`** will return real records (not mock)  
✅ **Multi-tenant isolation** will be active  
✅ **RLS policies** will enforce tenant boundaries  
✅ **Demo data** is ready for testing  

---

## Rollback Plan

If migration fails:

1. **Check error message** - Most errors are safe to ignore
2. **Re-run migration** - Safe to run again (idempotent)
3. **No rollback needed** - All operations are additive

If you need to revert:
- ❌ Do NOT drop tables
- ❌ Do NOT drop columns
- ✅ Just don't use the new columns/tables yet

---

## Files Needed

```
docs/SCHEMA_INSPECTION.sql          ← Run first (10 sec)
docs/SAFE_MIGRATION_PATCH_V2.sql    ← Run second (< 15 sec)
docs/MIGRATION_DEPLOYMENT_GUIDE.md  ← This file
```

---

## Contact & Support

If deployment fails:

1. Run `SCHEMA_INSPECTION.sql` again
2. Compare before/after output
3. Share:
   - Before schema inspection output
   - Error message from migration
   - After schema inspection output (if migration partially succeeded)

---

**Status**: ✅ Ready to Deploy  
**Risk Level**: 🟢 SAFE  
**Rollback Difficulty**: 🟢 EASY (re-run migration)

