"use client";

import { useCallback, useEffect, useState } from "react";

export interface IsoLoadData {
  current_load_mw: number;
  forecast_load_mw: number;
  timestamp: string;
  source: string;
  freshness: "live" | "delayed";
}

interface UseIsoLoadResult {
  data: IsoLoadData | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch current ISO-NE system load from /api/load/iso-current
 * Automatically refetches every 60 seconds
 */
export function useIsoLoad(refetchIntervalMs: number = 60000): UseIsoLoadResult {
  const [data, setData] = useState<IsoLoadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/load/iso-current", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<IsoLoadData>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => controller.abort();
  }, [fetchKey]);

  // Auto-refetch on interval
  useEffect(() => {
    const interval = setInterval(() => refetch(), refetchIntervalMs);
    return () => clearInterval(interval);
  }, [refetchIntervalMs, refetch]);

  return { data, loading, error, refetch };
}
