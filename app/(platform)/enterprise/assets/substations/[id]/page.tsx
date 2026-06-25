import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { AssetRelationshipRepository } from "@/lib/db/repositories/asset-relationship.repository";
import { AssetDigitalTwin } from "@/components/enterprise/asset-digital-twin";
import { AssetDependencyPanel } from "@/components/enterprise/asset-dependency-panel";
import { AssetCopilot } from "@/components/enterprise/asset-copilot";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { UpgradeProject } from "@/lib/data/capital-projects";

export default async function SubstationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isDbConfigured()) {
    return <NoDB />;
  }

  const ctx = await getCurrentTenant();
  if (!ctx) notFound();

  const repo = new AssetRelationshipRepository(getServerClient());
  const deps = await repo.findAssetDependencies(id, ctx.tenantId);

  if (!deps) notFound();

  const { substation, transformers, feeders, capitalProjects } = deps;
  const utilPct =
    substation.nameplateMVA > 0
      ? ((substation.peakLoadMW / substation.nameplateMVA) * 100).toFixed(1)
      : "—";

  return (
    <div className="min-h-screen bg-[#070b12] text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/40 bg-[#0a0f18]/90 px-6 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/enterprise?section=assets"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Assets
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">{substation.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{substation.region}</span>
          <span>·</span>
          <span>{substation.voltageKV} kV</span>
          <span>·</span>
          <span>{utilPct}% utilization</span>
          <span className="font-mono text-[10px] opacity-50">{substation.id}</span>
        </div>
      </header>

      {/* Content */}
      <main className="space-y-6 p-6">
        {/* Digital Twin — full width */}
        <AssetDigitalTwin substation={substation} projects={capitalProjects} />

        {/* Three-panel row */}
        <div className="grid gap-6 lg:grid-cols-3">
          <AssetDependencyPanel
            substation={substation}
            transformers={transformers}
            feeders={feeders}
            capitalProjects={capitalProjects}
          />

          <CapitalProjectsSummary
            projects={capitalProjects}
            substationId={id}
          />

          <AssetCopilot substation={substation} projects={capitalProjects} />
        </div>
      </main>
    </div>
  );
}

// ── Capital projects summary card ─────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  planned:      "bg-slate-500/15 text-slate-400 border-slate-500/30",
  approved:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "in-progress":"bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  completed:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  cancelled:    "bg-red-500/15 text-red-400 border-red-500/30",
};

function CapitalProjectsSummary({
  projects,
  substationId: _,
}: {
  projects: UpgradeProject[];
  substationId: string;
}) {
  const totalCost = projects.reduce((s, p) => s + p.estimatedCostUSD, 0);
  const totalMW   = projects.reduce((s, p) => s + p.addedCapacityMW, 0);

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle className="text-base">Capital Projects</CardTitle>
        <CardDescription>
          {projects.length} project{projects.length !== 1 ? "s" : ""} ·{" "}
          ${(totalCost / 1_000_000).toFixed(1)}M total · +{totalMW} MW planned
        </CardDescription>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No capital projects are planned for this substation.
          </p>
        ) : (
          <div className="space-y-3">
            {[...projects]
              .sort((a, b) => b.priorityScore - a.priorityScore)
              .map((p) => (
                <Link
                  key={p.id}
                  href={`/enterprise/assets/projects/${p.id}`}
                  className="block rounded-lg border border-border/30 bg-background/20 p-3 hover:border-border/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{p.projectName}</p>
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[9px] ${STATUS_BADGE["planned"]}`}
                    >
                      planned
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>${(p.estimatedCostUSD / 1_000_000).toFixed(1)}M</span>
                    <span>·</span>
                    <span>+{p.addedCapacityMW} MW</span>
                    <span>·</span>
                    <span>{p.implementationMonths} mo</span>
                    <span className="ml-auto font-mono">P{p.priorityScore}</span>
                  </div>
                </Link>
              ))}

            <div className="rounded-md border border-border/20 bg-background/10 p-2.5 text-[10px] text-muted-foreground">
              Total planned capacity increase: <span className="font-semibold text-cyan-400">+{totalMW} MW</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NoDB() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070b12] p-6">
      <div className="max-w-md text-center space-y-4">
        <p className="text-lg font-semibold">Database not configured</p>
        <p className="text-sm text-muted-foreground">
          Run <code className="rounded bg-border/40 px-1 py-0.5 text-xs">scripts/migrate-11a.sql</code> against
          your Supabase project to enable asset detail pages.
        </p>
        <Link href="/enterprise" className="text-sm text-primary hover:underline">
          ← Back to Enterprise Planning
        </Link>
      </div>
    </div>
  );
}
