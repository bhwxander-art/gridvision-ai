import type { GridLoad, AnalyticsData, GridStatusResponse } from "@/lib/types";
import { fetchWithRetry } from "@/lib/api/retry";
import {
  loadGrowthData,
  evImpactData,
  dataCenterImpactData,
  monthlyLoadTrend,
} from "@/lib/sample-data";

// ── Fallback (mock) values ─────────────────────────────────────────────────

const MOCK_GRID_STATUS: GridStatusResponse = {
  currentLoad: 16842,
  peakCapacityMW: 4820,
  utilizationPct: 34.9,
  substationSummary: { total: 4, constrained: 2, critical: 1 },
  dcQueueMW: 262,
  source: "GridVision (mock)",
  timestamp: new Date().toISOString(),
};

const MOCK_ANALYTICS: AnalyticsData = {
  loadGrowth: loadGrowthData,
  evImpact: evImpactData,
  dataCenterImpact: dataCenterImpactData,
  monthlyTrend: monthlyLoadTrend,
};

// ── DB source (server-side only, dynamically imported) ──────────────────────

async function fetchGridLoadFromDb(): Promise<GridLoad | null> {
  const { isDbConfigured, getServerClient } = await import("@/lib/db/client");
  if (!isDbConfigured()) return null;

  const { GridLoadRepository } = await import(
    "@/lib/db/repositories/grid-load.repository"
  );
  const repo = new GridLoadRepository(getServerClient());
  return repo.getLatest();
}

// ── Service functions ──────────────────────────────────────────────────────

/**
 * Fetches the current grid status from the highest-priority available source:
 *   1. Supabase grid_load_history  (latest reading, server-side only)
 *   2. GET /api/grid  (HTTP fetch)
 *   3. In-memory mock
 */
export async function fetchGridStatus(opts?: {
  signal?: AbortSignal;
}): Promise<GridStatusResponse> {
  // ── 1. DB (server-side only) ──────────────────────────────────────────────
  if (typeof window === "undefined") {
    try {
      const dbLoad = await fetchGridLoadFromDb();
      if (dbLoad) {
        return {
          currentLoad: dbLoad.currentLoad,
          peakCapacityMW: MOCK_GRID_STATUS.peakCapacityMW,
          utilizationPct:
            Math.round(
              (dbLoad.currentLoad / MOCK_GRID_STATUS.peakCapacityMW) * 1000
            ) / 10,
          substationSummary: MOCK_GRID_STATUS.substationSummary,
          dcQueueMW: MOCK_GRID_STATUS.dcQueueMW,
          source: dbLoad.source,
          timestamp: dbLoad.timestamp,
        };
      }
    } catch (dbErr) {
      if (dbErr instanceof DOMException && dbErr.name === "AbortError") throw dbErr;
    }
  }

  // ── 2. API route ──────────────────────────────────────────────────────────
  try {
    return await fetchWithRetry<GridStatusResponse>("/api/grid", {
      signal: opts?.signal,
    });
  } catch (apiErr) {
    if (apiErr instanceof DOMException && apiErr.name === "AbortError") throw apiErr;
  }

  // ── 3. Mock fallback ──────────────────────────────────────────────────────
  return { ...MOCK_GRID_STATUS, timestamp: new Date().toISOString() };
}

/**
 * Derives a GridLoad from the grid status.
 * Kept for backward compatibility with useGridLoad.
 */
export async function fetchGridLoad(opts?: {
  signal?: AbortSignal;
}): Promise<GridLoad> {
  const status = await fetchGridStatus(opts);
  return {
    source: status.source,
    currentLoad: status.currentLoad,
    timestamp: status.timestamp,
  };
}

/**
 * Fetches analytics data (load growth, EV/DC impact, monthly trend).
 * Source priority: API → mock.
 * (Analytics data is not yet stored in the database schema.)
 */
export async function fetchAnalyticsData(opts?: {
  signal?: AbortSignal;
}): Promise<AnalyticsData> {
  try {
    return await fetchWithRetry<AnalyticsData>("/api/analytics", {
      signal: opts?.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return MOCK_ANALYTICS;
  }
}
