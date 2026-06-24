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
  raw_type: string | null;   // ISO-NE Type field from CSV imports (null for other sources)
  created_at: string;
}

export type DbGridLoadInsert = Omit<DbGridLoadReading, "id" | "created_at" | "raw_type"> & {
  raw_type?: string | null;
};

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

// ── tenants ───────────────────────────────────────────────────────────────────

export type TenantType =
  | "utility"
  | "developer"
  | "consultant"
  | "investor"
  | "demo";

export type TenantPlan   = "trial" | "professional" | "enterprise";
export type TenantStatus = "active" | "suspended" | "cancelled";

export interface DbTenant {
  id:         string;
  slug:       string;
  name:       string;
  type:       TenantType;
  plan:       TenantPlan;
  status:     TenantStatus;
  settings:   Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type DbTenantInsert = Omit<DbTenant, "id" | "created_at" | "updated_at" | "settings"> & {
  id?:       string;
  settings?: Record<string, unknown>;
};

// ── users ─────────────────────────────────────────────────────────────────────

export interface DbUser {
  id:             string;
  email:          string;
  full_name:      string | null;
  avatar_url:     string | null;
  is_super_admin: boolean;
  created_at:     string;
  updated_at:     string;
}

export type UserRole =
  | "super_admin"
  | "utility_executive"
  | "planner"
  | "engineer"
  | "sales"
  | "read_only";

// ── user_tenants ──────────────────────────────────────────────────────────────

export interface DbUserTenant {
  id:          string;
  user_id:     string;
  tenant_id:   string;
  role:        UserRole;
  is_active:   boolean;
  invited_at:  string;
  accepted_at: string | null;
  created_at:  string;
}

export interface DbUserWithRole extends DbUser {
  role:      UserRole;
  is_active: boolean;
  tenant_id: string;
}

// ── capital_projects ─────────────────────────────────────────────────────────

export type DbUpgradeType =
  | "transformer-replacement"
  | "substation-expansion"
  | "feeder-reconductor"
  | "new-substation"
  | "cable-replacement";

export type DbProjectStatus =
  | "planned"
  | "approved"
  | "in-progress"
  | "completed"
  | "cancelled";

export interface DbCapitalProject {
  id: string;
  substation_id: string;
  project_name: string;
  upgrade_type: DbUpgradeType;
  estimated_cost_usd: number;
  added_capacity_mw: number;
  implementation_months: number;
  risk_reduction: number;
  priority_score: number;
  status: DbProjectStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type DbCapitalProjectInsert = Omit<DbCapitalProject, "created_at" | "updated_at">;

// ── import_jobs ───────────────────────────────────────────────────────────────

export type ImportEntityType = "substations" | "transformers" | "feeders" | "accounts";
export type ImportJobStatus  = "pending" | "processing" | "completed" | "partial" | "failed";

export interface DbImportJob {
  id:             string;
  tenant_id:      string;
  entity_type:    ImportEntityType;
  status:         ImportJobStatus;
  rows_processed: number;
  rows_failed:    number;
  error_details:  Array<{ row: number; field: string; message: string }>;
  filename:       string | null;
  created_at:     string;
  completed_at:   string | null;
}

// ── accounts (CRM — DB-backed) ────────────────────────────────────────────────

export interface DbAccount {
  id:                    string;
  tenant_id:             string;
  name:                  string;
  type:                  string;
  status:                string;
  annual_load_mw:        number;
  projected_growth_mw:   number;
  territory:             string | null;
  estimated_revenue_usd: number;
  estimated_arr:         number;
  deal_probability:      number;
  expected_close_date:   string | null;
  forecast_quarter:      string | null;
  capacity_required_mw:  number;
  priority:              string;
  risk_rating:           string;
  contact_name:          string | null;
  contact_title:         string | null;
  notes:                 string | null;
  created_at:            string;
  updated_at:            string;
}

// ── Supabase nested join shapes ───────────────────────────────────────────────

/** Shape returned by .select('*, transformers(*), feeders(*)') */
export interface DbSubstationWithRelations extends DbSubstation {
  transformers: DbTransformer[];
  feeders: DbFeeder[];
}
