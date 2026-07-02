/**
 * Confidence & Risk Scoring engine public types — INFRA-016
 * (conf_model_calibration wired per INFRA-022)
 *
 * Scope: deterministic, weighted-average composite scoring over only the
 * components that are actually computable today. Four schema component
 * columns (conf_mc_convergence, risk_cost_uncertainty, risk_congestion_trend,
 * risk_withdrawal) require infrastructure that does not exist yet (Monte
 * Carlo hosting capacity, a cost model, a congestion time-series, and a Cox
 * PH withdrawal model, respectively) and are persisted as NULL — see the
 * approved technical specifications for the full rationale.
 * conf_model_calibration is computed deterministically from historical
 * ife_outcome_tracking coverage data (INFRA-022) — see CoverageStats below —
 * falling back to NULL only when a tenant has insufficient historical
 * observations. confidence_score and risk_score themselves are NOT NULL in
 * the schema, so they are always computed as a weighted average over
 * whichever components ARE available, with weights renormalized over that
 * available subset, falling back to a documented neutral midpoint only if
 * literally none are available.
 */

export const NEUTRAL_FALLBACK_SCORE = 50;

/**
 * conf_model_calibration inputs/tunables — INFRA-022.
 *
 * A well-calibrated p10-p90 interval should nominally contain ~80% of actual
 * outcomes; a well-calibrated p25-p75 interval should nominally contain ~50%.
 * These nominal values, the minimum sample size, and the linear scoring
 * formula in confidence-risk-engine.ts are explicit, tunable design choices —
 * not fixed statistical requirements.
 */
export const NOMINAL_COST_COVERAGE = 0.8;
export const NOMINAL_COD_COVERAGE = 0.5;
export const MIN_CALIBRATION_SAMPLE_SIZE = 5;

/**
 * Aggregate historical outcome-coverage statistics for a tenant, sourced from
 * ife_outcome_tracking.within_cost_p10_p90/within_cod_p25_p75 (INFRA-021).
 * coverageRate is null (never 0) whenever sampleSize is 0 — see
 * IfeCalibrationStatsRepository.getCoverageStats for the exact aggregation
 * algorithm (NULL values excluded from both numerator and denominator).
 */
export interface CoverageStats {
  costCoverageRate: number | null;
  costSampleSize: number;
  codCoverageRate: number | null;
  codSampleSize: number;
}

export interface ConfidenceWeights {
  dataFreshness: number;
  modelCalibration: number;
  inputCompleteness: number;
  mcConvergence: number;
}

export interface RiskWeights {
  costUncertainty: number;
  queueDepth: number;
  congestionTrend: number;
  withdrawal: number;
}

export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  dataFreshness: 25,
  modelCalibration: 25,
  inputCompleteness: 25,
  mcConvergence: 25,
};

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  costUncertainty: 25,
  queueDepth: 25,
  congestionTrend: 25,
  withdrawal: 25,
};

export interface ConfidenceRiskOptions {
  confidenceWeights?: Partial<ConfidenceWeights>;
  riskWeights?: Partial<RiskWeights>;
}

/** One component's contribution (or lack thereof) to a composite score. */
export interface ComponentEntry {
  value: number | null;
  weight: number;
  available: boolean;
  reason?: string;
}

export interface ComponentBreakdown {
  /** Allows this shape to be passed directly as ife_confidence_risk.component_breakdown (JSONB, typed Record<string, unknown> at the repository boundary) without a cast. */
  [key: string]: unknown;
  confidence: {
    dataFreshness: ComponentEntry;
    modelCalibration: ComponentEntry;
    inputCompleteness: ComponentEntry;
    mcConvergence: ComponentEntry;
    fallback?: "no_components_available";
  };
  risk: {
    costUncertainty: ComponentEntry;
    queueDepth: ComponentEntry;
    congestionTrend: ComponentEntry;
    withdrawal: ComponentEntry;
    fallback?: "no_components_available";
  };
}

export interface ConfidenceRiskResult {
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
  componentBreakdown: ComponentBreakdown;
  computedAt: string;
}
