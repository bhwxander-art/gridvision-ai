-- ============================================================
-- GridVision AI — Auth & Row-Level Security
-- Migration 004 · RLS policies for user-owned data
-- ============================================================
-- Prerequisite: Supabase Auth must be enabled.
-- The service-role key used by API routes bypasses RLS.
-- These policies protect direct anon/user-key access.
-- ============================================================

-- ── scenarios ─────────────────────────────────────────────────────────────────

ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all scenarios (shared planning workspace)
CREATE POLICY "scenarios_select"
  ON scenarios FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can create scenarios
CREATE POLICY "scenarios_insert"
  ON scenarios FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can delete any scenario (shared workspace)
CREATE POLICY "scenarios_delete"
  ON scenarios FOR DELETE
  TO authenticated
  USING (true);
