import type { GridLoad, AnalyticsData, GridStatusResponse } from "@/lib/types";
import { fetchWithRetry } from "@/lib/api/retry";
import {
  loadGrowthData,
  evImpactData,
  dataCenterImpactData,
  monthlyLoadTrend,
} from "@/lib/sample-data";

// ── Analytics fallback data ────────────────────────────────────────────────

const MOCK_ANALYTICS: AnalyticsData = {
  loadGrowth: loadGrowthData,
  evImpact: evImpactData,
  dataCenterImpact: dataCenterImpactData,
  monthlyTrend: monthlyLoadTrend,
};

// ── Service functions ──────────────────────────────────────────────────────

/**
 * Fetches the current grid status from GET /api/grid.
 * Throws if the API is unavailable — callers handle the error.
 */
export async function fetchGridStatus(opts?: {
  signal?: AbortSignal;
}): Promise<GridStatusResponse> {
  return fetchWithRetry<GridStatusResponse>("/api/grid", {
    signal: opts?.signal,
  });
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
    currentLoadMW: status.currentLoadMW,
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
