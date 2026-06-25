import "server-only";

// ── ROI Assumptions ────────────────────────────────────────────────────────────

export interface UtilityProfile {
  annualCapitalSpend: number; // $ spent on infrastructure annually
  planningTeamSize: number; // FTEs in planning/engineering
  substationsManaged: number; // Number of substations
  assetsManaged: number; // Total transformers + feeders
  scenariosPerYear: number; // Modeling efforts annually
  averageImplementationTime: number; // Months from plan to execution
}

export interface ROICalculation {
  // Savings
  planningTimeReduction: number; // Hours/year saved
  planningTimeSavingsUSD: number; // $ value of time
  capitalOptimization: number; // % reduction in waste
  capitalSavingsUSD: number; // $ from better planning
  riskReduction: number; // % reduction in unplanned outages
  riskSavingsUSD: number; // $ from avoided incidents
  totalAnnualSavings: number;

  // Costs
  subscriptionCost: number;
  implementationCost: number;
  trainingCost: number;
  totalAnnualCosts: number;

  // ROI
  netBenefit: number;
  roi: number; // percentage
  paybackMonths: number;
  threeyearNPV: number;
}

// ── ROI Calculator ────────────────────────────────────────────────────────────

export function calculateUtilityROI(
  profile: UtilityProfile,
  planTier: "starter" | "professional" | "enterprise" = "professional"
): ROICalculation {
  // ── Planning Time Reduction ────────────────────────────────────────────────
  // GridVision reduces manual scenario modeling and analysis by 40%

  const hoursSavedPerScenario = 16; // Hours to manually model a scenario
  const totalHoursSaved = profile.scenariosPerYear * hoursSavedPerScenario * 0.4;
  const plannerHourlyRate = 95; // $/hour avg utility planner
  const planningTimeSavingsUSD = totalHoursSaved * plannerHourlyRate;

  // ── Capital Optimization ───────────────────────────────────────────────────
  // Better planning reduces wasted/redundant capital spend by 8-12%
  // Use conservative 8%

  const capitalOptimizationRate = 0.08;
  const capitalSavingsUSD = profile.annualCapitalSpend * capitalOptimizationRate;

  // ── Risk Reduction (Avoiding Unplanned Outages) ────────────────────────────
  // Proactive planning reduces unplanned outages by 5-15%
  // Cost of unplanned outage: $15K-50K per incident for utilities
  // Assume 3-5 major incidents prevented annually
  // Use conservative: 4 incidents prevented × $30K = $120K

  const incidentsPrevented = Math.min(
    Math.max(profile.substationsManaged / 50, 2),
    5
  );
  const costPerIncident = 30000;
  const riskSavingsUSD = incidentsPrevented * costPerIncident;

  // ── Subscription & Implementation Costs ─────────────────────────────────────

  const subscriptionCosts = {
    starter: 99 * 12,
    professional: 499 * 12,
    enterprise: 2499 * 12,
  };

  const subscriptionCost = subscriptionCosts[planTier];

  // Implementation: ~$15K-50K depending on scale
  const implementationCost =
    Math.min(Math.max(profile.substationsManaged * 200, 15000), 50000) +
    5000; // Integration + initial setup
  const trainingCost = profile.planningTeamSize * 2000; // 2 days training per person

  // ── Calculate Totals ───────────────────────────────────────────────────────

  const totalAnnualSavings =
    planningTimeSavingsUSD + capitalSavingsUSD + riskSavingsUSD;
  const totalAnnualCosts = subscriptionCost + implementationCost + trainingCost;
  const netBenefit = totalAnnualSavings - totalAnnualCosts;
  const roi = totalAnnualCosts > 0 ? (netBenefit / totalAnnualCosts) * 100 : 0;
  const paybackMonths =
    totalAnnualCosts > 0 ? (totalAnnualCosts / totalAnnualSavings) * 12 : 0;

  // 3-year NPV (simplified: undiscounted)
  const threeyearNPV = netBenefit * 3 - implementationCost;

  return {
    planningTimeReduction: totalHoursSaved,
    planningTimeSavingsUSD,
    capitalOptimization: capitalOptimizationRate * 100,
    capitalSavingsUSD,
    riskReduction: (incidentsPrevented / (incidentsPrevented + 5)) * 100,
    riskSavingsUSD,
    totalAnnualSavings,
    subscriptionCost,
    implementationCost,
    trainingCost,
    totalAnnualCosts,
    netBenefit,
    roi,
    paybackMonths,
    threeyearNPV,
  };
}

// ── ROI Messaging ──────────────────────────────────────────────────────────────

export function getRoiHeadline(calculation: ROICalculation): string {
  if (calculation.paybackMonths < 3) {
    return `Pays for itself in ${Math.ceil(calculation.paybackMonths)} months`;
  }
  if (calculation.roi > 300) {
    return `${Math.round(calculation.roi)}% annual ROI`;
  }
  if (calculation.netBenefit > 1000000) {
    return `Save $${(calculation.netBenefit / 1000000).toFixed(1)}M annually`;
  }
  return `${Math.round(calculation.netBenefit / 1000)}K annual savings`;
}

// ── Sensitivity Analysis ───────────────────────────────────────────────────────

export function performSensitivityAnalysis(
  profile: UtilityProfile
): Record<string, ROICalculation> {
  const base = calculateUtilityROI(profile, "professional");

  // Optimistic scenario: 12% capital savings + more risk reduction
  const optimisticCapitalSavings = profile.annualCapitalSpend * 0.12;
  const optimisticRiskSavings = 400000;
  const optimisticTotal = base.planningTimeSavingsUSD + optimisticCapitalSavings + optimisticRiskSavings;
  const optimisticNetBenefit = optimisticTotal - base.totalAnnualCosts;

  // Conservative scenario: 4% capital savings + less risk reduction
  const conservativeCapitalSavings = profile.annualCapitalSpend * 0.04;
  const conservativeRiskSavings = 60000;
  const conservativeTotal = base.planningTimeSavingsUSD + conservativeCapitalSavings + conservativeRiskSavings;
  const conservativeNetBenefit = conservativeTotal - base.totalAnnualCosts;

  return {
    base,
    optimistic: {
      ...base,
      capitalSavingsUSD: optimisticCapitalSavings,
      capitalOptimization: 12,
      riskSavingsUSD: optimisticRiskSavings,
      totalAnnualSavings: optimisticTotal,
      netBenefit: optimisticNetBenefit,
      roi: (optimisticNetBenefit / base.totalAnnualCosts) * 100,
      threeyearNPV: optimisticNetBenefit * 3 - base.implementationCost,
    },
    conservative: {
      ...base,
      capitalSavingsUSD: conservativeCapitalSavings,
      capitalOptimization: 4,
      riskSavingsUSD: conservativeRiskSavings,
      totalAnnualSavings: conservativeTotal,
      netBenefit: conservativeNetBenefit,
      roi: (conservativeNetBenefit / base.totalAnnualCosts) * 100,
      threeyearNPV: conservativeNetBenefit * 3 - base.implementationCost,
    },
  };
}
