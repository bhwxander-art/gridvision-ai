/**
 * Grid Health Engine — deterministic, no LLM.
 *
 * Architecture:
 *   - HealthScorer interface: swap in an ML model by implementing this contract.
 *   - DeterministicScorer:    current weighted-factor implementation.
 *   - computeGridHealth():    convenience wrapper that wires in DeterministicScorer.
 *
 * Replacing with an ML model later requires only implementing HealthScorer
 * and passing the new scorer to computeGridHealth().
 */

// ── Public types ───────────────────────────────────────────────────────────

export interface HealthInputs {
  currentLoadMW: number;
  /** Hourly history, chronological (oldest first). Minimum 2 points for ramp/trend. */
  historyReadings: ReadonlyArray<{ timestamp: string; currentLoadMW: number }>;
  /** ISO-NE all-time peak — default 26,000 MW. Override per RTO. */
  referenceCapacityMW?: number;
}

export interface HealthFactor {
  id: string;
  label: string;
  score: number;   // 0–100
  weight: number;  // sums to 1.0 across all factors
  detail: string;  // one concise phrase shown in the UI
}

export type HealthStatus = "stable" | "elevated" | "critical";

export interface GridHealthResult {
  score: number;           // 0–100 integer, weighted composite
  status: HealthStatus;
  recommendation: string; // single actionable sentence for the operator
  factors: HealthFactor[];
  computedAt: string;      // ISO 8601
}

/** Contract that future ML models must satisfy. */
export interface HealthScorer {
  compute(inputs: HealthInputs): GridHealthResult;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CAPACITY_MW = 26_000; // ISO-NE all-time peak

const WEIGHTS = {
  capacityHeadroom: 0.35,
  rampRate:         0.25,
  demandDeviation:  0.25,
  trendMomentum:    0.15,
} as const;

/** Neutral score used when a factor lacks sufficient data. */
const NEUTRAL_SCORE = 75;

// ── Pure factor functions ──────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Non-linear penalty: full score below 70% utilization, steep drop above 85%. */
function factorCapacityHeadroom(
  currentMW: number,
  capacityMW: number
): HealthFactor {
  const safeCap = capacityMW > 0 ? capacityMW : DEFAULT_CAPACITY_MW;
  const util = currentMW / safeCap;
  let score: number;

  if (util <= 0.70) {
    score = 100;
  } else if (util <= 0.85) {
    score = Math.round(100 - ((util - 0.70) / 0.15) * 60); // 100 → 40
  } else {
    score = Math.round(Math.max(0, 40 - ((util - 0.85) / 0.15) * 40)); // 40 → 0
  }

  const pct = Math.round(util * 100);
  return {
    id: "capacity-headroom",
    label: "Capacity Headroom",
    score,
    weight: WEIGHTS.capacityHeadroom,
    detail: `${pct}% of ${safeCap.toLocaleString()} MW reference capacity`,
  };
}

/** Penalises large hour-over-hour absolute changes (≥ 1,500 MW → score = 0). */
function factorRampRate(
  currentMW: number,
  history: ReadonlyArray<{ timestamp: string; currentLoadMW: number }>
): HealthFactor {
  const MAX_RAMP = 1_500; // MW/hr threshold for score = 0

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000);
  const baseline = history
    .filter((r) => new Date(r.timestamp) <= oneHourAgo)
    .at(-1); // last entry ≤ 1h ago (history is ascending)

  if (!baseline) {
    return {
      id: "ramp-rate",
      label: "Ramp Rate",
      score: NEUTRAL_SCORE,
      weight: WEIGHTS.rampRate,
      detail: "Insufficient history for ramp calculation",
    };
  }

  const deltaMW = currentMW - baseline.currentLoadMW;
  const absDelta = Math.abs(deltaMW);
  const score = Math.round(clamp(100 - (absDelta / MAX_RAMP) * 100, 0, 100));
  const direction = deltaMW > 0 ? "+" : "";

  return {
    id: "ramp-rate",
    label: "Ramp Rate",
    score,
    weight: WEIGHTS.rampRate,
    detail: `${direction}${deltaMW.toLocaleString()} MW from 1-hour baseline`,
  };
}

/** Penalises deviation > 20% from rolling 24-hour mean. */
function factorDemandDeviation(
  currentMW: number,
  history: ReadonlyArray<{ currentLoadMW: number }>
): HealthFactor {
  const MAX_DEVIATION = 0.20; // 20% → score = 0

  if (history.length < 6) {
    return {
      id: "demand-deviation",
      label: "Demand Deviation",
      score: NEUTRAL_SCORE,
      weight: WEIGHTS.demandDeviation,
      detail: "Insufficient history for deviation calculation",
    };
  }

  const avg = history.reduce((s, r) => s + r.currentLoadMW, 0) / history.length;
  if (avg === 0) {
    return {
      id: "demand-deviation",
      label: "Demand Deviation",
      score: NEUTRAL_SCORE,
      weight: WEIGHTS.demandDeviation,
      detail: "Rolling average is zero — cannot compute deviation",
    };
  }
  const deviation = Math.abs(currentMW - avg) / avg;
  const score = Math.round(clamp(100 - (deviation / MAX_DEVIATION) * 100, 0, 100));
  const sign = currentMW >= avg ? "+" : "";
  const pct = Math.round(deviation * 100);

  return {
    id: "demand-deviation",
    label: "Demand Deviation",
    score,
    weight: WEIGHTS.demandDeviation,
    detail: `${sign}${pct}% vs ${Math.round(avg).toLocaleString()} MW rolling average`,
  };
}

/** Scores net demand change over the past 2 hours (directional momentum). */
function factorTrendMomentum(
  currentMW: number,
  history: ReadonlyArray<{ timestamp: string; currentLoadMW: number }>
): HealthFactor {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1_000);
  const baseline = history
    .filter((r) => new Date(r.timestamp) <= twoHoursAgo)
    .at(-1);

  if (!baseline) {
    return {
      id: "trend-momentum",
      label: "Trend Momentum",
      score: NEUTRAL_SCORE,
      weight: WEIGHTS.trendMomentum,
      detail: "Insufficient history for trend calculation",
    };
  }

  const deltaMW = currentMW - baseline.currentLoadMW;

  // Score table: strong ramp hurts score; decline or stability is neutral/good
  let score: number;
  if (deltaMW > 2_000)       score = 30;
  else if (deltaMW > 1_000)  score = 55;
  else if (deltaMW > 300)    score = 75;
  else if (deltaMW >= -300)  score = 100;
  else                       score = 90; // declining: slightly below perfect (could be unexpected)

  const sign = deltaMW > 0 ? "+" : "";
  const direction = deltaMW > 300 ? "Rising" : deltaMW < -300 ? "Falling" : "Stable";

  return {
    id: "trend-momentum",
    label: "Trend Momentum",
    score,
    weight: WEIGHTS.trendMomentum,
    detail: `${direction} · ${sign}${deltaMW.toLocaleString()} MW over 2 hours`,
  };
}

// ── Recommendation logic ───────────────────────────────────────────────────

const RECOMMENDATIONS: Record<string, Record<HealthStatus, string>> = {
  "capacity-headroom": {
    critical:  "Demand approaching system peak. Initiate load curtailment procedures and verify operating reserves.",
    elevated:  "Elevated demand. Confirm spinning reserves are adequate for continued load growth.",
    stable:    "All indicators nominal. No immediate action required.",
  },
  "ramp-rate": {
    critical:  "Load ramping rapidly. Alert distribution operations and verify voltage support availability.",
    elevated:  "Load rising faster than normal. Monitor distribution feeders for overload conditions.",
    stable:    "All indicators nominal. No immediate action required.",
  },
  "demand-deviation": {
    critical:  "Demand is significantly abnormal. Verify metering data integrity and check for outage reporting.",
    elevated:  "Unusual load level relative to recent history. Confirm no unplanned generation trips.",
    stable:    "All indicators nominal. No immediate action required.",
  },
  "trend-momentum": {
    critical:  "Sustained upward demand trend. Coordinate with dispatch to activate additional resources.",
    elevated:  "Upward trend continuing. Monitor 30-minute intervals and prepare for peak conditions.",
    stable:    "All indicators nominal. No immediate action required.",
  },
};

function deriveRecommendation(
  factors: HealthFactor[],
  status: HealthStatus
): string {
  if (status === "stable") {
    return "All indicators nominal. No immediate action required.";
  }

  // Find the factor contributing the most concern (lowest weighted score)
  const worst = factors.reduce<HealthFactor | null>((acc, f) => {
    if (!acc) return f;
    return f.score * f.weight < acc.score * acc.weight ? f : acc;
  }, null);

  if (!worst) return "Review system conditions and confirm no active outages.";

  return RECOMMENDATIONS[worst.id]?.[status]
    ?? "Review system conditions and confirm no active outages.";
}

// ── DeterministicScorer ────────────────────────────────────────────────────

export class DeterministicScorer implements HealthScorer {
  compute(inputs: HealthInputs): GridHealthResult {
    const capacityMW = inputs.referenceCapacityMW ?? DEFAULT_CAPACITY_MW;
    const { currentLoadMW, historyReadings } = inputs;

    const factors: HealthFactor[] = [
      factorCapacityHeadroom(currentLoadMW, capacityMW),
      factorRampRate(currentLoadMW, historyReadings),
      factorDemandDeviation(currentLoadMW, historyReadings),
      factorTrendMomentum(currentLoadMW, historyReadings),
    ];

    const score = Math.round(
      factors.reduce((sum, f) => sum + f.score * f.weight, 0)
    );

    const status: HealthStatus =
      score >= 70 ? "stable" : score >= 40 ? "elevated" : "critical";

    return {
      score,
      status,
      recommendation: deriveRecommendation(factors, status),
      factors,
      computedAt: new Date().toISOString(),
    };
  }
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Compute grid health using the deterministic scorer.
 * Pass a custom scorer to swap in an ML model without changing call sites.
 */
export function computeGridHealth(
  inputs: HealthInputs,
  scorer: HealthScorer = new DeterministicScorer()
): GridHealthResult {
  return scorer.compute(inputs);
}
