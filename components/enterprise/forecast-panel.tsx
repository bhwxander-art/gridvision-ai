"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ForecastResult, ForecastRiskLevel } from "@/lib/forecast-engine";

// ── Risk styling ──────────────────────────────────────────────────────────────

const RISK_STYLES: Record<
  ForecastRiskLevel,
  { label: string; badge: string; border: string; dot: string }
> = {
  normal: {
    label: "Normal",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    border: "border-emerald-500/20",
    dot: "bg-emerald-400",
  },
  watch: {
    label: "Watch",
    badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    border: "border-cyan-500/20",
    dot: "bg-cyan-400",
  },
  constrained: {
    label: "Constrained",
    badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    border: "border-yellow-500/20",
    dot: "bg-yellow-400",
  },
  critical: {
    label: "Critical",
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    border: "border-red-500/20",
    dot: "bg-red-400",
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: string }) {
  const style = RISK_STYLES[level as ForecastRiskLevel] ?? RISK_STYLES.normal;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-widest ${style.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function UtilizationBar({
  pct,
  level,
}: {
  pct: number;
  level: string;
}) {
  const style = RISK_STYLES[level as ForecastRiskLevel] ?? RISK_STYLES.normal;
  const clamped = Math.min(pct, 100);
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
      <div
        className={`h-full rounded-full ${style.dot}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function HorizonCard({
  years,
  targetYear,
  projectedLoadMW,
  utilizationPct,
  risk,
  currentLoadMW,
}: {
  years: number;
  targetYear: number;
  projectedLoadMW: number;
  utilizationPct: number;
  risk: string;
  currentLoadMW: number;
}) {
  const style = RISK_STYLES[risk as ForecastRiskLevel] ?? RISK_STYLES.normal;
  const deltaLoadMW = projectedLoadMW - currentLoadMW;

  return (
    <div
      className={`rounded-lg border bg-[#0d1219]/80 p-4 ${style.border}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {years}-Year Horizon
          </p>
          <p className="text-xs text-muted-foreground">{targetYear}</p>
        </div>
        <RiskBadge level={risk} />
      </div>

      <p className="font-mono text-2xl font-semibold">
        {projectedLoadMW.toLocaleString()}{" "}
        <span className="text-sm font-normal text-muted-foreground">MW</span>
      </p>

      <p className="mt-0.5 text-xs text-muted-foreground">
        +{deltaLoadMW.toLocaleString()} MW from current
      </p>

      <UtilizationBar pct={utilizationPct} level={risk} />

      <p className="mt-1.5 text-right font-mono text-sm text-muted-foreground">
        {utilizationPct.toFixed(1)}% utilized
      </p>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface ForecastPanelProps {
  data: ForecastResult;
}

export function ForecastPanel({ data }: ForecastPanelProps) {
  const {
    horizonYears,
    projectedLoadMW,
    utilizationPct,
    riskLevel,
    baseYear,
    currentLoadMW,
    systemCapacityMW,
    compositeGrowthPct,
  } = data;

  const assumptions = [
    { label: "Base year", value: String(baseYear) },
    { label: "Current system peak", value: `${currentLoadMW.toLocaleString()} MW` },
    { label: "Installed capacity", value: `${systemCapacityMW.toLocaleString()} MW` },
    { label: "Composite growth rate", value: `${compositeGrowthPct.toFixed(1)}%/yr` },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle>System Load Forecast</CardTitle>
          <CardDescription>
            Deterministic 3-horizon projection — compound organic growth + data
            center queue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {horizonYears.map((years, i) => (
              <HorizonCard
                key={years}
                years={years}
                targetYear={baseYear + years}
                projectedLoadMW={projectedLoadMW[i]}
                utilizationPct={utilizationPct[i]}
                risk={riskLevel[i]}
                currentLoadMW={currentLoadMW}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-base">Model Assumptions</CardTitle>
          <CardDescription>
            EV 15% weight · Population 40% weight · Commercial 45% weight
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {assumptions.map((a) => (
              <div
                key={a.label}
                className="rounded-lg border border-border/30 bg-background/30 p-3"
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {a.label}
                </p>
                <p className="mt-1 font-mono text-sm">{a.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
