-- ============================================================
-- GridVision AI — EIA Generator Inventory
-- Migration 017 · INFRA-006
-- ============================================================
-- Stores the annual EIA Form 860 operating-generator-capacity
-- snapshot per tenant.  One row per (tenant, plant, generator, year).
--
-- Primary uses:
--   1. IFE hosting-capacity analysis — existing generation context
--      at each point of interconnection (POI bus)
--   2. Grid portrait — installed MW by fuel type per balancing authority
--   3. Retirement schedule — capacity being freed over a planning horizon
--
-- Data source:
--   EIA Open Data API v2
--   /electricity/operating-generator-capacity/data/
--   Annual frequency; each calendar year's snapshot published ~Oct following year
-- ============================================================

-- ── ENUM types ────────────────────────────────────────────────────────────────

CREATE TYPE generator_status AS ENUM (
  'operating',       -- OP: currently generating
  'standby',         -- SB: standby / backup
  'out_of_service',  -- OA/OS: temporarily out of service
  'retired',         -- RE: permanently retired
  'proposed',        -- IP/P/T/V/L: under development or permitted
  'canceled',        -- CN: canceled before construction
  'other'
);

CREATE TYPE generator_fuel_type AS ENUM (
  'natural_gas',
  'coal',
  'nuclear',
  'wind',
  'solar',
  'hydro',
  'oil',
  'geothermal',
  'biomass',
  'other_renewable',
  'other'
);

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE eia_generators (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- EIA identifiers (Form 860 key columns)
  plant_id            TEXT         NOT NULL, -- EIA plant code  (plantCode)
  generator_id        TEXT         NOT NULL, -- within-plant generator unit (generatorId)
  plant_name          TEXT         NOT NULL,
  data_year           SMALLINT     NOT NULL, -- snapshot year (period field from EIA)

  -- Geography
  state_abbr          CHAR(2),
  county              TEXT,
  latitude            NUMERIC(9,  6),
  longitude           NUMERIC(10, 6),
  balancing_authority TEXT,                  -- BA code: ISNE, PJM, MISO, ERCO, CISO, NYISO, …

  -- Nameplate capacity (MW)
  nameplate_mw        NUMERIC(10, 2),        -- rated at standard conditions
  summer_mw           NUMERIC(10, 2),        -- typically < nameplate for gas turbines
  winter_mw           NUMERIC(10, 2),        -- typically > nameplate for gas turbines

  -- Classification
  fuel_type           generator_fuel_type NOT NULL DEFAULT 'other',
  prime_mover         TEXT,                  -- CC, CT, ST, PV, WT, etc.
  energy_source_code  TEXT,                  -- raw EIA code: NG, SUN, WND, WAT, NUC, …
  technology          TEXT,                  -- human-readable, e.g. "Natural Gas Fired CC"

  -- Status and online / retirement dates
  operational_status  generator_status NOT NULL DEFAULT 'other',
  operating_year      SMALLINT,
  operating_month     SMALLINT CHECK (operating_month BETWEEN 1 AND 12),
  retirement_year     SMALLINT,
  retirement_month    SMALLINT CHECK (retirement_month BETWEEN 1 AND 12),

  -- Ownership
  utility_id          TEXT,
  utility_name        TEXT,

  -- Provenance
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency key: one row per (tenant, plant, generator, year)
  UNIQUE (tenant_id, plant_id, generator_id, data_year)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Common filters: by balancing authority (most queries start here)
CREATE INDEX idx_eia_gen_tenant_ba
  ON eia_generators (tenant_id, balancing_authority);

-- State-level queries (distribution planning, regulatory filings)
CREATE INDEX idx_eia_gen_tenant_state
  ON eia_generators (tenant_id, state_abbr);

-- Capacity-by-fuel queries (grid portrait, resource adequacy)
CREATE INDEX idx_eia_gen_tenant_fuel
  ON eia_generators (tenant_id, fuel_type);

-- Status filter (operating vs retired vs proposed)
CREATE INDEX idx_eia_gen_tenant_status
  ON eia_generators (tenant_id, operational_status);

-- Year-scoped queries (compare snapshots across years)
CREATE INDEX idx_eia_gen_tenant_year
  ON eia_generators (tenant_id, data_year);

-- Retirement-schedule queries (only rows still operating but have a retirement year)
CREATE INDEX idx_eia_gen_retirement
  ON eia_generators (tenant_id, retirement_year)
  WHERE operational_status = 'operating' AND retirement_year IS NOT NULL;

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE eia_generators ENABLE ROW LEVEL SECURITY;

CREATE POLICY eia_generators_select ON eia_generators
  FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY eia_generators_insert ON eia_generators
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY eia_generators_update ON eia_generators
  FOR UPDATE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY eia_generators_delete ON eia_generators
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

-- ── Trigger: keep updated_at current ─────────────────────────────────────────

CREATE TRIGGER trg_eia_generators_updated_at
  BEFORE UPDATE ON eia_generators
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
