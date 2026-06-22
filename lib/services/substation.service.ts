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

// ── Service response shape ─────────────────────────────────────────────────

export interface SubstationServiceData {
  portfolio: SubstationPlan[];
  trend: TransformerLoadingPoint[];
  simple: Substation[];
  config: PlanningConfig;
}

/** Which data source successfully provided the data. */
export type DataSourceTag = "db" | "api" | "mock";

// ── Fallback (mock) value ──────────────────────────────────────────────────

const MOCK_DATA: SubstationServiceData = {
  portfolio: substationPortfolio,
  trend: transformerLoadingTrend,
  simple: substations,
  config: {
    territory: planningTerritory,
    loadGrowthAssumptions,
  },
};

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

// ── DB source (server-side only, dynamically imported) ──────────────────────

async function fetchFromDb(): Promise<SubstationServiceData> {
  // Dynamic import keeps @supabase/supabase-js out of the client bundle
  const { isDbConfigured, getServerClient } = await import("@/lib/db/client");
  if (!isDbConfigured()) throw new Error("Supabase not configured");

  const { SubstationRepository } = await import(
    "@/lib/db/repositories/substation.repository"
  );
  const repo = new SubstationRepository(getServerClient());
  const portfolio = await repo.findAll();

  // Derive the simple marketing-layer substations from the enterprise portfolio
  const simple: Substation[] = portfolio.map((ss) => {
    const util = ss.peakLoadMW / ss.nameplateMVA;
    const status: Substation["status"] =
      util >= 0.95 ? "capacity-risk" : util >= 0.80 ? "warning" : "normal";
    return {
      id: ss.id.replace("ss-", ""),
      name: ss.name.split(" ").slice(0, 2).join(" "),
      status,
      load: ss.peakLoadMW,
      capacity: ss.nameplateMVA,
      latitude: ss.latitude,
      longitude: ss.longitude,
      region: ss.region,
    };
  });

  return {
    portfolio,
    trend: transformerLoadingTrend,       // trend history not yet in DB schema
    simple,
    config: { territory: planningTerritory, loadGrowthAssumptions },
  };
}

// ── Service function ────────────────────────────────────────────────────────

/**
 * Fetches the full substation dataset from the highest-priority available source:
 *   1. Supabase database  (server-side only, requires NEXT_PUBLIC_SUPABASE_URL)
 *   2. GET /api/substations  (HTTP fetch; works client- and server-side)
 *   3. In-memory mock data  (always available as last resort)
 *
 * The return type is identical regardless of source — callers are source-agnostic.
 */
export async function fetchSubstationData(opts?: {
  signal?: AbortSignal;
}): Promise<SubstationServiceData> {
  // ── 1. DB (server-side only) ──────────────────────────────────────────────
  if (typeof window === "undefined") {
    try {
      return await fetchFromDb();
    } catch (dbErr) {
      if (dbErr instanceof DOMException && dbErr.name === "AbortError") throw dbErr;
      // DB not configured or failed — continue to API
    }
  }

  // ── 2. API route ──────────────────────────────────────────────────────────
  try {
    return await fetchWithRetry<SubstationServiceData>("/api/substations", {
      signal: opts?.signal,
    });
  } catch (apiErr) {
    if (apiErr instanceof DOMException && apiErr.name === "AbortError") throw apiErr;
    // API failed — fall through to mock
  }

  // ── 3. Mock fallback ──────────────────────────────────────────────────────
  return MOCK_DATA;
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
