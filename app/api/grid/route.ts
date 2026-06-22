import { NextResponse } from "next/server";
import type { GridStatusResponse } from "@/lib/types";
import {
  substationPortfolio,
  dataCenterQueue,
  planningTerritory,
} from "@/lib/enterprise-data";
import { assessSubstationCapacity } from "@/lib/planning-engine";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { GridLoadRepository } from "@/lib/db/repositories/grid-load.repository";
import { fetchISONeGridLoad } from "@/lib/adapters/isone.adapter";
import { makeProvenance, mockProvenance } from "@/lib/provenance";

function buildBaseStatus(): Omit<GridStatusResponse, "source" | "timestamp" | "freshness" | "isMock"> {
  const results = substationPortfolio.map((ss) =>
    assessSubstationCapacity(ss, planningTerritory.planningHorizonYears)
  );
  return {
    currentLoad: 16842,
    peakCapacityMW: planningTerritory.peakSystemLoadMW,
    utilizationPct: Math.round((16842 / planningTerritory.peakSystemLoadMW) * 1000) / 10,
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
  currentLoad: number,
  source: string,
  timestamp: string,
  isMock: boolean
): GridStatusResponse {
  const prov = makeProvenance(source, timestamp, isMock);
  return {
    ...base,
    currentLoad,
    utilizationPct: Math.round((currentLoad / base.peakCapacityMW) * 1000) / 10,
    source,
    timestamp,
    freshness: prov.freshness,
    isMock,
  };
}

export async function GET(): Promise<NextResponse<GridStatusResponse>> {
  const base = buildBaseStatus();

  // ── 1. ISO New England live load ───────────────────────────────────────────
  try {
    const iso = await fetchISONeGridLoad();
    return NextResponse.json(
      mergeLoad(base, iso.currentLoad, iso.source, iso.timestamp, iso.provenance.dataQuality === "mock"),
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
          mergeLoad(base, latest.currentLoad, latest.source, latest.timestamp, false),
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
    { ...base, currentLoad: 16842, source: prov.source, timestamp: prov.timestamp, freshness: "mock" as const, isMock: true },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60", "X-Data-Source": "mock" } }
  );
}
