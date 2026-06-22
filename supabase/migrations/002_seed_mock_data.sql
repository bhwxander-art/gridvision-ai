-- ============================================================
-- GridVision AI — Seed Data (Eastern Massachusetts territory)
-- Migration 002 · Mirrors lib/enterprise-data.ts mock records
-- ============================================================
-- Run AFTER 001_initial_schema.sql.
-- Safe to re-run — uses INSERT ... ON CONFLICT DO UPDATE.

-- ── Substations ──────────────────────────────────────────────────────────────

INSERT INTO substations
  (id, name, region, voltage_kv, nameplate_mva, peak_load_mw,
   n1_capacity_mw, annual_growth_pct, latitude, longitude)
VALUES
  ('ss-boston-north',
   'Boston North 115/13.8 kV',  'North Shore',        115.0, 450.0, 342.0, 405.0, 3.2,
   42.4671, -70.9437),

  ('ss-cambridge-central',
   'Cambridge Central 115/27 kV', 'Inner Metro',       115.0, 420.0, 398.0, 378.0, 4.8,
   42.3626, -71.0857),

  ('ss-somerville-east',
   'Somerville East 27/13.8 kV', 'Inner Metro',         27.0, 290.0, 287.0, 261.0, 5.6,
   42.3898, -71.0747),

  ('ss-waltham-west',
   'Waltham West 115/13.8 kV',  'Route 128 Corridor', 115.0, 380.0, 215.0, 342.0, 6.2,
   42.3765, -71.2356)

ON CONFLICT (id) DO UPDATE SET
  name             = EXCLUDED.name,
  region           = EXCLUDED.region,
  voltage_kv       = EXCLUDED.voltage_kv,
  nameplate_mva    = EXCLUDED.nameplate_mva,
  peak_load_mw     = EXCLUDED.peak_load_mw,
  n1_capacity_mw   = EXCLUDED.n1_capacity_mw,
  annual_growth_pct = EXCLUDED.annual_growth_pct,
  latitude         = EXCLUDED.latitude,
  longitude        = EXCLUDED.longitude,
  updated_at       = NOW();

-- ── Transformers ─────────────────────────────────────────────────────────────

INSERT INTO transformers
  (id, substation_id, name, rated_mva, peak_load_mva, load_factor, age_years, n1_compliant)
VALUES
  -- Boston North
  ('tx-bn-1', 'ss-boston-north',       'T1 150 MVA', 150.0, 118.0, 0.92, 22, TRUE),
  ('tx-bn-2', 'ss-boston-north',       'T2 150 MVA', 150.0, 112.0, 0.92, 22, TRUE),

  -- Cambridge Central
  ('tx-cc-1', 'ss-cambridge-central',  'T1 100 MVA', 100.0,  94.0, 0.95, 38, FALSE),
  ('tx-cc-2', 'ss-cambridge-central',  'T2 100 MVA', 100.0,  88.0, 0.95, 38, FALSE),

  -- Somerville East
  ('tx-se-1', 'ss-somerville-east',    'T1 75 MVA',   75.0,  74.0, 0.97, 31, TRUE),

  -- Waltham West
  ('tx-ww-1', 'ss-waltham-west',       'T1 125 MVA', 125.0,  98.0, 0.90, 18, TRUE)

ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  rated_mva     = EXCLUDED.rated_mva,
  peak_load_mva = EXCLUDED.peak_load_mva,
  load_factor   = EXCLUDED.load_factor,
  age_years     = EXCLUDED.age_years,
  n1_compliant  = EXCLUDED.n1_compliant,
  updated_at    = NOW();

-- ── Feeders ──────────────────────────────────────────────────────────────────

INSERT INTO feeders
  (id, substation_id, name, hosting_capacity_mw, committed_load_mw, queued_load_mw)
VALUES
  ('fd-bn-12', 'ss-boston-north',      'Feeder 12 — Lynn',          45.0, 28.0,  8.0),
  ('fd-cc-7',  'ss-cambridge-central', 'Feeder 7 — Kendall Sq',     32.0, 30.0, 12.0),
  ('fd-se-3',  'ss-somerville-east',   'Feeder 3 — Assembly Row',   18.0, 16.0,  6.0),
  ('fd-ww-5',  'ss-waltham-west',      'Feeder 5 — Route 128 Tech', 55.0, 22.0, 28.0)

ON CONFLICT (id) DO UPDATE SET
  name                = EXCLUDED.name,
  hosting_capacity_mw = EXCLUDED.hosting_capacity_mw,
  committed_load_mw   = EXCLUDED.committed_load_mw,
  queued_load_mw      = EXCLUDED.queued_load_mw,
  updated_at          = NOW();

-- ── Data Center Queue ─────────────────────────────────────────────────────────

INSERT INTO data_center_queue
  (id, project_name, developer, requested_mw, load_factor,
   target_cod, status, affected_substation_id, affected_feeder_id, ramp_months)
VALUES
  ('dc-001',
   'Project Helix — AI Training Campus', 'Undisclosed Hyperscaler',
   180.0, 0.96, '2028-Q2', 'study',
   'ss-waltham-west', 'fd-ww-5', 18),

  ('dc-002',
   'Kendall Inference Hub',             'Cloud Provider JV',
    45.0, 0.94, '2027-Q4', 'ia-executed',
   'ss-cambridge-central', 'fd-cc-7', 12),

  ('dc-003',
   'Assembly Edge DC',                  'Regional Colo Operator',
    22.0, 0.88, '2027-Q1', 'construction',
   'ss-somerville-east', 'fd-se-3', 6),

  ('dc-004',
   'North Shore Enterprise DC',         'Enterprise Tenant',
    15.0, 0.85, '2026-Q4', 'study',
   'ss-boston-north', 'fd-bn-12', 9)

ON CONFLICT (id) DO UPDATE SET
  project_name           = EXCLUDED.project_name,
  developer              = EXCLUDED.developer,
  requested_mw           = EXCLUDED.requested_mw,
  load_factor            = EXCLUDED.load_factor,
  target_cod             = EXCLUDED.target_cod,
  status                 = EXCLUDED.status,
  affected_substation_id = EXCLUDED.affected_substation_id,
  affected_feeder_id     = EXCLUDED.affected_feeder_id,
  ramp_months            = EXCLUDED.ramp_months,
  updated_at             = NOW();

-- ── Initial grid load reading ─────────────────────────────────────────────────
-- One seed reading so the history table is non-empty.

INSERT INTO grid_load_history (territory_id, recorded_at, load_mw, source, interval_min)
VALUES ('eastern-ma', '2026-06-10 14:00:00+00', 16842.0, 'manual', 60)
ON CONFLICT (territory_id, source, interval_min, recorded_at) DO NOTHING;
