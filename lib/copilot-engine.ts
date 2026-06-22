import {
  assessSubstationCapacity,
  forecastTransformerOverload,
  analyzeDataCenterImpact,
  type ConstraintSeverity,
  type DataCenterInterconnection,
  type SubstationPlan,
} from "@/lib/planning-engine";
import type { ForecastResult } from "@/lib/forecast-engine";
import type { PlanningConfig } from "@/lib/types";

// ── Public types ──────────────────────────────────────────────────────────────

export type UrgencyLevel = "immediate" | "near-term" | "long-range";
export type RecommendationCategory =
  | "substation"
  | "transformer"
  | "interconnection"
  | "forecast"
  | "system";

export interface PlanningRecommendation {
  id: string;
  title: string;
  category: RecommendationCategory;
  urgency: UrgencyLevel;
  affectedAssets: string[];
  /** Estimated percentage reduction in overall planning risk if acted upon. */
  riskReductionPct: number;
  estimatedCapexM: number;
  rationale: string;
  actions: string[];
}

export interface CopilotReport {
  recommendations: PlanningRecommendation[];
  /** 0–100 composite risk score across the portfolio. */
  systemRiskScore: number;
  immediateCount: number;
  nearTermCount: number;
  longRangeCount: number;
  generatedAt: string;
}

export interface CopilotInput {
  portfolio: SubstationPlan[];
  queue: DataCenterInterconnection[];
  forecast: ForecastResult | null;
  config: PlanningConfig;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function mw(n: number): string {
  return `${Math.round(n).toLocaleString()} MW`;
}

function pct(n: number, dp = 1): string {
  return `${n.toFixed(dp)}%`;
}

const URGENCY_ORDER: Record<UrgencyLevel, number> = {
  immediate: 0,
  "near-term": 1,
  "long-range": 2,
};

// ── Rules ─────────────────────────────────────────────────────────────────────

function substationRules(
  portfolio: SubstationPlan[],
  queue: DataCenterInterconnection[],
  horizonYears: 3 | 5 | 10
): PlanningRecommendation[] {
  const recs: PlanningRecommendation[] = [];
  let seq = 0;

  for (const ss of portfolio) {
    const r = assessSubstationCapacity(ss, horizonYears);

    if (r.severity === "critical") {
      recs.push({
        id: `ss-critical-${seq++}`,
        title: `Emergency capacity intervention — ${ss.name}`,
        category: "substation",
        urgency: "immediate",
        affectedAssets: [ss.name],
        riskReductionPct: Math.min(40, Math.round((r.utilizationPct - 80) * 1.6)),
        estimatedCapexM: r.estimatedCapexM,
        rationale:
          `${ss.name} operates at ${pct(r.utilizationPct)} nameplate utilization with only ${mw(r.n1HeadroomMW)} of N-1 headroom. ` +
          `A single contingency event creates a credible uncontrolled outage across the ${ss.region} service area. ` +
          `Constraint year: ${r.yearsToConstraint === 0 ? "already breached" : `${r.yearsToConstraint} yr`}.`,
        actions: [
          r.recommendedAction,
          "Notify ISO-NE reliability coordinator of constraint.",
          "Escalate to capital planning committee within 30 days.",
        ],
      });
    } else if (r.severity === "constrained") {
      const yearsClose = r.yearsToConstraint !== null && r.yearsToConstraint <= 2;
      const urgency: UrgencyLevel = yearsClose ? "immediate" : "near-term";
      recs.push({
        id: `ss-constrained-${seq++}`,
        title: `Capital project required — ${ss.name}`,
        category: "substation",
        urgency,
        affectedAssets: [ss.name],
        riskReductionPct: yearsClose ? 32 : 20,
        estimatedCapexM: r.estimatedCapexM,
        rationale:
          `${ss.name} (${pct(r.utilizationPct)} utilization) has ${mw(r.n1HeadroomMW)} N-1 headroom. ` +
          `At ${ss.annualGrowthPct}%/yr organic growth${queue.some(dc => dc.affectedSubstationId === ss.id && dc.status !== "energized") ? " plus pending DC load additions" : ""}, ` +
          `constraint is projected in ${r.yearsToConstraint ?? "unknown"} year(s).`,
        actions: [
          r.recommendedAction,
          "Issue RFP for transmission upgrade engineering study within 60 days.",
        ],
      });
    } else if (r.severity === "watch" && ss.annualGrowthPct >= 4) {
      recs.push({
        id: `ss-watch-${seq++}`,
        title: `High-growth watch — ${ss.name}`,
        category: "substation",
        urgency: "long-range",
        affectedAssets: [ss.name],
        riskReductionPct: 8,
        estimatedCapexM: r.estimatedCapexM,
        rationale:
          `${ss.name} grows at ${ss.annualGrowthPct}%/yr — above the 4% enhanced-monitoring threshold. ` +
          `Current N-1 headroom is ${mw(r.n1HeadroomMW)}, which may erode within the planning horizon without proactive capital.`,
        actions: [
          "Increase monitoring cadence to monthly load reporting.",
          r.recommendedAction,
        ],
      });
    }
  }

  return recs;
}

function transformerRules(
  portfolio: SubstationPlan[],
  queue: DataCenterInterconnection[]
): PlanningRecommendation[] {
  const recs: PlanningRecommendation[] = [];
  let seq = 0;

  for (const ss of portfolio) {
    // Distribute pending DC load for this substation evenly across its transformers.
    const pendingDCLoad = queue
      .filter(dc => dc.affectedSubstationId === ss.id && dc.status !== "energized")
      .reduce((sum, dc) => sum + dc.requestedMW * dc.loadFactor, 0);
    const dcPerTx = pendingDCLoad / Math.max(1, ss.transformers.length);

    for (const tx of ss.transformers) {
      const r = forecastTransformerOverload(tx, ss.annualGrowthPct, dcPerTx);

      if (!tx.n1Compliant) {
        const urgency: UrgencyLevel =
          r.forecastLoadingPct >= 95 ? "immediate" : "near-term";
        recs.push({
          id: `tx-n1-${seq++}`,
          title: `N-1 non-compliant — replace ${tx.name} at ${ss.name}`,
          category: "transformer",
          urgency,
          affectedAssets: [tx.name, ss.name],
          riskReductionPct: 30,
          estimatedCapexM: Math.round(tx.ratedMVA * 0.02 * 10) / 10,
          rationale:
            `${tx.name} at ${ss.name} does not satisfy the N-1 criterion. Current loading ${pct(r.loadingPct)}, ` +
            `forecast ${pct(r.forecastLoadingPct)} under growth and DC queue additions. ` +
            `A single transformer failure creates an uncontrolled outage in the ${ss.region} zone.`,
          actions: [
            r.recommendedAction,
            `Place ${tx.ratedMVA} MVA spare bank on order (18-month typical lead time).`,
            "Add to emergency capital budget for next fiscal year.",
          ],
        });
      } else if (r.overloadRisk === "critical") {
        recs.push({
          id: `tx-overload-${seq++}`,
          title: `Forecast thermal overload — ${tx.name} at ${ss.name}`,
          category: "transformer",
          urgency: "immediate",
          affectedAssets: [tx.name, ss.name],
          riskReductionPct: 25,
          estimatedCapexM: Math.round(tx.ratedMVA * 0.02 * 10) / 10,
          rationale:
            `${tx.name} is projected to reach ${pct(r.forecastLoadingPct)} loading — above the 100% thermal limit — ` +
            `under 1-year organic growth and DC queue energizations. ` +
            `Thermal margin is currently ${r.thermalMarginMVA.toFixed(1)} MVA.`,
          actions: [r.recommendedAction],
        });
      } else if (r.overloadRisk === "constrained" && tx.ageYears >= 25) {
        recs.push({
          id: `tx-aged-${seq++}`,
          title: `Aged transformer risk — ${tx.name} at ${ss.name}`,
          category: "transformer",
          urgency: "near-term",
          affectedAssets: [tx.name, ss.name],
          riskReductionPct: 18,
          estimatedCapexM: Math.round(tx.ratedMVA * 0.025 * 10) / 10,
          rationale:
            `${tx.name} is ${tx.ageYears} years old at ${pct(r.loadingPct)} loading, ` +
            `forecast to reach ${pct(r.forecastLoadingPct)}. ` +
            `Aging insulation combined with elevated loading accelerates winding failure probability by approximately ${tx.ageYears > 35 ? "30%" : "15%"} above baseline.`,
          actions: [
            r.recommendedAction,
            "Commission oil analysis and insulation resistance test this quarter.",
            "Pre-position mobile substation within the ${ss.region} service area.",
          ],
        });
      }
    }
  }

  return recs;
}

function interconnectionRules(
  portfolio: SubstationPlan[],
  queue: DataCenterInterconnection[]
): PlanningRecommendation[] {
  const recs: PlanningRecommendation[] = [];
  let seq = 0;

  for (const dc of queue) {
    if (dc.status === "energized") continue;

    const ss = portfolio.find(s => s.id === dc.affectedSubstationId);
    if (!ss) continue;
    const feeder = ss.feeders.find(f => f.id === dc.affectedFeederId);
    if (!feeder) continue;

    const impact = analyzeDataCenterImpact(dc, ss, feeder);

    if (impact.constraintFlag) {
      const urgency: UrgencyLevel = dc.status === "construction" ? "immediate" : "near-term";
      const upgradeCapex =
        impact.feederHeadroomAfterMW < 0
          ? 4 + Math.abs(impact.feederHeadroomAfterMW) * 0.12
          : 2;
      recs.push({
        id: `dc-constraint-${seq++}`,
        title: `Network upgrade required — ${dc.projectName}`,
        category: "interconnection",
        urgency,
        affectedAssets: [dc.projectName, ss.name, feeder.name],
        riskReductionPct: Math.min(35, Math.round((dc.requestedMW / 45) * 10)),
        estimatedCapexM: Math.round(upgradeCapex * 10) / 10,
        rationale:
          `${dc.projectName} (${mw(dc.requestedMW)}, target ${dc.targetCOD}) triggers a grid constraint: ${impact.upgradeRequired.toLowerCase()} ` +
          `Post-interconnection substation utilization reaches ${pct(impact.substationUtilAfterPct)}.`,
        actions: [
          impact.upgradeRequired,
          impact.studyPhaseRecommendation,
        ],
      });
    } else if (dc.requestedMW >= 100 && dc.status === "study") {
      recs.push({
        id: `dc-large-${seq++}`,
        title: `Large DC — fast-track feasibility — ${dc.projectName}`,
        category: "interconnection",
        urgency: "near-term",
        affectedAssets: [dc.projectName, ss.name],
        riskReductionPct: 12,
        estimatedCapexM: 0.5,
        rationale:
          `${dc.projectName} (${mw(dc.requestedMW)}) is a major load addition in study phase targeting ${dc.targetCOD}. ` +
          `Early feasibility work avoids timeline slippage and enables proactive capacity reservation on ${feeder.name} (${mw(feeder.hostingCapacityMW)} hosting capacity).`,
        actions: [
          impact.studyPhaseRecommendation,
          "Assign dedicated interconnection project manager.",
          "Issue cost responsibility letter to developer within 45 days.",
        ],
      });
    }
  }

  return recs;
}

function forecastRules(forecast: ForecastResult): PlanningRecommendation[] {
  const recs: PlanningRecommendation[] = [];
  const [yr1Risk, yr3Risk, yr5Risk] = forecast.riskLevel;
  const [mw1, mw3, mw5] = forecast.projectedLoadMW;
  const [util1, util3, util5] = forecast.utilizationPct;
  const { baseYear, compositeGrowthPct } = forecast;

  if (yr1Risk === "critical") {
    recs.push({
      id: "fc-1yr-critical",
      title: `System capacity emergency — ${baseYear + 1} horizon critical`,
      category: "forecast",
      urgency: "immediate",
      affectedAssets: ["Eastern Massachusetts Territory"],
      riskReductionPct: 30,
      estimatedCapexM: 25,
      rationale:
        `Territory load reaches ${mw(mw1)} in ${baseYear + 1} (${pct(util1)} system utilization), ` +
        `exceeding the 95% critical planning threshold. Immediate capacity procurement or demand reduction required.`,
      actions: [
        "Engage ISO-NE capacity procurement mechanism.",
        "Activate demand response programs for peak shaving.",
        "Assess emergency import capacity from adjacent control areas.",
      ],
    });
  } else if (yr3Risk === "critical" || yr3Risk === "constrained") {
    recs.push({
      id: "fc-3yr-constrained",
      title: `Accelerate capital program — 3-year horizon ${yr3Risk}`,
      category: "forecast",
      urgency: "near-term",
      affectedAssets: ["Eastern Massachusetts Territory"],
      riskReductionPct: 20,
      estimatedCapexM: 15,
      rationale:
        `Territory is projected at ${mw(mw3)} in ${baseYear + 3} (${pct(util3)} utilization, ${yr3Risk} risk level). ` +
        `Composite growth of ${pct(compositeGrowthPct, 1)}/yr driven by EV adoption and commercial load requires accelerated capital deployment.`,
      actions: [
        "Advance 5-year capital plan delivery timeline by 12–18 months.",
        "Initiate transmission reinforcement scoping study.",
        "Review and tighten DC queue admission criteria per substation zone.",
      ],
    });
  }

  if (yr5Risk === "critical" || (yr5Risk === "constrained" && util5 >= 88)) {
    recs.push({
      id: "fc-5yr-plan",
      title: `Long-range — 5-year capacity margin at risk`,
      category: "forecast",
      urgency: "long-range",
      affectedAssets: ["Eastern Massachusetts Territory"],
      riskReductionPct: 15,
      estimatedCapexM: 40,
      rationale:
        `5-year horizon projects ${mw(mw5)} at ${pct(util5)} utilization. ` +
        `The ISO-NE 15% planning reserve margin would be breached. Long-range transmission expansion ` +
        `filing is required under FERC Order 1920.`,
      actions: [
        "Initiate regional transmission planning process with ISO-NE.",
        "File long-range needs assessment with DPU by next annual planning cycle.",
        "Engage rate case counsel on transmission capital recovery mechanisms.",
      ],
    });
  }

  return recs;
}

function systemRules(
  portfolio: SubstationPlan[],
  queue: DataCenterInterconnection[],
  forecast: ForecastResult | null,
  horizonYears: 3 | 5 | 10
): PlanningRecommendation[] {
  const recs: PlanningRecommendation[] = [];

  // Rule: multiple simultaneous critical substations → cascading risk
  const criticalSubstations = portfolio.filter(
    ss => assessSubstationCapacity(ss, horizonYears).severity === "critical"
  );
  if (criticalSubstations.length >= 2) {
    const totalCapex = criticalSubstations.reduce(
      (sum, ss) => sum + assessSubstationCapacity(ss, horizonYears).estimatedCapexM,
      0
    );
    recs.push({
      id: "sys-multi-critical",
      title: `System-wide reliability risk — ${criticalSubstations.length} substations critical`,
      category: "system",
      urgency: "immediate",
      affectedAssets: criticalSubstations.map(ss => ss.name),
      riskReductionPct: 35,
      estimatedCapexM: Math.round(totalCapex * 10) / 10,
      rationale:
        `${criticalSubstations.length} substations are simultaneously in critical state (` +
        `${criticalSubstations.map(ss => ss.name).join(", ")}). ` +
        `A single N-1 event in this configuration could trigger cascading load shedding across ` +
        `${[...new Set(criticalSubstations.map(ss => ss.region))].join(", ")} service areas.`,
      actions: [
        "Convene emergency reliability planning committee.",
        "Issue reliability assessment notice to Massachusetts DPU.",
        "Negotiate temporary load reduction agreements with large industrial customers.",
      ],
    });
  }

  // Rule: DC queue saturation relative to system capacity
  const pendingMW = queue
    .filter(dc => dc.status !== "energized")
    .reduce((sum, dc) => sum + dc.requestedMW, 0);
  const capMW = forecast?.systemCapacityMW ?? 6500;
  if (pendingMW > capMW * 0.22) {
    recs.push({
      id: "sys-dc-saturation",
      title: `DC queue saturation — cluster study required`,
      category: "system",
      urgency: "near-term",
      affectedAssets: queue
        .filter(dc => dc.status !== "energized")
        .map(dc => dc.projectName),
      riskReductionPct: 18,
      estimatedCapexM: 1.5,
      rationale:
        `${mw(pendingMW)} of pending DC interconnections (${Math.round((pendingMW / capMW) * 100)}% of system capacity) ` +
        `creates systemic queue congestion. Sequential individual-project studies underestimate cumulative grid impact and may invalidate earlier feasibility approvals.`,
      actions: [
        "Commission cluster interconnection study under ISO-NE DISIS process.",
        "Implement staged COD queue management policy with MW-weighted admission caps.",
        "Establish per-substation zone queue limits to prevent localized saturation.",
      ],
    });
  }

  return recs;
}

// ── Public entry point ────────────────────────────────────────────────────────

export function runCopilot(input: CopilotInput): CopilotReport {
  const { portfolio, queue, forecast, config } = input;
  const horizonYears = config.territory.planningHorizonYears;

  const all: PlanningRecommendation[] = [
    ...substationRules(portfolio, queue, horizonYears),
    ...transformerRules(portfolio, queue),
    ...interconnectionRules(portfolio, queue),
    ...(forecast ? forecastRules(forecast) : []),
    ...systemRules(portfolio, queue, forecast, horizonYears),
  ];

  // Sort: urgency asc, then risk reduction desc
  all.sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      b.riskReductionPct - a.riskReductionPct
  );

  const immediateCount = all.filter(r => r.urgency === "immediate").length;
  const nearTermCount = all.filter(r => r.urgency === "near-term").length;
  const longRangeCount = all.filter(r => r.urgency === "long-range").length;
  const systemRiskScore = Math.min(
    100,
    immediateCount * 20 + nearTermCount * 8 + longRangeCount * 3
  );

  return {
    recommendations: all,
    systemRiskScore,
    immediateCount,
    nearTermCount,
    longRangeCount,
    generatedAt: new Date().toISOString(),
  };
}
