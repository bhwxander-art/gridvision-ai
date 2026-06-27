import "server-only";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { LoadRepository } from "@/lib/db/repositories/load.repository";
import { computeGridHealth } from "@/lib/health/grid-health";
import type { GridContextSnapshot } from "./types";

const CAPACITY_MW = 8_400;

export async function buildGridContextSnapshot(): Promise<GridContextSnapshot> {
  const fetchedAt = new Date().toISOString();

  if (!isDbConfigured()) {
    return {
      currentLoadMW: null,
      forecastLoadMW: null,
      loadTimestamp: null,
      healthScore: null,
      healthStatus: null,
      healthRecommendation: null,
      capacityMW: CAPACITY_MW,
      utilizationPct: null,
      historyCount: null,
      avgLoad24hMW: null,
      peakLoad24hMW: null,
      fetchedAt,
    };
  }

  try {
    const client = getServerClient();
    const repo = new LoadRepository(client);

    const [current, history] = await Promise.all([
      repo.getCurrent(),
      repo.getHistory(24),
    ]);

    if (!current) {
      return {
        currentLoadMW: null,
        forecastLoadMW: null,
        loadTimestamp: null,
        healthScore: null,
        healthStatus: null,
        healthRecommendation: null,
        capacityMW: CAPACITY_MW,
        utilizationPct: null,
        historyCount: history.length,
        avgLoad24hMW: null,
        peakLoad24hMW: null,
        fetchedAt,
      };
    }

    const health = computeGridHealth({
      currentLoadMW: current.currentLoadMW,
      historyReadings: history.map((r) => ({
        timestamp: r.timestamp,
        currentLoadMW: r.currentLoadMW,
      })),
      referenceCapacityMW: CAPACITY_MW,
    });

    const avgLoad24hMW =
      history.length > 0
        ? Math.round(
            history.reduce((s, r) => s + r.currentLoadMW, 0) / history.length
          )
        : null;

    const peakLoad24hMW =
      history.length > 0
        ? Math.max(...history.map((r) => r.currentLoadMW))
        : null;

    const utilizationPct =
      current.currentLoadMW != null && CAPACITY_MW > 0
        ? Math.round((current.currentLoadMW / CAPACITY_MW) * 100)
        : null;

    return {
      currentLoadMW: current.currentLoadMW,
      forecastLoadMW: current.forecastLoadMW || null,
      loadTimestamp: current.timestamp,
      healthScore: health.score,
      healthStatus: health.status,
      healthRecommendation: health.recommendation,
      capacityMW: CAPACITY_MW,
      utilizationPct,
      historyCount: history.length,
      avgLoad24hMW,
      peakLoad24hMW,
      fetchedAt,
    };
  } catch (err) {
    console.error("[buildGridContextSnapshot]", err);
    return {
      currentLoadMW: null,
      forecastLoadMW: null,
      loadTimestamp: null,
      healthScore: null,
      healthStatus: null,
      healthRecommendation: null,
      capacityMW: CAPACITY_MW,
      utilizationPct: null,
      historyCount: null,
      avgLoad24hMW: null,
      peakLoad24hMW: null,
      fetchedAt,
    };
  }
}

export function formatContextForPrompt(snapshot: GridContextSnapshot): string {
  const lines: string[] = [
    "=== ISO-NE GRID CONTEXT SNAPSHOT ===",
    `Fetched At: ${snapshot.fetchedAt}`,
    "",
    "=== LIVE LOAD ===",
    snapshot.currentLoadMW != null
      ? `Current Load: ${snapshot.currentLoadMW.toLocaleString()} MW`
      : "Current Load: unavailable",
    snapshot.forecastLoadMW != null
      ? `Forecast Load: ${snapshot.forecastLoadMW.toLocaleString()} MW`
      : "Forecast Load: unavailable",
    snapshot.loadTimestamp
      ? `Last Reading: ${snapshot.loadTimestamp}`
      : "Last Reading: unavailable",
    "",
    "=== CAPACITY ===",
    `Reference Capacity: ${snapshot.capacityMW.toLocaleString()} MW`,
    snapshot.utilizationPct != null
      ? `Utilization: ${snapshot.utilizationPct}%`
      : "Utilization: unavailable",
    "",
    "=== GRID HEALTH ===",
    snapshot.healthScore != null
      ? `Health Score: ${snapshot.healthScore}/100`
      : "Health Score: unavailable",
    snapshot.healthStatus
      ? `Status: ${snapshot.healthStatus.toUpperCase()}`
      : "Status: unavailable",
    snapshot.healthRecommendation
      ? `Recommendation: ${snapshot.healthRecommendation}`
      : "Recommendation: unavailable",
    "",
    "=== 24-HOUR HISTORY ===",
    snapshot.historyCount != null
      ? `Data Points: ${snapshot.historyCount}`
      : "Data Points: unavailable",
    snapshot.avgLoad24hMW != null
      ? `24h Average Load: ${snapshot.avgLoad24hMW.toLocaleString()} MW`
      : "24h Average Load: unavailable",
    snapshot.peakLoad24hMW != null
      ? `24h Peak Load: ${snapshot.peakLoad24hMW.toLocaleString()} MW`
      : "24h Peak Load: unavailable",
    "",
    "=== END CONTEXT ===",
  ];

  return lines.join("\n");
}
