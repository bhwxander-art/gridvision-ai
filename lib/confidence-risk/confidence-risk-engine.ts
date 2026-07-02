/**
 * Confidence & Risk Scoring engine — INFRA-016 (conf_model_calibration wired
 * per INFRA-022)
 *
 * Pure computation only (no I/O): deterministic weighted-average scoring
 * over whichever components are actually available, with weights
 * renormalized over that available subset. Four of the eight schema
 * component columns (conf_mc_convergence, risk_cost_uncertainty,
 * risk_congestion_trend, risk_withdrawal) remain structurally unavailable
 * and always persisted as NULL — see the approved technical specifications
 * for the full rationale. conf_model_calibration is no longer one of them:
 * it is now computed deterministically from historical
 * ife_outcome_tracking coverage data (INFRA-022), falling back to NULL only
 * when a tenant has fewer than MIN_CALIBRATION_SAMPLE_SIZE observations.
 *
 * Bucket thresholds and default weights are named constants (types.ts) so a
 * future milestone can add a real component (e.g. once a cost model or a
 * Cox PH withdrawal model exists) without redesigning the aggregation
 * mechanism itself.
 */

import {
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_RISK_WEIGHTS,
  MIN_CALIBRATION_SAMPLE_SIZE,
  NEUTRAL_FALLBACK_SCORE,
  NOMINAL_COD_COVERAGE,
  NOMINAL_COST_COVERAGE,
  type ComponentBreakdown,
  type ComponentEntry,
  type ConfidenceRiskOptions,
  type ConfidenceRiskResult,
} from "./types";

export interface ConfidenceRiskInputs {
  /** network_models.model_date (or updated_at fallback) — reference date for staleness. */
  networkModelDate: string;
  /** Reference "now" — optional override for deterministic testing; defaults to current time. */
  now?: string;
  /** Whether hosting capacity alone was insufficient (i.e. upgrade analysis was a required stage). */
  upgradeAnalysisRequired: boolean;
  upgradeResultsPresent: boolean;
  timeToPowerPresent: boolean;
  /** Only meaningful when timeToPowerPresent is true. */
  activeQueueProjectsCount: number | null;
  /** Tenant's historical outcome-coverage statistics — INFRA-022. See CoverageStats (types.ts). */
  costCoverageRate: number | null;
  costSampleSize: number;
  codCoverageRate: number | null;
  codSampleSize: number;
}

function bucketDataFreshness(daysSinceModel: number): number {
  if (daysSinceModel <= 30) return 100;
  if (daysSinceModel <= 90) return 80;
  if (daysSinceModel <= 180) return 60;
  if (daysSinceModel <= 365) return 40;
  return 20;
}

function bucketQueueDepth(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 20;
  if (count <= 5) return 40;
  if (count <= 10) return 60;
  if (count <= 20) return 80;
  return 100;
}

interface WeightedEntry {
  value: number | null;
  weight: number;
  reason?: string;
}

function weightedAverage(entries: WeightedEntry[]): { score: number; usedFallback: boolean } {
  const available = entries.filter(
    (e): e is WeightedEntry & { value: number } => e.value !== null
  );
  const totalWeight = available.reduce((sum, e) => sum + e.weight, 0);
  if (available.length === 0 || totalWeight <= 0) {
    return { score: NEUTRAL_FALLBACK_SCORE, usedFallback: true };
  }
  const weightedSum = available.reduce((sum, e) => sum + e.value * e.weight, 0);
  return { score: Math.round(weightedSum / totalWeight), usedFallback: false };
}

function toEntry(entry: WeightedEntry): ComponentEntry {
  const available = entry.value !== null;
  return {
    value: entry.value,
    weight: entry.weight,
    available,
    ...(!available && entry.reason ? { reason: entry.reason } : {}),
  };
}

function clamp0to100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * conf_model_calibration — INFRA-022. Pure arithmetic: compares each
 * interval's empirical historical coverage rate against its nominal coverage
 * (80% for p10-p90, 50% for p25-p75); the closer the match, the higher the
 * score. Reuses weightedAverage (above) to combine the cost/COD sub-scores —
 * no new aggregation mechanism. Returns null (excluded from the outer
 * confidence weighted average, same as every other unavailable component)
 * when neither side has at least MIN_CALIBRATION_SAMPLE_SIZE observations.
 */
function computeModelCalibration(
  inputs: Pick<ConfidenceRiskInputs, "costCoverageRate" | "costSampleSize" | "codCoverageRate" | "codSampleSize">
): { value: number | null; reason?: string } {
  const costUsable = inputs.costCoverageRate !== null && inputs.costSampleSize >= MIN_CALIBRATION_SAMPLE_SIZE;
  const codUsable = inputs.codCoverageRate !== null && inputs.codSampleSize >= MIN_CALIBRATION_SAMPLE_SIZE;

  if (!costUsable && !codUsable) {
    return {
      value: null,
      reason: `fewer than ${MIN_CALIBRATION_SAMPLE_SIZE} historical outcome observations with a computed coverage flag`,
    };
  }

  const subEntries: WeightedEntry[] = [];
  if (costUsable) {
    const error = Math.abs(inputs.costCoverageRate! - NOMINAL_COST_COVERAGE);
    subEntries.push({ value: clamp0to100(Math.round(100 * (1 - error))), weight: 1 });
  }
  if (codUsable) {
    const error = Math.abs(inputs.codCoverageRate! - NOMINAL_COD_COVERAGE);
    subEntries.push({ value: clamp0to100(Math.round(100 * (1 - error))), weight: 1 });
  }

  return { value: weightedAverage(subEntries).score };
}

export function computeConfidenceRisk(
  inputs: ConfidenceRiskInputs,
  options: ConfidenceRiskOptions = {}
): ConfidenceRiskResult {
  const confidenceWeights = { ...DEFAULT_CONFIDENCE_WEIGHTS, ...options.confidenceWeights };
  const riskWeights = { ...DEFAULT_RISK_WEIGHTS, ...options.riskWeights };
  const now = inputs.now ?? new Date().toISOString();

  const daysSinceModel = Math.max(
    0,
    (new Date(now).getTime() - new Date(inputs.networkModelDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  const confDataFreshness = bucketDataFreshness(daysSinceModel);

  // Hosting capacity is always present (a precondition enforced by the pipeline before this
  // function is ever called), so it always counts as one completed/required stage.
  const requiredStages = 1 + (inputs.upgradeAnalysisRequired ? 1 : 0) + 1; // +1 for time-to-power
  const completedStages =
    1 +
    (inputs.upgradeAnalysisRequired && inputs.upgradeResultsPresent ? 1 : 0) +
    (inputs.timeToPowerPresent ? 1 : 0);
  const confInputCompleteness = Math.round((100 * completedStages) / requiredStages);

  const modelCalibration = computeModelCalibration(inputs);
  const confModelCalibration = modelCalibration.value;
  const confMcConvergence: number | null = null;

  const riskQueueDepth =
    inputs.timeToPowerPresent && inputs.activeQueueProjectsCount != null
      ? bucketQueueDepth(inputs.activeQueueProjectsCount)
      : null;
  const riskCostUncertainty: number | null = null;
  const riskCongestionTrend: number | null = null;
  const riskWithdrawal: number | null = null;

  const confidenceEntries: Record<
    "dataFreshness" | "modelCalibration" | "inputCompleteness" | "mcConvergence",
    WeightedEntry
  > = {
    dataFreshness: { value: confDataFreshness, weight: confidenceWeights.dataFreshness },
    modelCalibration: {
      value: confModelCalibration,
      weight: confidenceWeights.modelCalibration,
      reason: modelCalibration.reason,
    },
    inputCompleteness: { value: confInputCompleteness, weight: confidenceWeights.inputCompleteness },
    mcConvergence: {
      value: confMcConvergence,
      weight: confidenceWeights.mcConvergence,
      reason: "Monte Carlo hosting capacity (INFRA-012 §2) is not implemented",
    },
  };

  const { score: confidenceScore, usedFallback: confidenceFallback } = weightedAverage(
    Object.values(confidenceEntries)
  );

  const riskEntries: Record<
    "costUncertainty" | "queueDepth" | "congestionTrend" | "withdrawal",
    WeightedEntry
  > = {
    costUncertainty: {
      value: riskCostUncertainty,
      weight: riskWeights.costUncertainty,
      reason: "cost model (INFRA-013 §2) is not implemented",
    },
    queueDepth: {
      value: riskQueueDepth,
      weight: riskWeights.queueDepth,
      reason: inputs.timeToPowerPresent
        ? undefined
        : "time-to-power (INFRA-015) has not been computed for this analysis yet",
    },
    congestionTrend: {
      value: riskCongestionTrend,
      weight: riskWeights.congestionTrend,
      reason: "historical congestion time-series does not exist yet",
    },
    withdrawal: {
      value: riskWithdrawal,
      weight: riskWeights.withdrawal,
      reason:
        "Cox PH withdrawal model is not implemented, and ife_analyses has no FK to a specific queue_projects row",
    },
  };

  const { score: riskScore, usedFallback: riskFallback } = weightedAverage(Object.values(riskEntries));

  const componentBreakdown: ComponentBreakdown = {
    confidence: {
      dataFreshness: toEntry(confidenceEntries.dataFreshness),
      modelCalibration: toEntry(confidenceEntries.modelCalibration),
      inputCompleteness: toEntry(confidenceEntries.inputCompleteness),
      mcConvergence: toEntry(confidenceEntries.mcConvergence),
      ...(confidenceFallback ? { fallback: "no_components_available" as const } : {}),
    },
    risk: {
      costUncertainty: toEntry(riskEntries.costUncertainty),
      queueDepth: toEntry(riskEntries.queueDepth),
      congestionTrend: toEntry(riskEntries.congestionTrend),
      withdrawal: toEntry(riskEntries.withdrawal),
      ...(riskFallback ? { fallback: "no_components_available" as const } : {}),
    },
  };

  return {
    confidenceScore,
    riskScore,
    confDataFreshness,
    confModelCalibration,
    confInputCompleteness,
    confMcConvergence,
    riskCostUncertainty,
    riskQueueDepth,
    riskCongestionTrend,
    riskWithdrawal,
    componentBreakdown,
    computedAt: now,
  };
}
