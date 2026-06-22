"use client";

import { useCallback, useEffect, useState } from "react";
import type { ForecastResult } from "@/lib/forecast-engine";

interface UseForecastResult {
  data: ForecastResult | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useForecast(): UseForecastResult {
  const [data, setData] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/forecast", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Forecast API returned ${res.status}`);
        return res.json() as Promise<ForecastResult>;
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
