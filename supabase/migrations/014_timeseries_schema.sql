-- ============================================================
-- GridVision AI — Time-Series Hypertables
-- Migration 014 · INFRA-003: SCADA, LMP, generation, weather
-- ============================================================
-- TimescaleDB hypertables for high-frequency grid data.
-- All tables are append-only — rows are never updated in place.
-- Retention and compression policies are set per table.
--
-- NOTE: This migration requires TimescaleDB to be installed.
-- On Supabase, enable via Dashboard → Extensions → timescaledb.
-- If TimescaleDB is not available, the CREATE TABLE statements
-- still work but the hypertable and continuous aggregate calls
-- must be run separately once the extension is enabled.
-- ============================================================

-- Enable TimescaleDB if not already enabled
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── scada_readings ────────────────────────────────────────────────────────────
-- Raw SCADA telemetry from EMS/SCADA systems.
-- Typical resolution: 4-second to 1-minute per measurement point.
-- Primary source for real-time state estimation (PEDT).

CREATE TABLE scada_readings (
  ts              TIMESTAMPTZ   NOT NULL,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model_id        UUID          REFERENCES network_models(id) ON DELETE SET NULL,
  bus_id          UUID          REFERENCES network_buses(id) ON DELETE SET NULL,
  branch_id       UUID          REFERENCES network_branches(id) ON DELETE SET NULL,

  -- What is being measured
  measurement_type TEXT         NOT NULL,
    -- 'voltage_mag_pu'  — bus voltage magnitude in per-unit
    -- 'voltage_ang_deg' — bus voltage angle in degrees
    -- 'active_power_mw' — MW injection (positive = generation)
    -- 'reactive_power_mvar'
    -- 'line_flow_mw'    — branch active power flow
    -- 'line_flow_mvar'
    -- 'frequency_hz'    — system frequency
    -- 'current_ka'      — branch current magnitude

  value           DOUBLE PRECISION NOT NULL,
  quality         SMALLINT      NOT NULL DEFAULT 0,
    -- 0 = good, 1 = suspect, 2 = bad, 3 = estimated

  source          TEXT          NOT NULL DEFAULT 'SCADA',
    -- 'SCADA' | 'PMU' | 'AMI' | 'ESTIMATED'

  CONSTRAINT scada_readings_measurement_type_valid CHECK (
    measurement_type IN (
      'voltage_mag_pu', 'voltage_ang_deg',
      'active_power_mw', 'reactive_power_mvar',
      'line_flow_mw', 'line_flow_mvar',
      'frequency_hz', 'current_ka'
    )
  ),
  CONSTRAINT scada_readings_quality_range CHECK (quality BETWEEN 0 AND 3)
);

-- Partition by 1-day time chunks
SELECT create_hypertable(
  'scada_readings', 'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE
);

-- Compress chunks older than 7 days
SELECT add_compression_policy(
  'scada_readings',
  compress_after => INTERVAL '7 days',
  if_not_exists  => TRUE
);

-- Primary query pattern: all readings for a bus/branch in a time range
CREATE INDEX idx_scada_bus_ts
  ON scada_readings(bus_id, ts DESC)
  WHERE bus_id IS NOT NULL;

CREATE INDEX idx_scada_branch_ts
  ON scada_readings(branch_id, ts DESC)
  WHERE branch_id IS NOT NULL;

CREATE INDEX idx_scada_tenant_ts
  ON scada_readings(tenant_id, ts DESC);

-- ── lmp_prices ────────────────────────────────────────────────────────────────
-- Locational Marginal Prices from ISO real-time and day-ahead markets.
-- Resolution: 5-minute (real-time) or hourly (day-ahead).

CREATE TABLE lmp_prices (
  ts              TIMESTAMPTZ   NOT NULL,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  iso_id          TEXT          NOT NULL REFERENCES isos(id),
  bus_id          UUID          REFERENCES network_buses(id) ON DELETE SET NULL,

  -- ISO's own pricing node identifier (e.g. PJM pnode_id)
  pnode_id        TEXT          NOT NULL,
  pnode_name      TEXT,

  -- LMP decomposition
  lmp_total       DOUBLE PRECISION NOT NULL,   -- $/MWh
  lmp_energy      DOUBLE PRECISION,            -- energy component
  lmp_congestion  DOUBLE PRECISION,            -- congestion component
  lmp_loss        DOUBLE PRECISION,            -- loss component

  market_type     TEXT          NOT NULL DEFAULT 'RT',  -- 'RT' | 'DA'
  interval_min    SMALLINT      NOT NULL DEFAULT 5,

  CONSTRAINT lmp_market_type_valid CHECK (market_type IN ('RT', 'DA')),
  CONSTRAINT lmp_interval_valid    CHECK (interval_min IN (5, 15, 60))
);

SELECT create_hypertable(
  'lmp_prices', 'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE
);

SELECT add_compression_policy(
  'lmp_prices',
  compress_after => INTERVAL '7 days',
  if_not_exists  => TRUE
);

CREATE INDEX idx_lmp_pnode_ts
  ON lmp_prices(iso_id, pnode_id, ts DESC);

CREATE INDEX idx_lmp_bus_ts
  ON lmp_prices(bus_id, ts DESC)
  WHERE bus_id IS NOT NULL;

CREATE INDEX idx_lmp_tenant_ts
  ON lmp_prices(tenant_id, iso_id, ts DESC);

-- 1-hour continuous aggregate for fast historical LMP queries
CREATE MATERIALIZED VIEW lmp_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  tenant_id,
  iso_id,
  pnode_id,
  market_type,
  AVG(lmp_total)      AS lmp_avg,
  MIN(lmp_total)      AS lmp_min,
  MAX(lmp_total)      AS lmp_max,
  COUNT(*)            AS sample_count
FROM lmp_prices
GROUP BY bucket, tenant_id, iso_id, pnode_id, market_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'lmp_hourly',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

-- ── generator_output ──────────────────────────────────────────────────────────
-- Actual and scheduled generator MW output.
-- Sources: EIA-930 (hourly balancing authority), SCADA (unit-level),
--          EIA-860 dispatch schedules.

CREATE TABLE generator_output (
  ts              TIMESTAMPTZ   NOT NULL,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  iso_id          TEXT          NOT NULL REFERENCES isos(id),

  -- Generator identifier — EIA plant_id + generator_id or SCADA point name
  generator_id    TEXT          NOT NULL,
  generator_name  TEXT,

  bus_id          UUID          REFERENCES network_buses(id) ON DELETE SET NULL,

  fuel_type       TEXT          NOT NULL,
    -- 'solar' | 'wind' | 'natural_gas' | 'nuclear' | 'hydro' |
    -- 'coal' | 'oil' | 'geothermal' | 'other'

  output_mw       DOUBLE PRECISION NOT NULL,
  scheduled_mw    DOUBLE PRECISION,           -- AGC target or economic dispatch schedule
  capacity_mw     DOUBLE PRECISION,           -- nameplate or derated capacity

  source          TEXT          NOT NULL DEFAULT 'EIA_930',
  interval_min    SMALLINT      NOT NULL DEFAULT 60
);

SELECT create_hypertable(
  'generator_output', 'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE
);

SELECT add_compression_policy(
  'generator_output',
  compress_after => INTERVAL '7 days',
  if_not_exists  => TRUE
);

CREATE INDEX idx_genout_generator_ts
  ON generator_output(iso_id, generator_id, ts DESC);

CREATE INDEX idx_genout_bus_ts
  ON generator_output(bus_id, ts DESC)
  WHERE bus_id IS NOT NULL;

CREATE INDEX idx_genout_fuel_ts
  ON generator_output(iso_id, fuel_type, ts DESC);

-- ── weather_observations ──────────────────────────────────────────────────────
-- NWP (Numerical Weather Prediction) forecasts and actuals from NOAA/ECMWF.
-- Used for Dynamic Line Rating (DLR) and renewable output forecasting.

CREATE TABLE weather_observations (
  ts              TIMESTAMPTZ   NOT NULL,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Weather station or NWP grid point
  station_id      TEXT          NOT NULL,
  station_name    TEXT,
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,

  -- Meteorological variables
  temp_c          DOUBLE PRECISION,   -- air temperature (°C)
  wind_speed_ms   DOUBLE PRECISION,   -- wind speed (m/s at hub height)
  wind_dir_deg    DOUBLE PRECISION,   -- wind direction (degrees from North)
  solar_irr_wm2   DOUBLE PRECISION,   -- global horizontal irradiance (W/m²)
  precip_mm       DOUBLE PRECISION,   -- precipitation (mm)
  humidity_pct    DOUBLE PRECISION,   -- relative humidity (%)
  pressure_hpa    DOUBLE PRECISION,   -- barometric pressure (hPa)

  -- Forecast metadata (null for observations)
  forecast_horizon_h  INTEGER,        -- hours ahead (null = observation)
  model_run_ts        TIMESTAMPTZ,    -- when the NWP model was run

  source          TEXT NOT NULL DEFAULT 'NOAA_GFS'
    -- 'NOAA_GFS' | 'ECMWF_HRES' | 'NOAA_HRRR' | 'OBSERVATION'
);

SELECT create_hypertable(
  'weather_observations', 'ts',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

SELECT add_compression_policy(
  'weather_observations',
  compress_after => INTERVAL '30 days',
  if_not_exists  => TRUE
);

CREATE INDEX idx_weather_station_ts
  ON weather_observations(station_id, ts DESC);

CREATE INDEX idx_weather_location_ts
  ON weather_observations(tenant_id, latitude, longitude, ts DESC);

-- ── ami_interval_data ─────────────────────────────────────────────────────────
-- Advanced Metering Infrastructure (AMI) interval energy data.
-- 15-minute intervals from smart meters.
-- Used for load morphology fingerprinting and demand forecast training.

CREATE TABLE ami_interval_data (
  ts              TIMESTAMPTZ   NOT NULL,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Meter identifier — anonymised for privacy
  meter_id        TEXT          NOT NULL,

  -- Geographic aggregation level
  feeder_id       TEXT,          -- distribution feeder
  substation_id   TEXT,          -- transmission substation
  zip_code        TEXT,

  energy_kwh      DOUBLE PRECISION NOT NULL,   -- energy consumed in interval
  demand_kw       DOUBLE PRECISION,            -- peak demand in interval
  voltage_v       DOUBLE PRECISION,            -- voltage at meter

  customer_type   TEXT NOT NULL DEFAULT 'residential',
    -- 'residential' | 'commercial' | 'industrial' | 'ev_charging'

  CONSTRAINT ami_energy_nonneg  CHECK (energy_kwh >= 0),
  CONSTRAINT ami_customer_valid CHECK (
    customer_type IN ('residential', 'commercial', 'industrial', 'ev_charging')
  )
);

SELECT create_hypertable(
  'ami_interval_data', 'ts',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

SELECT add_compression_policy(
  'ami_interval_data',
  compress_after => INTERVAL '30 days',
  if_not_exists  => TRUE
);

CREATE INDEX idx_ami_feeder_ts
  ON ami_interval_data(feeder_id, ts DESC)
  WHERE feeder_id IS NOT NULL;

CREATE INDEX idx_ami_substation_ts
  ON ami_interval_data(substation_id, ts DESC)
  WHERE substation_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- All time-series tables are tenant-scoped.

ALTER TABLE scada_readings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lmp_prices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE generator_output    ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ami_interval_data   ENABLE ROW LEVEL SECURITY;

-- Select policies (tenant-scoped read)
CREATE POLICY "scada_select" ON scada_readings FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY "lmp_select" ON lmp_prices FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY "genout_select" ON generator_output FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY "weather_select" ON weather_observations FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY "ami_select" ON ami_interval_data FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

-- Insert policies (ingestion pipelines run as service role, so this is for API insert)
CREATE POLICY "scada_insert" ON scada_readings FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY "lmp_insert" ON lmp_prices FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY "genout_insert" ON generator_output FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY "weather_insert" ON weather_observations FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));

CREATE POLICY "ami_insert" ON ami_interval_data FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));
