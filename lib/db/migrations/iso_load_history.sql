-- Create iso_load_history table for ISO-NE load data
CREATE TABLE IF NOT EXISTS iso_load_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL UNIQUE,
  actual_load_mw NUMERIC NOT NULL,
  forecast_load_mw NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on timestamp for efficient queries
CREATE INDEX IF NOT EXISTS idx_iso_load_timestamp
  ON iso_load_history(timestamp DESC);

-- Index on created_at for recent data queries
CREATE INDEX IF NOT EXISTS idx_iso_load_created
  ON iso_load_history(created_at DESC);

-- Enable RLS (disable for now - no tenant scoping needed for system data)
ALTER TABLE iso_load_history ENABLE ROW LEVEL SECURITY;

-- Allow service role to read/write
CREATE POLICY "service_role_all"
  ON iso_load_history
  AS PERMISSIVE
  FOR ALL
  TO "service_role"
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to read
CREATE POLICY "authenticated_read"
  ON iso_load_history
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE iso_load_history IS 'ISO-NE system load data (actual and forecast)';
COMMENT ON COLUMN iso_load_history.timestamp IS 'Timestamp of load measurement';
COMMENT ON COLUMN iso_load_history.actual_load_mw IS 'Actual system load in MW';
COMMENT ON COLUMN iso_load_history.forecast_load_mw IS 'Forecasted system load in MW';
