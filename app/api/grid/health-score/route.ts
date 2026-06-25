import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { LoadRepository } from "@/lib/db/repositories/load.repository";
import { computeGridHealth, type GridHealthResult } from "@/lib/health/grid-health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<GridHealthResult | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const repo = new LoadRepository(getServerClient());
    const [current, history] = await Promise.all([
      repo.getCurrent(),
      repo.getHistory(24),
    ]);

    if (!current) {
      return NextResponse.json(
        { error: "No load data available — initial sync has not run" },
        { status: 404 }
      );
    }

    const result = computeGridHealth({
      currentLoadMW: current.currentLoadMW,
      historyReadings: history.map((r) => ({
        timestamp: r.timestamp,
        currentLoadMW: r.currentLoadMW,
      })),
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
        "X-Data-Source": "iso-load-history",
      },
    });
  } catch (err) {
    console.error("[api/grid/health-score]", err);
    return NextResponse.json({ error: "Health score computation failed" }, { status: 500 });
  }
}
