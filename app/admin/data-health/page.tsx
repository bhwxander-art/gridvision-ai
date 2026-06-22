"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataHealthResponse, SourceStatus } from "@/app/api/admin/data-health/route";

const STATUS_STYLES: Record<SourceStatus["status"], { dot: string; badge: string; label: string }> = {
  live:          { dot: "bg-emerald-400 animate-pulse", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "LIVE" },
  mock:          { dot: "bg-slate-400",                 badge: "bg-slate-500/15 text-slate-400 border-slate-500/30",       label: "MOCK" },
  unconfigured:  { dot: "bg-yellow-400",                badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",   label: "UNCONFIGURED" },
  error:         { dot: "bg-red-400",                   badge: "bg-red-500/15 text-red-400 border-red-500/30",             label: "ERROR" },
};

function SourceCard({ source }: { source: SourceStatus }) {
  const s = STATUS_STYLES[source.status];
  return (
    <div className="rounded-lg border border-border/50 bg-[#0d1219]/80 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
          <h2 className="text-sm font-semibold">{source.name}</h2>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-widest ${s.badge}`}>
          {s.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Latency</p>
          <p className="mt-1 font-mono text-sm">
            {source.latencyMs !== null ? `${source.latencyMs} ms` : "—"}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Checked</p>
          <p className="mt-1 font-mono text-sm">
            {new Date(source.checkedAt).toLocaleTimeString()}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{source.detail}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      Checking sources…
    </div>
  );
}

export default function DataHealthPage() {
  const [data, setData] = useState<DataHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCountdown(30);
    try {
      const res = await fetch("/api/admin/data-health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // auto-refresh every 30 s
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { refresh(); return 30; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const sources = data ? Object.values(data.sources) : [];
  const liveCount = sources.filter((s) => s.status === "live").length;

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live status of every external data source used by GridVision AI.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && data && (
            <span className="text-xs text-muted-foreground">
              {liveCount}/{sources.length} live · refreshes in {countdown}s
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="py-12 text-center">
          <Spinner />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Health check failed: {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SourceCard source={data.sources.isone} />
            <SourceCard source={data.sources.eia} />
            <SourceCard source={data.sources.census} />
            <SourceCard source={data.sources.supabase} />
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Last checked at {new Date(data.checkedAt).toLocaleTimeString()} ·{" "}
            <span className="font-mono">/api/admin/data-health</span>
          </p>
        </>
      )}
    </div>
  );
}
