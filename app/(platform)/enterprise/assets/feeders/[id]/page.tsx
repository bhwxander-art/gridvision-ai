import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { AssetRelationshipRepository } from "@/lib/db/repositories/asset-relationship.repository";
import { FeederRepository } from "@/lib/db/repositories/feeder.repository";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  computeFeederRisk,
  type AssetRiskLevel,
} from "@/lib/services/asset-risk.service";
import { AssetDependencyPanel } from "@/components/enterprise/asset-dependency-panel";
import { AssetDigitalTwin } from "@/components/enterprise/asset-digital-twin";

const RISK_BADGE: Record<AssetRiskLevel, string> = {
  LOW:      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MEDIUM:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  HIGH:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default async function FeederDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isDbConfigured()) return <NoDB />;

  const ctx = await getCurrentTenant();
  if (!ctx) notFound();

  const fdRepo = new FeederRepository(getServerClient());
  const feeder = await fdRepo.findById(id, ctx.tenantId);
  if (!feeder) notFound();

  const relRepo = new AssetRelationshipRepository(getServerClient());
  const deps = await relRepo.findAssetDependencies(feeder.substationId);
  if (!deps) notFound();

  const { substation, transformers, feeders, capitalProjects } = deps;
  const risk = computeFeederRisk(feeder);
  const headroom = feeder.hostingCapacityMW - feeder.committedLoadMW - feeder.queuedLoadMW;
  const committedPct = feeder.hostingCapacityMW > 0
    ? ((feeder.committedLoadMW / feeder.hostingCapacityMW) * 100).toFixed(1)
    : "—";

  return (
    <div className="min-h-screen bg-[#070b12] text-foreground">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/40 bg-[#0a0f18]/90 px-6 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href={`/enterprise/assets/substations/${substation.id}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            {substation.name.split(" ").slice(0, 2).join(" ")}
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-cyan-400" />
            <p className="text-sm font-semibold">{feeder.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{feeder.hostingCapacityMW} MW hosting</span>
          <span>·</span>
          <span>{headroom.toFixed(0)} MW headroom</span>
          <Badge variant="outline" className={`text-[10px] ${RISK_BADGE[risk.riskLevel]}`}>
            {risk.riskLevel}
          </Badge>
        </div>
      </header>

      <main className="space-y-6 p-6">
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle>{feeder.name}</CardTitle>
            <CardDescription>{substation.name} · Feeder Circuit</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Hosting Capacity", value: `${feeder.hostingCapacityMW} MW` },
              { label: "Committed Load",   value: `${feeder.committedLoadMW} MW` },
              { label: "Queued Load",      value: `${feeder.queuedLoadMW} MW` },
              { label: "Headroom",         value: `${headroom.toFixed(0)} MW` },
              { label: "Committed %",      value: `${committedPct}%` },
              { label: "Risk Score",       value: `${risk.riskScore}/100` },
              { label: "Risk Level",       value: risk.riskLevel },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border/30 bg-background/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="mt-1 font-mono text-sm font-semibold">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {risk.drivers.length > 0 && (
          <Card className="border-orange-500/20 bg-orange-500/5">
            <CardHeader><CardTitle className="text-base text-orange-400">Risk Drivers</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {risk.drivers.map((d) => (
                  <li key={d} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" />
                    {d}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <AssetDigitalTwin substation={substation} projects={capitalProjects} />
          <AssetDependencyPanel
            substation={substation}
            transformers={transformers}
            feeders={feeders}
            capitalProjects={capitalProjects}
          />
        </div>
      </main>
    </div>
  );
}

function NoDB() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070b12] p-6">
      <div className="text-center space-y-4">
        <p className="text-lg font-semibold">Database not configured</p>
        <Link href="/enterprise" className="text-sm text-primary hover:underline">← Back</Link>
      </div>
    </div>
  );
}
