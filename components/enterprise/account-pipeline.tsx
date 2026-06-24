"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  accounts,
  PIPELINE_STAGES,
  TYPE_BADGE,
  TYPE_LABEL,
  PRIORITY_COLOR,
  formatRevenue,
  type Account,
} from "@/lib/data/accounts";
import { scoreOpportunity } from "@/lib/services/account-intelligence.service";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AccountPipelineProps {
  selectedId:  string | null;
  onSelect:    (account: Account) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AccountPipeline({ selectedId, onSelect }: AccountPipelineProps) {
  const totalAccounts  = accounts.length;
  const totalMW        = accounts.reduce((s, a) => s + a.projectedGrowthMW, 0);
  const totalRevenue   = accounts.reduce((s, a) => s + a.estimatedRevenueUSD, 0);

  return (
    <div className="space-y-4">
      {/* Pipeline header */}
      <div className="flex flex-wrap items-center gap-6 text-[11px] text-muted-foreground">
        <span><span className="font-semibold text-foreground">{totalAccounts}</span> accounts</span>
        <span><span className="font-semibold text-cyan-400">{totalMW.toLocaleString()} MW</span> total pipeline</span>
        <span><span className="font-semibold text-primary">{formatRevenue(totalRevenue)}</span> total ARR opportunity</span>
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {PIPELINE_STAGES.map((stage) => {
          const stageAccounts = accounts.filter((a) => a.status === stage.id);
          const stageMW       = stageAccounts.reduce((s, a) => s + a.projectedGrowthMW, 0);
          const stageRevenue  = stageAccounts.reduce((s, a) => s + a.estimatedRevenueUSD, 0);

          return (
            <div key={stage.id} className="space-y-2">
              {/* Column header */}
              <div className={`rounded-lg border px-3 py-2 ${stage.color}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${stage.dotColor}`} />
                  <p className={`text-xs font-semibold ${stage.textColor}`}>{stage.label}</p>
                  <span className={`ml-auto rounded-full px-1.5 py-0.5 font-mono text-[10px] ${stage.color} ${stage.textColor}`}>
                    {stageAccounts.length}
                  </span>
                </div>
                {stageAccounts.length > 0 && (
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    {stageMW > 0 && `${stageMW} MW · `}{formatRevenue(stageRevenue)}
                  </p>
                )}
              </div>

              {/* Account cards */}
              <div className="space-y-2">
                {stageAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    isSelected={selectedId === account.id}
                    onClick={() => onSelect(account)}
                  />
                ))}
                {stageAccounts.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border/30 px-3 py-4 text-center text-[10px] text-muted-foreground/40">
                    No accounts
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────

function AccountCard({
  account,
  isSelected,
  onClick,
}: {
  account:    Account;
  isSelected: boolean;
  onClick:    () => void;
}) {
  const score = scoreOpportunity(account);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        isSelected
          ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
          : "border-border/40 bg-[#0d1219]/80 hover:border-border/60 hover:bg-white/[0.02]"
      }`}
    >
      {/* Name + type */}
      <p className="text-xs font-semibold leading-snug">{account.name}</p>
      <div className="mt-1">
        <Badge variant="outline" className={`text-[9px] ${TYPE_BADGE[account.type]}`}>
          {TYPE_LABEL[account.type]}
        </Badge>
      </div>

      {/* Metrics */}
      <div className="mt-2 space-y-1">
        {account.projectedGrowthMW > 0 && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">MW</span>
            <span className="font-mono font-semibold text-cyan-400">
              +{account.projectedGrowthMW.toLocaleString()} MW
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">ARR</span>
          <span className="font-mono font-semibold text-primary">
            {formatRevenue(account.estimatedRevenueUSD)}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">Score</span>
          <span className={`font-mono font-bold ${PRIORITY_COLOR[score.priority]}`}>
            {score.opportunityScore}
          </span>
        </div>
      </div>

      {/* Priority bar */}
      <div className="mt-2 h-0.5 w-full rounded-full bg-border/30">
        <div
          className={`h-0.5 rounded-full transition-all ${
            score.priority === "strategic" ? "bg-cyan-400" :
            score.priority === "high"     ? "bg-orange-400" :
            score.priority === "medium"   ? "bg-yellow-400" :
            "bg-slate-400"
          }`}
          style={{ width: `${score.opportunityScore}%` }}
        />
      </div>
    </button>
  );
}
