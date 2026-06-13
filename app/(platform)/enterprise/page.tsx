"use client";

import { useMemo, useState } from "react";
import {
  EnterpriseShell,
  type EnterpriseSection,
} from "@/components/enterprise/enterprise-shell";
import { KpiStrip } from "@/components/enterprise/kpi-strip";
import { SubstationCapacityPanel } from "@/components/enterprise/substation-capacity-panel";
import { TransformerOverloadPanel } from "@/components/enterprise/transformer-overload-panel";
import { DataCenterImpactPanel } from "@/components/enterprise/datacenter-impact-panel";
import {
  PriorityActionsTable,
  computeEnterpriseKpis,
} from "@/components/enterprise/priority-actions-table";
import { EnterpriseTerritoryMap } from "@/components/enterprise/enterprise-territory-map";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loadGrowthAssumptions, planningTerritory } from "@/lib/enterprise-data";

export default function EnterprisePlanningPage() {
  const [section, setSection] = useState<EnterpriseSection>("overview");
  const kpis = useMemo(() => computeEnterpriseKpis(), []);

  return (
    <EnterpriseShell activeSection={section} onSectionChange={setSection}>
      <div className="space-y-6">
        <KpiStrip {...kpis} />

        {section === "overview" && (
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="border-border/40 bg-[#0d1219]/80 lg:col-span-2">
                <CardHeader>
                  <CardTitle>Planning Command Center</CardTitle>
                  <CardDescription>
                    Integrated view for distribution planning, interconnection,
                    and capital prioritization
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  {[
                    {
                      label: "Planning Horizon",
                      value: `${planningTerritory.planningHorizonYears} years`,
                    },
                    {
                      label: "System Peak",
                      value: `${planningTerritory.peakSystemLoadMW.toLocaleString()} MW`,
                    },
                    {
                      label: "EV Growth Assumption",
                      value: `${loadGrowthAssumptions.evPenetrationGrowthPct}%/yr`,
                    },
                    {
                      label: "DC Queue Total",
                      value: `${loadGrowthAssumptions.dataCenterQueueMW} MW`,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border border-border/30 bg-background/30 p-3"
                    >
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-1 font-mono text-lg">{item.value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-yellow-500/20 bg-yellow-500/5">
                <CardHeader>
                  <CardTitle className="text-base">Planner Alert</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <p>
                    Somerville East at 99% transformer loading. Cambridge
                    Central fails N-1 under Kendall Inference Hub energization.
                    Project Helix (180 MW) exceeds Waltham West feeder hosting
                    capacity.
                  </p>
                  <p className="mt-3 text-xs">
                    Recommend escalation to capital planning committee this
                    quarter.
                  </p>
                </CardContent>
              </Card>
            </div>
            <PriorityActionsTable />
          </>
        )}

        {section === "substations" && <SubstationCapacityPanel />}
        {section === "transformers" && <TransformerOverloadPanel />}
        {section === "datacenters" && <DataCenterImpactPanel />}
        {section === "map" && <EnterpriseTerritoryMap />}
      </div>
    </EnterpriseShell>
  );
}
