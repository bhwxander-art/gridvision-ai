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
import { PRIORITY_COLOR, type Account } from "@/lib/data/accounts";
import {
  generateAccountQA,
  scoreOpportunity,
} from "@/lib/services/account-intelligence.service";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AccountCopilotProps {
  account: Account;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AccountCopilot({ account }: AccountCopilotProps) {
  const score = useMemo(() => scoreOpportunity(account), [account]);
  const qa    = useMemo(() => generateAccountQA(account, score), [account, score]);

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <CardTitle className="text-base">Account Intelligence Copilot</CardTitle>
        </div>
        <CardDescription>
          {account.name} · {account.type.replace(/-/g, " ")}
        </CardDescription>
        <div className="flex items-center gap-2 pt-1">
          <span className={`font-mono text-2xl font-bold ${PRIORITY_COLOR[score.priority]}`}>
            {score.opportunityScore}
          </span>
          <span className="text-xs text-muted-foreground">/ 100 opportunity score</span>
          <Badge
            variant="outline"
            className={`ml-auto text-[10px] font-bold ${PRIORITY_COLOR[score.priority]} border-current/30`}
          >
            {score.priority.toUpperCase()}
          </Badge>
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

          <p className="border-t border-border/30 pt-3 text-[10px] text-muted-foreground/50">
            Analysis generated deterministically from account intelligence data.
            No external LLM. Scores update in real time as account data changes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
