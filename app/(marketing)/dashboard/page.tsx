"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Info,
  MapPin,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  calculateForecast,
  getRiskColor,
  type RiskLevel,
} from "@/lib/forecast";
import { defaultForecastInputs } from "@/lib/config";
import { formatMW, formatPercent } from "@/lib/utils";
import { useIsoLoad } from "@/lib/hooks/use-iso-load";
import { useIsoHistory } from "@/lib/hooks/use-iso-history";
import { useGridHealth } from "@/lib/hooks/use-grid-health";
import { generateAlerts, type GridAlert, type AlertSeverity } from "@/lib/alerts/grid-alerts";
import type { HealthStatus } from "@/lib/health/grid-health";

// ── Forecast helpers (unchanged) ───────────────────────────────────────────

function getRiskBadgeVariant(risk: RiskLevel): "success" | "warning" | "danger" {
  switch (risk) {
    case "LOW":   return "success";
    case "MEDIUM": return "warning";
    case "HIGH":   return "danger";
  }
}

function getRiskIcon(risk: RiskLevel) {
  switch (risk) {
    case "LOW":    return CheckCircle2;
    case "MEDIUM": return AlertTriangle;
    case "HIGH":   return AlertTriangle;
  }
}

// ── Alert helpers ──────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<AlertSeverity, { border: string; icon: string; badge: "danger" | "warning" | "secondary" }> = {
  critical: { border: "border-red-500/40 bg-red-500/5",  icon: "text-red-400",    badge: "danger" },
  warning:  { border: "border-yellow-500/40 bg-yellow-500/5", icon: "text-yellow-400", badge: "warning" },
  info:     { border: "border-blue-500/40 bg-blue-500/5", icon: "text-blue-400",   badge: "secondary" },
};

function AlertCard({ alert }: { alert: GridAlert }) {
  const s = SEVERITY_STYLES[alert.severity];
  const Icon = alert.severity === "info" ? Info : AlertTriangle;
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border p-4", s.border)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.icon)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold">{alert.title}</span>
          <Badge variant={s.badge} className="text-xs">
            {alert.severity.toUpperCase()}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {alert.message}
        </p>
      </div>
    </div>
  );
}

// ── System status ──────────────────────────────────────────────────────────

function getSystemStatus(
  error: Error | null,
  dataAgeMinutes: number | null
): "online" | "stale" | "offline" {
  if (error || dataAgeMinutes === null) return "offline";
  if (dataAgeMinutes < 180) return "online";   // < 3h = fresh EIA data
  return "stale";
}

const STATUS_STYLES = {
  online:  { dot: "bg-green-400",  text: "text-green-400",  label: "Online" },
  stale:   { dot: "bg-yellow-400", text: "text-yellow-400", label: "Stale" },
  offline: { dot: "bg-red-400",    text: "text-red-400",    label: "Offline" },
};

// ── Grid Health helpers ────────────────────────────────────────────────────

const HEALTH_STATUS_CONFIG: Record<
  HealthStatus,
  { label: string; emoji: string; scoreClass: string; badgeVariant: "success" | "warning" | "danger" }
> = {
  stable:   { label: "Stable",   emoji: "🟢", scoreClass: "text-green-400",  badgeVariant: "success" },
  elevated: { label: "Elevated", emoji: "🟡", scoreClass: "text-yellow-400", badgeVariant: "warning" },
  critical: { label: "Critical", emoji: "🔴", scoreClass: "text-red-400",    badgeVariant: "danger"  },
};

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  // ── Grid Monitor data ──────────────────────────────────────────────────
  const { data: liveLoad, loading: loadLoading, error: loadError } = useIsoLoad(60_000);
  const { readings, loading: histLoading } = useIsoHistory(24, 300_000);
  const { result: health, loading: healthLoading } = useGridHealth(120_000);

  const dataAgeMinutes = liveLoad
    ? (Date.now() - new Date(liveLoad.timestamp).getTime()) / 60_000
    : null;

  const systemStatus = getSystemStatus(loadError, dataAgeMinutes);
  const ss = STATUS_STYLES[systemStatus];

  const high24h = readings.length > 0 ? Math.max(...readings.map((r) => r.currentLoadMW)) : null;
  const low24h  = readings.length > 0 ? Math.min(...readings.map((r) => r.currentLoadMW)) : null;

  const alerts = useMemo(() => {
    const current = liveLoad
      ? { timestamp: liveLoad.timestamp, currentLoadMW: liveLoad.current_load_mw }
      : null;
    return generateAlerts(current, readings);
  }, [liveLoad, readings]);

  const topAlert = alerts[0] ?? null;

  const chartData = readings.map((r) => ({
    time: new Date(r.timestamp).toISOString().slice(11, 16), // "HH:MM" UTC
    mw: r.currentLoadMW,
  }));

  // ── Forecast state (unchanged) ─────────────────────────────────────────
  const [cityName, setCityName] = useState(defaultForecastInputs.cityName);
  const [currentPeakLoad, setCurrentPeakLoad] = useState(String(defaultForecastInputs.currentPeakLoad));
  const [populationGrowthRate, setPopulationGrowthRate] = useState(String(defaultForecastInputs.populationGrowthRate));
  const [evGrowthRate, setEvGrowthRate] = useState(String(defaultForecastInputs.evGrowthRate));
  const [dataCenterLoad, setDataCenterLoad] = useState(String(defaultForecastInputs.dataCenterLoad));

  const result = useMemo(() => {
    return calculateForecast({
      cityName,
      currentPeakLoad: parseFloat(currentPeakLoad) || 0,
      populationGrowthRate: parseFloat(populationGrowthRate) || 0,
      evGrowthRate: parseFloat(evGrowthRate) || 0,
      dataCenterLoad: parseFloat(dataCenterLoad) || 0,
    });
  }, [cityName, currentPeakLoad, populationGrowthRate, evGrowthRate, dataCenterLoad]);

  const RiskIcon = getRiskIcon(result.riskLevel);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 space-y-14">

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 1 — GRID MONITOR
          ════════════════════════════════════════════════════════════════════ */}
      <section>
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Grid Monitor</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              ISO New England · Real-Time System Load
            </p>
          </div>

          <div className="shrink-0 text-right text-xs text-muted-foreground space-y-1">
            <div className="flex items-center justify-end gap-1.5">
              <span className={cn("inline-block h-2 w-2 rounded-full", ss.dot)} />
              <span className={cn("font-semibold uppercase tracking-wide text-foreground text-sm", ss.text)}>
                {ss.label}
              </span>
            </div>
            {liveLoad ? (
              <>
                <div>
                  Source:&nbsp;
                  <span className="font-mono text-foreground">
                    {liveLoad.source.toUpperCase()}
                  </span>
                </div>
                <div>
                  Updated:&nbsp;
                  <span className="font-mono text-foreground">
                    {new Date(liveLoad.timestamp)
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 16)}{" "}
                    UTC
                  </span>
                </div>
              </>
            ) : loadLoading ? (
              <div>Loading…</div>
            ) : (
              <div className="text-red-400">
                {loadError?.message ?? "No data"}
              </div>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {/* Current Load */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardDescription>Current Load</CardDescription>
              <CardTitle className="font-mono text-3xl text-primary">
                {liveLoad
                  ? liveLoad.current_load_mw.toLocaleString()
                  : loadLoading
                  ? "…"
                  : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {liveLoad ? "MW · System-wide demand" : "MW · Awaiting sync"}
              </p>
            </CardContent>
          </Card>

          {/* 24h Peak */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardDescription>24-Hour Peak</CardDescription>
              <CardTitle className="font-mono text-2xl">
                {high24h ? high24h.toLocaleString() : histLoading ? "…" : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">MW · Max in window</p>
            </CardContent>
          </Card>

          {/* 24h Valley */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardDescription>24-Hour Valley</CardDescription>
              <CardTitle className="font-mono text-2xl">
                {low24h ? low24h.toLocaleString() : histLoading ? "…" : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">MW · Min in window</p>
            </CardContent>
          </Card>

          {/* Alert status */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardDescription>Alert Status</CardDescription>
              <div className="flex items-center gap-2 mt-1">
                {topAlert === null ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                    <span className="font-semibold text-green-400">Normal</span>
                  </>
                ) : topAlert.severity === "critical" ? (
                  <>
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                    <span className="font-semibold text-red-400">Critical</span>
                  </>
                ) : topAlert.severity === "warning" ? (
                  <>
                    <AlertTriangle className="h-5 w-5 text-yellow-400" />
                    <span className="font-semibold text-yellow-400">Warning</span>
                  </>
                ) : (
                  <>
                    <Info className="h-5 w-5 text-blue-400" />
                    <span className="font-semibold text-blue-400">Advisory</span>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {alerts.length === 0
                  ? "No active alerts"
                  : `${alerts.length} active alert${alerts.length > 1 ? "s" : ""}`}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Grid Health Score */}
        <Card className="border-border/60 mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Grid Health Score</CardTitle>
              {health && (
                <Badge variant={HEALTH_STATUS_CONFIG[health.status].badgeVariant}>
                  {HEALTH_STATUS_CONFIG[health.status].emoji}&nbsp;
                  {HEALTH_STATUS_CONFIG[health.status].label}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {healthLoading && !health ? (
              <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
                Computing…
              </div>
            ) : health ? (
              <div className="space-y-4">
                {/* Score + factors row */}
                <div className="grid grid-cols-[auto_1fr] gap-6 items-start">
                  {/* Score dial */}
                  <div className="flex flex-col items-center justify-center min-w-[80px]">
                    <span
                      className={cn(
                        "font-mono text-5xl font-bold leading-none",
                        HEALTH_STATUS_CONFIG[health.status].scoreClass
                      )}
                    >
                      {health.score}
                    </span>
                    <span className="mt-1 text-xs text-muted-foreground">/ 100</span>
                  </div>

                  {/* Factor bars */}
                  <div className="space-y-2.5">
                    {health.factors.map((f) => (
                      <div key={f.id}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground truncate">{f.label}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-xs text-foreground w-7 text-right">
                              {f.score}
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              f.score >= 70
                                ? "bg-green-400"
                                : f.score >= 40
                                ? "bg-yellow-400"
                                : "bg-red-400"
                            )}
                            style={{ width: `${f.score}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground/70 truncate">
                          {f.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recommendation */}
                <div className="flex items-start gap-2 rounded-md border border-border/40 bg-secondary/30 px-3 py-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {health.recommendation}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
                Health score unavailable — awaiting data sync
              </div>
            )}
          </CardContent>
        </Card>

        {/* 24-Hour Load Trend */}
        <Card className="border-border/60 mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              24-Hour Load Trend
            </CardTitle>
            <CardDescription>
              {readings.length > 0
                ? `${readings.length} hourly readings · UTC timestamps`
                : "No readings available — data sync required"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="loadFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="hsl(187 85% 53%)" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="hsl(187 85% 53%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(217 33% 14%)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="time"
                      stroke="hsl(215 20% 45%)"
                      fontSize={10}
                      interval={3}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="hsl(215 20% 45%)"
                      fontSize={10}
                      tickFormatter={(v: number) => `${Math.round(v / 1_000)}k`}
                      width={36}
                      tickLine={false}
                      axisLine={false}
                      domain={[
                        (min: number) => Math.floor((min * 0.97) / 1_000) * 1_000,
                        (max: number) => Math.ceil((max * 1.03) / 1_000) * 1_000,
                      ]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(222 47% 6%)",
                        border: "1px solid hsl(217 33% 18%)",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                      labelStyle={{ color: "hsl(210 40% 98%)", marginBottom: "2px" }}
                      formatter={(v: number) => [`${v.toLocaleString()} MW`, "Load"]}
                      labelFormatter={(label: string) => `${label} UTC`}
                    />
                    <Area
                      type="monotone"
                      dataKey="mw"
                      stroke="hsl(187 85% 53%)"
                      strokeWidth={1.5}
                      fill="url(#loadFill)"
                      dot={false}
                      activeDot={{ r: 3, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                {histLoading ? "Loading chart data…" : "No historical data available"}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Grid Alerts */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Zap className="h-4 w-4 text-primary" />
            AI Grid Alerts
          </h2>

          {loadLoading && readings.length === 0 ? (
            <div className="rounded-lg border border-border/40 p-4 text-sm text-muted-foreground">
              Evaluating conditions…
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-green-500/5 p-4">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />
              <span className="text-sm text-muted-foreground">
                All systems operating within normal parameters.
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <AlertCard key={alert.code} alert={alert} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border/30" />

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 2 — FORECAST DASHBOARD (unchanged)
          ════════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="mb-10">
          <h2 className="text-3xl font-bold tracking-tight">
            Forecast Dashboard
          </h2>
          <p className="mt-2 text-muted-foreground">
            Model future electrical load growth and receive risk assessments
            with capacity recommendations.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Inputs */}
          <Card className="border-border/60 lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-primary" />
                Forecast Inputs
              </CardTitle>
              <CardDescription>
                Configure parameters for your service territory
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="city">City Name</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="city"
                    value={cityName}
                    onChange={(e) => setCityName(e.target.value)}
                    className="pl-9"
                    placeholder="Boston"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="load">Current Peak Load (MW)</Label>
                <Input
                  id="load"
                  type="number"
                  min="0"
                  step="1"
                  value={currentPeakLoad}
                  onChange={(e) => setCurrentPeakLoad(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pop">Population Growth Rate (%)</Label>
                <Input
                  id="pop"
                  type="number"
                  min="0"
                  step="0.1"
                  value={populationGrowthRate}
                  onChange={(e) => setPopulationGrowthRate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ev">EV Growth Rate (%)</Label>
                <Input
                  id="ev"
                  type="number"
                  min="0"
                  step="0.1"
                  value={evGrowthRate}
                  onChange={(e) => setEvGrowthRate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dc">New Data Center Load (MW)</Label>
                <Input
                  id="dc"
                  type="number"
                  min="0"
                  step="1"
                  value={dataCenterLoad}
                  onChange={(e) => setDataCenterLoad(e.target.value)}
                />
              </div>

              <Button
                className="w-full"
                onClick={() => {
                  setCityName(defaultForecastInputs.cityName);
                  setCurrentPeakLoad(String(defaultForecastInputs.currentPeakLoad));
                  setPopulationGrowthRate(String(defaultForecastInputs.populationGrowthRate));
                  setEvGrowthRate(String(defaultForecastInputs.evGrowthRate));
                  setDataCenterLoad(String(defaultForecastInputs.dataCenterLoad));
                }}
                variant="outline"
              >
                Reset to Defaults
              </Button>
            </CardContent>
          </Card>

          {/* Outputs */}
          <div className="space-y-6 lg:col-span-3">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardDescription>Forecasted Load</CardDescription>
                  <CardTitle className="font-mono text-2xl text-primary">
                    {formatMW(result.futureLoad)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {cityName || "—"} · +{formatPercent(result.increasePercent)}{" "}
                    increase
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardDescription>Risk Level</CardDescription>
                  <div className="flex items-center gap-2">
                    <RiskIcon
                      className="h-5 w-5"
                      style={{ color: getRiskColor(result.riskLevel) }}
                    />
                    <Badge variant={getRiskBadgeVariant(result.riskLevel)}>
                      {result.riskLevel}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {result.riskLevel === "LOW" && "<10% load increase"}
                    {result.riskLevel === "MEDIUM" && "10–25% load increase"}
                    {result.riskLevel === "HIGH" && ">25% load increase"}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardDescription>Current Baseline</CardDescription>
                  <CardTitle className="font-mono text-2xl">
                    {formatMW(parseFloat(currentPeakLoad) || 0)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Peak demand today
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Activity className="h-5 w-5 text-primary" />
                  Load Contribution Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { label: "Population Growth", value: result.populationContribution, color: "bg-chart-3" },
                    { label: "EV Adoption",        value: result.evContribution,         color: "bg-chart-1" },
                    { label: "Data Centers",       value: result.dataCenterContribution, color: "bg-chart-2" },
                  ].map((item) => {
                    const total =
                      result.populationContribution +
                      result.evContribution +
                      result.dataCenterContribution;
                    const pct = total > 0 ? (item.value / total) * 100 : 0;
                    return (
                      <div key={item.label}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span>{item.label}</span>
                          <span className="font-mono text-muted-foreground">
                            {formatMW(item.value)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full ${item.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card
              className="border-border/60"
              style={{ borderColor: `${getRiskColor(result.riskLevel)}33` }}
            >
              <CardHeader>
                <CardTitle className="text-lg">Capacity Recommendation</CardTitle>
                <CardDescription>
                  Based on {result.riskLevel} risk classification
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {result.capacityRecommendation}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
