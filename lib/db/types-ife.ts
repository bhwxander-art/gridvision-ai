/**
 * Database row types for IFE analysis tables (migration 015).
 */

import type { ProjectType } from "@/lib/db/types-queue";

// ── Enums ─────────────────────────────────────────────────────────────────────

export type IfeAnalysisStatus = "pending" | "running" | "completed" | "failed";

// ── ife_analyses ──────────────────────────────────────────────────────────────

export interface DbIfeAnalysis {
  id: string;
  tenant_id: string;
  network_model_id: string;
  poi_bus_id: string;
  iso_id: string;
  capacity_mw: number;
  project_type: ProjectType;
  target_cod: string | null;
  input_snapshot: Record<string, unknown>;
  status: IfeAnalysisStatus;
  progress_pct: number;
  error_message: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbIfeAnalysisInsert
  extends Omit<
    DbIfeAnalysis,
    | "id"
    | "status"
    | "progress_pct"
    | "queued_at"
    | "created_at"
    | "updated_at"
    | "error_message"
    | "started_at"
    | "completed_at"
    | "idempotency_key"
  > {
  id?: string;
  status?: IfeAnalysisStatus;
  progress_pct?: number;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  idempotency_key?: string | null;
}

// ── ife_hosting_capacity ──────────────────────────────────────────────────────

export interface DbIfeHostingCapacity {
  id: string;
  analysis_id: string;
  tenant_id: string;
  hc_deterministic_mw: number | null;
  binding_line_id: string | null;
  binding_contingency_id: string | null;
  hc_p10_mw: number | null;
  hc_p50_mw: number | null;
  hc_p90_mw: number | null;
  mc_scenarios_run: number | null;
  mc_convergence_pct: number | null;
  violation_probability: number | null;
  vmin_headroom_pu: number | null;
  vmax_headroom_pu: number | null;
  computed_at: string;
}

export interface DbIfeHostingCapacityInsert
  extends Omit<DbIfeHostingCapacity, "id" | "computed_at"> {
  id?: string;
}

// ── ife_upgrade_results ───────────────────────────────────────────────────────

export interface UpgradeDetail {
  branch_id: string;
  branch_name: string;
  upgrade_type: "thermal_uprate" | "new_line" | "substation_work";
  capacity_increase_mw: number;
  cost_p50_m: number | null; // null = not computed (no cost model), not a fabricated value
}

export interface DbIfeUpgradeResults {
  id: string;
  analysis_id: string;
  tenant_id: string;
  cost_p10_m: number | null;
  cost_p50_m: number | null;
  cost_p90_m: number | null;
  project_share_p50_m: number | null;
  upgrades_required: number;
  milp_optimality_gap_pct: number | null;
  milp_solve_seconds: number | null;
  upgrade_details: UpgradeDetail[];
  computed_at: string;
}

export interface DbIfeUpgradeResultsInsert
  extends Omit<DbIfeUpgradeResults, "id" | "computed_at"> {
  id?: string;
}

// ── ife_time_to_power ─────────────────────────────────────────────────────────

export interface DbIfeTimeToPower {
  id: string;
  analysis_id: string;
  tenant_id: string;
  cod_p25: string | null;
  cod_p50: string | null;
  cod_p75: string | null;
  months_to_study_completion: number | null;
  active_queue_projects_count: number | null;
  survival_12m: number | null;
  survival_24m: number | null;
  survival_36m: number | null;
  computed_at: string;
}

export interface DbIfeTimeToPowerInsert
  extends Omit<DbIfeTimeToPower, "id" | "computed_at"> {
  id?: string;
}

// ── ife_confidence_risk ───────────────────────────────────────────────────────

export interface DbIfeConfidenceRisk {
  id: string;
  analysis_id: string;
  tenant_id: string;
  confidence_score: number;
  risk_score: number;
  conf_data_freshness: number | null;
  conf_model_calibration: number | null;
  conf_input_completeness: number | null;
  conf_mc_convergence: number | null;
  risk_cost_uncertainty: number | null;
  risk_queue_depth: number | null;
  risk_congestion_trend: number | null;
  risk_withdrawal: number | null;
  component_breakdown: Record<string, unknown>;
  computed_at: string;
}

export interface DbIfeConfidenceRiskInsert
  extends Omit<DbIfeConfidenceRisk, "id" | "computed_at"> {
  id?: string;
}

// ── ife_explanations ──────────────────────────────────────────────────────────

export interface ShapValue {
  feature: string;
  value: number | string;
  shap_value: number;
  direction: "increases_withdrawal" | "decreases_withdrawal";
  rank: number;
}

export interface DbIfeExplanations {
  id: string;
  analysis_id: string;
  tenant_id: string;
  baseline_withdrawal_prob: number | null;
  predicted_withdrawal_prob: number | null;
  withdrawal_shap_values: ShapValue[];
  cost_drivers: Array<{ factor: string; impact_m: number; direction: string }>;
  assumptions: string[] | null;
  cox_model_version: string | null;
  cost_model_version: string | null;
  computed_at: string;
}

export interface DbIfeExplanationsInsert
  extends Omit<DbIfeExplanations, "id" | "computed_at"> {
  id?: string;
}

// ── ife_outcome_tracking ──────────────────────────────────────────────────────

export interface DbIfeOutcomeTracking {
  id: string;
  analysis_id: string;
  tenant_id: string;
  queue_project_id: string | null;
  actual_cost_m: number | null;
  actual_cod: string | null;
  actual_feasible: boolean | null;
  actual_withdrawn: boolean | null;
  outcome_observed_at: string | null;
  cost_residual_m: number | null;
  cod_residual_months: number | null;
  within_cost_p10_p90: boolean | null;
  within_cod_p25_p75: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbIfeOutcomeTrackingInsert
  extends Omit<DbIfeOutcomeTracking, "id" | "cost_residual_m" | "cod_residual_months" | "created_at" | "updated_at"> {
  id?: string;
}

// ── Domain types (camelCase) ──────────────────────────────────────────────────

export interface IfeAnalysis {
  id: string;
  tenantId: string;
  networkModelId: string;
  poiBusId: string;
  isoId: string;
  capacityMw: number;
  projectType: ProjectType;
  targetCod: string | null;
  inputSnapshot: Record<string, unknown>;
  status: IfeAnalysisStatus;
  progressPct: number;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IfeHostingCapacity {
  id: string;
  analysisId: string;
  tenantId: string;
  hcDeterministicMw: number | null;
  bindingLineId: string | null;
  bindingContingencyId: string | null;
  hcP10Mw: number | null;
  hcP50Mw: number | null;
  hcP90Mw: number | null;
  mcScenariosRun: number | null;
  mcConvergencePct: number | null;
  violationProbability: number | null;
  vminHeadroomPu: number | null;
  vmaxHeadroomPu: number | null;
  computedAt: string;
}

export interface IfeUpgradeResults {
  id: string;
  analysisId: string;
  tenantId: string;
  costP10M: number | null;
  costP50M: number | null;
  costP90M: number | null;
  projectShareP50M: number | null;
  upgradesRequired: number;
  milpOptimalityGapPct: number | null;
  milpSolveSeconds: number | null;
  upgradeDetails: UpgradeDetail[];
  computedAt: string;
}

export interface IfeTimeToPower {
  id: string;
  analysisId: string;
  tenantId: string;
  codP25: string | null;
  codP50: string | null;
  codP75: string | null;
  monthsToStudyCompletion: number | null;
  activeQueueProjectsCount: number | null;
  survival12m: number | null;
  survival24m: number | null;
  survival36m: number | null;
  computedAt: string;
}

export interface IfeConfidenceRisk {
  id: string;
  analysisId: string;
  tenantId: string;
  confidenceScore: number;
  riskScore: number;
  confDataFreshness: number | null;
  confModelCalibration: number | null;
  confInputCompleteness: number | null;
  confMcConvergence: number | null;
  riskCostUncertainty: number | null;
  riskQueueDepth: number | null;
  riskCongestionTrend: number | null;
  riskWithdrawal: number | null;
  componentBreakdown: Record<string, unknown>;
  computedAt: string;
}

export interface IfeAnalysisComplete {
  analysis: IfeAnalysis;
  hostingCapacity: IfeHostingCapacity | null;
  upgradeResults: IfeUpgradeResults | null;
  timeToPower: IfeTimeToPower | null;
  confidenceRisk: IfeConfidenceRisk | null;
  explanations: DbIfeExplanations | null;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

export function toIfeAnalysis(row: DbIfeAnalysis): IfeAnalysis {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    networkModelId: row.network_model_id,
    poiBusId: row.poi_bus_id,
    isoId: row.iso_id,
    capacityMw: Number(row.capacity_mw),
    projectType: row.project_type,
    targetCod: row.target_cod,
    inputSnapshot: row.input_snapshot ?? {},
    status: row.status,
    progressPct: Number(row.progress_pct),
    errorMessage: row.error_message,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toIfeHostingCapacity(
  row: DbIfeHostingCapacity
): IfeHostingCapacity {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    tenantId: row.tenant_id,
    hcDeterministicMw:
      row.hc_deterministic_mw != null ? Number(row.hc_deterministic_mw) : null,
    bindingLineId: row.binding_line_id,
    bindingContingencyId: row.binding_contingency_id,
    hcP10Mw: row.hc_p10_mw != null ? Number(row.hc_p10_mw) : null,
    hcP50Mw: row.hc_p50_mw != null ? Number(row.hc_p50_mw) : null,
    hcP90Mw: row.hc_p90_mw != null ? Number(row.hc_p90_mw) : null,
    mcScenariosRun: row.mc_scenarios_run,
    mcConvergencePct:
      row.mc_convergence_pct != null ? Number(row.mc_convergence_pct) : null,
    violationProbability:
      row.violation_probability != null
        ? Number(row.violation_probability)
        : null,
    vminHeadroomPu:
      row.vmin_headroom_pu != null ? Number(row.vmin_headroom_pu) : null,
    vmaxHeadroomPu:
      row.vmax_headroom_pu != null ? Number(row.vmax_headroom_pu) : null,
    computedAt: row.computed_at,
  };
}

export function toIfeUpgradeResults(
  row: DbIfeUpgradeResults
): IfeUpgradeResults {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    tenantId: row.tenant_id,
    costP10M: row.cost_p10_m != null ? Number(row.cost_p10_m) : null,
    costP50M: row.cost_p50_m != null ? Number(row.cost_p50_m) : null,
    costP90M: row.cost_p90_m != null ? Number(row.cost_p90_m) : null,
    projectShareP50M:
      row.project_share_p50_m != null
        ? Number(row.project_share_p50_m)
        : null,
    upgradesRequired: row.upgrades_required,
    milpOptimalityGapPct:
      row.milp_optimality_gap_pct != null
        ? Number(row.milp_optimality_gap_pct)
        : null,
    milpSolveSeconds:
      row.milp_solve_seconds != null ? Number(row.milp_solve_seconds) : null,
    upgradeDetails: row.upgrade_details ?? [],
    computedAt: row.computed_at,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export class IfeValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = "IfeValidationError";
  }
}

export function validateIfeAnalysisInsert(
  insert: DbIfeAnalysisInsert
): void {
  if (!insert.network_model_id) {
    throw new IfeValidationError(
      "network_model_id is required",
      "network_model_id"
    );
  }
  if (!insert.poi_bus_id) {
    throw new IfeValidationError("poi_bus_id is required", "poi_bus_id");
  }
  if (!insert.iso_id) {
    throw new IfeValidationError("iso_id is required", "iso_id");
  }
  if (insert.capacity_mw <= 0) {
    throw new IfeValidationError(
      "capacity_mw must be positive",
      "capacity_mw"
    );
  }
  if (insert.capacity_mw > 50_000) {
    throw new IfeValidationError(
      "capacity_mw exceeds maximum supported value of 50,000 MW",
      "capacity_mw"
    );
  }
}

export function validateIfeHostingCapacityInsert(
  insert: DbIfeHostingCapacityInsert
): void {
  if (
    insert.hc_p10_mw != null &&
    insert.hc_p50_mw != null &&
    insert.hc_p10_mw > insert.hc_p50_mw
  ) {
    throw new IfeValidationError(
      "hc_p10_mw must be ≤ hc_p50_mw",
      "hc_p10_mw"
    );
  }
  if (
    insert.hc_p50_mw != null &&
    insert.hc_p90_mw != null &&
    insert.hc_p50_mw > insert.hc_p90_mw
  ) {
    throw new IfeValidationError(
      "hc_p50_mw must be ≤ hc_p90_mw",
      "hc_p50_mw"
    );
  }
  if (
    insert.violation_probability != null &&
    (insert.violation_probability < 0 || insert.violation_probability > 1)
  ) {
    throw new IfeValidationError(
      "violation_probability must be between 0 and 1",
      "violation_probability"
    );
  }
}

export function validateIfeUpgradeResultsInsert(
  insert: DbIfeUpgradeResultsInsert
): void {
  if (
    insert.cost_p10_m != null &&
    insert.cost_p50_m != null &&
    insert.cost_p10_m > insert.cost_p50_m
  ) {
    throw new IfeValidationError("cost_p10_m must be ≤ cost_p50_m", "cost_p10_m");
  }
  if (
    insert.cost_p50_m != null &&
    insert.cost_p90_m != null &&
    insert.cost_p50_m > insert.cost_p90_m
  ) {
    throw new IfeValidationError("cost_p50_m must be ≤ cost_p90_m", "cost_p50_m");
  }
  if (insert.upgrades_required < 0) {
    throw new IfeValidationError(
      "upgrades_required must be non-negative",
      "upgrades_required"
    );
  }
}

export function validateIfeConfidenceRiskInsert(
  insert: DbIfeConfidenceRiskInsert
): void {
  if (insert.confidence_score < 0 || insert.confidence_score > 100) {
    throw new IfeValidationError(
      "confidence_score must be between 0 and 100",
      "confidence_score"
    );
  }
  if (insert.risk_score < 0 || insert.risk_score > 100) {
    throw new IfeValidationError(
      "risk_score must be between 0 and 100",
      "risk_score"
    );
  }
}
