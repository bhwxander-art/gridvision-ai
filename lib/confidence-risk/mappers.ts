/**
 * ife_confidence_risk row -> domain mapper — INFRA-016
 *
 * Kept in this feature module rather than lib/db/types-ife.ts, following the
 * same placement established for Time-to-Power (INFRA-015): the shared
 * types file already declares DbIfeConfidenceRisk/IfeConfidenceRisk and
 * validateIfeConfidenceRiskInsert (present since the file was originally
 * authored) and is not to grow further — only the mapper *function* lives
 * here, since no such mapper existed yet.
 */

import type { DbIfeConfidenceRisk, IfeConfidenceRisk } from "@/lib/db/types-ife";

export function toIfeConfidenceRisk(row: DbIfeConfidenceRisk): IfeConfidenceRisk {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    tenantId: row.tenant_id,
    confidenceScore: Number(row.confidence_score),
    riskScore: Number(row.risk_score),
    confDataFreshness: row.conf_data_freshness,
    confModelCalibration: row.conf_model_calibration,
    confInputCompleteness: row.conf_input_completeness,
    confMcConvergence: row.conf_mc_convergence,
    riskCostUncertainty: row.risk_cost_uncertainty,
    riskQueueDepth: row.risk_queue_depth,
    riskCongestionTrend: row.risk_congestion_trend,
    riskWithdrawal: row.risk_withdrawal,
    componentBreakdown: row.component_breakdown ?? {},
    computedAt: row.computed_at,
  };
}
