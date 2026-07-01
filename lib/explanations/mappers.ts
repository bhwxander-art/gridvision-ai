/**
 * ife_explanations row -> domain mapper — INFRA-017
 *
 * Kept in this feature module rather than lib/db/types-ife.ts, following
 * the placement convention established for Time-to-Power (INFRA-015) and
 * Confidence & Risk (INFRA-016).
 */

import type { DbIfeExplanations } from "@/lib/db/types-ife";
import type { IfeExplanations } from "./types";

export function toIfeExplanations(row: DbIfeExplanations): IfeExplanations {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    tenantId: row.tenant_id,
    baselineWithdrawalProb:
      row.baseline_withdrawal_prob != null ? Number(row.baseline_withdrawal_prob) : null,
    predictedWithdrawalProb:
      row.predicted_withdrawal_prob != null ? Number(row.predicted_withdrawal_prob) : null,
    withdrawalShapValues: row.withdrawal_shap_values ?? [],
    costDrivers: row.cost_drivers ?? [],
    assumptions: row.assumptions,
    coxModelVersion: row.cox_model_version,
    costModelVersion: row.cost_model_version,
    computedAt: row.computed_at,
  };
}
