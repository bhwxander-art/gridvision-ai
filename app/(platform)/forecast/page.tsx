"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useIsoLoad } from "@/lib/hooks/use-iso-load";
import { useIsoForecastCurrent } from "@/lib/hooks/use-iso-forecast";
import { ForecastAccuracyPanel } from "@/components/enterprise/forecast-accuracy-panel";

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardContent className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {loading ? (
          <div className="mt-1 h-8 w-28 animate-pulse rounded bg-border/30" />
        ) : (
          <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
        )}
        {sub && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Hour label helper ─────────────────────────────────────────────────────────

function formatHour(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
    timeZone: "America/New_York",
  });
}

function formatDay(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "America/New_York",
  });
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  const { data: loadData } = useIsoLoad(60_000);
  const { data: forecastData, loading: forecastLoading, error: forecastError, refetch } =
    useIsoForecastCurrent();

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState(false);

  // Derived KPIs
  const currentLoadMW = forecastData?.currentLoadMW ?? loadData?.current_load_mw ?? null;

  const peak24h = useMemo(() => {
    if (!forecastData?.forecasts.length) return null;
    const now = Date.now();
    const next24h = forecastData.forecasts.filter(
      (f) => new Date(f.forecastFor).getTime() > now
    );
    if (!next24h.length) return null;
    return Math.max(...next24h.map((f) => f.predictedLoadMW));
  }, [forecastData]);

  const day7Forecast = useMemo(() => {
    if (!forecastData?.forecasts.length) return null;
    const last = forecastData.forecasts[forecastData.forecasts.length - 1];
    return last?.predictedLoadMW ?? null;
  }, [forecastData]);

  // 24h chart data
  const chartData24h = useMemo(() => {
    if (!forecastData?.forecasts.length) return [];
    return forecastData.forecasts.map((f) => ({
      label: formatHour(f.forecastFor),
      predicted: f.predictedLoadMW,
      confidenceLow: f.confidenceLowMW,
      confidenceHigh: f.confidenceHighMW,
      actual: f.actualLoadMW,
    }));
  }, [forecastData]);

  // 7-day outlook: aggregate by day
  const chartData7d = useMemo(() => {
    if (!forecastData?.forecasts.length) return [];
    const dayMap = new Map<string, number[]>();
    for (const f of forecastData.forecasts) {
      const day = formatDay(f.forecastFor);
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day)!.push(f.predictedLoadMW);
    }
    return Array.from(dayMap.entries()).map(([day, values]) => ({
      day,
      peakMW: Math.max(...values),
    }));
  }, [forecastData]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    setGenerateSuccess(false);
    try {
      const res = await fetch("/api/forecast/generate", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setGenerateSuccess(true);
      refetch();
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const hasForecasts = (forecastData?.forecasts.length ?? 0) > 0;
  const generatedAt = forecastData?.generatedAt;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ISO-NE Load Forecast</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Statistical load prediction for ISO New England · Weighted hour-of-day model ·
            Updated every 24 hours
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Button
            onClick={handleGenerate}
            disabled={generating}
            size="sm"
            variant="outline"
            className="border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
          >
            {generating ? "Generating…" : "Generate Forecast"}
          </Button>
          {generateSuccess && (
            <p className="text-xs text-emerald-400">Forecast generated successfully.</p>
          )}
          {generateError && (
            <p className="text-xs text-red-400">{generateError}</p>
          )}
        </div>
      </div>

      {/* Freshness / status bar */}
      <div className="rounded-lg border border-border/40 bg-[#0d1219]/60 px-4 py-2.5">
        {forecastLoading ? (
          <div className="h-4 w-48 animate-pulse rounded bg-border/30" />
        ) : generatedAt ? (
          <p className="text-xs text-muted-foreground">
            Last generated:{" "}
            <span className="text-foreground/80">
              {new Date(generatedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </span>{" "}
            · Model: <span className="font-mono text-cyan-400/80">{forecastData?.modelType}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No forecast data in database.{" "}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
            >
              {generating ? "Generating…" : "Generate now"}
            </button>
          </p>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Current Load"
          value={currentLoadMW != null ? `${currentLoadMW.toLocaleString()} MW` : "—"}
          sub="ISO-NE system load"
          loading={forecastLoading && currentLoadMW == null}
        />
        <KpiCard
          label="24h Forecast Peak"
          value={peak24h != null ? `${peak24h.toLocaleString()} MW` : "—"}
          sub="Max predicted next 24h"
          loading={forecastLoading}
        />
        <KpiCard
          label="7-Day Outlook"
          value={day7Forecast != null ? `${day7Forecast.toLocaleString()} MW` : "—"}
          sub="End-of-horizon prediction"
          loading={forecastLoading}
        />
        <KpiCard
          label="Model"
          value="WH-OD 1.0"
          sub="Weighted hour-of-day"
        />
      </div>

      {/* 24-Hour Forecast Chart */}
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle>24-Hour Load Forecast</CardTitle>
          <CardDescription>
            Predicted load with 90% confidence band vs actual readings (MW)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {forecastLoading ? (
            <div className="h-64 animate-pulse rounded-lg bg-border/20" />
          ) : forecastError ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              Unable to load forecast data.
            </div>
          ) : !hasForecasts ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>No forecast data. Click &quot;Generate Forecast&quot; to compute predictions.</p>
              <Button
                onClick={handleGenerate}
                disabled={generating}
                size="sm"
                variant="outline"
              >
                {generating ? "Generating…" : "Generate Forecast"}
              </Button>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData24h}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0d1219",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(value: number, name: string) => [
                    `${value.toLocaleString()} MW`,
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {/* Confidence band (area between low and high) */}
                <Area
                  type="monotone"
                  dataKey="confidenceHigh"
                  name="Confidence High"
                  stroke="none"
                  fill="rgba(34,211,238,0.08)"
                  legendType="none"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="confidenceLow"
                  name="Confidence Low"
                  stroke="none"
                  fill="#0d1219"
                  legendType="none"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  name="Predicted (MW)"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual (MW)"
                  stroke="rgba(255,255,255,0.6)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 7-Day Outlook Chart */}
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle>7-Day Peak Outlook</CardTitle>
          <CardDescription>Daily forecast peak load (MW)</CardDescription>
        </CardHeader>
        <CardContent>
          {forecastLoading ? (
            <div className="h-48 animate-pulse rounded-lg bg-border/20" />
          ) : !hasForecasts || chartData7d.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              No forecast data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData7d}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "rgba(255,255,255,0.4)" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0d1219",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(value: number) => [`${value.toLocaleString()} MW`, "Peak Forecast"]}
                />
                <Bar dataKey="peakMW" name="Peak Forecast (MW)" fill="rgba(34,211,238,0.7)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Accuracy section */}
      <div>
        <h2 className="mb-3 text-base font-semibold">Forecast Accuracy</h2>
        <ForecastAccuracyPanel />
      </div>
    </div>
  );
}
