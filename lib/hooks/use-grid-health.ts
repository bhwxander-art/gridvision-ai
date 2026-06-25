"use client";

import { useCallback, useEffect, useState } from "react";
import type { GridHealthResult } from "@/lib/health/grid-health";

interface UseGridHealthResult {
  result: GridHealthResult | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useGridHealth(refetchIntervalMs = 120_000): UseGridHealthResult {
  const [result, setResult] = useState<GridHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/grid/health-score", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`
          );
        }
        return res.json().catch(() => {
          throw new Error("Invalid JSON in health-score response");
        }) as Promise<GridHealthResult>;
      })
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => controller.abort();
  }, [fetchKey]);

  useEffect(() => {
    const interval = setInterval(refetch, refetchIntervalMs);
    return () => clearInterval(interval);
  }, [refetchIntervalMs, refetch]);

  return { result, loading, error, refetch };
}
