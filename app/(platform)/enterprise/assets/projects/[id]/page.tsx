import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CircleDollarSign } from "lucide-react";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { AssetRelationshipRepository } from "@/lib/db/repositories/asset-relationship.repository";
import { CapitalProjectRepository } from "@/lib/db/repositories/capital-project.repository";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { AssetDependencyPanel } from "@/components/enterprise/asset-dependency-panel";
import { AssetDigitalTwin } from "@/components/enterprise/asset-digital-twin";
import type { DbProjectStatus } from "@/lib/db/types";

const STATUS_BADGE: Record<DbProjectStatus, string> = {
  planned:      "bg-slate-500/15 text-slate-400 border-slate-500/30",
  approved:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "in-progress":"bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  completed:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  cancelled:    "bg-red-500/15 text-red-400 border-red-500/30",
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isDbConfigured()) return <NoDB />;

  const cpRepo = new CapitalProjectRepository(getServerClient());
  const managedProject = await cpRepo.listManaged().then((list) => list.find((p) => p.id === id));
  if (!managedProject) notFound();

  const relRepo = new AssetRelationshipRepository(getServerClient());
  const deps = await relRepo.findAssetDependencies(managedProject.substationId);
  if (!deps) notFound();

  const { substation, transformers, feeders, capitalProjects } = deps;
  const status = managedProject.status ?? "planned";
  const costPerMW = managedProject.addedCapacityMW > 0
    ? Math.round(managedProject.estimatedCostUSD / managedProject.addedCapacityMW / 1_000)
    : 0;

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
            <CircleDollarSign className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold truncate max-w-xs">{managedProject.projectName}</p>
          </div>
        </div>
        <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[status]}`}>
          {status}
        </Badge>
      </header>

      <main className="space-y-6 p-6">
        {/* Project overview */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle>{managedProject.projectName}</CardTitle>
            <CardDescription>
              {substation.name} · {managedProject.upgradeType.replace(/-/g, " ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Estimated Cost",    value: `$${(managedProject.estimatedCostUSD / 1_000_000).toFixed(1)}M` },
              { label: "Added Capacity",    value: `+${managedProject.addedCapacityMW} MW` },
              { label: "Cost / MW",         value: `$${costPerMW.toLocaleString()}k` },
              { label: "Timeline",          value: `${managedProject.implementationMonths} months` },
              { label: "Risk Reduction",    value: `${managedProject.riskReduction}/100` },
              { label: "Priority Score",    value: `${managedProject.priorityScore}/100` },
              { label: "Status",            value: status },
              { label: "Created",           value: new Date(managedProject.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border/30 bg-background/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="mt-1 font-mono text-sm font-semibold">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Parent context */}
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
