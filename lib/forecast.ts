export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ForecastInputs {
  cityName: string;
  currentPeakLoad: number;
  populationGrowthRate: number;
  evGrowthRate: number;
  dataCenterLoad: number;
}

export interface ForecastResult {
  futureLoad: number;
  increasePercent: number;
  riskLevel: RiskLevel;
  capacityRecommendation: string;
  populationContribution: number;
  evContribution: number;
  dataCenterContribution: number;
}

export function calculateForecast(inputs: ForecastInputs): ForecastResult {
  const {
    currentPeakLoad,
    populationGrowthRate,
    evGrowthRate,
    dataCenterLoad,
  } = inputs;

  const populationContribution =
    currentPeakLoad * (populationGrowthRate / 100);
  const evContribution = currentPeakLoad * (evGrowthRate / 200);
  const dataCenterContribution = dataCenterLoad;

  const futureLoad =
    currentPeakLoad * (1 + populationGrowthRate / 100) +
    currentPeakLoad * (evGrowthRate / 200) +
    dataCenterLoad;

  const increasePercent =
    currentPeakLoad > 0
      ? ((futureLoad - currentPeakLoad) / currentPeakLoad) * 100
      : 0;

  const riskLevel = getRiskLevel(increasePercent);
  const capacityRecommendation = getCapacityRecommendation(
    riskLevel,
    futureLoad,
    currentPeakLoad
  );

  return {
    futureLoad,
    increasePercent,
    riskLevel,
    capacityRecommendation,
    populationContribution,
    evContribution,
    dataCenterContribution,
  };
}

export function getRiskLevel(increasePercent: number): RiskLevel {
  if (increasePercent < 10) return "LOW";
  if (increasePercent <= 25) return "MEDIUM";
  return "HIGH";
}

export function getCapacityRecommendation(
  riskLevel: RiskLevel,
  futureLoad: number,
  currentPeakLoad: number
): string {
  switch (riskLevel) {
    case "LOW":
      return "Current infrastructure is sufficient. Continue routine monitoring and annual capacity reviews.";
    case "MEDIUM":
      return `Plan incremental upgrades within 3–5 years. Target ${formatMW(futureLoad * 1.15)} installed capacity to maintain 15% reserve margin.`;
    case "HIGH":
      return `Immediate action required. Accelerate substation upgrades and consider ${formatMW(futureLoad - currentPeakLoad)} of new capacity by year 3.`;
  }
}

function formatMW(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} MW`;
}

export function getRiskColor(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case "LOW":
      return "#22c55e";
    case "MEDIUM":
      return "#eab308";
    case "HIGH":
      return "#ef4444";
  }
}
