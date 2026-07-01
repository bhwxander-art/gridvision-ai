/**
 * ife_outcome_tracking row -> domain mapper — INFRA-020
 *
 * Kept in this feature module rather than lib/db/types-ife.ts, following the
 * placement convention established for Time-to-Power/Confidence-Risk/
 * Explanations (INFRA-015/016/017).
 */

import type { DbIfeOutcomeTracking } from "@/lib/db/types-ife";
import type { IfeOutcomeTracking } from "./types";

export function toIfeOutcomeTracking(row: DbIfeOutcomeTracking): IfeOutcomeTracking {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    tenantId: row.tenant_id,
    queueProjectId: row.queue_project_id,
    actualCostM: row.actual_cost_m != null ? Number(row.actual_cost_m) : null,
    actualCod: row.actual_cod,
    actualFeasible: row.actual_feasible,
    actualWithdrawn: row.actual_withdrawn,
    outcomeObservedAt: row.outcome_observed_at,
    costResidualM: row.cost_residual_m != null ? Number(row.cost_residual_m) : null,
    codResidualMonths: row.cod_residual_months != null ? Number(row.cod_residual_months) : null,
    withinCostP10P90: row.within_cost_p10_p90,
    withinCodP25P75: row.within_cod_p25_p75,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
