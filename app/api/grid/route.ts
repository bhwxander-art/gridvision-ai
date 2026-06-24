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
import { makeProvenance } from "@/lib/provenance";
import { EASTERN_MA_FRACTION } from "@/lib/services/capacity.service";

function buildBaseStatus() {
  const results = substationPortfolio.map((ss) =>
    assessSubstationCapacity(ss, planningTerritory.planningHorizonYears)
  );
  return {
    peakSystemLoadMW: planningTerritory.peakSystemLoadMW,
    systemCapacityMW: TERRITORY_CAPACITY_MW,
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
  isoneSystemLoadMW: number,
  source: string,
  timestamp: string,
  isMock: boolean
): GridStatusResponse {
  const prov = makeProvenance(source, timestamp, isMock);
  // Scale ISO-NE system load to Eastern MA territory scope before computing
  // utilization against Eastern MA installed capacity (6,500 MW).
  // Raw ISO-NE figures (~14,000 MW) are system-wide and must not be compared
  // directly to territory capacity — that produces utilization >100%.
  const currentLoadMW = Math.round(isoneSystemLoadMW * EASTERN_MA_FRACTION);
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

export async function GET(): Promise<NextResponse<GridStatusResponse | { error: string }>> {
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

  // ── 3. No data available ────────────────────────────────────────────────────
  return NextResponse.json(
    { error: "Load data unavailable — configure ISO-NE credentials or run scripts/import-isone-load.ts" },
    { status: 503 }
  );
}
