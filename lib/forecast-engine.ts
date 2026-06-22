import type { DataCenterInterconnection } from "@/lib/planning-engine";

export interface ForecastInput {
  currentLoadMW: number;
  systemCapacityMW: number;
  dataCenterQueue: Pick<
    DataCenterInterconnection,
    "requestedMW" | "loadFactor" | "targetCOD" | "status"
  >[];
  growthAssumptions: {
    evPenetrationGrowthPct: number;
    populationGrowthPct: number;
    commercialGrowthPct: number;
  };
  baseYear?: number;
}

export interface ForecastResult {
  horizonYears: number[];
  projectedLoadMW: number[];
  utilizationPct: number[];
  riskLevel: string[];
  baseYear: number;
  currentLoadMW: number;
  systemCapacityMW: number;
  compositeGrowthPct: number;
}

export type ForecastRiskLevel = "normal" | "watch" | "constrained" | "critical";

const HORIZONS = [1, 3, 5] as const;

// "2027-Q4" → 2027 (project comes online that calendar year)
function codYear(cod: string): number {
  return parseInt(cod.slice(0, 4), 10);
}

function riskLevel(utilizationPct: number): ForecastRiskLevel {
  if (utilizationPct >= 95) return "critical";
  if (utilizationPct >= 85) return "constrained";
  if (utilizationPct >= 75) return "watch";
  return "normal";
}

export function runForecast(input: ForecastInput): ForecastResult {
  const {
    currentLoadMW,
    systemCapacityMW,
    dataCenterQueue,
    growthAssumptions,
    baseYear = new Date().getFullYear(),
  } = input;

  const { evPenetrationGrowthPct, populationGrowthPct, commercialGrowthPct } =
    growthAssumptions;

  // Weighted composite annual organic growth rate.
  // Weights: EV 15% (share-of-load driver), Population 40%, Commercial 45%.
  // Convention matches the planning scenario engine.
  const compositeGrowthPct =
    evPenetrationGrowthPct * 0.15 +
    populationGrowthPct * 0.4 +
    commercialGrowthPct * 0.45;
  const compositeRate = compositeGrowthPct / 100;

  // Energized projects are already reflected in currentLoadMW
  const pending = dataCenterQueue.filter((dc) => dc.status !== "energized");

  const projectedLoadMW: number[] = [];
  const utilizationPcts: number[] = [];
  const riskLevels: string[] = [];

  for (const years of HORIZONS) {
    const targetYear = baseYear + years;

    // Compound organic growth
    const organicLoad = currentLoadMW * Math.pow(1 + compositeRate, years);

    // DC projects that reach COD by end of target year
    const dcLoad = pending
      .filter((dc) => codYear(dc.targetCOD) <= targetYear)
      .reduce((sum, dc) => sum + dc.requestedMW * dc.loadFactor, 0);

    const total = Math.round(organicLoad + dcLoad);
    const util = Math.round((total / systemCapacityMW) * 1000) / 10;

    projectedLoadMW.push(total);
    utilizationPcts.push(util);
    riskLevels.push(riskLevel(util));
  }

  return {
    horizonYears: [...HORIZONS],
    projectedLoadMW,
    utilizationPct: utilizationPcts,
    riskLevel: riskLevels,
    baseYear,
    currentLoadMW: Math.round(currentLoadMW),
    systemCapacityMW,
    compositeGrowthPct: Math.round(compositeGrowthPct * 10) / 10,
  };
}
