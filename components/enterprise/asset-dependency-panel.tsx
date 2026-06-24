"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  Server,
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
import type { SubstationPlan, FeederCircuit } from "@/lib/types";
import type { TransformerAsset } from "@/lib/planning-engine";
import type { UpgradeProject } from "@/lib/data/capital-projects";
import {
  computeTransformerRisk,
  computeFeederRisk,
  type AssetRiskLevel,
} from "@/lib/services/asset-risk.service";

// ── Risk color helpers ────────────────────────────────────────────────────────

const DOT_COLOR: Record<AssetRiskLevel, string> = {
  LOW:      "bg-emerald-400",
  MEDIUM:   "bg-yellow-400",
  HIGH:     "bg-orange-400",
  CRITICAL: "bg-red-400",
};

// ── Collapsible group ─────────────────────────────────────────────────────────

function Group({
  label,
  count,
  icon,
  children,
  defaultOpen = true,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-white/[0.04]"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="ml-auto rounded-full bg-border/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          {count}
        </span>
      </button>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-border/30 pl-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Asset node row ────────────────────────────────────────────────────────────

function AssetNode({
  label,
  meta,
  riskLevel,
  href,
}: {
  label: string;
  meta?: string;
  riskLevel?: AssetRiskLevel;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/[0.04]"
    >
      {riskLevel && (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_COLOR[riskLevel]}`} />
      )}
      <span className="min-w-0 flex-1 truncate text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
      {meta && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">{meta}</span>
      )}
      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/60" />
    </Link>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AssetDependencyPanelProps {
  substation: SubstationPlan;
  transformers: TransformerAsset[];
  feeders: FeederCircuit[];
  capitalProjects: UpgradeProject[];
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AssetDependencyPanel({
  substation,
  transformers,
  feeders,
  capitalProjects,
}: AssetDependencyPanelProps) {
  const ssUtil =
    substation.nameplateMVA > 0
      ? ((substation.peakLoadMW / substation.nameplateMVA) * 100).toFixed(1)
      : "—";

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle className="text-base">Asset Relationships</CardTitle>
        <CardDescription>Dependency tree · click to navigate</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Root — Substation */}
        <div className="flex items-center gap-2 rounded-md border border-border/30 bg-background/20 px-3 py-2">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{substation.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {substation.region} · {ssUtil}% utilized · {substation.voltageKV} kV
            </p>
          </div>
        </div>

        {/* Transformers */}
        <Group
          label="Transformers"
          count={transformers.length}
          icon={<Server className="h-3.5 w-3.5" />}
        >
          {transformers.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground/60">No transformers</p>
          )}
          {transformers.map((tx) => {
            const risk = computeTransformerRisk(tx);
            const loading = tx.ratedMVA > 0
              ? ((tx.peakLoadMVA / tx.ratedMVA) * 100).toFixed(1)
              : "—";
            return (
              <AssetNode
                key={tx.id}
                label={tx.name}
                meta={`${loading}%`}
                riskLevel={risk.riskLevel}
                href={`/enterprise/assets/transformers/${tx.id}`}
              />
            );
          })}
        </Group>

        {/* Feeders */}
        <Group
          label="Feeders"
          count={feeders.length}
          icon={<Zap className="h-3.5 w-3.5" />}
        >
          {feeders.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground/60">No feeders</p>
          )}
          {feeders.map((fd) => {
            const risk = computeFeederRisk(fd);
            const headroom = fd.hostingCapacityMW - fd.committedLoadMW - fd.queuedLoadMW;
            return (
              <AssetNode
                key={fd.id}
                label={fd.name}
                meta={`${headroom.toFixed(0)} MW hdroom`}
                riskLevel={risk.riskLevel}
                href={`/enterprise/assets/feeders/${fd.id}`}
              />
            );
          })}
        </Group>

        {/* Capital Projects */}
        <Group
          label="Capital Projects"
          count={capitalProjects.length}
          icon={<CircleDollarSign className="h-3.5 w-3.5" />}
          defaultOpen={capitalProjects.length > 0}
        >
          {capitalProjects.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground/60">No active projects</p>
          )}
          {capitalProjects.map((p) => (
            <AssetNode
              key={p.id}
              label={p.projectName}
              meta={`$${(p.estimatedCostUSD / 1_000_000).toFixed(1)}M`}
              href={`/enterprise/assets/projects/${p.id}`}
            />
          ))}
        </Group>

        {/* Summary footer */}
        <div className="mt-2 rounded-md border border-border/20 bg-background/10 px-3 py-2 text-[10px] text-muted-foreground">
          {transformers.length} transformer{transformers.length !== 1 ? "s" : ""} ·{" "}
          {feeders.length} feeder{feeders.length !== 1 ? "s" : ""} ·{" "}
          {capitalProjects.length} capital project{capitalProjects.length !== 1 ? "s" : ""} ·{" "}
          ${(capitalProjects.reduce((s, p) => s + p.estimatedCostUSD, 0) / 1_000_000).toFixed(1)}M planned
        </div>
      </CardContent>
    </Card>
  );
}
