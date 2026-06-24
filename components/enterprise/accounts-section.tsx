"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { AccountPipeline } from "@/components/enterprise/account-pipeline";
import { AccountDetailPanel } from "@/components/enterprise/account-detail-panel";
import { AccountCopilot } from "@/components/enterprise/account-copilot";
import { scoreOpportunity } from "@/lib/services/account-intelligence.service";
import type { Account } from "@/lib/data/accounts";

export function AccountsSection() {
  const [selected, setSelected] = useState<Account | null>(null);

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Account Intelligence</h2>
          <p className="text-[11px] text-muted-foreground">
            Utility CRM · pipeline management · grid capacity advisory opportunities
          </p>
        </div>
      </div>

      {/* Pipeline */}
      <AccountPipeline
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
      />

      {/* Detail + Copilot */}
      {selected ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AccountDetailPanel
              account={selected}
              score={scoreOpportunity(selected)}
            />
          </div>
          <AccountCopilot account={selected} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/30 py-10 text-center text-sm text-muted-foreground">
          Select an account from the pipeline to view intelligence details and recommendations.
        </div>
      )}
    </div>
  );
}
