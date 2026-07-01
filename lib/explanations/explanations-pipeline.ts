/**
 * Explanations repository-integrated pipeline — INFRA-017
 *
 * Operates on an EXISTING, already-completed ife_analyses record, same
 * pattern as Time-to-Power / Confidence & Risk. Reads whichever of the
 * optional child analyses (upgrade results, time-to-power, confidence/risk)
 * already exist — it does not require them and does not recompute anything
 * they own; their absence is reflected transparently as a different
 * assumptions[] entry (see explanations-engine.ts) rather than an error.
 *
 * No dependency on PTDF, LODF, DC power flow, or NetworkRepository at all —
 * this pipeline only reads IfeRepository.
 *
 * Idempotency: mirrors Upgrade Analysis / Time-to-Power / Confidence & Risk's
 * check-first pattern. analysisId is the natural dedup key for
 * ife_explanations.
 */

import "server-only";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { IfeAnalysis } from "@/lib/db/types-ife";
import { computeExplanations } from "./explanations-engine";
import type { IfeExplanations } from "./types";

// Mirrors (does not import) the orchestrator's DEFAULT_SUFFICIENCY_TOLERANCE_MW, used to
// re-derive whether upgrade analysis was a required stage for the assumptions[] topic
// selection. Shares the same known limitation documented in confidence-risk-pipeline.ts:
// ife_analyses has no column recording the tolerance actually used when the analysis was
// originally run, so this can disagree with the true historical decision if a caller supplied
// a non-default upgradeAnalysisOptions.toleranceMw. Here the consequence is narrower than for
// Confidence & Risk's conf_input_completeness — at worst it selects
// ASSUMPTION_UPGRADE_ANALYSIS_NOT_YET_COMPUTED instead of omitting the upgrade topic entirely,
// which is still a true, non-misleading statement (no upgrade_results row exists for this
// analysis), just an unnecessary one.
const SUFFICIENCY_TOLERANCE_MW = 1e-6;

export interface ExplanationsPipelineResult {
  analysis: IfeAnalysis;
  explanations: IfeExplanations;
  computeMs: number;
}

export async function computeAndPersistExplanations(
  tenantId: string,
  analysisId: string,
  ifeRepo: IfeRepository
): Promise<ExplanationsPipelineResult> {
  const t0 = performance.now();

  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    throw new Error(`[Explanations] Analysis ${analysisId} not found for tenant ${tenantId}`);
  }

  const existingExplanations = await ifeRepo.getExplanationsByAnalysisId(tenantId, analysisId);
  if (existingExplanations) {
    return {
      analysis,
      explanations: existingExplanations,
      computeMs: Math.round(performance.now() - t0),
    };
  }

  if (analysis.status !== "completed") {
    throw new Error(
      `[Explanations] Analysis ${analysisId} is not completed (status: ${analysis.status}) ` +
        `— the analysis must finish successfully before explanations can be generated`
    );
  }

  const [hostingCapacity, upgradeResults, timeToPower, confidenceRisk] = await Promise.all([
    ifeRepo.getHostingCapacityByAnalysisId(tenantId, analysisId),
    ifeRepo.getUpgradeResultsByAnalysisId(tenantId, analysisId),
    ifeRepo.getTimeToPowerByAnalysisId(tenantId, analysisId),
    ifeRepo.getConfidenceRiskByAnalysisId(tenantId, analysisId),
  ]);

  if (!hostingCapacity || hostingCapacity.hcDeterministicMw === null) {
    // Should not be reachable for a 'completed' analysis — Hosting Capacity always populates this
    // field on success (see INFRA-012). A data-consistency defect, not a valid state to explain.
    throw new Error(
      `[Explanations] Analysis ${analysisId} has no usable hosting capacity result ` +
        `— hosting capacity must complete successfully before explanations can be generated`
    );
  }

  const upgradeAnalysisRequired =
    hostingCapacity.hcDeterministicMw < analysis.capacityMw - SUFFICIENCY_TOLERANCE_MW;

  const result = computeExplanations({
    upgradeAnalysisRequired,
    upgradeResultsPresent: upgradeResults !== null,
    timeToPowerPresent: timeToPower !== null,
    confidenceRiskPresent: confidenceRisk !== null,
  });

  const explanations = await ifeRepo.createExplanations({
    analysis_id: analysisId,
    tenant_id: tenantId,
    baseline_withdrawal_prob: result.baselineWithdrawalProb,
    predicted_withdrawal_prob: result.predictedWithdrawalProb,
    withdrawal_shap_values: result.withdrawalShapValues,
    cost_drivers: result.costDrivers,
    assumptions: result.assumptions,
    cox_model_version: result.coxModelVersion,
    cost_model_version: result.costModelVersion,
  });

  return { analysis, explanations, computeMs: Math.round(performance.now() - t0) };
}
