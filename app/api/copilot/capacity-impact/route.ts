import { NextRequest, NextResponse } from "next/server";
import { fetchISONeGridLoad } from "@/lib/adapters/isone.adapter";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { GridLoadRepository } from "@/lib/db/repositories/grid-load.repository";
import {
  computeCapacity,
  simulateDataCenter,
  simulateSubstations,
} from "@/lib/services/capacity.service";
import { substationPortfolio } from "@/lib/enterprise-data";
import { computeFreshness } from "@/lib/provenance";

// ── Copilot-specific risk tiers (uppercase; spec-defined thresholds) ──────────

export type CopilotRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

function deriveCopilotRisk(utilizationPct: number): CopilotRiskLevel {
  if (utilizationPct >= 90) return "CRITICAL";
  if (utilizationPct >= 75) return "HIGH";
  if (utilizationPct >= 60) return "MEDIUM";
  return "LOW";
}

// ── Recommendation templates ──────────────────────────────────────────────────

const RECOMMENDATIONS: Record<CopilotRiskLevel, string[]> = {
  LOW: [
    "Capacity is sufficient for the requested load addition.",
    "Continue monitoring data center queue growth projections.",
  ],
  MEDIUM: [
    "Review transformer loading at affected substations under increased demand.",
    "Monitor data center queue growth and update load flow studies.",
  ],
  HIGH: [
    "Begin capacity upgrade planning for the most affected substations.",
    "Review N-1 compliance margins under new load conditions before approving interconnections.",
  ],
  CRITICAL: [
    "Immediate capacity review required — system headroom is insufficient.",
    "Transformer upgrade recommended for affected substations.",
    "Evaluate new substation site options to serve projected demand.",
  ],
};

// ── Summary builder ───────────────────────────────────────────────────────────

function buildSummary(
  addedMW: number,
  baseUtilPct: number,
  simUtilPct: number,
  simHeadroomMW: number,
  capacityMW: number,
  riskLevel: CopilotRiskLevel
): string {
  const headroomClause =
    simHeadroomMW < 0
      ? `exceeding installed capacity by ${Math.abs(simHeadroomMW).toLocaleString()} MW`
      : `with ${simHeadroomMW.toLocaleString()} MW of headroom remaining against the ${capacityMW.toLocaleString()} MW installed capacity`;

  const riskSentence: Record<CopilotRiskLevel, string> = {
    LOW:      "The system remains well within safe operating limits.",
    MEDIUM:   "Approaching the moderate-risk threshold — transformer loading should be reviewed before approval.",
    HIGH:     "Operating above the high-risk threshold; capacity upgrades should be initiated before additional demand is accepted.",
    CRITICAL: "Critical capacity threshold exceeded; remaining headroom is insufficient to maintain N-1 reliability margins.",
  };

  return (
    `Adding ${addedMW.toLocaleString()} MW increases Eastern MA system utilization from ` +
    `${baseUtilPct}% to ${simUtilPct}%, ${headroomClause}. ${riskSentence[riskLevel]}`
  );
}

// ── Executive summary templates ───────────────────────────────────────────────

function buildExecutive(
  addedMW: number,
  projUtil: number,
  headroom: number,
  riskLevel: CopilotRiskLevel,
  topSubstation: string
): {
  operationalImpact: string;
  capacityRisk: string;
  recommendedUpgradeTimeline: string;
  investmentPriority: string;
} {
  const mwStr = addedMW.toLocaleString();
  const hStr  = headroom < 0
    ? `−${Math.abs(headroom).toLocaleString()}`
    : headroom.toLocaleString();

  const operationalImpact: Record<CopilotRiskLevel, string> = {
    LOW:
      `The proposed ${mwStr} MW addition represents a manageable increase in Eastern MA system load. ` +
      `Grid infrastructure has sufficient capacity to absorb this demand without operational degradation. ` +
      `Current headroom of ${hStr} MW provides adequate buffer for additional near-term interconnection requests.`,
    MEDIUM:
      `The ${mwStr} MW addition increases system loading into the moderate-risk band at ${projUtil}% utilization. ` +
      `Transformer loading at the most-affected substations — including ${topSubstation} — ` +
      `should be reviewed before interconnection approval. Remaining headroom of ${hStr} MW limits flexibility for unplanned demand.`,
    HIGH:
      `The ${mwStr} MW addition drives Eastern MA system loading to ${projUtil}%, entering high-risk territory. ` +
      `N-1 compliance margins at affected substations are compromised under this load profile. ` +
      `Only ${hStr} MW of headroom remains — insufficient to accommodate unplanned demand spikes.`,
    CRITICAL:
      `The ${mwStr} MW addition drives system utilization to ${projUtil}%, exceeding the critical operating threshold. ` +
      `With only ${hStr} MW of remaining headroom, the Eastern MA grid cannot safely absorb further unplanned load. ` +
      `Immediate operational intervention is required.`,
  };

  const capacityRisk: Record<CopilotRiskLevel, string> = {
    LOW:
      `System utilization of ${projUtil}% remains well below risk thresholds. ` +
      `${hStr} MW of headroom supports continued data center queue growth. No near-term N-1 compliance risks identified.`,
    MEDIUM:
      `At ${projUtil}% utilization, headroom narrows to ${hStr} MW. ` +
      `Continued queue growth without infrastructure investment could trigger constraint conditions within the 5-year planning horizon.`,
    HIGH:
      `High utilization at ${projUtil}% with only ${hStr} MW of headroom. ` +
      `N-1 contingency analysis will likely reveal compliance violations at one or more substations. ` +
      `Infrastructure investment is now a prerequisite for additional interconnection approvals.`,
    CRITICAL:
      `Critical: ${projUtil}% utilization with ${hStr} MW remaining. ` +
      `The system is operating outside N-1 reliability standards. Cascading constraint risk is elevated. ` +
      `No additional large load additions should be approved pending capital program completion.`,
  };

  const upgradeTimeline: Record<CopilotRiskLevel, string> = {
    LOW:
      "No immediate upgrades required. Standard 5-year capital planning cycle should model long-range capacity needs. " +
      "Monitor data center queue growth quarterly.",
    MEDIUM:
      "Initiate load flow studies within 6 months. Capital upgrade authorization recommended within 12–18 months " +
      "if the data center queue continues to grow. Target completion before next summer peak.",
    HIGH:
      `Transformer upgrades at ${topSubstation} and adjacent assets should begin within 6 months. ` +
      "Substation expansion studies should be authorized immediately for 24–36 month delivery.",
    CRITICAL:
      "Emergency capacity review required within 30 days. Accelerate upgrade timelines to 18–24 month delivery. " +
      "Immediate procurement authorization required for transformer and substation infrastructure.",
  };

  const investmentPriority: Record<CopilotRiskLevel, string> = {
    LOW:
      "Low. Maintain standard capital maintenance programs. No emergency authorization required. " +
      "Schedule next capacity review in line with the annual planning cycle.",
    MEDIUM:
      "Medium. Include affected substations in the next capital cycle. Allocate contingency budget for " +
      "transformer loading remediation. Review before approving additional interconnections.",
    HIGH:
      "High. Recommend immediate capital authorization for substation upgrades. Brief capital planning " +
      "committee within 30 days. Suspend additional large-load interconnection approvals pending capacity expansion.",
    CRITICAL:
      "Critical. Immediate capital authorization and executive escalation required. Declare capacity emergency " +
      "and activate accelerated procurement procedures. Brief board or regulatory stakeholders as appropriate.",
  };

  return {
    operationalImpact:          operationalImpact[riskLevel],
    capacityRisk:               capacityRisk[riskLevel],
    recommendedUpgradeTimeline: upgradeTimeline[riskLevel],
    investmentPriority:         investmentPriority[riskLevel],
  };
}

// ── Response type ─────────────────────────────────────────────────────────────

export interface CapacityImpactResponse {
  summary: string;
  riskLevel: CopilotRiskLevel;
  mostAffectedSubstations: Array<{ name: string; addedMW: number }>;
  recommendedActions: string[];
  _meta: {
    addedMW: number;
    baseUtilizationPct: number;
    projectedUtilizationPct: number;
    remainingHeadroomMW: number;
  };
  _executive: {
    operationalImpact: string;
    capacityRisk: string;
    recommendedUpgradeTimeline: string;
    investmentPriority: string;
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest
): Promise<NextResponse<CapacityImpactResponse | { error: string }>> {
  // ── 1. Parse body ───────────────────────────────────────────────────────────
  let addedMW: number;
  try {
    const body = await req.json();
    addedMW = Number(body.addedMW);
    if (!isFinite(addedMW) || addedMW < 0) {
      return NextResponse.json(
        { error: "addedMW must be a non-negative finite number" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── 2. Fetch current capacity snapshot ──────────────────────────────────────
  let snapshot: ReturnType<typeof computeCapacity> | null = null;

  try {
    const iso = await fetchISONeGridLoad();
    const freshness =
      iso.provenance.dataQuality === "live"
        ? "live"
        : iso.provenance.dataQuality === "cache"
        ? "delayed"
        : "mock";
    snapshot = computeCapacity(iso.currentLoadMW, iso.source, iso.timestamp, freshness);
  } catch {
    // fall through to DB
  }

  if (!snapshot && isDbConfigured()) {
    try {
      const repo = new GridLoadRepository(getServerClient());
      const latest = await repo.getLatest("eastern-ma");
      if (latest) {
        const freshness = computeFreshness(latest.timestamp, false);
        snapshot = computeCapacity(
          latest.currentLoadMW,
          latest.source,
          latest.timestamp,
          freshness
        );
      }
    } catch (dbErr) {
      console.error("[api/copilot/capacity-impact] DB error:", dbErr);
    }
  }

  if (!snapshot) {
    return NextResponse.json(
      { error: "No capacity data available — configure ISO-NE credentials or import historical data" },
      { status: 503 }
    );
  }

  // ── 3. Simulate system-level impact ─────────────────────────────────────────
  const systemResult = simulateDataCenter(snapshot, addedMW);
  const riskLevel = deriveCopilotRisk(systemResult.utilizationPct);

  // ── 4. Simulate per-substation impact ────────────────────────────────────────
  const simMap = simulateSubstations(substationPortfolio, addedMW);

  const mostAffectedSubstations = Array.from(simMap.values())
    .sort((a, b) => b.ssAddedMW - a.ssAddedMW)
    .slice(0, 3)
    .map((s) => {
      const ss = substationPortfolio.find((p) => p.id === s.substationId);
      return {
        name:    ss?.name ?? s.substationId,
        addedMW: s.ssAddedMW,
      };
    });

  // ── 5. Build response ────────────────────────────────────────────────────────
  const summary = buildSummary(
    addedMW,
    snapshot.utilizationPct,
    systemResult.utilizationPct,
    systemResult.remainingHeadroomMW,
    snapshot.capacityMW,
    riskLevel
  );

  const topSubstationName =
    mostAffectedSubstations[0]?.name.split(" ").slice(0, 2).join(" ") ?? "affected substations";

  const response: CapacityImpactResponse = {
    summary,
    riskLevel,
    mostAffectedSubstations,
    recommendedActions: RECOMMENDATIONS[riskLevel],
    _meta: {
      addedMW,
      baseUtilizationPct:      snapshot.utilizationPct,
      projectedUtilizationPct: systemResult.utilizationPct,
      remainingHeadroomMW:     systemResult.remainingHeadroomMW,
    },
    _executive: buildExecutive(
      addedMW,
      systemResult.utilizationPct,
      systemResult.remainingHeadroomMW,
      riskLevel,
      topSubstationName
    ),
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
