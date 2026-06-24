"use client";

import { useMemo } from "react";
import { AlertTriangle, Zap } from "lucide-react";
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
  formatRevenue,
} from "@/lib/data/accounts";
import {
  buildRevenueSnapshot,
  type AtRiskDeal,
} from "@/lib/services/revenue-forecast.service";

// ── Component ─────────────────────────────────────────────────────────────────

export function DealRiskPanel() {
  const snap = useMemo(() => buildRevenueSnapshot(), []);
  const { atRiskDeals } = snap;

  // Capacity-blocked accounts (separate section)
  const capacityBlocked = useMemo(
    () =>
      snap.topRevenueAccounts
        .filter((a) => a.capacityRequiredMW >= 150 && a.status !== "won")
        .slice(0, 3),
    [snap]
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* At-risk deals */}
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-400" />
            <CardTitle className="text-base">At-Risk Opportunities</CardTitle>
          </div>
          <CardDescription>
            {atRiskDeals.length} deal{atRiskDeals.length !== 1 ? "s" : ""} flagged · probability
            decline, overdue dates, multiple blockers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {atRiskDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No at-risk deals identified.</p>
          ) : (
            <div className="space-y-3">
              {atRiskDeals.map((deal) => (
                <RiskCard key={deal.account.id} deal={deal} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capacity bottlenecks */}
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            <CardTitle className="text-base">Capacity Bottlenecks</CardTitle>
          </div>
          <CardDescription>
            Deals blocked by grid constraints — hosting capacity must be confirmed to advance
          </CardDescription>
        </CardHeader>
        <CardContent>
          {capacityBlocked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No capacity bottlenecks.</p>
          ) : (
            <div className="space-y-3">
              {capacityBlocked.map((deal) => {
                const stage = PIPELINE_STAGES.find((s) => s.id === deal.status);
                return (
                  <div
                    key={deal.id}
                    className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{deal.name}</p>
                        <p className="text-[10px] text-muted-foreground">{deal.territory}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className={`text-[9px] ${TYPE_BADGE[deal.type]}`}>
                          {TYPE_LABEL[deal.type]}
                        </Badge>
                        {stage && (
                          <Badge variant="outline" className={`text-[9px] ${stage.color} ${stage.textColor}`}>
                            {stage.label}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Capacity requirement */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Capacity Required</span>
                      <span className="font-mono font-bold text-yellow-400">
                        {deal.capacityRequiredMW.toLocaleString()} MW
                      </span>
                    </div>

                    {/* ARR at stake */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">ARR at Stake</span>
                      <span className="font-mono font-semibold text-primary">
                        {formatRevenue(deal.estimatedARR)}
                      </span>
                    </div>

                    {/* Primary blocker */}
                    {deal.blockers[0] && (
                      <p className="text-[11px] text-yellow-300/80">
                        <span className="font-medium">Blocker:</span> {deal.blockers[0]}
                      </p>
                    )}

                    {/* Capacity bar */}
                    <div>
                      <div className="mb-0.5 flex justify-between text-[9px] text-muted-foreground">
                        <span>MW Required vs 6,500 MW territory capacity</span>
                        <span>{((deal.capacityRequiredMW / 6_500) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-border/30">
                        <div
                          className="h-1 rounded-full bg-yellow-400"
                          style={{ width: `${Math.min((deal.capacityRequiredMW / 6_500) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-md border border-border/20 bg-background/10 p-2.5 text-[10px] text-muted-foreground">
                Combined capacity requirement:{" "}
                <span className="font-mono font-semibold text-yellow-400">
                  {capacityBlocked.reduce((s, d) => s + d.capacityRequiredMW, 0).toLocaleString()} MW
                </span>{" "}
                · ARR at risk:{" "}
                <span className="font-mono font-semibold text-primary">
                  {formatRevenue(capacityBlocked.reduce((s, d) => s + d.estimatedARR, 0))}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Risk card ─────────────────────────────────────────────────────────────────

function RiskCard({ deal }: { deal: AtRiskDeal }) {
  const { account, weightedARR, riskReason, recommendation } = deal;
  const stage = PIPELINE_STAGES.find((s) => s.id === account.status);

  const probColor =
    account.dealProbability < 20
      ? "text-red-400"
      : account.dealProbability < 40
      ? "text-orange-400"
      : "text-yellow-400";

  return (
    <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{account.name}</p>
          <p className="text-[10px] text-muted-foreground">{account.contactName} · {account.contactTitle}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="outline" className={`text-[9px] ${TYPE_BADGE[account.type]}`}>
            {TYPE_LABEL[account.type]}
          </Badge>
          {stage && (
            <Badge variant="outline" className={`text-[9px] ${stage.color} ${stage.textColor}`}>
              {stage.label}
            </Badge>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[9px] text-muted-foreground">ARR</p>
          <p className="font-mono text-xs font-semibold">{formatRevenue(account.estimatedARR)}</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground">Weighted</p>
          <p className="font-mono text-xs font-semibold">{formatRevenue(weightedARR)}</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground">Probability</p>
          <p className={`font-mono text-xs font-bold ${probColor}`}>{account.dealProbability}%</p>
        </div>
      </div>

      {/* Risk reasons */}
      <div>
        {riskReason.map((r) => (
          <p key={r} className="flex items-center gap-1.5 text-[11px] text-orange-300/80">
            <span className="h-1 w-1 rounded-full bg-orange-400 shrink-0" />
            {r}
          </p>
        ))}
      </div>

      {/* Recommendation */}
      <p className="rounded-md border border-border/20 bg-background/20 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Action: </span>
        {recommendation}
      </p>
    </div>
  );
}
