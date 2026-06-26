"use client";

import { useCallback, useEffect, useState } from "react";
import type { CurrentForecastResponse } from "@/app/api/forecast/current/route";
import type { ForecastHistoryResponse } from "@/app/api/forecast/history/route";

export type { CurrentForecastResponse, ForecastHistoryResponse };

// ── Current 24h forecast ──────────────────────────────────────────────────────

interface UseIsoForecastCurrentResult {
  data: CurrentForecastResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useIsoForecastCurrent(): UseIsoForecastCurrentResult {
  const [data, setData] = useState<CurrentForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/forecast/current", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`
          );
        }
        return res.json() as Promise<CurrentForecastResponse>;
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

// ── Forecast history ──────────────────────────────────────────────────────────

interface UseIsoForecastHistoryResult {
  data: ForecastHistoryResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useIsoForecastHistory(days = 7): UseIsoForecastHistoryResult {
  const [data, setData] = useState<ForecastHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/forecast/history?days=${days}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`
          );
        }
        return res.json() as Promise<ForecastHistoryResponse>;
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
  }, [days]);

  return { data, loading, error };
}
