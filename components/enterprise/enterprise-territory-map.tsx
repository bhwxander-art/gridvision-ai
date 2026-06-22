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
import { cn, formatMW } from "@/lib/utils";
import {
  assessSubstationCapacity,
  getSeverityColor,
  getSeverityLabel,
  type SubstationPlan,
} from "@/lib/planning-engine";
import type { PlanningConfig } from "@/lib/types";
import {
  geoToCssPercent,
  geoToSVGPoint,
  BOSTON_METRO_BOUNDS,
  formatCoordinates,
} from "@/lib/gis/projection";

interface EnterpriseTerritoryMapProps {
  portfolio: SubstationPlan[];
  config: PlanningConfig;
}

export function EnterpriseTerritoryMap({
  portfolio,
  config,
}: EnterpriseTerritoryMapProps) {
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
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 70"
            >
              {/* Land outline */}
              <path
                d="M 5 15 Q 20 8 40 12 Q 60 10 75 18 Q 82 30 78 45 Q 70 58 50 62 Q 30 65 10 55 Q 3 40 5 15 Z"
                fill="hsl(217 33% 8%)"
                stroke="hsl(217 33% 16%)"
                strokeWidth="0.4"
              />

              {/* Transmission lines — computed from real coordinates */}
              {[
                ["ss-waltham-west", "ss-cambridge-central"],
                ["ss-cambridge-central", "ss-somerville-east"],
                ["ss-cambridge-central", "ss-boston-north"],
                ["ss-somerville-east", "ss-boston-north"],
              ].map(([fromId, toId]) => {
                const from = portfolio.find((s) => s.id === fromId);
                const to = portfolio.find((s) => s.id === toId);
                if (!from || !to) return null;
                const fromPt = geoToSVGPoint(
                  from.latitude,
                  from.longitude,
                  BOSTON_METRO_BOUNDS
                );
                const toPt = geoToSVGPoint(
                  to.latitude,
                  to.longitude,
                  BOSTON_METRO_BOUNDS
                );
                return (
                  <line
                    key={`${fromId}-${toId}`}
                    x1={fromPt.x}
                    y1={fromPt.y}
                    x2={toPt.x}
                    y2={toPt.y}
                    stroke="hsl(187 85% 53% / 0.3)"
                    strokeWidth="0.3"
                    strokeDasharray="1 1"
                  />
                );
              })}
            </svg>

            {portfolio.map((ss) => {
              const assessment = assessSubstationCapacity(
                ss,
                config.territory.planningHorizonYears
              );
              const color = getSeverityColor(assessment.severity);
              const isSelected = selected?.id === ss.id;
              const { xPct, yPct } = geoToCssPercent(
                ss.latitude,
                ss.longitude,
                BOSTON_METRO_BOUNDS
              );

              return (
                <button
                  key={ss.id}
                  type="button"
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${xPct}%`, top: `${yPct}%` }}
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
                    {ss.name}
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
              const assessment = assessSubstationCapacity(
                selected,
                config.territory.planningHorizonYears
              );

              return (
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Voltage</span>
                    <span>{selected.voltageKV} kV</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Peak Load</span>
                    <span>{formatMW(selected.peakLoadMW)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nameplate</span>
                    <span>{formatMW(selected.nameplateMVA)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">N-1 Headroom</span>
                    <span>{formatMW(assessment.n1HeadroomMW)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Coordinates</span>
                    <span className="font-mono text-xs">
                      {formatCoordinates(selected.latitude, selected.longitude)}
                    </span>
                  </div>

                  <Badge
                    variant="outline"
                    style={{
                      borderColor: `${getSeverityColor(assessment.severity)}44`,
                      color: getSeverityColor(assessment.severity),
                    }}
                  >
                    {getSeverityLabel(assessment.severity)}
                  </Badge>

                  <p className="text-xs text-muted-foreground">
                    {assessment.recommendedAction}
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
