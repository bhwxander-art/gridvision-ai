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

// ── Fallback (mock) value ──────────────────────────────────────────────────

function buildMockData(): SubstationServiceData {
  return {
    portfolio: substationPortfolio,
    trend: transformerLoadingTrend,
    simple: substations,
    config: { territory: planningTerritory, loadGrowthAssumptions },
    _provenance: mockProvenance(),
  };
}

// ── Source priority: DB → API → Mock ──────────────────────────────────────
//
// Server-side (typeof window === "undefined"):
//   1. Query Supabase directly via SubstationRepository (fastest, no HTTP round-trip)
//   2. Fall back to API route (handles its own DB/mock logic)
//   3. Fall back to in-memory mock
//
// Client-side:
//   1. Call the /api/substations route (which internally tries DB → mock)
//   2. Fall back to in-memory mock

// ── Service function ────────────────────────────────────────────────────────

/**
 * Fetches the full substation dataset from the highest-priority available source:
 *   1. GET /api/substations  (HTTP fetch; API route handles DB → mock internally)
 *   2. In-memory mock data  (always available as last resort)
 *
 * The return type is identical regardless of source — callers are source-agnostic.
 */
export async function fetchSubstationData(opts?: {
  signal?: AbortSignal;
}): Promise<SubstationServiceData> {
  // ── 1. API route ──────────────────────────────────────────────────────────
  try {
    return await fetchWithRetry<SubstationServiceData>("/api/substations", {
      signal: opts?.signal,
    });
  } catch (apiErr) {
    if (apiErr instanceof DOMException && apiErr.name === "AbortError") throw apiErr;
  }

  // ── 2. Mock fallback ──────────────────────────────────────────────────────
  return buildMockData();
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
