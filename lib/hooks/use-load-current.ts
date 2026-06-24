"use client";

import { useCallback, useEffect, useState } from "react";
import type { GridLoad } from "@/lib/types";

// Shape returned by GET /api/load/current
export interface LoadCurrentResponse {
  source: string;
  currentLoadMW: number;
  timestamp: string;
  freshness: "live" | "delayed" | "mock";
  territory: string;
}

interface UseLoadCurrentResult {
  data: LoadCurrentResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useLoadCurrent(): UseLoadCurrentResult {
  const [data, setData] = useState<LoadCurrentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/load/current", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`/api/load/current returned ${res.status}`);
        return res.json() as Promise<LoadCurrentResponse>;
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

  return { data, loading, error, refetch };
}
