import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { GridLoadRepository } from "@/lib/db/repositories/grid-load.repository";
import type { GridLoad } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 10_000;
const DEFAULT_LIMIT = 96; // 4 days of hourly data

export interface LoadHistoryResponse {
  territory: string;
  count: number;
  from: string | null;
  to: string | null;
  readings: GridLoad[];
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<LoadHistoryResponse | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured — run scripts/import-isone-load.ts first" },
      { status: 503 }
    );
  }

  const { searchParams } = request.nextUrl;
  const territory = searchParams.get("territory") ?? "eastern-ma";
  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");
  const limitStr  = searchParams.get("limit");

  // Validate date params
  if (fromParam && isNaN(Date.parse(fromParam))) {
    return NextResponse.json({ error: "Invalid 'from' date" }, { status: 400 });
  }
  if (toParam && isNaN(Date.parse(toParam))) {
    return NextResponse.json({ error: "Invalid 'to' date" }, { status: 400 });
  }

  const limit = limitStr
    ? Math.min(Math.max(1, parseInt(limitStr, 10) || DEFAULT_LIMIT), MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    const repo = new GridLoadRepository(getServerClient());
    let readings: GridLoad[];

    if (fromParam && toParam) {
      readings = await repo.getRange(territory, new Date(fromParam), new Date(toParam));
    } else {
      readings = await repo.getHistory(territory, limit);
    }

    // getHistory returns newest-first; reverse so charts get chronological order
    if (!fromParam && !toParam) {
      readings = readings.slice().reverse();
    }

    return NextResponse.json(
      {
        territory,
        count: readings.length,
        from:  readings.length > 0 ? readings[0].timestamp : null,
        to:    readings.length > 0 ? readings[readings.length - 1].timestamp : null,
        readings,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
          "X-Data-Source":  "db",
        },
      }
    );
  } catch (err) {
    console.error("[api/load/history]", err);
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }
}
