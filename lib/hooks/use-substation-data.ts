"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchSubstationData,
  type SubstationServiceData,
} from "@/lib/services/substation.service";
import type { ProvenanceInfo } from "@/lib/provenance";

interface UseSubstationDataResult {
  data: SubstationServiceData | null;
  provenance: ProvenanceInfo | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useSubstationData(): UseSubstationDataResult {
  const [data, setData] = useState<SubstationServiceData | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceInfo | null>(null);
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
        setProvenance(d._provenance ?? null);
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

  return { data, provenance, loading, error, refetch };
}
