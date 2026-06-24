"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Upload,
  X,
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
import {
  generateCSVTemplate,
  IMPORT_TEMPLATES,
  parseCSV,
  type ImportEntityType,
} from "@/lib/utils/csv";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImportResult {
  jobId:         string;
  status:        "completed" | "partial" | "failed";
  rowsTotal:     number;
  rowsProcessed: number;
  rowsFailed:    number;
  errors:        Array<{ row: number; field: string; message: string }>;
}

const TABS: { id: ImportEntityType; label: string; endpoint: string }[] = [
  { id: "substations",  label: "Substations",  endpoint: "/api/import/substations"  },
  { id: "transformers", label: "Transformers",  endpoint: "/api/import/transformers" },
  { id: "feeders",      label: "Feeders",       endpoint: "/api/import/feeders"      },
  { id: "accounts",     label: "Accounts",      endpoint: "/api/import/accounts"     },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function DataImportCenter() {
  const [activeTab, setActiveTab] = useState<ImportEntityType>("substations");

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" />
          <CardTitle>Data Import Center</CardTitle>
        </div>
        <CardDescription>
          Upload CSV files to import assets into your workspace · all records scoped to your tenant
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg border border-border/40 p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Active import tab */}
        {TABS.map((tab) =>
          activeTab === tab.id ? (
            <ImportTab key={tab.id} type={tab.id} endpoint={tab.endpoint} />
          ) : null
        )}
      </CardContent>
    </Card>
  );
}

// ── Single import tab ─────────────────────────────────────────────────────────

function ImportTab({
  type,
  endpoint,
}: {
  type:     ImportEntityType;
  endpoint: string;
}) {
  const template      = IMPORT_TEMPLATES[type];
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile]         = useState<File | null>(null);
  const [preview, setPreview]   = useState<Array<Record<string, string>>>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult]     = useState<ImportResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  function loadFile(f: File) {
    setFile(f);
    setResult(null);
    setApiError(null);
    f.text().then((text) => {
      const rows = parseCSV(text);
      setPreview(rows.slice(0, 5));
    });
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith(".csv")) loadFile(f);
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
  }

  async function handleImport() {
    if (!file) return;
    setUploading(true);
    setApiError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res  = await fetch(endpoint, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data as ImportResult);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  function handleDownloadTemplate() {
    const csv  = generateCSVTemplate(type);
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `gridvision-${type}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearFile() {
    setFile(null);
    setPreview([]);
    setResult(null);
    setApiError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const previewHeaders = preview.length > 0 ? Object.keys(preview[0]) : [];

  return (
    <div className="space-y-4">
      {/* Template hint */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/30 bg-background/20 p-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Expected columns</p>
          <p className="mt-1 font-mono text-[10px] text-cyan-400">
            {template.columns.join(", ")}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Required: <span className="text-foreground">{template.requiredCols.join(", ")}</span>
            {" · "}{template.description}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 gap-1.5 border-border/40 text-xs"
          onClick={handleDownloadTemplate}
        >
          <Download className="h-3 w-3" />
          Download Template
        </Button>
      </div>

      {/* Drop zone */}
      {!file && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragging
              ? "border-primary bg-primary/5"
              : "border-border/40 bg-background/10 hover:border-border/60 hover:bg-background/20"
          }`}
        >
          <FileUp className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Drop CSV file here or click to browse</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Accepts .csv · UTF-8 · comma-separated
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      )}

      {/* File selected — preview */}
      {file && !result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </div>
            <button onClick={clearFile} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Preview table */}
          {preview.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Preview — first {preview.length} row{preview.length !== 1 ? "s" : ""}
              </p>
              <div className="overflow-x-auto rounded-lg border border-border/30">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30 bg-background/30">
                      {previewHeaders.map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-mono text-[10px] text-muted-foreground">
                          {h}
                          {template.requiredCols.includes(h) && (
                            <span className="ml-1 text-primary">*</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {preview.map((row, i) => (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        {previewHeaders.map((h) => (
                          <td key={h} className="max-w-[140px] truncate px-3 py-2 font-mono">
                            {row[h] || <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {apiError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {apiError.includes("not configured")
                ? "Database not configured — run scripts/migrate-13b.sql to enable imports."
                : apiError}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleImport}
              disabled={uploading}
              className="gap-1.5"
            >
              {uploading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Importing…</>
              ) : (
                <><Upload className="h-3.5 w-3.5" />Import {preview.length > 0 ? "(preview shown)" : ""}</>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={clearFile} disabled={uploading}
              className="border-border/40">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-lg border p-4 space-y-3 ${
          result.status === "completed"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : result.status === "partial"
            ? "border-yellow-500/30 bg-yellow-500/5"
            : "border-red-500/30 bg-red-500/5"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {result.status === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-400" />
              )}
              <p className="text-sm font-semibold">
                {result.status === "completed" && "Import Complete"}
                {result.status === "partial"   && "Import Partially Complete"}
                {result.status === "failed"    && "Import Failed"}
              </p>
            </div>
            <Badge variant="outline" className={`text-[10px] ${
              result.status === "completed" ? "text-emerald-400 border-emerald-500/30" :
              result.status === "partial"   ? "text-yellow-400 border-yellow-500/30" :
              "text-red-400 border-red-500/30"
            }`}>
              {result.rowsProcessed} / {result.rowsTotal} rows
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="font-mono text-lg font-bold text-emerald-400">{result.rowsProcessed}</p>
              <p className="text-[10px] text-muted-foreground">Imported</p>
            </div>
            <div>
              <p className="font-mono text-lg font-bold text-red-400">{result.rowsFailed}</p>
              <p className="text-[10px] text-muted-foreground">Failed</p>
            </div>
            <div>
              <p className="font-mono text-lg font-bold">{result.rowsTotal}</p>
              <p className="text-[10px] text-muted-foreground">Total rows</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Validation errors ({result.errors.length} shown)
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <p key={i} className="text-[11px] text-red-400/90">
                    Row {e.row} · <span className="font-mono">{e.field}</span>: {e.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          <Button size="sm" variant="outline" className="border-border/40" onClick={clearFile}>
            Import Another File
          </Button>
        </div>
      )}
    </div>
  );
}
