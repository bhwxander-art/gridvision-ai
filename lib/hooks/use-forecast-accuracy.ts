"use client";

import { useEffect, useState } from "react";

interface ForecastRecord {
  timestamp: string;
  actualMW: number;
  forecastMW: number;
  errorPct: number;
}

export interface ForecastAccuracyAvailable {
  available: true;
  records: ForecastRecord[];
  mape: number;
  rmse: number;
  accuracyPct: number;
  recordCount: number;
}

export interface ForecastAccuracyUnavailable {
  available: false;
  reason: string;
  recordCount: number;
}

export type ForecastAccuracyData = ForecastAccuracyAvailable | ForecastAccuracyUnavailable;

export function useForecastAccuracy(): {
  data: ForecastAccuracyData | null;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<ForecastAccuracyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/analytics/forecast-accuracy", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ForecastAccuracyData>;
      })
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  return { data, loading, error };
}
