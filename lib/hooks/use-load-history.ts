"use client";

import { useCallback, useEffect, useState } from "react";
import type { GridLoad } from "@/lib/types";

// Shape returned by GET /api/load/history
export interface LoadHistoryResponse {
  territory: string;
  count: number;
  from: string | null;
  to: string | null;
  readings: GridLoad[];
}

interface UseLoadHistoryResult {
  data: LoadHistoryResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useLoadHistory(limit = 96): UseLoadHistoryResult {
  const [data, setData] = useState<LoadHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/load/history?limit=${limit}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`/api/load/history returned ${res.status}`);
        return res.json() as Promise<LoadHistoryResponse>;
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
  }, [fetchKey, limit]);

  return { data, loading, error, refetch };
}
