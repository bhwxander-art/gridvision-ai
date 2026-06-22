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

function buildMockStatus(): GridStatusResponse {
  const results = substationPortfolio.map((ss) =>
    assessSubstationCapacity(ss, planningTerritory.planningHorizonYears)
  );
  const constrained = results.filter((r) => r.severity === "constrained").length;
  const critical    = results.filter((r) => r.severity === "critical").length;
  const dcQueueMW   = dataCenterQueue.reduce((s, d) => s + d.requestedMW, 0);
  const currentLoad = 16842;

  return {
    currentLoad,
    peakCapacityMW: planningTerritory.peakSystemLoadMW,
    utilizationPct:
      Math.round((currentLoad / planningTerritory.peakSystemLoadMW) * 1000) / 10,
    substationSummary: { total: substationPortfolio.length, constrained, critical },
    dcQueueMW,
    source: "GridVision",
    timestamp: new Date().toISOString(),
  };
}

export async function GET(): Promise<NextResponse<GridStatusResponse>> {
  // ── 1. Database (most-recent load reading) ─────────────────────────────────
  if (isDbConfigured()) {
    try {
      const repo = new GridLoadRepository(getServerClient());
      const latest = await repo.getLatest();

      if (latest) {
        const mock = buildMockStatus();
        const body: GridStatusResponse = {
          ...mock,
          currentLoad: latest.currentLoad,
          utilizationPct:
            Math.round(
              (latest.currentLoad / mock.peakCapacityMW) * 1000
            ) / 10,
          source: latest.source,
          timestamp: latest.timestamp,
        };

        return NextResponse.json(body, {
          headers: {
            "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
            "X-Data-Source": "db",
          },
        });
      }
    } catch (dbErr) {
      console.error("[api/grid] DB error, falling back to mock:", dbErr);
    }
  }

  // ── 2. Mock fallback ────────────────────────────────────────────────────────
  try {
    return NextResponse.json(buildMockStatus(), {
      headers: {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
        "X-Data-Source": "mock",
      },
    });
  } catch (err) {
    console.error("[api/grid] handler error", err);
    return NextResponse.json(
      {
        currentLoad: 0,
        peakCapacityMW: 0,
        utilizationPct: 0,
        substationSummary: { total: 0, constrained: 0, critical: 0 },
        dcQueueMW: 0,
        source: "error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
