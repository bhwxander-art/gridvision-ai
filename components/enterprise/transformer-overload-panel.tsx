"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  forecastTransformerOverload,
  getSeverityColor,
  getSeverityLabel,
} from "@/lib/planning-engine";
import {
  loadGrowthAssumptions,
  substationPortfolio,
  transformerLoadingTrend,
} from "@/lib/enterprise-data";

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(222 47% 6%)",
    border: "1px solid hsl(217 33% 14%)",
    borderRadius: "8px",
    fontSize: "12px",
  },
};

export function TransformerOverloadPanel() {
  const allTransformers = substationPortfolio.flatMap((ss) => ss.transformers);
  const results = allTransformers
    .map((tx) =>
      forecastTransformerOverload(
        tx,
        loadGrowthAssumptions.evPenetrationGrowthPct,
        loadGrowthAssumptions.dataCenterQueueMW / allTransformers.length
      )
    )
    .sort((a, b) => b.replacementPriority - a.replacementPriority);

  return (
    <div className="space-y-6">
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle>Transformer Thermal Loading Forecast</CardTitle>
          <CardDescription>
            Current vs. forecast loading with EV + data center growth · thermal
            limit 100% nameplate
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Transformer</th>
                  <th className="pb-3 pr-4 font-medium">Current</th>
                  <th className="pb-3 pr-4 font-medium">Forecast</th>
                  <th className="pb-3 pr-4 font-medium">Thermal Margin</th>
                  <th className="pb-3 pr-4 font-medium">Priority</th>
                  <th className="pb-3 pr-4 font-medium">Risk</th>
                  <th className="pb-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => {
                  const tx = allTransformers.find(
                    (t) => t.id === row.transformerId
                  )!;
                  return (
                    <tr
                      key={row.transformerId}
                      className="border-b border-border/20 hover:bg-accent/20"
                    >
                      <td className="py-3 pr-4">
                        <p className="font-medium">{tx.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {tx.ratedMVA} MVA · {tx.ageYears} yrs
                          {!tx.n1Compliant && " · N-1 gap"}
                        </p>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">
                        {row.loadingPct.toFixed(0)}%
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className="font-mono text-xs font-semibold"
                          style={{ color: getSeverityColor(row.overloadRisk) }}
                        >
                          {row.forecastLoadingPct.toFixed(0)}%
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">
                        {row.thermalMarginMVA.toFixed(1)} MVA
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">
                        {row.replacementPriority}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: `${getSeverityColor(row.overloadRisk)}44`,
                            color: getSeverityColor(row.overloadRisk),
                          }}
                        >
                          {getSeverityLabel(row.overloadRisk)}
                        </Badge>
                      </td>
                      <td className="max-w-xs py-3 text-xs text-muted-foreground">
                        {row.recommendedAction}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle>Loading Trend by Substation (%)</CardTitle>
          <CardDescription>Historical peak transformer loading</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={transformerLoadingTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" />
                <XAxis dataKey="year" stroke="hsl(215 20% 55%)" fontSize={11} />
                <YAxis
                  stroke="hsl(215 20% 55%)"
                  fontSize={11}
                  domain={[60, 115]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  {...chartTooltipStyle}
                  formatter={(v: number) => [`${v}%`, ""]}
                />
                <Bar dataKey="cambridge" name="Cambridge" fill="#eab308" radius={[2, 2, 0, 0]} />
                <Bar dataKey="somerville" name="Somerville" fill="#ef4444" radius={[2, 2, 0, 0]} />
                <Bar dataKey="waltham" name="Waltham" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                <Bar dataKey="boston" name="Boston North" fill="#22c55e" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
