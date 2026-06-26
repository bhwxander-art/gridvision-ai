"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronUp,
  Server,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  runCopilot,
  type CopilotInput,
  type PlanningRecommendation,
  type RecommendationCategory,
  type UrgencyLevel,
} from "@/lib/copilot-engine";

// ── Urgency styling ───────────────────────────────────────────────────────────

const URGENCY_STYLE: Record<
  UrgencyLevel,
  { badge: string; border: string; dot: string; label: string }
> = {
  immediate: {
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    border: "border-red-500/25",
    dot: "bg-red-400",
    label: "Immediate",
  },
  "near-term": {
    badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    border: "border-yellow-500/25",
    dot: "bg-yellow-400",
    label: "Near-term",
  },
  "long-range": {
    badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    border: "border-cyan-500/25",
    dot: "bg-cyan-400",
    label: "Long-range",
  },
};

// ── Category icons ────────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<RecommendationCategory, React.ElementType> = {
  substation:     Zap,
  transformer:    Server,
  interconnection: Building2,
  forecast:       TrendingUp,
  system:         AlertTriangle,
};

const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  substation:     "Substation",
  transformer:    "Transformer",
  interconnection: "Interconnection",
  forecast:       "Forecast",
  system:         "System",
};

// ── Risk score display ────────────────────────────────────────────────────────

function riskScoreColor(score: number): string {
  if (score >= 70) return "text-red-400";
  if (score >= 40) return "text-yellow-400";
  return "text-emerald-400";
}

function riskScoreLabel(score: number): string {
  if (score >= 70) return "High";
  if (score >= 40) return "Elevated";
  if (score >= 20) return "Moderate";
  return "Low";
}

// ── AI Insights types ─────────────────────────────────────────────────────────

interface AiInsightsData {
  summary: string;
  planningNote: string;
  enrichedRecommendations: Array<{ id: string; narrative: string }>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SystemRiskStrip({
  score,
  immediateCount,
  nearTermCount,
  longRangeCount,
}: {
  score: number;
  immediateCount: number;
  nearTermCount: number;
  longRangeCount: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-border/40 bg-background/30 p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          System Risk
        </p>
        <p className={cn("mt-1 font-mono text-2xl font-semibold", riskScoreColor(score))}>
          {score}
          <span className="ml-1 text-sm font-normal">/100</span>
        </p>
        <p className={cn("text-[11px]", riskScoreColor(score))}>
          {riskScoreLabel(score)}
        </p>
      </div>

      {(
        [
          { urgency: "immediate" as UrgencyLevel, count: immediateCount },
          { urgency: "near-term" as UrgencyLevel, count: nearTermCount },
          { urgency: "long-range" as UrgencyLevel, count: longRangeCount },
        ] as const
      ).map(({ urgency, count }) => {
        const s = URGENCY_STYLE[urgency];
        return (
          <div
            key={urgency}
            className={cn(
              "rounded-lg border bg-background/30 p-3",
              s.border
            )}
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {s.label}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold">{count}</p>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
              {count === 1 ? "action" : "actions"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecommendationCard({
  rec,
  narrative,
}: {
  rec: PlanningRecommendation;
  narrative?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const urgStyle = URGENCY_STYLE[rec.urgency];
  const Icon = CATEGORY_ICON[rec.category];

  return (
    <div
      className={cn(
        "rounded-lg border bg-[#0d1219]/60 p-4 transition-colors",
        urgStyle.border
      )}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider",
                urgStyle.badge
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", urgStyle.dot)} />
              {urgStyle.label}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Icon className="h-3 w-3" />
              {CATEGORY_LABEL[rec.category]}
            </span>
          </div>
          <p className="text-sm font-medium leading-snug">{rec.title}</p>
        </div>

        {/* Risk reduction */}
        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-semibold text-emerald-400">
            -{rec.riskReductionPct}%
          </p>
          <p className="text-[10px] text-muted-foreground">risk reduction</p>
        </div>
      </div>

      {/* Affected assets */}
      {rec.affectedAssets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rec.affectedAssets.map((a) => (
            <span
              key={a}
              className="rounded border border-border/40 bg-background/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      {/* Rationale */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {rec.rationale}
      </p>

      {/* AI narrative */}
      {narrative && (
        <p className="mt-2 text-xs italic leading-relaxed text-primary/70">
          {narrative}
        </p>
      )}

      {/* Capex */}
      {rec.estimatedCapexM > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Estimated capex:{" "}
          <span className="font-mono text-foreground/70">
            ${rec.estimatedCapexM.toFixed(1)}M
          </span>
        </p>
      )}

      {/* Expandable actions */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <>
            <ChevronUp className="h-3 w-3" /> Hide actions
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" /> {rec.actions.length} recommended action{rec.actions.length !== 1 ? "s" : ""}
          </>
        )}
      </button>

      {expanded && (
        <ol className="mt-2 space-y-1.5 pl-4">
          {rec.actions.map((action, i) => (
            <li key={i} className="list-decimal text-xs text-muted-foreground">
              {action}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── AI Insights Panel ─────────────────────────────────────────────────────────

function AiInsightsPanel({ data }: { data: AiInsightsData }) {
  if (!data.summary && !data.planningNote) return null;

  return (
    <div className="space-y-3">
      {data.summary && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <CardTitle className="text-sm">AI Executive Summary</CardTitle>
              <span className="ml-auto text-[9px] text-muted-foreground">
                Powered by Claude
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {data.summary}
            </p>
          </CardContent>
        </Card>
      )}
      {data.planningNote && (
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Strategic Planning Note</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {data.planningNote}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AiInsightsSkeleton() {
  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" />
          Claude is analyzing your grid...
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-3 animate-pulse rounded bg-border/40" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-border/40" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function CopilotPanel(props: CopilotInput) {
  const report = useMemo(() => runCopilot(props), [props]);
  const [aiInsights, setAiInsights] = useState<AiInsightsData | null>(null);
  const [aiLoading, setAiLoading] = useState(true);

  useEffect(() => {
    const criticalCount = props.portfolio.filter((ss) => {
      const util = ss.peakLoadMW / ss.nameplateMVA;
      return util >= 0.95;
    }).length;
    const dcQueueMW = props.queue.reduce(
      (sum, dc) => (dc.status !== "energized" ? sum + dc.requestedMW : sum),
      0
    );

    fetch("/api/copilot/ai-insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recommendations: report.recommendations,
        systemRiskScore: report.systemRiskScore,
        portfolioSummary: {
          substationCount: props.portfolio.length,
          criticalCount,
          dcQueueMW,
        },
      }),
    })
      .then((r) => r.json())
      .then((data: AiInsightsData) => {
        setAiInsights(data);
      })
      .catch(() => {
        setAiInsights({ summary: "", planningNote: "", enrichedRecommendations: [] });
      })
      .finally(() => setAiLoading(false));
  }, [report, props.portfolio, props.queue]);

  const narrativeMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of aiInsights?.enrichedRecommendations ?? []) {
      m[e.id] = e.narrative;
    }
    return m;
  }, [aiInsights]);

  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle>AI Planning Recommendations</CardTitle>
            <Badge
              variant="outline"
              className="ml-auto border-border/40 text-[10px] text-muted-foreground"
            >
              Deterministic Rules Engine
            </Badge>
          </div>
          <CardDescription>
            {report.recommendations.length} recommendation
            {report.recommendations.length !== 1 ? "s" : ""} generated from substation
            assessments, transformer analysis, interconnection impacts, and load
            forecast trajectory. Generated{" "}
            {new Date(report.generatedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SystemRiskStrip
            score={report.systemRiskScore}
            immediateCount={report.immediateCount}
            nearTermCount={report.nearTermCount}
            longRangeCount={report.longRangeCount}
          />
        </CardContent>
      </Card>

      {/* AI Insights */}
      {aiLoading && <AiInsightsSkeleton />}
      {!aiLoading && aiInsights && (
        <AiInsightsPanel data={aiInsights} />
      )}

      {/* Recommendation list */}
      {report.recommendations.length === 0 ? (
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No planning actions identified under current data. Continue monitoring
            per DPU annual review cycle.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {report.recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              narrative={narrativeMap[rec.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
