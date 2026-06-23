import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { GridLoadRepository } from "@/lib/db/repositories/grid-load.repository";
import { computeFreshness } from "@/lib/provenance";

export const dynamic = "force-dynamic";

export interface LoadCurrentResponse {
  source: string;
  currentLoadMW: number;
  timestamp: string;
  freshness: "live" | "delayed" | "mock";
  territory: string;
}

export async function GET(): Promise<NextResponse<LoadCurrentResponse | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured — run scripts/import-isone-load.ts first" },
      { status: 503 }
    );
  }

  try {
    const repo = new GridLoadRepository(getServerClient());
    const latest = await repo.getLatest("eastern-ma");

    if (!latest) {
      return NextResponse.json(
        { error: "No load data in database — run scripts/import-isone-load.ts to import data" },
        { status: 404 }
      );
    }

    const freshness = computeFreshness(latest.timestamp, false);

    return NextResponse.json(
      {
        source:        latest.source,
        currentLoadMW: latest.currentLoadMW,
        timestamp:     latest.timestamp,
        freshness,
        territory:     "eastern-ma",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
          "X-Data-Source":  "db",
        },
      }
    );
  } catch (err) {
    console.error("[api/load/current]", err);
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }
}
