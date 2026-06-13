"use client";

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
  type SubstationCapacityResult,
} from "@/lib/planning-engine";
import {
  planningTerritory,
  substationPortfolio,
} from "@/lib/enterprise-data";
import { formatMW } from "@/lib/utils";

export function SubstationCapacityPanel() {
  const results: (SubstationCapacityResult & { name: string; region: string })[] =
    substationPortfolio.map((ss) => ({
      ...assessSubstationCapacity(ss, planningTerritory.planningHorizonYears),
      name: ss.name,
      region: ss.region,
    }));

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Substation Capacity Planning</CardTitle>
        <CardDescription>
          N-1 headroom, utilization, and years-to-constraint by station ·{" "}
          {planningTerritory.planningHorizonYears}-year horizon
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">Substation</th>
                <th className="pb-3 pr-4 font-medium">Utilization</th>
                <th className="pb-3 pr-4 font-medium">N-1 Headroom</th>
                <th className="pb-3 pr-4 font-medium">Yrs to Limit</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 pr-4 font-medium">Est. Capex</th>
                <th className="pb-3 font-medium">Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr
                  key={row.substationId}
                  className="border-b border-border/20 hover:bg-accent/20"
                >
                  <td className="py-3 pr-4">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.region}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(row.utilizationPct, 100)}%`,
                            backgroundColor: getSeverityColor(row.severity),
                          }}
                        />
                      </div>
                      <span className="font-mono text-xs">
                        {row.utilizationPct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {formatMW(row.n1HeadroomMW)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {row.yearsToConstraint !== null
                      ? row.yearsToConstraint
                      : "—"}
                  </td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant="outline"
                      style={{
                        borderColor: `${getSeverityColor(row.severity)}44`,
                        color: getSeverityColor(row.severity),
                      }}
                    >
                      {getSeverityLabel(row.severity)}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {row.estimatedCapexM > 0
                      ? `$${row.estimatedCapexM.toFixed(1)}M`
                      : "—"}
                  </td>
                  <td className="max-w-xs py-3 text-xs text-muted-foreground">
                    {row.recommendedAction}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
