import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { LoadRepository } from "@/lib/db/repositories/load.repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const parsed = parseInt(request.nextUrl.searchParams.get("hours") ?? "24", 10);
  const hours = isNaN(parsed) ? 24 : Math.min(Math.max(1, parsed), 168);

  try {
    const repo = new LoadRepository(getServerClient());
    const readings = await repo.getHistory(hours);

    return NextResponse.json(
      {
        count: readings.length,
        from: readings[0]?.timestamp ?? null,
        to: readings.at(-1)?.timestamp ?? null,
        readings,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=120, stale-while-revalidate=300",
          "X-Data-Source": "iso-load-history",
        },
      }
    );
  } catch (err) {
    console.error("[api/load/iso-history]", err);
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }
}
