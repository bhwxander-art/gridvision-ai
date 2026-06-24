"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ManagedSubstation } from "@/lib/hooks/use-assets";
import type { DbImportJob } from "@/lib/db/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssetHealth {
  totalSubstations:     number;
  totalTransformers:    number;
  totalFeeders:         number;
  totalProjects:        number;
  missingCoordinates:   number;
  missingCapacity:      number;
  duplicateNames:       number;
  lastImport:           DbImportJob | null;
  sourceTag:            "db" | "demo" | "mixed" | "no-db";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DataHealthDashboard() {
  const [health, setHealth]   = useState<AssetHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ssRes, txRes, fdRes, cpRes, jobRes] = await Promise.all([
        fetch("/api/assets/substations"),
        fetch("/api/assets/transformers"),
        fetch("/api/assets/feeders"),
        fetch("/api/assets/capital-projects"),
        fetch("/api/import/jobs?limit=1"),
      ]);

      // Substations (most data quality metrics derived from here)
      let substations: ManagedSubstation[] = [];
      let sourceTag: AssetHealth["sourceTag"] = "no-db";

      if (ssRes.ok) {
        const d = await ssRes.json();
        substations = d.substations ?? [];
        sourceTag   = d.source === "db" ? "db" : "demo";
      }

      const txCount = txRes.ok ? ((await txRes.json()).count ?? 0) : 0;
      const fdCount = fdRes.ok ? ((await fdRes.json()).count ?? 0) : 0;
      const cpCount = cpRes.ok ? ((await cpRes.json()).count ?? 0) : 0;

      // Coordinate quality: lat === 0 AND lng === 0 or explicitly null
      const missingCoordinates = substations.filter(
        (s) => (!s.latitude && !s.longitude) || (s.latitude === 0 && s.longitude === 0)
      ).length;

      // Capacity quality: nameplate_mva === 0 or missing
      const missingCapacity = substations.filter(
        (s) => !s.nameplateMVA || s.nameplateMVA === 0
      ).length;

      // Duplicate names within substations
      const nameCounts = new Map<string, number>();
      substations.forEach((s) => {
        const k = s.name.toLowerCase().trim();
        nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
      });
      const duplicateNames = [...nameCounts.values()].filter((c) => c > 1).length;

      // Last import job
      let lastImport: DbImportJob | null = null;
      if (jobRes.ok) {
        const jobData = await jobRes.json();
        lastImport = (jobData.jobs?.[0] as DbImportJob | undefined) ?? null;
      }

      setHealth({
        totalSubstations:   substations.length,
        totalTransformers:  txCount,
        totalFeeders:       fdCount,
        totalProjects:      cpCount,
        missingCoordinates,
        missingCapacity,
        duplicateNames,
        lastImport,
        sourceTag,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const hasIssues = health
    ? health.missingCoordinates > 0 || health.missingCapacity > 0 || health.duplicateNames > 0
    : false;

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <CardTitle>Data Health Dashboard</CardTitle>
          </div>
          <CardDescription>
            Asset completeness, quality, and import status for your workspace
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 border-border/40"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading && (
          <div className="space-y-2 animate-pulse">
            {[1,2,3].map((i) => <div key={i} className="h-12 rounded bg-border/20" />)}
          </div>
        )}

        {!loading && error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {!loading && health && (
          <>
            {/* Source badge */}
            <div className="flex items-center gap-2">
              <SourceBadge tag={health.sourceTag} />
              <span className="text-xs text-muted-foreground">
                {health.sourceTag === "no-db"
                  ? "Database not configured — run scripts/migrate-13b.sql"
                  : health.sourceTag === "db"
                  ? "Showing live database records"
                  : "Showing static demo data"}
              </span>
            </div>

            {/* Asset counts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CountCard label="Substations"    count={health.totalSubstations}  icon="⚡" />
              <CountCard label="Transformers"   count={health.totalTransformers} icon="🔌" />
              <CountCard label="Feeders"        count={health.totalFeeders}      icon="〰️" />
              <CountCard label="Capital Projects" count={health.totalProjects}   icon="💰" />
            </div>

            {/* Quality checks */}
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Data Quality
              </p>
              <div className="space-y-2">
                <QualityRow
                  label="Missing Coordinates"
                  value={health.missingCoordinates}
                  total={health.totalSubstations}
                  description="Substations without latitude/longitude (affects GIS layer)"
                  warnAt={1}
                />
                <QualityRow
                  label="Missing Capacity (nameplate)"
                  value={health.missingCapacity}
                  total={health.totalSubstations}
                  description="Substations without nameplate MVA (affects utilization calculations)"
                  warnAt={1}
                />
                <QualityRow
                  label="Duplicate Substation Names"
                  value={health.duplicateNames}
                  total={health.totalSubstations}
                  description="Name groups appearing more than once — may cause planning engine collisions"
                  warnAt={1}
                />
              </div>
            </div>

            {/* Overall health */}
            <div className={`flex items-center gap-3 rounded-lg border p-3 ${
              hasIssues
                ? "border-yellow-500/30 bg-yellow-500/5"
                : "border-emerald-500/30 bg-emerald-500/5"
            }`}>
              {hasIssues ? (
                <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              )}
              <p className="text-sm">
                {hasIssues
                  ? "Data quality issues detected — review the items above and re-import corrected CSV files."
                  : "All quality checks passed. Asset data is complete and ready for planning."}
              </p>
            </div>

            {/* Last import */}
            {health.lastImport && (
              <div className="flex items-start gap-3 rounded-lg border border-border/30 bg-background/20 p-3">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 text-xs">
                  <p className="font-medium">
                    Last import:{" "}
                    <span className="font-mono">{health.lastImport.entity_type}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {new Date(health.lastImport.created_at).toLocaleString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                      hour: "numeric", minute: "2-digit",
                    })}
                    {" · "}
                    {health.lastImport.rows_processed} rows imported
                    {health.lastImport.rows_failed > 0 && ` · ${health.lastImport.rows_failed} failed`}
                    {health.lastImport.filename && ` · ${health.lastImport.filename}`}
                  </p>
                </div>
                <ImportStatusBadge status={health.lastImport.status} />
              </div>
            )}

            {!health.lastImport && health.sourceTag !== "no-db" && (
              <p className="text-xs text-muted-foreground">
                No import jobs yet. Use the Import Center above to load your first CSV.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SourceBadge({ tag }: { tag: AssetHealth["sourceTag"] }) {
  const styles: Record<AssetHealth["sourceTag"], string> = {
    db:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    demo:   "bg-slate-500/15  text-slate-400  border-slate-500/30",
    mixed:  "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    "no-db":"bg-red-500/15    text-red-400    border-red-500/30",
  };
  const labels: Record<AssetHealth["sourceTag"], string> = {
    db:     "DATABASE",
    demo:   "DEMO DATA",
    mixed:  "MIXED",
    "no-db":"NO DATABASE",
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${styles[tag]}`}>
      {labels[tag]}
    </Badge>
  );
}

function CountCard({ label, count, icon }: { label: string; count: number; icon: string }) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/20 p-3 text-center">
      <p className="text-xl">{icon}</p>
      <p className="mt-1 font-mono text-xl font-bold">{count.toLocaleString()}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function QualityRow({
  label,
  value,
  total,
  description,
  warnAt,
}: {
  label:       string;
  value:       number;
  total:       number;
  description: string;
  warnAt:      number;
}) {
  const isOk = value < warnAt;
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/20 bg-background/10 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isOk ? (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-3 w-3 shrink-0 text-yellow-400" />
          )}
          <p className="text-xs font-medium">{label}</p>
        </div>
        <p className="mt-0.5 pl-4.5 text-[10px] text-muted-foreground">{description}</p>
      </div>
      <span className={`shrink-0 font-mono text-sm font-bold ${isOk ? "text-emerald-400" : "text-yellow-400"}`}>
        {value}{total > 0 && <span className="text-[10px] text-muted-foreground font-normal">/{total}</span>}
      </span>
    </div>
  );
}

function ImportStatusBadge({ status }: { status: DbImportJob["status"] }) {
  const styles: Record<DbImportJob["status"], string> = {
    pending:    "bg-slate-500/15  text-slate-400  border-slate-500/30",
    processing: "bg-blue-500/15   text-blue-400   border-blue-500/30",
    completed:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    partial:    "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    failed:     "bg-red-500/15    text-red-400    border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`shrink-0 text-[9px] ${styles[status]}`}>
      {status}
    </Badge>
  );
}
