"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DollarSign,
  Gauge,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRevenue } from "@/lib/data/accounts";
import { buildRevenueSnapshot } from "@/lib/services/revenue-forecast.service";
import { useAccounts } from "@/lib/hooks/use-accounts";

// ── Chart styling ─────────────────────────────────────────────────────────────

const TIP = {
  contentStyle: {
    backgroundColor: "hsl(222 47% 6%)",
    border: "1px solid hsl(217 33% 14%)",
    borderRadius: "8px",
    fontSize: "12px",
  },
  labelStyle: { color: "hsl(210 40% 98%)" },
};

const fmtM = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1_000)}k`);

// ── Component ─────────────────────────────────────────────────────────────────

export function RevenueDashboard() {
  const { accounts } = useAccounts();
  const snap = useMemo(() => buildRevenueSnapshot(accounts), [accounts]);

  const kpis = [
    {
      label:   "Total Pipeline ARR",
      value:   formatRevenue(snap.totalPipelineARR),
      sub:     `${snap.probabilityBuckets.reduce((s, b) => s + b.count, 0)} accounts`,
      icon:    DollarSign,
      accent:  "text-primary",
    },
    {
      label:   "Weighted Pipeline ARR",
      value:   formatRevenue(snap.weightedPipelineARR),
      sub:     "probability-adjusted",
      icon:    TrendingUp,
      accent:  "text-cyan-400",
    },
    {
      label:   "Q3 2026 Forecast ARR",
      value:   formatRevenue(snap.forecastARR),
      sub:     "current quarter closes",
      icon:    Target,
      accent:  "text-orange-400",
    },
    {
      label:   "Pipeline Coverage",
      value:   `${(snap.pipelineCoverage * 100).toFixed(0)}%`,
      sub:     `of ${formatRevenue(snap.quota)} quota`,
      icon:    Gauge,
      accent:  snap.pipelineCoverage >= 0.8 ? "text-emerald-400" : snap.pipelineCoverage >= 0.5 ? "text-yellow-400" : "text-red-400",
    },
    {
      label:   "Win Rate",
      value:   `${snap.winRate.toFixed(1)}%`,
      sub:     "closed-won / total",
      icon:    Trophy,
      accent:  "text-emerald-400",
    },
    {
      label:   "Avg Deal Size (ARR)",
      value:   formatRevenue(snap.avgDealSizeARR),
      sub:     "mean across pipeline",
      icon:    Users,
      accent:  "text-purple-400",
    },
  ];

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-border/40 bg-[#0d1219]/80">
            <CardContent className="flex items-start gap-3 p-4">
              <kpi.icon className={`mt-0.5 h-4 w-4 shrink-0 ${kpi.accent}`} />
              <div className="min-w-0">
                <p className="font-mono text-xl font-bold">{kpi.value}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/60">{kpi.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row 1: ARR by Stage + Quarterly Forecast */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ARR by Stage */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">ARR by Pipeline Stage</CardTitle>
            <CardDescription className="text-xs">Total vs weighted ARR per stage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={snap.stageARR} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" />
                  <XAxis dataKey="stage" stroke="hsl(215 20% 55%)" fontSize={10} />
                  <YAxis stroke="hsl(215 20% 55%)" fontSize={10} tickFormatter={fmtM} width={52} />
                  <Tooltip {...TIP} formatter={(v: number) => [fmtM(v)]} />
                  <Bar dataKey="totalARR" name="Total ARR"    fill="hsl(222 47% 25%)" radius={[3,3,0,0]} />
                  <Bar dataKey="weighted"  name="Weighted ARR" fill="hsl(187 85% 43%)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Quarterly Forecast Trend */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quarterly Forecast Trend</CardTitle>
            <CardDescription className="text-xs">Weighted ARR forecasted by close quarter</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={snap.quarterlyForecast}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" />
                  <XAxis dataKey="quarter" stroke="hsl(215 20% 55%)" fontSize={10} />
                  <YAxis stroke="hsl(215 20% 55%)" fontSize={10} tickFormatter={fmtM} width={52} />
                  <Tooltip {...TIP} formatter={(v: number) => [fmtM(v)]} />
                  <Line
                    type="monotone"
                    dataKey="forecastARR"
                    name="Forecast ARR"
                    stroke="hsl(187 85% 53%)"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "hsl(187 85% 53%)" }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="totalARR"
                    name="Total ARR (unweighted)"
                    stroke="hsl(222 47% 45%)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2: ARR by Type + Probability Distribution */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ARR by Account Type */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">ARR by Account Type</CardTitle>
            <CardDescription className="text-xs">Total pipeline ARR segmented by customer type</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={snap.typeARR} layout="vertical" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" horizontal={false} />
                  <XAxis type="number" stroke="hsl(215 20% 55%)" fontSize={10} tickFormatter={fmtM} />
                  <YAxis type="category" dataKey="type" stroke="hsl(215 20% 55%)" fontSize={10} width={72} />
                  <Tooltip {...TIP} formatter={(v: number) => [fmtM(v)]} />
                  <Bar dataKey="arr"      name="Total ARR"    fill="hsl(222 47% 30%)" radius={[0,3,3,0]} />
                  <Bar dataKey="weighted" name="Weighted ARR" fill="hsl(39 80% 50%)"  radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Deal Probability Distribution */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Deal Probability Distribution</CardTitle>
            <CardDescription className="text-xs">Account count and ARR by close probability bucket</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={snap.probabilityBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" />
                  <XAxis dataKey="bucket" stroke="hsl(215 20% 55%)" fontSize={10} />
                  <YAxis yAxisId="left"  stroke="hsl(215 20% 55%)" fontSize={10} />
                  <YAxis yAxisId="right" orientation="right" stroke="hsl(215 20% 55%)" fontSize={10} tickFormatter={fmtM} />
                  <Tooltip
                    {...TIP}
                    formatter={(v: number, name: string) =>
                      name === "Accounts" ? [v, name] : [fmtM(v), name]
                    }
                  />
                  <Bar yAxisId="left"  dataKey="count"    name="Accounts"  fill="hsl(260 60% 50%)" radius={[3,3,0,0]} />
                  <Bar yAxisId="right" dataKey="totalARR" name="Total ARR" fill="hsl(187 85% 43%)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
