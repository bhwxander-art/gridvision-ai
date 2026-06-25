"use client";

import { useCallback, useEffect, useState } from "react";

export interface IsoReadingPoint {
  currentLoadMW: number;
  forecastLoadMW: number;
  timestamp: string;
}

interface UseIsoHistoryResult {
  readings: IsoReadingPoint[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useIsoHistory(
  hours = 24,
  refetchIntervalMs = 300_000
): UseIsoHistoryResult {
  const [readings, setReadings] = useState<IsoReadingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/load/iso-history?hours=${hours}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`
          );
        }
        return res.json() as Promise<{ readings: IsoReadingPoint[] }>;
      })
      .then((data) => {
        setReadings(data.readings ?? []);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => controller.abort();
  }, [fetchKey, hours]);

  useEffect(() => {
    const interval = setInterval(refetch, refetchIntervalMs);
    return () => clearInterval(interval);
  }, [refetchIntervalMs, refetch]);

  return { readings, loading, error, refetch };
}
