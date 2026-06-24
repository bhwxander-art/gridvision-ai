"use client";

import { Activity, Battery, Gauge, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { CapacitySnapshot, RiskLevel } from "@/lib/services/capacity.service";

const riskConfig: Record<
  RiskLevel,
  { label: string; color: string; bg: string }
> = {
  low:      { label: "Low",      color: "text-emerald-400", bg: "bg-emerald-400" },
  moderate: { label: "Moderate", color: "text-yellow-400",  bg: "bg-yellow-400"  },
  high:     { label: "High",     color: "text-orange-400",  bg: "bg-orange-400"  },
  critical: { label: "Critical", color: "text-red-400",     bg: "bg-red-400"     },
};

interface CapacityKpiStripProps {
  snapshot: CapacitySnapshot;
}

export function CapacityKpiStrip({ snapshot }: CapacityKpiStripProps) {
  const risk = riskConfig[snapshot.riskLevel];

  const kpis = [
    {
      label: "Current Load (Eastern MA)",
      value: `${snapshot.currentLoadMW.toLocaleString()} MW`,
      sub: `ISO-NE system: ${snapshot.isoneSystemLoadMW.toLocaleString()} MW`,
      icon: Activity,
      accent: "text-cyan-400",
    },
    {
      label: "Available Capacity",
      value: `${snapshot.capacityMW.toLocaleString()} MW`,
      sub: "Eastern MA installed",
      icon: Battery,
      accent: "text-primary",
    },
    {
      label: "Utilization",
      value: `${snapshot.utilizationPct}%`,
      sub: "of Eastern MA capacity",
      icon: Gauge,
      accent:
        snapshot.utilizationPct >= 85
          ? "text-red-400"
          : snapshot.utilizationPct >= 70
          ? "text-yellow-400"
          : "text-emerald-400",
    },
    {
      label: "Headroom",
      value: `${snapshot.headroomMW.toLocaleString()} MW`,
      sub: "available headroom",
      icon: ShieldAlert,
      accent:
        snapshot.headroomMW < 500
          ? "text-red-400"
          : snapshot.headroomMW < 1_500
          ? "text-yellow-400"
          : "text-emerald-400",
    },
  ];

  return (
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
              {kpi.sub && (
                <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                  {kpi.sub}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card className="col-span-2 border-border/40 bg-[#0d1219]/80 lg:col-span-4">
        <CardContent className="flex items-center gap-4 p-4">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            System Risk Level
          </span>
          <span className={`flex items-center gap-1.5 font-semibold ${risk.color}`}>
            <span className={`h-2 w-2 rounded-full ${risk.bg}`} />
            {risk.label}
          </span>
          <div className="ml-auto flex-1 max-w-xs">
            <div className="h-1.5 w-full rounded-full bg-border/40">
              <div
                className={`h-1.5 rounded-full transition-all ${risk.bg}`}
                style={{ width: `${Math.min(snapshot.utilizationPct, 100)}%` }}
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {snapshot.utilizationPct}% utilized
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
