import { NextResponse } from "next/server";
import type { GridStatusResponse } from "@/lib/types";
import {
  substationPortfolio,
  dataCenterQueue,
  planningTerritory,
  TERRITORY_CAPACITY_MW,
} from "@/lib/enterprise-data";
import { assessSubstationCapacity } from "@/lib/planning-engine";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { GridLoadRepository } from "@/lib/db/repositories/grid-load.repository";
import { fetchISONeGridLoad } from "@/lib/adapters/isone.adapter";
import { makeProvenance, mockProvenance } from "@/lib/provenance";

// Representative Eastern MA territory load for the static/mock path.
// Replace with zone-level ISO-NE fetch (/fiveminuteload/{zoneId}) for live data.
const TERRITORY_MOCK_LOAD_MW = 3_984;

function buildBaseStatus(): Omit<GridStatusResponse, "source" | "timestamp" | "freshness" | "isMock" | "_provenance"> {
  const results = substationPortfolio.map((ss) =>
    assessSubstationCapacity(ss, planningTerritory.planningHorizonYears)
  );
  return {
    currentLoadMW: TERRITORY_MOCK_LOAD_MW,
    peakSystemLoadMW: planningTerritory.peakSystemLoadMW,
    systemCapacityMW: TERRITORY_CAPACITY_MW,
    utilizationPct: Math.round((TERRITORY_MOCK_LOAD_MW / TERRITORY_CAPACITY_MW) * 1000) / 10,
    substationSummary: {
      total: substationPortfolio.length,
      constrained: results.filter((r) => r.severity === "constrained").length,
      critical: results.filter((r) => r.severity === "critical").length,
    },
    dcQueueMW: dataCenterQueue.reduce((s, d) => s + d.requestedMW, 0),
  };
}

function mergeLoad(
  base: ReturnType<typeof buildBaseStatus>,
  currentLoadMW: number,
  source: string,
  timestamp: string,
  isMock: boolean
): GridStatusResponse {
  const prov = makeProvenance(source, timestamp, isMock);
  return {
    ...base,
    currentLoadMW,
    utilizationPct: Math.round((currentLoadMW / base.systemCapacityMW) * 1000) / 10,
    source,
    timestamp,
    freshness: prov.freshness,
    isMock,
    _provenance: prov,
  };
}

export async function GET(): Promise<NextResponse<GridStatusResponse>> {
  const base = buildBaseStatus();

  // ── 1. ISO New England live load ───────────────────────────────────────────
  try {
    const iso = await fetchISONeGridLoad();
    return NextResponse.json(
      mergeLoad(base, iso.currentLoadMW, iso.source, iso.timestamp, iso.provenance.dataQuality === "mock"),
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600", "X-Data-Source": iso.provenance.dataQuality } }
    );
  } catch {
    // fall through
  }

  // ── 2. Database ────────────────────────────────────────────────────────────
  if (isDbConfigured()) {
    try {
      const repo = new GridLoadRepository(getServerClient());
      const latest = await repo.getLatest();
      if (latest) {
        return NextResponse.json(
          mergeLoad(base, latest.currentLoadMW, latest.source, latest.timestamp, false),
          { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60", "X-Data-Source": "db" } }
        );
      }
    } catch (dbErr) {
      console.error("[api/grid] DB error:", dbErr);
    }
  }

  // ── 3. Mock fallback ────────────────────────────────────────────────────────
  const prov = mockProvenance("GridVision");
  return NextResponse.json(
    { ...base, source: prov.source, timestamp: prov.timestamp, freshness: "mock" as const, isMock: true, _provenance: prov },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60", "X-Data-Source": "mock" } }
  );
}
