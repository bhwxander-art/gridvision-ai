import type { UpgradeProject } from "@/lib/data/capital-projects";
import { substationPortfolio } from "@/lib/enterprise-data";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RankedUpgradeProject extends UpgradeProject {
  rank: number;
  costPerMW: number;
  adjustedPriorityScore: number;
  substationName: string;
}

export interface CapitalPlanSummary {
  totalCostUSD: number;
  totalAddedCapacityMW: number;
  weightedCostPerMW: number;
  totalRiskReduction: number;
  rankedProjects: RankedUpgradeProject[];
}

export interface RecommendationInputs {
  currentUtilizationPct: number;
  projectedUtilizationPct: number;
  headroomMW: number;
  simulatedAddedMW: number;
}

export interface CapitalQA {
  question: string;
  answer: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatMillions(usd: number): string {
  return `$${(usd / 1_000_000).toFixed(1)}M`;
}

export function formatCostPerMW(usd: number): string {
  return `$${Math.round(usd / 1_000).toLocaleString()}k`;
}

function upgradeTypeLabel(type: UpgradeProject["upgradeType"]): string {
  const labels: Record<UpgradeProject["upgradeType"], string> = {
    "transformer-replacement": "Transformer Replacement",
    "substation-expansion":    "Substation Expansion",
    "feeder-reconductor":      "Feeder Reconductor",
    "new-substation":          "New Substation",
    "cable-replacement":       "Cable Replacement",
  };
  return labels[type];
}

function substationName(id: string): string {
  return (
    substationPortfolio.find((s) => s.id === id)?.name.split(" ").slice(0, 2).join(" ") ??
    id
  );
}

// ── Recommendation Engine ─────────────────────────────────────────────────────

export function recommendUpgrades(
  projects: UpgradeProject[],
  inputs: RecommendationInputs
): CapitalPlanSummary {
  const { projectedUtilizationPct, simulatedAddedMW } = inputs;

  // How many top projects to recommend based on urgency
  const topN =
    projectedUtilizationPct >= 90 ? 6 :
    projectedUtilizationPct >= 75 ? 5 :
    projectedUtilizationPct >= 60 ? 4 : 3;

  // Urgency multiplier applied to base priority scores
  const urgencyMultiplier =
    projectedUtilizationPct >= 90 ? 1.5 :
    projectedUtilizationPct >= 75 ? 1.25 :
    projectedUtilizationPct >= 60 ? 1.1 : 1.0;

  // When there's a large simulated load, favour fast-delivery projects
  const speedBoost = simulatedAddedMW >= 250;

  const scored: RankedUpgradeProject[] = projects
    .map((p) => {
      let score = p.priorityScore * urgencyMultiplier;

      // Fast-delivery bonus for urgent scenarios
      if (speedBoost && p.implementationMonths <= 18) score *= 1.15;

      // Large-capacity bonus for high utilization
      if (projectedUtilizationPct >= 75 && p.addedCapacityMW >= 100) score *= 1.1;

      return {
        ...p,
        costPerMW:             p.estimatedCostUSD / p.addedCapacityMW,
        adjustedPriorityScore: Math.min(100, Math.round(score)),
        substationName:        substationName(p.substationId),
        rank:                  0,
      };
    })
    .sort((a, b) => b.adjustedPriorityScore - a.adjustedPriorityScore)
    .slice(0, topN)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const totalCostUSD          = scored.reduce((s, p) => s + p.estimatedCostUSD, 0);
  const totalAddedCapacityMW  = scored.reduce((s, p) => s + p.addedCapacityMW, 0);
  const totalRiskReduction    = Math.round(
    scored.reduce((s, p) => s + p.riskReduction, 0) / scored.length
  );

  return {
    totalCostUSD,
    totalAddedCapacityMW,
    weightedCostPerMW: totalAddedCapacityMW > 0 ? totalCostUSD / totalAddedCapacityMW : 0,
    totalRiskReduction,
    rankedProjects:    scored,
  };
}

// ── AI Capital Copilot Q&A ────────────────────────────────────────────────────

export function generateCapitalQA(
  summary: CapitalPlanSummary,
  inputs: RecommendationInputs
): CapitalQA[] {
  const { rankedProjects, totalCostUSD, totalAddedCapacityMW, weightedCostPerMW, totalRiskReduction } = summary;
  if (rankedProjects.length === 0) return [];

  const top      = rankedProjects[0];
  const bestROI  = [...rankedProjects].sort((a, b) => a.costPerMW - b.costPerMW)[0];
  const fastest  = [...rankedProjects].sort((a, b) => a.implementationMonths - b.implementationMonths)[0];
  const highRisk = rankedProjects.filter((p) => p.riskReduction >= 30);
  const minCost  = Math.min(...rankedProjects.map((p) => p.estimatedCostUSD));
  const maxCost  = Math.max(...rankedProjects.map((p) => p.estimatedCostUSD));

  return [
    {
      question: "What should be upgraded first?",
      answer:
        `${top.projectName} at ${top.substationName} should be the first capital commitment ` +
        `(Priority Score: ${top.adjustedPriorityScore}/100). This ${upgradeTypeLabel(top.upgradeType).toLowerCase()} ` +
        `can be completed in ${top.implementationMonths} months, adds ${top.addedCapacityMW} MW of capacity, ` +
        `and delivers a risk-reduction score of ${top.riskReduction}/100 — the highest in the recommended portfolio. ` +
        `At ${formatCostPerMW(top.costPerMW)}/MW it represents efficient use of capital under current grid pressure.`,
    },
    {
      question: "How much capital is required?",
      answer:
        `The recommended ${rankedProjects.length}-project portfolio requires ${formatMillions(totalCostUSD)} ` +
        `in total capital investment, delivering ${totalAddedCapacityMW} MW of new capacity ` +
        `at a blended cost of ${formatCostPerMW(weightedCostPerMW)}/MW. ` +
        `Individual project costs range from ${formatMillions(minCost)} (${fastest.projectName}) ` +
        `to ${formatMillions(maxCost)}. ` +
        `The fastest path to capacity relief is ${fastest.projectName} at ${fastest.implementationMonths} months to energization.`,
    },
    {
      question: "Which project has the highest ROI?",
      answer:
        `${bestROI.projectName} delivers the best capital efficiency at ${formatCostPerMW(bestROI.costPerMW)}/MW — ` +
        `${formatMillions(bestROI.estimatedCostUSD)} for ${bestROI.addedCapacityMW} MW of added capacity. ` +
        `At ${bestROI.implementationMonths} months to complete, it provides near-term capacity relief without ` +
        `long permitting timelines. Its ${bestROI.riskReduction}/100 risk-reduction score makes it ` +
        `the strongest return on regulatory capital in the current programme.`,
    },
    {
      question: "What risk is avoided?",
      answer:
        `Executing this portfolio achieves a weighted risk-reduction score of ${totalRiskReduction}/100 ` +
        `across ${rankedProjects.length} projects, eliminating ${highRisk.length} high-impact constraint condition${highRisk.length !== 1 ? "s" : ""}. ` +
        `The upgrades resolve N-1 compliance gaps, add ${totalAddedCapacityMW} MW of headroom ` +
        `for data center interconnection, and reduce summer-peak reliability exposure. ` +
        `Without these investments, a system operating above ${inputs.projectedUtilizationPct}% utilization ` +
        `faces cascading constraint risk and potential DPU regulatory exposure.`,
    },
  ];
}
