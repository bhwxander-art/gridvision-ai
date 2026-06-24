import { NextResponse } from "next/server";
import { fetchISONeGridLoad } from "@/lib/adapters/isone.adapter";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { GridLoadRepository } from "@/lib/db/repositories/grid-load.repository";
import { computeCapacity, type CapacitySnapshot } from "@/lib/services/capacity.service";
import { computeFreshness } from "@/lib/provenance";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<CapacitySnapshot | { error: string }>> {
  // ── 1. ISO-NE live ─────────────────────────────────────────────────────────
  try {
    const iso = await fetchISONeGridLoad();
    const freshness =
      iso.provenance.dataQuality === "live"
        ? "live"
        : iso.provenance.dataQuality === "cache"
        ? "delayed"
        : "mock";
    const snapshot = computeCapacity(
      iso.currentLoadMW,
      iso.source,
      iso.timestamp,
      freshness
    );
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
        "X-Data-Source": iso.provenance.dataQuality,
      },
    });
  } catch {
    // fall through
  }

  // ── 2. Database ────────────────────────────────────────────────────────────
  if (isDbConfigured()) {
    try {
      const repo = new GridLoadRepository(getServerClient());
      const latest = await repo.getLatest("eastern-ma");
      if (latest) {
        const freshness = computeFreshness(latest.timestamp, false);
        const snapshot = computeCapacity(
          latest.currentLoadMW,
          latest.source,
          latest.timestamp,
          freshness
        );
        return NextResponse.json(snapshot, {
          headers: {
            "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
            "X-Data-Source": "db",
          },
        });
      }
    } catch (dbErr) {
      console.error("[api/capacity/current] DB error:", dbErr);
    }
  }

  return NextResponse.json(
    { error: "No load data available — configure ISO-NE credentials or import historical data" },
    { status: 503 }
  );
}
