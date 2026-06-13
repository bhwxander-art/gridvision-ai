import {
  AlertTriangle,
  Building2,
  DollarSign,
  Server,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SubstationCapacityResult, TransformerOverloadResult } from "@/lib/planning-engine";
import type { DataCenterImpactResult } from "@/lib/planning-engine";

interface KpiStripProps {
  constrainedSubstations: number;
  criticalTransformers: number;
  dcQueueMW: number;
  totalCapexM: number;
  constrainedDCProjects: number;
}

export function KpiStrip({
  constrainedSubstations,
  criticalTransformers,
  dcQueueMW,
  totalCapexM,
  constrainedDCProjects,
}: KpiStripProps) {
  const kpis = [
    {
      label: "Constrained Substations",
      value: constrainedSubstations,
      icon: AlertTriangle,
      accent: constrainedSubstations > 0 ? "text-yellow-400" : "text-green-400",
    },
    {
      label: "Transformers at Risk",
      value: criticalTransformers,
      icon: Server,
      accent: criticalTransformers > 0 ? "text-red-400" : "text-green-400",
    },
    {
      label: "DC Queue (MW)",
      value: dcQueueMW,
      icon: Building2,
      accent: "text-purple-400",
    },
    {
      label: "DC Projects w/ Constraints",
      value: constrainedDCProjects,
      icon: TrendingUp,
      accent: constrainedDCProjects > 0 ? "text-orange-400" : "text-green-400",
    },
    {
      label: "Est. Capex Priority ($M)",
      value: totalCapexM.toFixed(1),
      icon: DollarSign,
      accent: "text-primary",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {kpis.map((kpi) => (
        <Card
          key={kpi.label}
          className="border-border/40 bg-[#0d1219]/80"
        >
          <CardContent className="flex items-start gap-3 p-4">
            <kpi.icon className={`mt-0.5 h-4 w-4 shrink-0 ${kpi.accent}`} />
            <div>
              <p className="font-mono text-xl font-bold">{kpi.value}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {kpi.label}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export type { SubstationCapacityResult, TransformerOverloadResult, DataCenterImpactResult };
