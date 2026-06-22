import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { DataCenterRepository } from "@/lib/db/repositories/datacenter.repository";
import { runForecast, type ForecastResult } from "@/lib/forecast-engine";
import {
  planningTerritory,
  dataCenterQueue as mockQueue,
  loadGrowthAssumptions,
  TERRITORY_CAPACITY_MW,
} from "@/lib/enterprise-data";

export async function GET(): Promise<NextResponse<ForecastResult | { error: string }>> {
  try {
    let queue = mockQueue;

    if (isDbConfigured()) {
      try {
        const repo = new DataCenterRepository(getServerClient());
        const dbQueue = await repo.findAll();
        if (dbQueue.length > 0) queue = dbQueue;
      } catch (dbErr) {
        console.error("[api/forecast] DB error, falling back to mock queue:", dbErr);
      }
    }

    const result = runForecast({
      currentLoadMW: planningTerritory.peakSystemLoadMW,
      systemCapacityMW: TERRITORY_CAPACITY_MW,
      dataCenterQueue: queue,
      growthAssumptions: {
        evPenetrationGrowthPct: loadGrowthAssumptions.evPenetrationGrowthPct,
        populationGrowthPct: loadGrowthAssumptions.populationGrowthPct,
        commercialGrowthPct: loadGrowthAssumptions.commercialGrowthPct,
      },
      baseYear: new Date().getFullYear(),
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("[api/forecast GET]", err);
    return NextResponse.json(
      { error: "Forecast computation failed" },
      { status: 500 }
    );
  }
}
