-- =============================================================================
-- GridVision AI — Phase 13A Migration
-- Multi-Tenant SaaS Foundation
--
-- Idempotent — safe to run multiple times.
-- Creates: tenants · users · user_tenants
-- Extends: substations · transformers · feeders · capital_projects · scenarios
--          with tenant_id (nullable for backward compat, then defaulted)
-- Seeds:   "GridVision Demo" tenant with well-known UUID
-- =============================================================================

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. tenants ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT        UNIQUE NOT NULL
               CHECK (slug ~ '^[a-z0-9-]+$'),
  name       TEXT        NOT NULL,
  type       TEXT        NOT NULL DEFAULT 'utility'
               CHECK (type IN ('utility','developer','consultant','investor','demo')),
  plan       TEXT        NOT NULL DEFAULT 'trial'
               CHECK (plan IN ('trial','professional','enterprise')),
  status     TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','suspended','cancelled')),
  settings   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenants_slug_idx    ON tenants (slug);
CREATE INDEX IF NOT EXISTS tenants_status_idx  ON tenants (status);

-- ── 2. public users profile ───────────────────────────────────────────────────
-- Extends auth.users with display data and the super-admin flag.
-- The id is a FK to auth.users so sign-up creates both rows.

CREATE TABLE IF NOT EXISTS users (
  id             UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email          TEXT        NOT NULL,
  full_name      TEXT,
  avatar_url     TEXT,
  is_super_admin BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- ── 3. user_tenants (membership junction) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_tenants (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants (id)  ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'read_only'
                CHECK (role IN (
                  'super_admin','utility_executive','planner',
                  'engineer','sales','read_only'
                )),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS user_tenants_user_idx   ON user_tenants (user_id);
CREATE INDEX IF NOT EXISTS user_tenants_tenant_idx ON user_tenants (tenant_id);
CREATE INDEX IF NOT EXISTS user_tenants_active_idx ON user_tenants (tenant_id, is_active);

-- ── 4. Seed "GridVision Demo" tenant ─────────────────────────────────────────

INSERT INTO tenants (id, slug, name, type, plan, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'gridvision-demo',
  'GridVision Demo',
  'demo',
  'enterprise',
  'active'
) ON CONFLICT (id) DO NOTHING;

-- ── 5. Add tenant_id to existing tables ──────────────────────────────────────
-- Nullable first so existing rows are unaffected.
-- Then populated with the demo tenant UUID.
-- Constraint added after population.

-- substations
ALTER TABLE substations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE substations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- transformers
ALTER TABLE transformers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE transformers SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- feeders
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE feeders SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- capital_projects
ALTER TABLE capital_projects ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE capital_projects SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- scenarios
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE scenarios SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- ── 6. Indexes on tenant_id ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS substations_tenant_idx    ON substations    (tenant_id);
CREATE INDEX IF NOT EXISTS transformers_tenant_idx   ON transformers   (tenant_id);
CREATE INDEX IF NOT EXISTS feeders_tenant_idx        ON feeders        (tenant_id);
CREATE INDEX IF NOT EXISTS capital_projects_tenant_created_idx
  ON capital_projects (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scenarios_tenant_status_idx
  ON scenarios (tenant_id, created_at DESC);

-- ── 7. Row Level Security ─────────────────────────────────────────────────────
-- Service-role key bypasses RLS so existing server-side code is unaffected.
-- Anon / authenticated keys see only rows matching their tenant memberships.

-- tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super_admin_all"    ON tenants;
DROP POLICY IF EXISTS "member_read_own"    ON tenants;
CREATE POLICY "super_admin_all" ON tenants
  USING (auth.role() = 'service_role');
CREATE POLICY "member_read_own" ON tenants FOR SELECT
  USING (
    id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON users;
DROP POLICY IF EXISTS "self_read"        ON users;
CREATE POLICY "service_role_all" ON users USING (auth.role() = 'service_role');
CREATE POLICY "self_read"        ON users FOR SELECT USING (id = auth.uid());

-- user_tenants
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all"    ON user_tenants;
DROP POLICY IF EXISTS "tenant_member_read"  ON user_tenants;
CREATE POLICY "service_role_all"   ON user_tenants USING (auth.role() = 'service_role');
CREATE POLICY "tenant_member_read" ON user_tenants FOR SELECT
  USING (user_id = auth.uid());

-- substations (extend existing policy)
DROP POLICY IF EXISTS "tenant_isolation" ON substations;
CREATE POLICY "tenant_isolation" ON substations FOR SELECT
  USING (
    auth.role() = 'service_role' OR
    tenant_id IS NULL OR
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- transformers
DROP POLICY IF EXISTS "tenant_isolation" ON transformers;
CREATE POLICY "tenant_isolation" ON transformers FOR SELECT
  USING (
    auth.role() = 'service_role' OR
    tenant_id IS NULL OR
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- feeders
DROP POLICY IF EXISTS "tenant_isolation" ON feeders;
CREATE POLICY "tenant_isolation" ON feeders FOR SELECT
  USING (
    auth.role() = 'service_role' OR
    tenant_id IS NULL OR
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- capital_projects
DROP POLICY IF EXISTS "tenant_isolation" ON capital_projects;
CREATE POLICY "tenant_isolation" ON capital_projects FOR SELECT
  USING (
    auth.role() = 'service_role' OR
    tenant_id IS NULL OR
    tenant_id IN (
      SELECT tenant_id FROM user_tenants
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ── 8. updated_at triggers for new tables ────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tenants', 'users']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_' || tbl || '_updated_at'
        AND tgrelid = tbl::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %s
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        tbl, tbl
      );
    END IF;
  END LOOP;
END;
$$;
