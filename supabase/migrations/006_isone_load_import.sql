-- ============================================================
-- GridVision AI — ISO-NE Load Import
-- Migration 006 · Add raw_type to grid_load_history
-- ============================================================
--
-- Adds a nullable raw_type column to grid_load_history so that
-- ISO-NE CSV imports can preserve the original Type field
-- (e.g. "Real-Time Demand", "Day-Ahead Demand").
--
-- All existing rows receive NULL for raw_type, which is expected.
-- The ingestion script (scripts/import-isone-load.ts) populates
-- this column for newly imported rows.

ALTER TABLE grid_load_history
  ADD COLUMN IF NOT EXISTS raw_type TEXT;

COMMENT ON COLUMN grid_load_history.raw_type IS
  'Original Type field from ISO-NE export (e.g. "Real-Time Demand", "Day-Ahead Demand"). NULL for readings from other sources.';
