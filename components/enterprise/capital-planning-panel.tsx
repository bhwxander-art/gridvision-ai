"use client";

import { useMemo } from "react";
import {
  ArrowUpRight,
  CircleDollarSign,
  Database,
  Gauge,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatCostPerMW,
  formatMillions,
  generateCapitalQA,
  recommendUpgrades,
  type CapitalPlanSummary,
  type CapitalQA,
  type RankedUpgradeProject,
  type RecommendationInputs,
} from "@/lib/services/capital.service";
import { simulateDataCenter } from "@/lib/services/capacity.service";
import type { CapacitySnapshot } from "@/lib/services/capacity.service";
import { useCapitalProjects } from "@/lib/hooks/use-capital-projects";

// ── Upgrade type display ──────────────────────────────────────────────────────

const UPGRADE_BADGE: Record<string, string> = {
  "transformer-replacement": "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "substation-expansion":    "bg-blue-500/15   text-blue-400   border-blue-500/30",
  "feeder-reconductor":      "bg-cyan-500/15   text-cyan-400   border-cyan-500/30",
  "new-substation":          "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "cable-replacement":       "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const UPGRADE_LABEL: Record<string, string> = {
  "transformer-replacement": "Transformer",
  "substation-expansion":    "Substation",
  "feeder-reconductor":      "Feeder",
  "new-substation":          "New Sub",
  "cable-replacement":       "Cable",
};

// ── Priority score color ──────────────────────────────────────────────────────

function priorityColor(score: number): string {
  if (score >= 85) return "text-red-400";
  if (score >= 70) return "text-orange-400";
  if (score >= 55) return "text-yellow-400";
  return "text-emerald-400";
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CapitalPlanningPanelProps {
  simulatedMW: number;
  capacity: CapacitySnapshot | null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function CapitalPlanningPanel({
  simulatedMW,
  capacity,
}: CapitalPlanningPanelProps) {
  const { projects, source, loading: projectsLoading } = useCapitalProjects();

  // Derive inputs — use live capacity if available, otherwise conservative defaults
  const inputs: RecommendationInputs = useMemo(() => {
    if (capacity) {
      const sim = simulateDataCenter(capacity, simulatedMW);
      return {
        currentUtilizationPct:   capacity.utilizationPct,
        projectedUtilizationPct: sim.utilizationPct,
        headroomMW:              sim.remainingHeadroomMW,
        simulatedAddedMW:        simulatedMW,
      };
    }
    return {
      currentUtilizationPct:   41,
      projectedUtilizationPct: 41 + (simulatedMW / 6500) * 100,
      headroomMW:              3800 - simulatedMW,
      simulatedAddedMW:        simulatedMW,
    };
  }, [capacity, simulatedMW]);

  const summary = useMemo(
    () => recommendUpgrades(projects, inputs),
    [projects, inputs]
  );

  const qa = useMemo(
    () => generateCapitalQA(summary, inputs),
    [summary, inputs]
  );

  if (projectsLoading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CapitalDashboardCard summary={summary} inputs={inputs} source={source} />
      <UpgradeRankingTable projects={summary.rankedProjects} />
      <AICapitalCopilot qa={qa} summary={summary} />
    </div>
  );
}

// ── Capital Dashboard Card ────────────────────────────────────────────────────

function CapitalDashboardCard({
  summary,
  inputs,
  source,
}: {
  summary: CapitalPlanSummary;
  inputs: RecommendationInputs;
  source: "db" | "mock";
}) {
  const kpis = [
    {
      label:  "Total Capital Required",
      value:  formatMillions(summary.totalCostUSD),
      sub:    `${summary.rankedProjects.length} recommended projects`,
      icon:   CircleDollarSign,
      accent: "text-primary",
    },
    {
      label:  "Added Capacity",
      value:  `${summary.totalAddedCapacityMW} MW`,
      sub:    "across selected upgrades",
      icon:   Zap,
      accent: "text-cyan-400",
    },
    {
      label:  "Blended Cost / MW",
      value:  formatCostPerMW(summary.weightedCostPerMW),
      sub:    "portfolio average",
      icon:   Gauge,
      accent: "text-yellow-400",
    },
    {
      label:  "Risk Reduction Score",
      value:  `${summary.totalRiskReduction}/100`,
      sub:    `from ${inputs.projectedUtilizationPct}% projected utilization`,
      icon:   ShieldCheck,
      accent:
        summary.totalRiskReduction >= 40
          ? "text-emerald-400"
          : summary.totalRiskReduction >= 25
          ? "text-yellow-400"
          : "text-orange-400",
    },
  ];

  return (
    <>
      {/* Data-source provenance badge */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Database className="h-3 w-3" />
        {source === "db" ? (
          <span className="text-emerald-400">Live · capital_projects table</span>
        ) : (
          <span className="text-slate-400">Mock data · run migration to connect database</span>
        )}
      </div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <Card key={kpi.label} className="border-border/40 bg-[#0d1219]/80">
          <CardContent className="flex items-start gap-3 p-4">
            <kpi.icon className={`mt-0.5 h-4 w-4 shrink-0 ${kpi.accent}`} />
            <div className="min-w-0">
              <p className="font-mono text-xl font-bold">{kpi.value}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {kpi.label}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                {kpi.sub}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
    </>
  );
}

// ── Upgrade Ranking Table ─────────────────────────────────────────────────────

function UpgradeRankingTable({
  projects,
}: {
  projects: RankedUpgradeProject[];
}) {
  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Upgrade Ranking</CardTitle>
        <CardDescription>
          Priority-ranked capital projects · sorted by adjusted urgency score
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 text-center font-medium w-12">Rank</th>
                <th className="px-4 py-3 text-left font-medium">Project</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
                <th className="px-4 py-3 text-right font-medium">Added MW</th>
                <th className="px-4 py-3 text-right font-medium">Cost / MW</th>
                <th className="px-5 py-3 text-right font-medium">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {projects.map((p) => (
                <tr
                  key={p.id}
                  className="group hover:bg-white/[0.02]"
                >
                  {/* Rank */}
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        p.rank === 1
                          ? "bg-yellow-500/20 text-yellow-400"
                          : p.rank === 2
                          ? "bg-slate-500/20 text-slate-300"
                          : p.rank === 3
                          ? "bg-orange-700/20 text-orange-400"
                          : "bg-border/30 text-muted-foreground"
                      }`}
                    >
                      {p.rank}
                    </span>
                  </td>

                  {/* Project */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground group-hover:text-primary">
                      {p.projectName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {p.substationName} · {p.implementationMonths} mo delivery
                    </p>
                  </td>

                  {/* Type */}
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${UPGRADE_BADGE[p.upgradeType] ?? ""}`}
                    >
                      {UPGRADE_LABEL[p.upgradeType] ?? p.upgradeType}
                    </Badge>
                  </td>

                  {/* Cost */}
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {formatMillions(p.estimatedCostUSD)}
                  </td>

                  {/* Added MW */}
                  <td className="px-4 py-3 text-right font-mono text-cyan-400">
                    +{p.addedCapacityMW} MW
                  </td>

                  {/* Cost / MW */}
                  <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">
                    {formatCostPerMW(p.costPerMW)}/MW
                  </td>

                  {/* Priority score */}
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border/40">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${p.adjustedPriorityScore}%` }}
                        />
                      </div>
                      <span
                        className={`w-8 text-right font-mono text-xs font-bold ${priorityColor(p.adjustedPriorityScore)}`}
                      >
                        {p.adjustedPriorityScore}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>

            {/* Totals footer */}
            <tfoot>
              <tr className="border-t border-border/40 bg-background/20 text-[11px] text-muted-foreground">
                <td colSpan={3} className="px-5 py-3 font-medium uppercase tracking-wider">
                  Portfolio Total
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
                  {formatMillions(projects.reduce((s, p) => s + p.estimatedCostUSD, 0))}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-cyan-400">
                  +{projects.reduce((s, p) => s + p.addedCapacityMW, 0)} MW
                </td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                  {formatCostPerMW(
                    projects.reduce((s, p) => s + p.estimatedCostUSD, 0) /
                      Math.max(1, projects.reduce((s, p) => s + p.addedCapacityMW, 0))
                  )}/MW
                </td>
                <td className="px-5 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── AI Capital Copilot ────────────────────────────────────────────────────────

function AICapitalCopilot({
  qa,
  summary,
}: {
  qa: CapitalQA[];
  summary: CapitalPlanSummary;
}) {
  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <CardTitle>AI Capital Copilot</CardTitle>
        </div>
        <CardDescription>
          Investment decision guidance · {summary.rankedProjects.length} projects ·{" "}
          {formatMillions(summary.totalCostUSD)} portfolio
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {qa.map(({ question, answer }) => (
            <div key={question} className="space-y-1.5">
              {/* Question */}
              <div className="flex items-start gap-2">
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                <p className="text-sm font-semibold text-foreground">{question}</p>
              </div>
              {/* Answer */}
              <p className="pl-5 text-sm leading-relaxed text-muted-foreground">
                {answer}
              </p>
            </div>
          ))}

          {/* Project quick-chips */}
          <div className="border-t border-border/30 pt-4">
            <p className="mb-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              Recommended Projects
            </p>
            <div className="flex flex-wrap gap-2">
              {summary.rankedProjects.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1.5 rounded-md border border-border/30 bg-background/30 px-2.5 py-1 text-xs"
                >
                  <span
                    className={`font-bold ${priorityColor(p.adjustedPriorityScore)}`}
                  >
                    #{p.rank}
                  </span>
                  <span className="truncate max-w-[180px]">{p.projectName}</span>
                  <span className="font-mono text-muted-foreground/60">
                    {formatMillions(p.estimatedCostUSD)}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/50">
            Recommendations are generated from the GridVision capital planning engine using live Eastern MA
            grid state and mock project data. Final investment decisions require full feasibility study and
            regulatory review.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
