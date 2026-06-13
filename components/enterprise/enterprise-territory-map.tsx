"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  assessSubstationCapacity,
  getSeverityColor,
  getSeverityLabel,
} from "@/lib/planning-engine";
import {
  planningTerritory,
  substationPortfolio,
  type SubstationPlan,
} from "@/lib/enterprise-data";
import { cn, formatMW } from "@/lib/utils";

export function EnterpriseTerritoryMap() {
  const [selected, setSelected] = useState<SubstationPlan | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="border-border/40 bg-[#0d1219]/80 lg:col-span-2">
        <CardHeader>
          <CardTitle>Territory Map</CardTitle>
          <CardDescription>
            Substation constraint severity · Eastern Massachusetts service area
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-border/40 bg-[#070b12]">
            <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-15" />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 70">
              <path
                d="M 5 15 Q 20 8 40 12 Q 60 10 75 18 Q 82 30 78 45 Q 70 58 50 62 Q 30 65 10 55 Q 3 40 5 15 Z"
                fill="hsl(217 33% 8%)"
                stroke="hsl(217 33% 16%)"
                strokeWidth="0.4"
              />
            </svg>
            {substationPortfolio.map((ss) => {
              const assessment = assessSubstationCapacity(
                ss,
                planningTerritory.planningHorizonYears
              );
              const color = getSeverityColor(assessment.severity);
              const isSelected = selected?.id === ss.id;
              return (
                <button
                  key={ss.id}
                  type="button"
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${ss.x}%`, top: `${ss.y}%` }}
                  onClick={() => setSelected(ss)}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-transform",
                      isSelected && "scale-125"
                    )}
                    style={{
                      borderColor: color,
                      backgroundColor: `${color}22`,
                      boxShadow: `0 0 24px ${color}55`,
                    }}
                  >
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  </div>
                  <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[10px]">
                    {ss.name.split(" ")[0]} {ss.name.split(" ")[1]}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-base">
            {selected ? selected.name : "Select Substation"}
          </CardTitle>
          {selected && (
            <CardDescription>{selected.region}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {selected ? (
            (() => {
              const a = assessSubstationCapacity(
                selected,
                planningTerritory.planningHorizonYears
              );
              return (
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Voltage</span>
                    <span className="font-mono">{selected.voltageKV} kV</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Peak Load</span>
                    <span className="font-mono">
                      {formatMW(selected.peakLoadMW)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nameplate</span>
                    <span className="font-mono">
                      {formatMW(selected.nameplateMVA)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">N-1 Headroom</span>
                    <span className="font-mono">{formatMW(a.n1HeadroomMW)}</span>
                  </div>
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: `${getSeverityColor(a.severity)}44`,
                      color: getSeverityColor(a.severity),
                    }}
                  >
                    {getSeverityLabel(a.severity)}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    {a.recommendedAction}
                  </p>
                </div>
              );
            })()
          ) : (
            <p className="text-sm text-muted-foreground">
              Click a substation marker to view planning details.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
