/**
 * Confidence & Risk Scoring repository-integrated pipeline — INFRA-016
 *
 * Operates on an EXISTING, already-completed ife_analyses record (same
 * pattern as Upgrade Analysis / Time-to-Power). Reads whichever of the
 * optional child analyses (upgrade results, time-to-power) already exist —
 * it does not require them and does not recompute anything they own; their
 * absence is reflected transparently as lower conf_input_completeness /
 * a null risk_queue_depth rather than as an error.
 *
 * Like Time-to-Power, this pipeline has NO dependency on PTDF, LODF, or DC
 * power flow. Unlike Time-to-Power, it reads NetworkRepository.getModel
 * (unmodified) once, purely for the network model's date, to score
 * conf_data_freshness — no topology/bus/branch data is loaded.
 *
 * Idempotency: mirrors Upgrade Analysis / Time-to-Power's check-first
 * pattern. analysisId is the natural dedup key for ife_confidence_risk.
 */

import "server-only";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type { IfeAnalysis, IfeConfidenceRisk } from "@/lib/db/types-ife";
import { computeConfidenceRisk } from "./confidence-risk-engine";
import type { ConfidenceRiskOptions } from "./types";

// Mirrors (does not import) the orchestrator's DEFAULT_SUFFICIENCY_TOLERANCE_MW, used to
// re-derive whether upgrade analysis was a required stage for conf_input_completeness.
// KNOWN LIMITATION: ife_analyses has no column recording the tolerance actually used when the
// analysis was originally run — if a caller supplied a non-default upgradeAnalysisOptions.toleranceMw
// to the orchestrator or the standalone upgrade-analysis endpoint, this recomputation can disagree
// with that original decision (e.g. treating an already-sufficient result as "missing" its upgrade
// stage), understating conf_input_completeness. Fixing this properly would require a schema change
// to persist the original decision, which is out of scope for this milestone (no migration).
const SUFFICIENCY_TOLERANCE_MW = 1e-6;

export interface ConfidenceRiskPipelineResult {
  analysis: IfeAnalysis;
  confidenceRisk: IfeConfidenceRisk;
  computeMs: number;
}

export async function computeAndPersistConfidenceRisk(
  tenantId: string,
  analysisId: string,
  ifeRepo: IfeRepository,
  networkRepo: NetworkRepository,
  options: ConfidenceRiskOptions = {}
): Promise<ConfidenceRiskPipelineResult> {
  const t0 = performance.now();

  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    throw new Error(`[ConfidenceRisk] Analysis ${analysisId} not found for tenant ${tenantId}`);
  }

  const existingConfidenceRisk = await ifeRepo.getConfidenceRiskByAnalysisId(tenantId, analysisId);
  if (existingConfidenceRisk) {
    return {
      analysis,
      confidenceRisk: existingConfidenceRisk,
      computeMs: Math.round(performance.now() - t0),
    };
  }

  if (analysis.status !== "completed") {
    throw new Error(
      `[ConfidenceRisk] Analysis ${analysisId} is not completed (status: ${analysis.status}) ` +
        `— the analysis must finish successfully before confidence/risk can be scored`
    );
  }

  const [model, hostingCapacity, upgradeResults, timeToPower] = await Promise.all([
    networkRepo.getModel(tenantId, analysis.networkModelId),
    ifeRepo.getHostingCapacityByAnalysisId(tenantId, analysisId),
    ifeRepo.getUpgradeResultsByAnalysisId(tenantId, analysisId),
    ifeRepo.getTimeToPowerByAnalysisId(tenantId, analysisId),
  ]);

  if (!model) {
    throw new Error(
      `[ConfidenceRisk] Network model ${analysis.networkModelId} not found for tenant ${tenantId}`
    );
  }
  if (!hostingCapacity || hostingCapacity.hcDeterministicMw === null) {
    // Should not be reachable for a 'completed' analysis — Hosting Capacity always populates this
    // field on success (see INFRA-012). A data-consistency defect, not a valid state to score.
    throw new Error(
      `[ConfidenceRisk] Analysis ${analysisId} has no usable hosting capacity result ` +
        `— hosting capacity must complete successfully before confidence/risk can be scored`
    );
  }

  const upgradeAnalysisRequired =
    hostingCapacity.hcDeterministicMw < analysis.capacityMw - SUFFICIENCY_TOLERANCE_MW;

  const result = computeConfidenceRisk(
    {
      networkModelDate: model.modelDate,
      upgradeAnalysisRequired,
      upgradeResultsPresent: upgradeResults !== null,
      timeToPowerPresent: timeToPower !== null,
      activeQueueProjectsCount: timeToPower?.activeQueueProjectsCount ?? null,
    },
    options
  );

  const confidenceRisk = await ifeRepo.createConfidenceRisk({
    analysis_id: analysisId,
    tenant_id: tenantId,
    confidence_score: result.confidenceScore,
    risk_score: result.riskScore,
    conf_data_freshness: result.confDataFreshness,
    conf_model_calibration: result.confModelCalibration,
    conf_input_completeness: result.confInputCompleteness,
    conf_mc_convergence: result.confMcConvergence,
    risk_cost_uncertainty: result.riskCostUncertainty,
    risk_queue_depth: result.riskQueueDepth,
    risk_congestion_trend: result.riskCongestionTrend,
    risk_withdrawal: result.riskWithdrawal,
    component_breakdown: result.componentBreakdown,
  });

  return { analysis, confidenceRisk, computeMs: Math.round(performance.now() - t0) };
}
