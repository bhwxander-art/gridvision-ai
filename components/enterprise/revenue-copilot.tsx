"use client";

import { useMemo } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRevenue } from "@/lib/data/accounts";
import {
  buildRevenueSnapshot,
  generateRevenueQA,
} from "@/lib/services/revenue-forecast.service";
import { useAccounts } from "@/lib/hooks/use-accounts";

export function RevenueCopilot() {
  const { accounts } = useAccounts();
  const snap = useMemo(() => buildRevenueSnapshot(accounts), [accounts]);
  const qa   = useMemo(() => generateRevenueQA(snap), [snap]);

  const coverageColor =
    snap.pipelineCoverage >= 0.8
      ? "text-emerald-400"
      : snap.pipelineCoverage >= 0.5
      ? "text-yellow-400"
      : "text-red-400";

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <CardTitle>Revenue Intelligence Copilot</CardTitle>
        </div>
        <CardDescription>
          Executive-level deal analysis · deterministic · no external APIs
        </CardDescription>

        {/* Summary stats row */}
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <span className="text-muted-foreground">
            Weighted pipeline:{" "}
            <span className="font-mono font-semibold text-cyan-400">
              {formatRevenue(snap.weightedPipelineARR)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Q3 forecast:{" "}
            <span className="font-mono font-semibold text-orange-400">
              {formatRevenue(snap.forecastARR)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Coverage:{" "}
            <span className={`font-mono font-semibold ${coverageColor}`}>
              {(snap.pipelineCoverage * 100).toFixed(0)}%
            </span>
          </span>
          <span className="text-muted-foreground">
            At-risk deals:{" "}
            <span className="font-mono font-semibold text-orange-400">
              {snap.atRiskDeals.length}
            </span>
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-5">
          {qa.map(({ question, answer }) => (
            <div key={question} className="space-y-1.5">
              <div className="flex items-start gap-1.5">
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                <p className="text-sm font-semibold text-foreground">{question}</p>
              </div>
              <p className="pl-5 text-xs leading-relaxed text-muted-foreground">{answer}</p>
            </div>
          ))}

          {/* Top accounts quick reference */}
          <div className="border-t border-border/30 pt-4">
            <p className="mb-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              Top Revenue Accounts (weighted ARR)
            </p>
            <div className="space-y-1.5">
              {snap.topRevenueAccounts.map((a, i) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border border-border/30 bg-background/20 px-3 py-2 text-xs"
                >
                  <span className="w-4 text-center font-mono text-[10px] text-muted-foreground/60">
                    #{i + 1}
                  </span>
                  <span className="flex-1 font-medium">{a.name}</span>
                  <span className="font-mono text-primary">{formatRevenue(a.weightedARR)}</span>
                  <Badge variant="outline" className="text-[9px] border-border/40 text-muted-foreground">
                    {a.dealProbability}%
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/50">
            Analysis generated deterministically from account data and deal probability model.
            No external AI. Pipeline coverage vs ${(snap.quota / 1_000_000).toFixed(0)}M annual quota.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
