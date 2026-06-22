-- ============================================================
-- GridVision AI — Scenario Ownership
-- Migration 005 · Add user_id to scenarios for per-user isolation
-- ============================================================
-- Prerequisite: Migration 003 (scenarios table), 004 (RLS enabled)
-- ============================================================

-- Add user_id column; nullable so existing rows are not broken.
-- The service-role API routes always pass a user_id for new inserts.
-- Rows with user_id IS NULL are legacy/dev-mode rows.
ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scenarios_user_id ON scenarios(user_id);

-- ── Replace permissive policies with owner-scoped ones ─────────────────────────

DROP POLICY IF EXISTS "scenarios_select" ON scenarios;
DROP POLICY IF EXISTS "scenarios_insert" ON scenarios;
DROP POLICY IF EXISTS "scenarios_delete" ON scenarios;

-- Authenticated users see only their own scenarios
CREATE POLICY "scenarios_select"
  ON scenarios FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Authenticated users may only insert rows they own
CREATE POLICY "scenarios_insert"
  ON scenarios FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Authenticated users may only delete their own scenarios
CREATE POLICY "scenarios_delete"
  ON scenarios FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
