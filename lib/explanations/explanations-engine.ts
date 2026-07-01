/**
 * Explanations engine — INFRA-017
 *
 * Pure computation only (no I/O), and no new numerical algorithm at all —
 * like the IFE Orchestrator (INFRA-014), this ticket contributes no
 * computation to be pure about beyond boolean topic selection. Every
 * assumptions[] entry is one of the named constants in
 * assumption-templates.ts, selected by which upstream analyses exist for
 * this ife_analyses row; the engine never embeds template text inline.
 *
 * Fixed, deterministic order: topics are always evaluated and pushed in the
 * same sequence below (hosting capacity -> upgrade analysis -> time-to-
 * power -> confidence/risk -> withdrawal probability), so two calls with
 * identical inputs always produce byte-identical assumptions arrays — this
 * is required for stable API responses and snapshot tests, not just an
 * implementation detail.
 */

import {
  ASSUMPTION_CONFIDENCE_RISK_NOT_COMPUTED,
  ASSUMPTION_CONFIDENCE_RISK_PARTIAL,
  ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY,
  ASSUMPTION_TIME_TO_POWER_EMPIRICAL,
  ASSUMPTION_TIME_TO_POWER_NOT_COMPUTED,
  ASSUMPTION_UPGRADE_ANALYSIS_NOT_YET_COMPUTED,
  ASSUMPTION_UPGRADE_COST_NOT_ESTIMATED,
  ASSUMPTION_WITHDRAWAL_PROBABILITY_NOT_MODELED,
} from "./assumption-templates";
import type { ExplanationsResult } from "./types";

export interface ExplanationsInputs {
  /** Whether hosting capacity alone was insufficient (upgrade analysis is a required stage). */
  upgradeAnalysisRequired: boolean;
  upgradeResultsPresent: boolean;
  timeToPowerPresent: boolean;
  confidenceRiskPresent: boolean;
}

export function computeExplanations(inputs: ExplanationsInputs): ExplanationsResult {
  const assumptions: string[] = [];

  // Topic 1: hosting capacity scope — always applies.
  assumptions.push(ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY);

  // Topic 2: upgrade analysis — only relevant when it was actually a required stage.
  if (inputs.upgradeAnalysisRequired) {
    assumptions.push(
      inputs.upgradeResultsPresent
        ? ASSUMPTION_UPGRADE_COST_NOT_ESTIMATED
        : ASSUMPTION_UPGRADE_ANALYSIS_NOT_YET_COMPUTED
    );
  }

  // Topic 3: time-to-power.
  assumptions.push(
    inputs.timeToPowerPresent ? ASSUMPTION_TIME_TO_POWER_EMPIRICAL : ASSUMPTION_TIME_TO_POWER_NOT_COMPUTED
  );

  // Topic 4: confidence/risk.
  assumptions.push(
    inputs.confidenceRiskPresent ? ASSUMPTION_CONFIDENCE_RISK_PARTIAL : ASSUMPTION_CONFIDENCE_RISK_NOT_COMPUTED
  );

  // Topic 5: withdrawal probability — always applies.
  assumptions.push(ASSUMPTION_WITHDRAWAL_PROBABILITY_NOT_MODELED);

  return {
    baselineWithdrawalProb: null,
    predictedWithdrawalProb: null,
    withdrawalShapValues: [],
    costDrivers: [],
    assumptions,
    coxModelVersion: null,
    costModelVersion: null,
    computedAt: new Date().toISOString(),
  };
}
