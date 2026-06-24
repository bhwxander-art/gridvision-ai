"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Info, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  CapacityImpactResponse,
  CopilotRiskLevel,
} from "@/app/api/copilot/capacity-impact/route";

// ── Risk level styling ────────────────────────────────────────────────────────

const RISK_STYLE: Record<
  CopilotRiskLevel,
  { badge: string; icon: React.ElementType; label: string; bar: string }
> = {
  LOW: {
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon:  CheckCircle,
    label: "Low",
    bar:   "bg-emerald-500",
  },
  MEDIUM: {
    badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    icon:  Info,
    label: "Medium",
    bar:   "bg-yellow-500",
  },
  HIGH: {
    badge: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    icon:  AlertTriangle,
    label: "High",
    bar:   "bg-orange-500",
  },
  CRITICAL: {
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    icon:  Zap,
    label: "Critical",
    bar:   "bg-red-500",
  },
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface CapacityCopilotProps {
  addedMW: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CapacityCopilot({ addedMW }: CapacityCopilotProps) {
  const [data, setData] = useState<CapacityImpactResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // Debounce: wait 400 ms after last addedMW change before firing
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);

      fetch("/api/copilot/capacity-impact", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ addedMW }),
        signal:  controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              (body as { error?: string }).error ?? `API returned ${res.status}`
            );
          }
          return res.json() as Promise<CapacityImpactResponse>;
        })
        .then((d) => {
          setData(d);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [addedMW]);

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <CardTitle>AI Capacity Copilot</CardTitle>
        </div>
        <CardDescription>
          Plain-English capacity impact analysis · +{addedMW.toLocaleString()} MW scenario
        </CardDescription>
      </CardHeader>

      <CardContent>
        {loading && <CopilotSkeleton />}

        {!loading && error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && data && <CopilotBody data={data} />}
      </CardContent>
    </Card>
  );
}

// ── Body ──────────────────────────────────────────────────────────────────────

function CopilotBody({ data }: { data: CapacityImpactResponse }) {
  const style = RISK_STYLE[data.riskLevel];
  const RiskIcon = style.icon;

  return (
    <div className="space-y-5">
      {/* ── Risk level ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Badge
          variant="outline"
          className={`flex items-center gap-1.5 text-xs font-semibold ${style.badge}`}
        >
          <RiskIcon className="h-3 w-3" />
          Risk Level: {style.label}
        </Badge>

        {/* Compact utilization delta strip */}
        <div className="flex flex-1 items-center gap-2 text-[10px] text-muted-foreground">
          <span className="shrink-0">
            {data._meta.baseUtilizationPct}%
          </span>
          <div className="relative flex-1 h-1.5 rounded-full bg-border/40">
            {/* Baseline fill */}
            <div
              className="absolute left-0 top-0 h-1.5 rounded-full bg-border/60"
              style={{ width: `${Math.min(data._meta.baseUtilizationPct, 100)}%` }}
            />
            {/* Projected fill */}
            <div
              className={`absolute left-0 top-0 h-1.5 rounded-full transition-all duration-300 ${style.bar}`}
              style={{ width: `${Math.min(data._meta.projectedUtilizationPct, 100)}%` }}
            />
          </div>
          <span className={`shrink-0 font-semibold ${
            data.riskLevel === "CRITICAL" ? "text-red-400" :
            data.riskLevel === "HIGH"     ? "text-orange-400" :
            data.riskLevel === "MEDIUM"   ? "text-yellow-400" :
                                             "text-emerald-400"
          }`}>
            {data._meta.projectedUtilizationPct}%
          </span>
        </div>
      </div>

      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      <p className="text-sm leading-relaxed text-muted-foreground">
        {data.summary}
      </p>

      {/* ── Most Affected Substations ────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Most Affected Substations
        </p>
        <div className="space-y-1.5">
          {data.mostAffectedSubstations.map((ss, i) => (
            <div
              key={ss.name}
              className="flex items-center justify-between rounded-md border border-border/30 bg-background/30 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground/60">
                  #{i + 1}
                </span>
                <span>{ss.name}</span>
              </div>
              <span className="font-mono text-xs text-cyan-400">
                +{ss.addedMW.toLocaleString()} MW
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Recommended Actions ──────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Recommended Actions
        </p>
        <ul className="space-y-2">
          {data.recommendedActions.map((action, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.bar}`}
              />
              <span className="text-muted-foreground">{action}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <p className="text-[10px] text-muted-foreground/50">
        Headroom after simulation:{" "}
        <span className={data._meta.remainingHeadroomMW < 0 ? "text-red-400" : ""}>
          {data._meta.remainingHeadroomMW < 0 ? "−" : ""}
          {Math.abs(data._meta.remainingHeadroomMW).toLocaleString()} MW
        </span>{" "}
        · Analysis uses live Eastern MA capacity data
      </p>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function CopilotSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-5 w-32 rounded bg-border/40" />
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-border/40" />
        <div className="h-3 w-5/6 rounded bg-border/40" />
        <div className="h-3 w-4/6 rounded bg-border/40" />
      </div>
      <div className="space-y-1.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-9 rounded-md bg-border/30" />
        ))}
      </div>
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-4 w-4/5 rounded bg-border/30" />
        ))}
      </div>
    </div>
  );
}
