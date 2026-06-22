"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchSubstationData,
  type SubstationServiceData,
} from "@/lib/services/substation.service";

interface UseSubstationDataResult {
  data: SubstationServiceData | null;
  loading: boolean;
  error: Error | null;
  /** Trigger a fresh fetch (e.g. on user-initiated retry). */
  refetch: () => void;
}

export function useSubstationData(): UseSubstationDataResult {
  const [data, setData] = useState<SubstationServiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchSubstationData({ signal: controller.signal })
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
