-- ============================================================
-- GridVision AI — Scenario Persistence
-- Migration 003 · Planning scenarios table
-- ============================================================

CREATE TABLE scenarios (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL,
  inputs      JSONB       NOT NULL,
    -- { dataCenterLoadMW, evGrowthPct, populationGrowthPct, commercialGrowthPct }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scenarios_created_at ON scenarios(created_at DESC);

COMMENT ON TABLE scenarios IS
  'User-saved planning scenarios from the /enterprise/scenarios tool.';
COMMENT ON COLUMN scenarios.inputs IS
  'ScenarioInputs JSON: dataCenterLoadMW, evGrowthPct, populationGrowthPct, commercialGrowthPct.';
