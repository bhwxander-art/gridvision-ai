"use client";

import {
  Activity,
  Building2,
  CircleDollarSign,
  MapPin,
  ShieldAlert,
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
import {
  TYPE_BADGE,
  TYPE_LABEL,
  PIPELINE_STAGES,
  PRIORITY_COLOR,
  formatRevenue,
  type Account,
} from "@/lib/data/accounts";
import type { OpportunityScore } from "@/lib/services/account-intelligence.service";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AccountDetailPanelProps {
  account: Account;
  score:   OpportunityScore;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AccountDetailPanel({ account, score }: AccountDetailPanelProps) {
  const stage    = PIPELINE_STAGES.find((s) => s.id === account.status);
  const riskColor =
    account.riskRating === "high"   ? "text-red-400" :
    account.riskRating === "medium" ? "text-orange-400" :
    "text-emerald-400";

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        {/* Name + badges */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{account.name}</CardTitle>
            <CardDescription className="mt-0.5">
              {account.contactName} · {account.contactTitle}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={`text-xs ${TYPE_BADGE[account.type]}`}>
              {TYPE_LABEL[account.type]}
            </Badge>
            {stage && (
              <Badge variant="outline" className={`text-xs ${stage.color} ${stage.textColor}`}>
                {stage.label}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-xs font-semibold ${PRIORITY_COLOR[score.priority]} border-current/30 bg-current/5`}
            >
              {score.priority.toUpperCase()}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* KPI metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Current Load"
            value={account.annualLoadMW > 0 ? `${account.annualLoadMW.toLocaleString()} MW` : "—"}
            icon={<Activity className="h-3.5 w-3.5 text-cyan-400" />}
          />
          <MetricCard
            label="Projected Growth"
            value={account.projectedGrowthMW > 0 ? `+${account.projectedGrowthMW.toLocaleString()} MW` : "—"}
            icon={<TrendingUp className="h-3.5 w-3.5 text-orange-400" />}
            accent="text-orange-400"
          />
          <MetricCard
            label="Estimated ARR"
            value={formatRevenue(account.estimatedRevenueUSD)}
            icon={<CircleDollarSign className="h-3.5 w-3.5 text-primary" />}
            accent="text-primary"
          />
          <MetricCard
            label="Risk Rating"
            value={account.riskRating.toUpperCase()}
            icon={<ShieldAlert className={`h-3.5 w-3.5 ${riskColor}`} />}
            accent={riskColor}
          />
        </div>

        {/* Opportunity score */}
        <div className="rounded-lg border border-border/30 bg-background/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Opportunity Score
            </p>
            <span className={`font-mono text-lg font-bold ${PRIORITY_COLOR[score.priority]}`}>
              {score.opportunityScore}<span className="text-xs text-muted-foreground">/100</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-border/30">
            <div
              className={`h-2 rounded-full transition-all ${
                score.priority === "strategic" ? "bg-cyan-400" :
                score.priority === "high"     ? "bg-orange-400" :
                score.priority === "medium"   ? "bg-yellow-400" :
                "bg-slate-400"
              }`}
              style={{ width: `${score.opportunityScore}%` }}
            />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-[9px] text-muted-foreground">
            <ScoreBar label="Growth MW" value={score.breakdown.growthMW} max={40} />
            <ScoreBar label="Revenue"   value={score.breakdown.revenue}   max={30} />
            <ScoreBar label="Strategic" value={score.breakdown.strategic} max={20} />
            <ScoreBar label="Pipeline"  value={score.breakdown.pipeline}  max={10} />
          </div>
        </div>

        {/* Territory + contact */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/30 bg-background/20 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <MapPin className="h-3 w-3 text-muted-foreground" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Territory</p>
            </div>
            <p className="text-sm">{account.territory}</p>
          </div>
          <div className="rounded-lg border border-border/30 bg-background/20 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Contact</p>
            </div>
            <p className="text-sm font-medium">{account.contactName}</p>
            <p className="text-[10px] text-muted-foreground">{account.contactTitle}</p>
          </div>
        </div>

        {/* Active projects */}
        {account.activeProjects.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Active Projects</p>
            </div>
            <div className="space-y-1.5">
              {account.activeProjects.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-2 rounded-md border border-border/30 bg-background/20 px-3 py-2 text-xs"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  {p}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="rounded-lg border border-border/30 bg-background/20 p-3">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Notes</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{account.notes}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({
  label, value, icon, accent = "text-foreground",
}: {
  label:   string;
  value:   string;
  icon:    React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/20 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className={`font-mono text-sm font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function ScoreBar({
  label, value, max,
}: {
  label: string;
  value: number;
  max:   number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono">{value}/{max}</span>
      </div>
      <div className="h-0.5 w-full rounded-full bg-border/30">
        <div
          className="h-0.5 rounded-full bg-primary/60"
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );
}
