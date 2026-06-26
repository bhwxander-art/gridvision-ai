import type {
  SubstationPlan,
  FeederCircuit,
  Substation,
  TransformerLoadingPoint,
  PlanningConfig,
} from "@/lib/types";
import { fetchWithRetry } from "@/lib/api/retry";
import {
  substationPortfolio,
  planningTerritory,
  loadGrowthAssumptions,
  transformerLoadingTrend,
} from "@/lib/enterprise-data";
import { substations } from "@/lib/sample-data";
import { type ProvenanceInfo, mockProvenance } from "@/lib/provenance";

// ── Service response shape ─────────────────────────────────────────────────

export interface SubstationServiceData {
  portfolio: SubstationPlan[];
  trend: TransformerLoadingPoint[];
  simple: Substation[];
  config: PlanningConfig;
  _provenance?: ProvenanceInfo;
}

/** Which data source successfully provided the data. */
export type DataSourceTag = "db" | "api" | "mock";

// ── Fallback (mock) value — used only in development ──────────────────────

function buildMockData(): SubstationServiceData {
  return {
    portfolio: substationPortfolio,
    trend: transformerLoadingTrend,
    simple: substations,
    config: { territory: planningTerritory, loadGrowthAssumptions },
    _provenance: mockProvenance(),
  };
}

// ── Service function ────────────────────────────────────────────────────────

/**
 * Fetches the full substation dataset from the highest-priority available source:
 *   1. GET /api/substations  (HTTP fetch; API route handles DB → mock internally)
 *   2. In-memory mock data   (development fallback only — not used in production)
 *
 * The return type is identical regardless of source — callers are source-agnostic.
 */
export async function fetchSubstationData(opts?: {
  signal?: AbortSignal;
}): Promise<SubstationServiceData> {
  // ── 1. API route ──────────────────────────────────────────────────────────
  try {
    const data = await fetchWithRetry<SubstationServiceData>("/api/substations", {
      signal: opts?.signal,
    });

    // Warn in production when API returns mock data (no real DB data configured)
    if (
      data._provenance?.freshness === "mock" &&
      typeof process !== "undefined" &&
      process.env.NODE_ENV !== "development" &&
      process.env.NEXT_PUBLIC_USE_MOCK_DATA !== "true"
    ) {
      console.warn(
        "[substation.service] API returned mock data in a non-dev environment. " +
        "Ensure substations are seeded in the database for this tenant."
      );
    }

    return data;
  } catch (apiErr) {
    if (apiErr instanceof DOMException && apiErr.name === "AbortError") throw apiErr;

    // Only fall back to in-memory mock in development
    const isDev =
      typeof process !== "undefined" &&
      (process.env.NODE_ENV === "development" ||
        process.env.NEXT_PUBLIC_USE_MOCK_DATA === "true");

    if (isDev) {
      return buildMockData();
    }

    // In production, propagate the error rather than silently serving stale data
    throw apiErr;
  }
}

/**
 * Pure lookup helper — finds a feeder and its parent substation by feeder ID.
 * Operates on already-loaded portfolio data; performs no I/O.
 */
export function findFeederById(
  feederId: string,
  portfolio: SubstationPlan[]
): { feeder: FeederCircuit; substation: SubstationPlan } | undefined {
  for (const ss of portfolio) {
    const feeder = ss.feeders.find((f) => f.id === feederId);
    if (feeder) return { feeder, substation: ss };
  }
  return undefined;
}
