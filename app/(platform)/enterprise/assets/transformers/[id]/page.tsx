import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Server } from "lucide-react";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { AssetRelationshipRepository } from "@/lib/db/repositories/asset-relationship.repository";
import { TransformerRepository } from "@/lib/db/repositories/transformer.repository";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  computeTransformerRisk,
  computeSubstationRisk,
  type AssetRiskLevel,
} from "@/lib/services/asset-risk.service";
import { AssetDependencyPanel } from "@/components/enterprise/asset-dependency-panel";
import { AssetCopilot } from "@/components/enterprise/asset-copilot";
import { AssetDigitalTwin } from "@/components/enterprise/asset-digital-twin";

const RISK_BADGE: Record<AssetRiskLevel, string> = {
  LOW:      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MEDIUM:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  HIGH:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default async function TransformerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isDbConfigured()) {
    return <NoDB />;
  }

  const txRepo = new TransformerRepository(getServerClient());
  const transformer = await txRepo.findById(id);
  if (!transformer) notFound();

  const relRepo = new AssetRelationshipRepository(getServerClient());
  const deps = await relRepo.findAssetDependencies(transformer.substationId);
  if (!deps) notFound();

  const { substation, transformers, feeders, capitalProjects } = deps;
  const risk = computeTransformerRisk(transformer);
  const loadingPct = transformer.ratedMVA > 0
    ? ((transformer.peakLoadMVA / transformer.ratedMVA) * 100).toFixed(1)
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
            <Server className="h-4 w-4 text-purple-400" />
            <p className="text-sm font-semibold">{transformer.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{transformer.ratedMVA} MVA rated</span>
          <span>·</span>
          <span>{loadingPct}% loading</span>
          <span>·</span>
          <span>{transformer.ageYears} yr old</span>
          <Badge variant="outline" className={`text-[10px] ${RISK_BADGE[risk.riskLevel]}`}>
            {risk.riskLevel}
          </Badge>
        </div>
      </header>

      <main className="space-y-6 p-6">
        {/* Transformer detail card */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle>{transformer.name}</CardTitle>
            <CardDescription>
              {substation.name} · Transformer Asset · {transformer.substationId}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Rated MVA",      value: `${transformer.ratedMVA} MVA` },
              { label: "Peak Load MVA",  value: `${transformer.peakLoadMVA} MVA` },
              { label: "Thermal Loading",value: `${loadingPct}%` },
              { label: "Load Factor",    value: transformer.loadFactor.toFixed(2) },
              { label: "Age",            value: `${transformer.ageYears} years` },
              { label: "N-1 Compliant",  value: transformer.n1Compliant ? "Yes" : "No" },
              { label: "Risk Score",     value: `${risk.riskScore}/100` },
              { label: "Risk Level",     value: risk.riskLevel },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border/30 bg-background/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="mt-1 font-mono text-sm font-semibold">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Risk drivers */}
        {risk.drivers.length > 0 && (
          <Card className="border-orange-500/20 bg-orange-500/5">
            <CardHeader>
              <CardTitle className="text-base text-orange-400">Risk Drivers</CardTitle>
            </CardHeader>
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

        {/* Parent substation context */}
        <div className="grid gap-6 lg:grid-cols-2">
          <AssetDigitalTwin substation={substation} projects={capitalProjects} />
          <div className="space-y-6">
            <AssetDependencyPanel
              substation={substation}
              transformers={transformers}
              feeders={feeders}
              capitalProjects={capitalProjects}
            />
          </div>
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
