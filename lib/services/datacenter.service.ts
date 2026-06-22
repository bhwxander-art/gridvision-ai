import type { DataCenterInterconnection, DataCenterQueueResponse } from "@/lib/types";
import { fetchWithRetry } from "@/lib/api/retry";
import { dataCenterQueue } from "@/lib/enterprise-data";
import { mockProvenance } from "@/lib/provenance";

// ── Service function ────────────────────────────────────────────────────────

/**
 * Fetches the active data-center interconnection queue from the highest-priority
 * available source:
 *   1. GET /api/datacenters  (HTTP fetch; API route handles DB → mock internally)
 *   2. In-memory mock data  (always available as last resort)
 */
export async function fetchDataCenterQueue(opts?: {
  signal?: AbortSignal;
}): Promise<DataCenterQueueResponse> {
  // ── 1. API route ──────────────────────────────────────────────────────────
  try {
    return await fetchWithRetry<DataCenterQueueResponse>("/api/datacenters", {
      signal: opts?.signal,
    });
  } catch (apiErr) {
    if (apiErr instanceof DOMException && apiErr.name === "AbortError") throw apiErr;
  }

  // ── 2. Mock fallback ──────────────────────────────────────────────────────
  return { queue: dataCenterQueue, _provenance: mockProvenance() };
}
