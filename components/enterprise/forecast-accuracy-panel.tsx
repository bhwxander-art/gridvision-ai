"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useForecastAccuracy } from "@/lib/hooks/use-forecast-accuracy";

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardContent className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
        {sub && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function ForecastUnavailable({ reason, recordCount }: { reason: string; recordCount: number }) {
  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Forecast Accuracy</CardTitle>
        <CardDescription>{reason}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border/40 bg-background/30 px-6 py-10 text-center">
          <p className="text-sm font-medium">Forecast tracking not yet active</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Once real forecast data is ingested, accuracy metrics will appear here.
            Currently tracking: {recordCount.toLocaleString()} actual readings.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ForecastAccuracyPanel() {
  const { data, loading, error } = useForecastAccuracy();

  if (loading) {
    return (
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle>Forecast Accuracy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-40 animate-pulse rounded-lg bg-border/20" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Unable to load forecast accuracy data.
        </CardContent>
      </Card>
    );
  }

  if (!data.available) {
    return <ForecastUnavailable reason={data.reason} recordCount={data.recordCount} />;
  }

  const chartData = data.records.map((r) => ({
    date: new Date(r.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    actual: Math.round(r.actualMW),
    forecast: Math.round(r.forecastMW),
    errorPct: Math.round(r.errorPct * 10) / 10,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="MAPE"
          value={`${data.mape.toFixed(2)}%`}
          sub="Mean Absolute Percentage Error"
        />
        <KpiCard
          label="RMSE"
          value={`${data.rmse.toFixed(1)} MW`}
          sub="Root Mean Square Error"
        />
        <KpiCard
          label="Accuracy"
          value={`${data.accuracyPct.toFixed(1)}%`}
          sub="100 - MAPE"
        />
        <KpiCard
          label="Records"
          value={data.recordCount.toLocaleString()}
          sub="Last 30 days with forecast"
        />
      </div>

      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle>Forecast vs Actual Load</CardTitle>
          <CardDescription>Last 30 days — MW</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} />
              <Tooltip
                contentStyle={{
                  background: "#0d1219",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  fontSize: 11,
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual (MW)"
                stroke="#22d3ee"
                dot={false}
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast (MW)"
                stroke="rgba(255,255,255,0.3)"
                strokeDasharray="4 2"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-sm">Accuracy Records</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Date</th>
                  <th className="pb-2 text-right font-medium">Actual (MW)</th>
                  <th className="pb-2 text-right font-medium">Forecast (MW)</th>
                  <th className="pb-2 text-right font-medium">Error %</th>
                </tr>
              </thead>
              <tbody>
                {chartData.slice(0, 50).map((row, i) => (
                  <tr key={i} className="border-b border-border/20 hover:bg-white/2">
                    <td className="py-1.5 text-muted-foreground">{row.date}</td>
                    <td className="py-1.5 text-right font-mono">
                      {row.actual.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">
                      {row.forecast.toLocaleString()}
                    </td>
                    <td
                      className={`py-1.5 text-right font-mono ${
                        row.errorPct > 5
                          ? "text-red-400"
                          : row.errorPct > 2
                          ? "text-yellow-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {row.errorPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
