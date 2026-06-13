/**
 * Utility planning engine — models used by distribution & transmission planners.
 * Formulas reflect standard headroom, thermal loading, and interconnection analysis.
 */

export type PlanningHorizon = 3 | 5 | 10;
export type ConstraintSeverity = "normal" | "watch" | "constrained" | "critical";

export interface TransformerAsset {
  id: string;
  substationId: string;
  name: string;
  ratedMVA: number;
  peakLoadMVA: number;
  loadFactor: number;
  ageYears: number;
  n1Compliant: boolean;
}

export interface FeederCircuit {
  id: string;
  substationId: string;
  name: string;
  hostingCapacityMW: number;
  committedLoadMW: number;
  queuedLoadMW: number;
}

export interface SubstationPlan {
  id: string;
  name: string;
  region: string;
  voltageKV: number;
  nameplateMVA: number;
  peakLoadMW: number;
  n1CapacityMW: number;
  annualGrowthPct: number;
  transformers: TransformerAsset[];
  feeders: FeederCircuit[];
  x: number;
  y: number;
}

export interface DataCenterInterconnection {
  id: string;
  projectName: string;
  developer: string;
  requestedMW: number;
  loadFactor: number;
  targetCOD: string;
  status: "study" | "ia-executed" | "construction" | "energized";
  affectedSubstationId: string;
  affectedFeederId: string;
  rampMonths: number;
}

export interface SubstationCapacityResult {
  substationId: string;
  utilizationPct: number;
  headroomMW: number;
  n1HeadroomMW: number;
  severity: ConstraintSeverity;
  yearsToConstraint: number | null;
  recommendedAction: string;
  estimatedCapexM: number;
}

export interface TransformerOverloadResult {
  transformerId: string;
  substationId: string;
  loadingPct: number;
  forecastLoadingPct: number;
  overloadRisk: ConstraintSeverity;
  thermalMarginMVA: number;
  replacementPriority: number;
  recommendedAction: string;
}

export interface DataCenterImpactResult {
  projectId: string;
  netLoadMW: number;
  feederHeadroomAfterMW: number;
  substationUtilAfterPct: number;
  constraintFlag: boolean;
  upgradeRequired: string;
  studyPhaseRecommendation: string;
}

export function assessSubstationCapacity(
  substation: SubstationPlan,
  horizonYears: PlanningHorizon,
  additionalLoadMW = 0
): SubstationCapacityResult {
  const totalLoad = substation.peakLoadMW + additionalLoadMW;
  const utilizationPct = (totalLoad / substation.nameplateMVA) * 100;
  const headroomMW = substation.nameplateMVA - totalLoad;
  const n1HeadroomMW = substation.n1CapacityMW - totalLoad;

  let severity: ConstraintSeverity = "normal";
  if (utilizationPct >= 95 || n1HeadroomMW <= 0) severity = "critical";
  else if (utilizationPct >= 85 || n1HeadroomMW < 20) severity = "constrained";
  else if (utilizationPct >= 75 || n1HeadroomMW < 40) severity = "watch";

  const growthMWPerYear =
    substation.peakLoadMW * (substation.annualGrowthPct / 100);
  const yearsToConstraint =
    growthMWPerYear > 0 && headroomMW > 0
      ? Math.round((headroomMW / growthMWPerYear) * 10) / 10
      : headroomMW <= 0
        ? 0
        : null;

  const withinHorizon =
    yearsToConstraint !== null && yearsToConstraint <= horizonYears;

  let recommendedAction: string;
  let estimatedCapexM: number;

  if (severity === "critical" || withinHorizon) {
    recommendedAction = `Initiate substation upgrade study. Add ${Math.ceil(Math.max(50, totalLoad * 0.2))} MVA transformer bank or reconductor transmission tie within ${Math.max(1, Math.floor(yearsToConstraint ?? 1))} years.`;
    estimatedCapexM = 8 + (substation.nameplateMVA / 100) * 3;
  } else if (severity === "constrained") {
    recommendedAction =
      "Schedule detailed load flow analysis. Pre-position mobile transformer and update 5-year capital plan.";
    estimatedCapexM = 3 + (substation.nameplateMVA / 200) * 2;
  } else if (severity === "watch") {
    recommendedAction =
      "Monitor quarterly. Update hosting capacity map and notify interconnection queue of limited headroom.";
    estimatedCapexM = 0.5;
  } else {
    recommendedAction =
      "Within planning limits. Continue annual capacity review per DPU filing cycle.";
    estimatedCapexM = 0;
  }

  return {
    substationId: substation.id,
    utilizationPct,
    headroomMW,
    n1HeadroomMW,
    severity,
    yearsToConstraint,
    recommendedAction,
    estimatedCapexM,
  };
}

export function forecastTransformerOverload(
  transformer: TransformerAsset,
  loadGrowthPct: number,
  dataCenterLoadMW: number
): TransformerOverloadResult {
  const growthFactor = 1 + loadGrowthPct / 100;
  const additionalMVA = dataCenterLoadMW * transformer.loadFactor;
  const forecastPeakMVA =
    transformer.peakLoadMVA * growthFactor + additionalMVA;

  const loadingPct = (transformer.peakLoadMVA / transformer.ratedMVA) * 100;
  const forecastLoadingPct = (forecastPeakMVA / transformer.ratedMVA) * 100;
  const thermalMarginMVA = transformer.ratedMVA - forecastPeakMVA;

  let overloadRisk: ConstraintSeverity = "normal";
  if (forecastLoadingPct >= 100) overloadRisk = "critical";
  else if (forecastLoadingPct >= 95) overloadRisk = "constrained";
  else if (forecastLoadingPct >= 80) overloadRisk = "watch";

  const ageFactor = transformer.ageYears > 35 ? 1.3 : transformer.ageYears > 25 ? 1.15 : 1;
  const n1Penalty = transformer.n1Compliant ? 0 : 15;
  const replacementPriority = Math.min(
    100,
    Math.round(
      forecastLoadingPct * 0.6 +
        ageFactor * 10 +
        n1Penalty +
        (100 - thermalMarginMVA)
    )
  );

  let recommendedAction: string;
  if (overloadRisk === "critical") {
    recommendedAction = `Emergency load relief required. Split feeder or install ${Math.ceil(transformer.ratedMVA * 0.5)} MVA spare within 12 months.`;
  } else if (overloadRisk === "constrained") {
    recommendedAction =
      "Plan transformer replacement in next capital cycle. Evaluate load transfer to adjacent substation.";
  } else if (overloadRisk === "watch") {
    recommendedAction =
      "Increase SCADA monitoring frequency. Model summer peak with EV and DC load additions.";
  } else {
    recommendedAction = "Adequate thermal margin. Include in routine inspection schedule.";
  }

  return {
    transformerId: transformer.id,
    substationId: transformer.substationId,
    loadingPct,
    forecastLoadingPct,
    overloadRisk,
    thermalMarginMVA,
    replacementPriority,
    recommendedAction,
  };
}

export function analyzeDataCenterImpact(
  project: DataCenterInterconnection,
  substation: SubstationPlan,
  feeder: FeederCircuit
): DataCenterImpactResult {
  const netLoadMW = project.requestedMW * project.loadFactor;
  const feederHeadroomAfterMW =
    feeder.hostingCapacityMW - feeder.committedLoadMW - feeder.queuedLoadMW - netLoadMW;

  const substationAfter = assessSubstationCapacity(substation, 5, netLoadMW);
  const constraintFlag = feederHeadroomAfterMW < 0 || substationAfter.severity === "critical" || substationAfter.severity === "constrained";

  let upgradeRequired: string;
  if (feederHeadroomAfterMW < 0) {
    upgradeRequired = `Feeder ${feeder.name} exceeds hosting capacity by ${Math.abs(Math.round(feederHeadroomAfterMW))} MW. Reconductor or new 13.8 kV tie required.`;
  } else if (substationAfter.n1HeadroomMW < 0) {
    upgradeRequired = "Substation fails N-1 criterion post-interconnection. Additional transformer bank required.";
  } else if (substationAfter.severity === "constrained") {
    upgradeRequired = "Conditional approval — network upgrade contribution per ISO-NE Schedule 23.";
  } else {
    upgradeRequired = "No network upgrade required under current assumptions.";
  }

  const studyPhaseRecommendation =
    project.status === "study"
      ? constraintFlag
        ? "Issue feasibility study with estimated network upgrade cost and 18-month timeline."
        : "Fast-track system impact study — adequate headroom confirmed."
      : "Monitor energization ramp against approved load profile.";

  return {
    projectId: project.id,
    netLoadMW,
    feederHeadroomAfterMW,
    substationUtilAfterPct: substationAfter.utilizationPct,
    constraintFlag,
    upgradeRequired,
    studyPhaseRecommendation,
  };
}

export function getSeverityColor(severity: ConstraintSeverity): string {
  switch (severity) {
    case "normal":
      return "#22c55e";
    case "watch":
      return "#06b6d4";
    case "constrained":
      return "#eab308";
    case "critical":
      return "#ef4444";
  }
}

export function getSeverityLabel(severity: ConstraintSeverity): string {
  switch (severity) {
    case "normal":
      return "Normal";
    case "watch":
      return "Watch";
    case "constrained":
      return "Constrained";
    case "critical":
      return "Critical";
  }
}
