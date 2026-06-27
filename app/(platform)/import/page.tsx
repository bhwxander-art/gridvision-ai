"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, Clock, CheckCircle, XCircle, AlertTriangle, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ── Types ─────────────────────────────────────────────────────────────────────

type EntityType = "substations" | "transformers" | "feeders" | "accounts";
type UploadStatus = "idle" | "uploading" | "success" | "error";

interface ImportJob {
  id: string;
  entity_type: EntityType;
  status: "pending" | "processing" | "completed" | "partial" | "failed";
  rows_processed: number;
  rows_failed: number;
  filename: string | null;
  created_at: string;
  completed_at: string | null;
  error_details: Array<{ row: number; field: string; message: string }>;
}

interface UploadResult {
  jobId?: string;
  status?: string;
  rowsTotal?: number;
  rowsProcessed?: number;
  rowsFailed?: number;
  errors?: Array<{ row: number; field: string; message: string }>;
  error?: string;
}

// ── Template data ──────────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<EntityType, string> = {
  substations: "Substations",
  transformers: "Transformers",
  feeders: "Feeders",
  accounts: "Accounts",
};

const ENTITY_DESCRIPTIONS: Record<EntityType, string> = {
  substations: "Grid substations with location, voltage, and capacity data",
  transformers: "Transformer assets linked to substations",
  feeders: "Distribution feeders with hosting capacity",
  accounts: "Customer or load accounts",
};

const TEMPLATES: Record<EntityType, string> = {
  substations:
    "name,latitude,longitude,voltage_kv,nameplate_mva,peak_load_mw,n1_capacity_mw\nBoston North 115kV,42.37,-71.02,115,450,342,405",
  transformers:
    "name,substation_name,voltage_primary_kv,voltage_secondary_kv,nameplate_mva,loading_pct\nT1,Boston North,115,13.8,225,71",
  feeders:
    "name,substation_name,voltage_kv,peak_load_mw,length_miles\nF101,Boston North,13.8,12.4,3.2",
  accounts:
    "name,account_number,address,peak_demand_kw,annual_kwh\nAcme Corp,ACC-001,123 Main St,500,1250000",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadTemplate(entityType: EntityType) {
  const csv = TEMPLATES[entityType] ?? "";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${entityType}-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ImportJob["status"] }) {
  const cfg = {
    completed: {
      icon: <CheckCircle className="h-3.5 w-3.5" />,
      label: "Completed",
      cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    },
    partial: {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: "Partial",
      cls: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    },
    failed: {
      icon: <XCircle className="h-3.5 w-3.5" />,
      label: "Failed",
      cls: "text-red-400 bg-red-500/10 border-red-500/30",
    },
    pending: {
      icon: <Clock className="h-3.5 w-3.5" />,
      label: "Pending",
      cls: "text-muted-foreground bg-muted/20 border-border/40",
    },
    processing: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      label: "Processing",
      cls: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Upload Tab ────────────────────────────────────────────────────────────────

function UploadTab() {
  const [entityType, setEntityType] = useState<EntityType>("substations");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!f.name.endsWith(".csv")) {
      setResult({ error: "Only .csv files are accepted." });
      return;
    }
    setFile(f);
    setResult(null);
    setStatus("idle");
  }

  async function handleUpload() {
    if (!file) return;
    setStatus("uploading");
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/import/${entityType}`, {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as UploadResult;
      setResult(data);
      setStatus(res.ok ? "success" : "error");
    } catch {
      setResult({ error: "Upload failed. Check your connection and try again." });
      setStatus("error");
    }
  }

  return (
    <div className="space-y-5">
      {/* Entity type selector */}
      <Card className="border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle className="text-sm">Select Data Type</CardTitle>
          <CardDescription>Choose what you are importing</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(ENTITY_LABELS) as EntityType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setEntityType(type);
                  setFile(null);
                  setResult(null);
                  setStatus("idle");
                }}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  entityType === type
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/40 bg-background/30 text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                <div className="font-medium">{ENTITY_LABELS[type]}</div>
                <div className="mt-0.5 text-[11px] opacity-70">
                  {ENTITY_DESCRIPTIONS[type]}
                </div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => downloadTemplate(entityType)}
            className="mt-3 flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"
          >
            <Download className="h-3.5 w-3.5" />
            Download {ENTITY_LABELS[entityType]} CSV template
          </button>
        </CardContent>
      </Card>

      {/* Drop zone */}
      <Card className="border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle className="text-sm">Upload CSV File</CardTitle>
          <CardDescription>
            Upload a CSV file containing {ENTITY_LABELS[entityType].toLowerCase()} data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop CSV file here or click to browse"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) handleFile(dropped);
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragOver
                ? "border-primary/60 bg-primary/5"
                : "border-border/40 hover:border-border hover:bg-muted/10"
            }`}
          >
            <Upload className="h-8 w-8 text-muted-foreground/50" />
            {file ? (
              <div>
                <p className="text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground">
                  Drag and drop a .csv file here, or click to browse
                </p>
                <p className="mt-1 text-xs text-muted-foreground/50">
                  CSV format only · Max 10 MB
                </p>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          <Button
            onClick={() => void handleUpload()}
            disabled={!file || status === "uploading"}
            className="w-full"
          >
            {status === "uploading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Import {ENTITY_LABELS[entityType]}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card
          className={`border ${
            status === "success"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-red-500/30 bg-red-500/5"
          }`}
        >
          <CardContent className="pt-4">
            {result.error ? (
              <p className="text-sm text-red-400">{result.error}</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {result.rowsFailed === 0 ? (
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                  ) : result.rowsProcessed && result.rowsProcessed > 0 ? (
                    <AlertTriangle className="h-4 w-4 text-yellow-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400" />
                  )}
                  <span className="text-sm font-medium">
                    {result.rowsProcessed} of {result.rowsTotal} rows imported
                    {result.rowsFailed ? ` · ${result.rowsFailed} failed` : ""}
                  </span>
                </div>
                {result.errors && result.errors.length > 0 && (
                  <div className="mt-2 space-y-1 rounded-md bg-background/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Validation Errors
                    </p>
                    {result.errors.slice(0, 10).map((e, i) => (
                      <p key={i} className="text-xs text-red-400">
                        Row {e.row} · {e.field}: {e.message}
                      </p>
                    ))}
                    {result.errors.length > 10 && (
                      <p className="text-xs text-muted-foreground">
                        +{result.errors.length - 10} more errors
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/import/jobs?limit=30")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { jobs: ImportJob[] };
        setJobs(d.jobs ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Clock className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No import jobs yet</p>
        <p className="text-xs text-muted-foreground/60">
          Switch to the Upload tab to import your first CSV file
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex items-center justify-between gap-4 rounded-lg border border-border/40 bg-[#0d1219]/60 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium capitalize">
                {job.entity_type}
              </span>
              <StatusBadge status={job.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {job.filename ?? "unnamed file"} · {relativeTime(job.created_at)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-mono">
              {job.rows_processed}
              {job.rows_failed > 0 && (
                <span className="text-yellow-400"> / {job.rows_failed} err</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">rows</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [tab, setTab] = useState<"upload" | "history">("upload");

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Import Center</h1>
        <p className="text-sm text-muted-foreground">
          Upload CSV files to populate your grid data — substations, transformers, feeders, and accounts.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg border border-border/40 bg-[#0d1219]/60 p-1">
        {(["upload", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? "bg-primary/20 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "upload" ? "Upload" : "History"}
          </button>
        ))}
      </div>

      {tab === "upload" ? <UploadTab /> : <HistoryTab />}
    </div>
  );
}
