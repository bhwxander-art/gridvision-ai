"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataCenterInterconnection } from "@/lib/types";
import type { ProvenanceInfo } from "@/lib/provenance";
import { fetchDataCenterQueue } from "@/lib/services/datacenter.service";

interface UseDataCenterQueueResult {
  data: DataCenterInterconnection[] | null;
  provenance: ProvenanceInfo | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useDataCenterQueue(): UseDataCenterQueueResult {
  const [data, setData] = useState<DataCenterInterconnection[] | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchDataCenterQueue({ signal: controller.signal })
      .then((resp) => {
        setData(resp.queue);
        setProvenance(resp._provenance);
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
