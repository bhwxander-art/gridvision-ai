"use client";

import { useMemo, useState } from "react";
import type { ProvenanceInfo } from "@/lib/provenance";
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
import { useSubstationData } from "@/lib/hooks/use-substation-data";
import { useDataCenterQueue } from "@/lib/hooks/use-datacenter-queue";
import { useForecast } from "@/lib/hooks/use-forecast";
import { ForecastPanel } from "@/components/enterprise/forecast-panel";
import { CopilotPanel } from "@/components/enterprise/copilot-panel";

function DataBadge({ provenance }: { provenance: ProvenanceInfo | null }) {
  if (!provenance) return null;
  const styles = {
    live:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    delayed: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    mock:    "bg-slate-500/15 text-slate-400 border-slate-500/30",
  } as const;
  const labels = { live: "LIVE", delayed: "DELAYED", mock: "MOCK" } as const;
  const dots = { live: "bg-emerald-400", delayed: "bg-yellow-400", mock: "bg-slate-400" } as const;
  const f = provenance.freshness;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-widest ${styles[f]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[f]} ${f === "live" ? "animate-pulse" : ""}`} />
      {labels[f]}
      <span className="font-normal opacity-60">· {provenance.source}</span>
    </span>
  );
}

function EnterpriseSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80"
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-64 animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80 lg:col-span-2" />
        <div className="h-64 animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80" />
      </div>
      <div className="h-48 animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80" />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
      {message}
    </div>
  );
}

export default function EnterprisePlanningPage() {
  const [section, setSection] = useState<EnterpriseSection>("overview");

  const {
    data: substationData,
    provenance,
    loading: ssLoading,
    error: ssError,
  } = useSubstationData();

  const {
    data: queue,
    loading: queueLoading,
    error: queueError,
  } = useDataCenterQueue();

  const {
    data: forecast,
    loading: forecastLoading,
    error: forecastError,
  } = useForecast();

  const loading = ssLoading || queueLoading;
  const error = ssError ?? queueError;

  const kpis = useMemo(() => {
    if (!substationData || !queue) return null;
    return computeEnterpriseKpis(
      substationData.portfolio,
      queue,
      substationData.config.territory
    );
  }, [substationData, queue]);

  return (
    <EnterpriseShell
      activeSection={section}
      onSectionChange={setSection}
      territory={substationData?.config.territory}
      badge={<DataBadge provenance={provenance} />}
    >
      {loading && <EnterpriseSkeleton />}

      {!loading && error && (
        <ErrorBanner message="Unable to reach the data API — displaying cached planning data." />
      )}

      {!loading && substationData && queue && kpis && (
        <div className="space-y-6">
          <KpiStrip {...kpis} />

          {section === "overview" && (
            <>
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="border-border/40 bg-[#0d1219]/80 lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Planning Command Center</CardTitle>
                    <CardDescription>
                      Integrated view for distribution planning,
                      interconnection, and capital prioritization
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    {[
                      {
                        label: "Planning Horizon",
                        value: `${substationData.config.territory.planningHorizonYears} years`,
                      },
                      {
                        label: "System Peak",
                        value: `${substationData.config.territory.peakSystemLoadMW.toLocaleString()} MW`,
                      },
                      {
                        label: "EV Growth Assumption",
                        value: `${substationData.config.loadGrowthAssumptions.evPenetrationGrowthPct}%/yr`,
                      },
                      {
                        label: "DC Queue Total",
                        value: `${substationData.config.loadGrowthAssumptions.dataCenterQueueMW} MW`,
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
                      Central fails N-1 under Kendall Inference Hub
                      energization. Project Helix (180 MW) exceeds Waltham
                      West feeder hosting capacity.
                    </p>
                    <p className="mt-3 text-xs">
                      Recommend escalation to capital planning committee this
                      quarter.
                    </p>
                  </CardContent>
                </Card>
              </div>

              <PriorityActionsTable
                portfolio={substationData.portfolio}
                queue={queue}
                territory={substationData.config.territory}
              />
            </>
          )}

          {section === "substations" && (
            <SubstationCapacityPanel
              portfolio={substationData.portfolio}
              config={substationData.config}
            />
          )}

          {section === "transformers" && (
            <TransformerOverloadPanel
              portfolio={substationData.portfolio}
              trend={substationData.trend}
              config={substationData.config}
            />
          )}

          {section === "datacenters" && (
            <DataCenterImpactPanel
              queue={queue}
              portfolio={substationData.portfolio}
            />
          )}

          {section === "map" && (
            <EnterpriseTerritoryMap
              portfolio={substationData.portfolio}
              queue={queue}
              config={substationData.config}
            />
          )}

          {section === "forecast" && (
            forecastLoading ? (
              <EnterpriseSkeleton />
            ) : forecastError || !forecast ? (
              <ErrorBanner message="Unable to load forecast data." />
            ) : (
              <ForecastPanel data={forecast} />
            )
          )}

          {section === "copilot" && (
            <CopilotPanel
              portfolio={substationData.portfolio}
              queue={queue}
              forecast={forecast}
              config={substationData.config}
            />
          )}
        </div>
      )}
    </EnterpriseShell>
  );
}
