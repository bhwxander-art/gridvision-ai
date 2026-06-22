/**
 * Database row types for GridVision AI.
 *
 * Column names mirror the PostgreSQL schema (snake_case).
 * Each repository maps these into the camelCase domain types used by the app.
 */

// ── substations ───────────────────────────────────────────────────────────────

export interface DbSubstation {
  id: string;
  name: string;
  region: string;
  voltage_kv: number;
  nameplate_mva: number;
  peak_load_mw: number;
  n1_capacity_mw: number;
  annual_growth_pct: number;
  latitude: number;
  longitude: number;
  created_at: string;
  updated_at: string;
}

// ── transformers ─────────────────────────────────────────────────────────────

export interface DbTransformer {
  id: string;
  substation_id: string;
  name: string;
  rated_mva: number;
  peak_load_mva: number;
  load_factor: number;
  age_years: number;
  n1_compliant: boolean;
  created_at: string;
  updated_at: string;
}

// ── feeders ──────────────────────────────────────────────────────────────────

export interface DbFeeder {
  id: string;
  substation_id: string;
  name: string;
  hosting_capacity_mw: number;
  committed_load_mw: number;
  queued_load_mw: number;
  created_at: string;
  updated_at: string;
}

// ── grid_load_history ────────────────────────────────────────────────────────

export interface DbGridLoadReading {
  id: number;
  territory_id: string;
  recorded_at: string;
  load_mw: number;
  source: string;
  interval_min: 5 | 15 | 60;
  created_at: string;
}

export type DbGridLoadInsert = Omit<DbGridLoadReading, "id" | "created_at">;

// ── data_center_queue ────────────────────────────────────────────────────────

export interface DbDataCenter {
  id: string;
  project_name: string;
  developer: string | null;
  requested_mw: number;
  load_factor: number;
  target_cod: string;
  status: "study" | "ia-executed" | "construction" | "energized";
  affected_substation_id: string | null;
  affected_feeder_id: string | null;
  ramp_months: number;
  created_at: string;
  updated_at: string;
}

// ── forecast_runs ────────────────────────────────────────────────────────────

export interface DbForecastRun {
  id: number;
  territory_id: string;
  run_at: string;
  horizon_years: 3 | 5 | 10;
  inputs: Record<string, unknown>;  // ForecastInputs (JSONB)
  result: Record<string, unknown>;  // ForecastResult (JSONB)
  model_version: string;
  source: string;
  created_at: string;
}

export type DbForecastRunInsert = Omit<DbForecastRun, "id" | "created_at">;

// ── scenarios ─────────────────────────────────────────────────────────────────

export interface DbScenario {
  id: string;          // UUID
  user_id: string | null;
  name: string;
  inputs: {
    dataCenterLoadMW: number;
    evGrowthPct: number;
    populationGrowthPct: number;
    commercialGrowthPct: number;
  };
  created_at: string;
}

export type DbScenarioInsert = Omit<DbScenario, "id" | "created_at">;

// ── Supabase nested join shapes ───────────────────────────────────────────────

/** Shape returned by .select('*, transformers(*), feeders(*)') */
export interface DbSubstationWithRelations extends DbSubstation {
  transformers: DbTransformer[];
  feeders: DbFeeder[];
}
