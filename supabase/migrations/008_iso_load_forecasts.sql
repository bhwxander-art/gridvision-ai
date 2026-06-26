-- 008_iso_load_forecasts.sql
-- Short-term ISO-NE load forecasts from the statistical model.
-- Separate from forecast_runs (enterprise territory planning).

CREATE TABLE IF NOT EXISTS iso_load_forecasts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_for    TIMESTAMPTZ NOT NULL,
  predicted_load_mw  NUMERIC    NOT NULL,
  confidence_low_mw  NUMERIC    NOT NULL,
  confidence_high_mw NUMERIC    NOT NULL,
  model_type      TEXT        NOT NULL DEFAULT 'weighted-hour-of-day',
  model_version   TEXT        NOT NULL DEFAULT '1.0',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT iso_load_forecasts_unique_per_model
    UNIQUE (forecast_for, model_version)
);

CREATE INDEX IF NOT EXISTS idx_iso_forecasts_for
  ON iso_load_forecasts(forecast_for DESC);

CREATE INDEX IF NOT EXISTS idx_iso_forecasts_generated
  ON iso_load_forecasts(generated_at DESC);

-- Allow service role full access
ALTER TABLE iso_load_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON iso_load_forecasts
  AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read" ON iso_load_forecasts
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE iso_load_forecasts IS 'Statistical model forecasts for ISO-NE system load (hourly, up to 168h ahead)';
