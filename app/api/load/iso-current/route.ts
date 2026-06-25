import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { LoadRepository } from "@/lib/db/repositories/load.repository";

export const dynamic = "force-dynamic";

export interface IsoLoadResponse {
  current_load_mw: number;
  forecast_load_mw: number;
  timestamp: string;
  source: string;
  freshness: "live" | "delayed";
}

export async function GET(): Promise<NextResponse<IsoLoadResponse | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      {
        error: "Database not configured — run: npx tsx scripts/init-isone-database.ts",
      },
      { status: 503 }
    );
  }

  try {
    const repo = new LoadRepository(getServerClient());
    const current = await repo.getCurrent();

    if (!current) {
      return NextResponse.json(
        {
          error: "No ISO-NE load data available — run: npx tsx scripts/init-isone-database.ts",
        },
        { status: 404 }
      );
    }

    // Determine freshness
    const ageMinutes = (Date.now() - new Date(current.timestamp).getTime()) / 60_000;
    const freshness = ageMinutes < 5 ? "live" : "delayed";

    return NextResponse.json(
      {
        current_load_mw: current.currentLoadMW,
        forecast_load_mw: current.forecastLoadMW,
        timestamp: current.timestamp,
        source: "iso-ne",
        freshness,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
          "X-Data-Source": "iso-ne-database",
        },
      }
    );
  } catch (err) {
    console.error("[api/load/iso-current]", err);
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }
}
