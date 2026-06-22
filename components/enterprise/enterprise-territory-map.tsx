"use client";

import dynamic from "next/dynamic";
import type { DataCenterInterconnection, SubstationPlan } from "@/lib/planning-engine";
import type { PlanningConfig } from "@/lib/types";

// Leaflet requires window — load only on the client.
const GisMap = dynamic(
  () => import("@/components/enterprise/gis-map").then((m) => ({ default: m.GisMap })),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-[540px] animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80 lg:col-span-2" />
        <div className="h-[540px] animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80" />
      </div>
    ),
  }
);

export interface EnterpriseTerritoryMapProps {
  portfolio: SubstationPlan[];
  queue: DataCenterInterconnection[];
  config: PlanningConfig;
}

export function EnterpriseTerritoryMap({
  portfolio,
  queue,
  config,
}: EnterpriseTerritoryMapProps) {
  return <GisMap portfolio={portfolio} queue={queue} config={config} />;
}
