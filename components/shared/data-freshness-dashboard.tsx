"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface FreshnessInfo {
  lastUpdate: string | null;
  ageMinutes: number | null;
  stale: boolean;
}

interface DataFreshnessStatus {
  isoNeLoad: FreshnessInfo;
  capacity: FreshnessInfo;
  assets: FreshnessInfo;
  accounts: FreshnessInfo;
  timestamp: string;
}

interface FreshnessItemProps {
  label: string;
  info: FreshnessInfo;
}

const formatAge = (minutes: number | null): string => {
  if (minutes === null) return "Never";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
};

function FreshnessItem({ label, info }: FreshnessItemProps) {
  if (info.stale) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-red-400" />
          <div>
            <p className="text-xs font-medium text-foreground">{label}</p>
            <p className="text-[10px] text-muted-foreground">
              {info.ageMinutes ? `Last update: ${formatAge(info.ageMinutes)} ago` : "No data"}
            </p>
          </div>
        </div>
        <Badge variant="destructive" className="text-[9px]">
          Stale
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 text-green-400" />
        <div>
          <p className="text-xs font-medium text-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground">
            Updated {formatAge(info.ageMinutes)} ago
          </p>
        </div>
      </div>
      <Badge variant="outline" className="border-green-500/30 text-[9px] text-green-300">
        Fresh
      </Badge>
    </div>
  );
}

export function DataFreshnessDashboard() {
  const [status, setStatus] = useState<DataFreshnessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchFreshness = async () => {
      try {
        const res = await fetch("/api/system/data-freshness");
        if (!res.ok) throw new Error("Failed to fetch data freshness");
        const data = await res.json();
        setStatus(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
      } finally {
        setLoading(false);
      }
    };

    fetchFreshness();
  }, []);

  if (loading) {
    return (
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-400" />
            Data Freshness
          </CardTitle>
          <CardDescription className="text-xs">System data update status</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !status) {
    return (
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-400" />
            Data Freshness
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4" />
            Failed to load freshness status
          </div>
        </CardContent>
      </Card>
    );
  }

  const staleCount = [
    status.isoNeLoad.stale,
    status.capacity.stale,
    status.assets.stale,
    status.accounts.stale,
  ].filter(Boolean).length;

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-400" />
            <CardTitle className="text-sm">Data Freshness</CardTitle>
          </div>
          {staleCount > 0 && (
            <Badge variant="destructive" className="text-[9px]">
              {staleCount} stale
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">System data update status</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-2">
          <FreshnessItem label="ISO-NE Load Data" info={status.isoNeLoad} />
          <FreshnessItem label="Substation Capacity" info={status.capacity} />
          <FreshnessItem label="Assets" info={status.assets} />
          <FreshnessItem label="Accounts" info={status.accounts} />
        </div>
      </CardContent>
    </Card>
  );
}
