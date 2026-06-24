import type { SubstationPlan, FeederCircuit } from "@/lib/types";
import type { TransformerAsset } from "@/lib/planning-engine";
import type { UpgradeProject } from "@/lib/data/capital-projects";

// ── Risk types ────────────────────────────────────────────────────────────────

export type AssetRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskAssessment {
  riskScore: number;       // 0–100
  riskLevel: AssetRiskLevel;
  drivers: string[];
}

// ── Shared threshold helper ───────────────────────────────────────────────────

function levelFromScore(score: number): AssetRiskLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

// ── Substation risk ───────────────────────────────────────────────────────────

export function computeSubstationRisk(
  ss: SubstationPlan,
  projects: UpgradeProject[]
): RiskAssessment {
  let score = 0;
  const drivers: string[] = [];
  const utilPct = ss.nameplateMVA > 0 ? (ss.peakLoadMW / ss.nameplateMVA) * 100 : 0;
  const n1Headroom = ss.n1CapacityMW - ss.peakLoadMW;

  // ── Utilization ──────────────────────────────────────────────────────────
  if (utilPct >= 95) {
    score += 40;
    drivers.push(`Utilization critical at ${utilPct.toFixed(1)}% (≥95%)`);
  } else if (utilPct >= 85) {
    score += 28;
    drivers.push(`Utilization high at ${utilPct.toFixed(1)}% (≥85%)`);
  } else if (utilPct >= 75) {
    score += 14;
    drivers.push(`Utilization elevated at ${utilPct.toFixed(1)}% (≥75%)`);
  }

  // ── N-1 headroom ─────────────────────────────────────────────────────────
  if (n1Headroom <= 0) {
    score += 22;
    drivers.push("N-1 capacity violated — substation cannot sustain a contingency loss");
  } else if (n1Headroom < 20) {
    score += 12;
    drivers.push(`N-1 headroom critically low (${n1Headroom.toFixed(0)} MW remaining)`);
  }

  // ── Transformer conditions ────────────────────────────────────────────────
  const hasNonCompliant = ss.transformers.some((t) => !t.n1Compliant);
  if (hasNonCompliant) {
    score += 15;
    drivers.push("One or more transformers are N-1 non-compliant");
  }

  const maxTxAge = ss.transformers.length > 0
    ? Math.max(...ss.transformers.map((t) => t.ageYears))
    : 0;
  if (maxTxAge >= 40) {
    score += 12;
    drivers.push(`Oldest transformer is ${maxTxAge} years — approaching end of service life`);
  } else if (maxTxAge >= 35) {
    score += 7;
    drivers.push(`Oldest transformer is ${maxTxAge} years (exceeds 35-year target)`);
  }

  const maxTxLoading = ss.transformers.length > 0
    ? Math.max(...ss.transformers.map((t) => t.ratedMVA > 0 ? (t.peakLoadMVA / t.ratedMVA) * 100 : 0))
    : 0;
  if (maxTxLoading >= 95) {
    score += 10;
    drivers.push(`Peak transformer loading at ${maxTxLoading.toFixed(1)}% (critical threshold)`);
  }

  // ── Feeder headroom ───────────────────────────────────────────────────────
  const constrainedFeeders = ss.feeders.filter(
    (f) => f.hostingCapacityMW - f.committedLoadMW - f.queuedLoadMW < 0
  );
  if (constrainedFeeders.length > 0) {
    score += 14;
    drivers.push(`${constrainedFeeders.length} feeder(s) queue exceeds hosting capacity`);
  }

  // ── Capital programme gap ─────────────────────────────────────────────────
  const activeProjects = projects.filter(
    (p) => p.substationId === ss.id
  ).length;
  if (activeProjects === 0 && score >= 30) {
    score += 5;
    drivers.push("No active capital projects for this constrained asset");
  }

  score = Math.min(100, Math.round(score));
  return { riskScore: score, riskLevel: levelFromScore(score), drivers };
}

// ── Transformer risk ──────────────────────────────────────────────────────────

export function computeTransformerRisk(tx: TransformerAsset): RiskAssessment {
  let score = 0;
  const drivers: string[] = [];
  const loading = tx.ratedMVA > 0 ? (tx.peakLoadMVA / tx.ratedMVA) * 100 : 0;

  if (loading >= 100) {
    score += 45;
    drivers.push(`Thermal loading at ${loading.toFixed(1)}% — overloaded`);
  } else if (loading >= 95) {
    score += 35;
    drivers.push(`Thermal loading critical at ${loading.toFixed(1)}% (≥95%)`);
  } else if (loading >= 85) {
    score += 22;
    drivers.push(`Thermal loading high at ${loading.toFixed(1)}% (≥85%)`);
  } else if (loading >= 75) {
    score += 10;
    drivers.push(`Thermal loading elevated at ${loading.toFixed(1)}% (≥75%)`);
  }

  if (!tx.n1Compliant) {
    score += 28;
    drivers.push("Not N-1 compliant — fails single-contingency reliability standard");
  }

  if (tx.ageYears >= 40) {
    score += 20;
    drivers.push(`Age ${tx.ageYears} years — exceeds 40-year design life`);
  } else if (tx.ageYears >= 35) {
    score += 12;
    drivers.push(`Age ${tx.ageYears} years — approaching end of recommended service life`);
  } else if (tx.ageYears >= 25) {
    score += 5;
    drivers.push(`Age ${tx.ageYears} years — entering asset monitoring period`);
  }

  score = Math.min(100, Math.round(score));
  return { riskScore: score, riskLevel: levelFromScore(score), drivers };
}

// ── Feeder risk ───────────────────────────────────────────────────────────────

export function computeFeederRisk(feeder: FeederCircuit): RiskAssessment {
  let score = 0;
  const drivers: string[] = [];
  const headroom = feeder.hostingCapacityMW - feeder.committedLoadMW - feeder.queuedLoadMW;
  const committedRatio =
    feeder.hostingCapacityMW > 0 ? feeder.committedLoadMW / feeder.hostingCapacityMW : 0;
  const queueRatio =
    feeder.hostingCapacityMW > 0 ? feeder.queuedLoadMW / feeder.hostingCapacityMW : 0;

  if (headroom < 0) {
    score += 55;
    drivers.push(`Queue exceeds hosting capacity by ${Math.abs(headroom).toFixed(0)} MW`);
  } else if (headroom < 5) {
    score += 35;
    drivers.push(`Hosting capacity nearly exhausted (${headroom.toFixed(0)} MW headroom)`);
  } else if (headroom < 15) {
    score += 18;
    drivers.push(`Headroom critically low at ${headroom.toFixed(0)} MW`);
  }

  if (committedRatio >= 0.9) {
    score += 20;
    drivers.push(`Committed load is ${(committedRatio * 100).toFixed(0)}% of hosting capacity`);
  }

  if (queueRatio >= 0.5) {
    score += 15;
    drivers.push(`Queued load (${feeder.queuedLoadMW} MW) is ${(queueRatio * 100).toFixed(0)}% of hosting capacity`);
  }

  score = Math.min(100, Math.round(score));
  return { riskScore: score, riskLevel: levelFromScore(score), drivers };
}

// ── Asset-level scenario projection ──────────────────────────────────────────

export interface SubstationProjection {
  projectedLoadMW: number;
  projectedUtilizationPct: number;
  projectedN1HeadroomMW: number;
  projectedHeadroomMW: number;
  projectedRisk: RiskAssessment;
}

export function projectSubstationLoad(
  ss: SubstationPlan,
  addedMW: number,
  projects: UpgradeProject[]
): SubstationProjection {
  const projectedLoadMW = ss.peakLoadMW + addedMW;
  const projectedUtilizationPct =
    ss.nameplateMVA > 0
      ? Math.round((projectedLoadMW / ss.nameplateMVA) * 1_000) / 10
      : 0;
  const projectedN1HeadroomMW = ss.n1CapacityMW - projectedLoadMW;
  const projectedHeadroomMW = ss.nameplateMVA - projectedLoadMW;

  const projectedSS: SubstationPlan = { ...ss, peakLoadMW: projectedLoadMW };
  const projectedRisk = computeSubstationRisk(projectedSS, projects);

  return {
    projectedLoadMW,
    projectedUtilizationPct,
    projectedN1HeadroomMW,
    projectedHeadroomMW,
    projectedRisk,
  };
}
