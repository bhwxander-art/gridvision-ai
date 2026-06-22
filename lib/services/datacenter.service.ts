import type { DataCenterInterconnection } from "@/lib/types";
import { fetchWithRetry } from "@/lib/api/retry";
import { dataCenterQueue } from "@/lib/enterprise-data";

// ── Mock fallback ──────────────────────────────────────────────────────────

const MOCK_QUEUE = dataCenterQueue;

// ── DB source (server-side only, dynamically imported) ──────────────────────

async function fetchFromDb(): Promise<DataCenterInterconnection[]> {
  const { isDbConfigured, getServerClient } = await import("@/lib/db/client");
  if (!isDbConfigured()) throw new Error("Supabase not configured");

  const { DataCenterRepository } = await import(
    "@/lib/db/repositories/datacenter.repository"
  );
  const repo = new DataCenterRepository(getServerClient());
  return repo.findAll();
}

// ── Service function ────────────────────────────────────────────────────────

/**
 * Fetches the active data-center interconnection queue from the highest-priority
 * available source:
 *   1. Supabase database  (server-side only, requires NEXT_PUBLIC_SUPABASE_URL)
 *   2. GET /api/datacenters  (HTTP fetch; works client- and server-side)
 *   3. In-memory mock data  (always available as last resort)
 */
export async function fetchDataCenterQueue(opts?: {
  signal?: AbortSignal;
}): Promise<DataCenterInterconnection[]> {
  // ── 1. DB (server-side only) ──────────────────────────────────────────────
  if (typeof window === "undefined") {
    try {
      return await fetchFromDb();
    } catch (dbErr) {
      if (dbErr instanceof DOMException && dbErr.name === "AbortError") throw dbErr;
    }
  }

  // ── 2. API route ──────────────────────────────────────────────────────────
  try {
    return await fetchWithRetry<DataCenterInterconnection[]>("/api/datacenters", {
      signal: opts?.signal,
    });
  } catch (apiErr) {
    if (apiErr instanceof DOMException && apiErr.name === "AbortError") throw apiErr;
  }

  // ── 3. Mock fallback ──────────────────────────────────────────────────────
  return MOCK_QUEUE;
}
