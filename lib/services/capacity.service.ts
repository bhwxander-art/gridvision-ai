import { TERRITORY_CAPACITY_MW, planningTerritory } from "@/lib/enterprise-data";

// ISO-NE NEPOOL summer capability peak (MW) — used to derive Eastern MA fraction
export const ISONE_SYSTEM_PEAK_MW = 24_900;

// Eastern MA share of ISO-NE system load, based on territory vs system peak ratio
export const EASTERN_MA_FRACTION =
  planningTerritory.peakSystemLoadMW / ISONE_SYSTEM_PEAK_MW;

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export interface CapacitySnapshot {
  currentLoadMW: number;
  isoneSystemLoadMW: number;
  capacityMW: number;
  utilizationPct: number;
  headroomMW: number;
  riskLevel: RiskLevel;
  source: string;
  timestamp: string;
  freshness: "live" | "delayed" | "mock";
  territory: string;
}

export function deriveRiskLevel(utilizationPct: number): RiskLevel {
  if (utilizationPct >= 95) return "critical";
  if (utilizationPct >= 85) return "high";
  if (utilizationPct >= 70) return "moderate";
  return "low";
}

export function computeCapacity(
  isoneSystemLoadMW: number,
  source: string,
  timestamp: string,
  freshness: "live" | "delayed" | "mock"
): CapacitySnapshot {
  const currentLoadMW = Math.round(isoneSystemLoadMW * EASTERN_MA_FRACTION);
  const capacityMW = TERRITORY_CAPACITY_MW;
  const utilizationPct =
    Math.round((currentLoadMW / capacityMW) * 1_000) / 10;
  const headroomMW = capacityMW - currentLoadMW;

  return {
    currentLoadMW,
    isoneSystemLoadMW,
    capacityMW,
    utilizationPct,
    headroomMW,
    riskLevel: deriveRiskLevel(utilizationPct),
    source,
    timestamp,
    freshness,
    territory: "eastern-ma",
  };
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  low:      "Low",
  moderate: "Moderate",
  high:     "High",
  critical: "Critical",
};

export interface SimulationResult {
  futureTotalLoadMW: number;
  remainingHeadroomMW: number;
  utilizationPct: number;
  riskLevel: RiskLevel;
}

export function simulateDataCenter(
  baseline: CapacitySnapshot,
  addedMW: number
): SimulationResult {
  const futureTotalLoadMW = baseline.currentLoadMW + addedMW;
  const utilizationPct =
    Math.round((futureTotalLoadMW / baseline.capacityMW) * 1_000) / 10;
  const remainingHeadroomMW = baseline.capacityMW - futureTotalLoadMW;
  return {
    futureTotalLoadMW,
    remainingHeadroomMW,
    utilizationPct,
    riskLevel: deriveRiskLevel(utilizationPct),
  };
}

// ── Per-substation simulation ──────────────────────────────────────────────────

export interface SubstationSimResult {
  substationId: string;
  baseLoadMW: number;
  ssAddedMW: number;
  simLoadMW: number;
  baseUtilizationPct: number;
  simUtilizationPct: number;
  baseRiskLevel: RiskLevel;
  simRiskLevel: RiskLevel;
}

/**
 * Distributes addedMW across substations proportionally by existing peak load,
 * then returns before/after capacity metrics for each.
 */
export function simulateSubstations(
  portfolio: ReadonlyArray<{ id: string; peakLoadMW: number; n1CapacityMW: number }>,
  addedMW: number
): Map<string, SubstationSimResult> {
  const totalPeakMW = portfolio.reduce((s, ss) => s + ss.peakLoadMW, 0);
  const results = new Map<string, SubstationSimResult>();

  for (const ss of portfolio) {
    const share = totalPeakMW > 0 ? ss.peakLoadMW / totalPeakMW : 0;
    const ssAddedMW = Math.round(addedMW * share);
    const simLoadMW = ss.peakLoadMW + ssAddedMW;
    const baseUtilizationPct =
      Math.round((ss.peakLoadMW / ss.n1CapacityMW) * 1_000) / 10;
    const simUtilizationPct =
      Math.round((simLoadMW / ss.n1CapacityMW) * 1_000) / 10;

    results.set(ss.id, {
      substationId:      ss.id,
      baseLoadMW:        ss.peakLoadMW,
      ssAddedMW,
      simLoadMW,
      baseUtilizationPct,
      simUtilizationPct,
      baseRiskLevel:     deriveRiskLevel(baseUtilizationPct),
      simRiskLevel:      deriveRiskLevel(simUtilizationPct),
    });
  }

  return results;
}
