"use client";

import { useMemo } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SubstationPlan } from "@/lib/types";
import type { UpgradeProject } from "@/lib/data/capital-projects";
import {
  computeSubstationRisk,
  type AssetRiskLevel,
  type RiskAssessment,
} from "@/lib/services/asset-risk.service";

// ── Styling ───────────────────────────────────────────────────────────────────

const RISK_BADGE: Record<AssetRiskLevel, string> = {
  LOW:      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MEDIUM:   "bg-yellow-500/15  text-yellow-400  border-yellow-500/30",
  HIGH:     "bg-orange-500/15  text-orange-400  border-orange-500/30",
  CRITICAL: "bg-red-500/15     text-red-400     border-red-500/30",
};

// ── Answer generation (deterministic, no LLM) ─────────────────────────────────

interface QA { question: string; answer: string }

function generateQA(
  ss: SubstationPlan,
  projects: UpgradeProject[],
  risk: RiskAssessment
): QA[] {
  const utilPct =
    ss.nameplateMVA > 0
      ? Math.round((ss.peakLoadMW / ss.nameplateMVA) * 1_000) / 10
      : 0;
  const n1Headroom = ss.n1CapacityMW - ss.peakLoadMW;
  const headroom = ss.nameplateMVA - ss.peakLoadMW;

  // Sorted projects: highest priority first
  const sortedProjects = [...projects].sort(
    (a, b) => b.priorityScore - a.priorityScore
  );
  const topProject = sortedProjects[0];

  // 20% growth projection
  const growthLoad = Math.round(ss.peakLoadMW * 1.2);
  const growthUtil =
    ss.nameplateMVA > 0
      ? Math.round((growthLoad / ss.nameplateMVA) * 1_000) / 10
      : 0;
  const growthN1Headroom = ss.n1CapacityMW - growthLoad;

  // Total planned capacity from capital projects
  const totalPlannedMW = projects.reduce((s, p) => s + p.addedCapacityMW, 0);

  return [
    {
      question: "What is the biggest risk?",
      answer:
        risk.drivers.length > 0
          ? `The primary risk driver is: ${risk.drivers[0]}. ` +
            `This contributes to a composite risk score of ${risk.riskScore}/100 (${risk.riskLevel}). ` +
            (risk.drivers.length > 1
              ? `Additional factors include: ${risk.drivers.slice(1).join("; ")}.`
              : "No secondary risk factors identified at this time.")
          : `${ss.name} is operating within normal limits. Utilization is ${utilPct}% with ${headroom.toFixed(0)} MW of headroom against the ${ss.nameplateMVA} MVA nameplate rating.`,
    },
    {
      question: "What should be upgraded first?",
      answer:
        topProject
          ? `${topProject.projectName} carries the highest priority score (${topProject.priorityScore}/100). ` +
            `This ${topProject.upgradeType.replace(/-/g, " ")} adds ${topProject.addedCapacityMW} MW of capacity ` +
            `at $${(topProject.estimatedCostUSD / 1_000_000).toFixed(1)}M over ${topProject.implementationMonths} months. ` +
            (sortedProjects.length > 1
              ? `${sortedProjects.length} total projects are planned for this substation, adding ${totalPlannedMW} MW in aggregate.`
              : "")
          : `No capital projects are currently planned for ${ss.name}. Given a ${risk.riskLevel} risk level, ` +
            `a capacity study should be initiated to identify upgrade options.`,
    },
    {
      question: "What capacity remains?",
      answer:
        `${ss.name} has ${headroom.toFixed(0)} MW of nameplate headroom ` +
        `(${ss.nameplateMVA} MVA nameplate − ${ss.peakLoadMW} MW peak load). ` +
        `Under N-1 contingency criteria, headroom is ${n1Headroom.toFixed(0)} MW ` +
        `(${ss.n1CapacityMW} MW N-1 capacity). ` +
        (n1Headroom <= 0
          ? "The substation currently violates N-1 reliability standards."
          : n1Headroom < 20
          ? "N-1 headroom is critically low and limits new interconnection approvals."
          : "N-1 margins are currently adequate.") +
        (totalPlannedMW > 0
          ? ` Approved capital projects will add ${totalPlannedMW} MW, bringing total capacity to ${ss.nameplateMVA + totalPlannedMW} MVA.`
          : ""),
    },
    {
      question: "What happens if load grows 20%?",
      answer:
        `A 20% load growth would increase peak demand from ${ss.peakLoadMW} MW to ${growthLoad} MW, ` +
        `driving substation utilization to ${growthUtil}% ` +
        `(currently ${utilPct}%). ` +
        (growthUtil >= 95
          ? "This would push the substation into a critical overload condition requiring immediate capital intervention."
          : growthUtil >= 85
          ? "This would place the substation in the high-risk band, triggering upgrade programme obligations."
          : growthUtil >= 75
          ? "This would move the substation into the elevated-risk band. Upgrade planning should begin within 12 months."
          : "The substation would remain within acceptable operating limits, though continued monitoring is recommended.") +
        ` N-1 headroom would be ${growthN1Headroom.toFixed(0)} MW under that scenario.`,
    },
  ];
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AssetCopilotProps {
  substation: SubstationPlan;
  projects: UpgradeProject[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AssetCopilot({ substation, projects }: AssetCopilotProps) {
  const risk = useMemo(
    () => computeSubstationRisk(substation, projects),
    [substation, projects]
  );

  const qa = useMemo(
    () => generateQA(substation, projects, risk),
    [substation, projects, risk]
  );

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <CardTitle className="text-base">AI Asset Copilot</CardTitle>
        </div>
        <CardDescription>
          Asset-specific risk analysis · {substation.name}
        </CardDescription>
        <Badge variant="outline" className={`w-fit text-[10px] ${RISK_BADGE[risk.riskLevel]}`}>
          {risk.riskLevel} — {risk.riskScore}/100
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {qa.map(({ question, answer }) => (
            <div key={question} className="space-y-1.5">
              <div className="flex items-start gap-2">
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                <p className="text-sm font-semibold text-foreground">{question}</p>
              </div>
              <p className="pl-5 text-xs leading-relaxed text-muted-foreground">
                {answer}
              </p>
            </div>
          ))}

          <p className="border-t border-border/30 pt-3 text-[10px] text-muted-foreground/50">
            Responses are generated deterministically from live asset data.
            Risk scores update in real time as underlying data changes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
