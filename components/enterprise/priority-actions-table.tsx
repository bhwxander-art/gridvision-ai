"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  analyzeDataCenterImpact,
  assessSubstationCapacity,
  forecastTransformerOverload,
  getSeverityColor,
} from "@/lib/planning-engine";
import type {
  DataCenterInterconnection,
  SubstationPlan,
} from "@/lib/types";
import type { PlanningTerritory } from "@/lib/types";
import { findFeederById } from "@/lib/services/substation.service";

interface PriorityAction {
  rank: number;
  asset: string;
  category: "Substation" | "Transformer" | "Interconnection";
  urgency: "P1" | "P2" | "P3";
  action: string;
  capexM: number;
}

function buildPriorityActions(
  portfolio: SubstationPlan[],
  queue: DataCenterInterconnection[],
  territory: PlanningTerritory
): PriorityAction[] {
  const actions: PriorityAction[] = [];

  portfolio.forEach((ss) => {
    const result = assessSubstationCapacity(ss, territory.planningHorizonYears);
    if (result.severity !== "normal") {
      actions.push({
        rank: 0,
        asset: ss.name,
        category: "Substation",
        urgency:
          result.severity === "critical"
            ? "P1"
            : result.severity === "constrained"
              ? "P2"
              : "P3",
        action: result.recommendedAction,
        capexM: result.estimatedCapexM,
      });
    }
  });

  portfolio.flatMap((ss) => ss.transformers).forEach((tx) => {
    const result = forecastTransformerOverload(tx, 18, 40);
    if (result.overloadRisk !== "normal") {
      actions.push({
        rank: 0,
        asset: tx.name,
        category: "Transformer",
        urgency:
          result.overloadRisk === "critical"
            ? "P1"
            : result.overloadRisk === "constrained"
              ? "P2"
              : "P3",
        action: result.recommendedAction,
        capexM: result.overloadRisk === "critical" ? 4.5 : 2.2,
      });
    }
  });

  queue.forEach((project) => {
    const ctx = findFeederById(project.affectedFeederId, portfolio);
    if (!ctx) return;
    const impact = analyzeDataCenterImpact(project, ctx.substation, ctx.feeder);
    if (impact.constraintFlag) {
      actions.push({
        rank: 0,
        asset: project.projectName,
        category: "Interconnection",
        urgency: project.requestedMW >= 100 ? "P1" : "P2",
        action: impact.upgradeRequired,
        capexM: project.requestedMW * 0.08,
      });
    }
  });

  const urgencyOrder = { P1: 0, P2: 1, P3: 2 };
  return actions
    .sort(
      (a, b) =>
        urgencyOrder[a.urgency] - urgencyOrder[b.urgency] ||
        b.capexM - a.capexM
    )
    .map((a, i) => ({ ...a, rank: i + 1 }));
}

interface PriorityActionsTableProps {
  portfolio: SubstationPlan[];
  queue: DataCenterInterconnection[];
  territory: PlanningTerritory;
}

export function PriorityActionsTable({
  portfolio,
  queue,
  territory,
}: PriorityActionsTableProps) {
  const actions = buildPriorityActions(portfolio, queue, territory);

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Capital Priority Queue</CardTitle>
        <CardDescription>
          Ranked actions for next IRP / capital plan cycle — P1 requires action
          within 12 months
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">#</th>
                <th className="pb-3 pr-4 font-medium">Asset</th>
                <th className="pb-3 pr-4 font-medium">Category</th>
                <th className="pb-3 pr-4 font-medium">Urgency</th>
                <th className="pb-3 pr-4 font-medium">Est. Capex</th>
                <th className="pb-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((row) => (
                <tr
                  key={`${row.category}-${row.asset}`}
                  className="border-b border-border/20 hover:bg-accent/20"
                >
                  <td className="py-3 pr-4 font-mono text-xs">{row.rank}</td>
                  <td className="py-3 pr-4 font-medium">{row.asset}</td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">
                    {row.category}
                  </td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant="outline"
                      style={{
                        borderColor:
                          row.urgency === "P1"
                            ? "#ef444444"
                            : row.urgency === "P2"
                              ? "#eab30844"
                              : "#06b6d444",
                        color:
                          row.urgency === "P1"
                            ? "#ef4444"
                            : row.urgency === "P2"
                              ? "#eab308"
                              : "#06b6d4",
                      }}
                    >
                      {row.urgency}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    ${row.capexM.toFixed(1)}M
                  </td>
                  <td className="max-w-md py-3 text-xs text-muted-foreground">
                    {row.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function computeEnterpriseKpis(
  portfolio: SubstationPlan[],
  queue: DataCenterInterconnection[],
  territory: PlanningTerritory
) {
  const ssResults = portfolio.map((ss) =>
    assessSubstationCapacity(ss, territory.planningHorizonYears)
  );
  const constrainedSubstations = ssResults.filter(
    (r) => r.severity === "constrained" || r.severity === "critical"
  ).length;

  const txResults = portfolio
    .flatMap((ss) => ss.transformers)
    .map((tx) => forecastTransformerOverload(tx, 18, 40));
  const criticalTransformers = txResults.filter(
    (r) => r.overloadRisk === "critical" || r.overloadRisk === "constrained"
  ).length;

  const dcQueueMW = queue.reduce((s, d) => s + d.requestedMW, 0);
  const constrainedDCProjects = queue.filter((p) => {
    const ctx = findFeederById(p.affectedFeederId, portfolio);
    if (!ctx) return false;
    return analyzeDataCenterImpact(p, ctx.substation, ctx.feeder).constraintFlag;
  }).length;

  const totalCapexM = ssResults.reduce((s, r) => s + r.estimatedCapexM, 0);

  return {
    constrainedSubstations,
    criticalTransformers,
    dcQueueMW,
    constrainedDCProjects,
    totalCapexM,
  };
}
