"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { analyzeDataCenterImpact } from "@/lib/planning-engine";
import type { DataCenterInterconnection, SubstationPlan } from "@/lib/types";
import { findFeederById } from "@/lib/services/substation.service";
import { formatMW } from "@/lib/utils";

const statusLabels = {
  study: "Impact Study",
  "ia-executed": "IA Executed",
  construction: "Under Construction",
  energized: "Energized",
};

interface DataCenterImpactPanelProps {
  queue: DataCenterInterconnection[];
  portfolio: SubstationPlan[];
}

export function DataCenterImpactPanel({
  queue,
  portfolio,
}: DataCenterImpactPanelProps) {
  const results = queue
    .map((project) => {
      const ctx = findFeederById(project.affectedFeederId, portfolio);
      if (!ctx) return null;
      return {
        project,
        impact: analyzeDataCenterImpact(project, ctx.substation, ctx.feeder),
        substationName: ctx.substation.name,
        feederName: ctx.feeder.name,
      };
    })
    .filter(Boolean);

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Data Center Interconnection Queue</CardTitle>
        <CardDescription>
          Hosting capacity impact analysis · flat load factor AI campuses vs.
          colocation profiles
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {results.map((row) => {
            if (!row) return null;
            const { project, impact, substationName, feederName } = row;
            return (
              <div
                key={project.id}
                className="rounded-lg border border-border/40 bg-background/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{project.projectName}</p>
                    <p className="text-xs text-muted-foreground">
                      {project.developer} · COD {project.targetCOD}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {statusLabels[project.status]}
                    </Badge>
                    {impact.constraintFlag && (
                      <Badge variant="danger">Constraint</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Requested / Net Load
                    </p>
                    <p className="font-mono text-sm">
                      {formatMW(project.requestedMW)} →{" "}
                      {formatMW(impact.netLoadMW)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      LF {(project.loadFactor * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Affected Infrastructure
                    </p>
                    <p className="text-sm">{substationName}</p>
                    <p className="text-xs text-muted-foreground">{feederName}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Feeder Headroom After
                    </p>
                    <p
                      className="font-mono text-sm"
                      style={{
                        color:
                          impact.feederHeadroomAfterMW < 0
                            ? "#ef4444"
                            : "#22c55e",
                      }}
                    >
                      {formatMW(impact.feederHeadroomAfterMW)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Substation Util. After
                    </p>
                    <p className="font-mono text-sm">
                      {impact.substationUtilAfterPct.toFixed(0)}%
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 border-t border-border/30 pt-4 text-xs">
                  <p>
                    <span className="font-medium text-foreground">
                      Network upgrade:{" "}
                    </span>
                    <span className="text-muted-foreground">
                      {impact.upgradeRequired}
                    </span>
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      Study recommendation:{" "}
                    </span>
                    <span className="text-muted-foreground">
                      {impact.studyPhaseRecommendation}
                    </span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
