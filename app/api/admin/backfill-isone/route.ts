/**
 * TEMPORARY ONE-TIME ENDPOINT — DELETE AFTER BACKFILL COMPLETES
 *
 * GET /api/admin/backfill-isone?days=7
 * Authorization: Bearer gv-run-once-Xk9mP3qZnT8vL2wR
 *
 * Fetches historical ISO-NE load data from EIA and upserts into
 * iso_load_history. Uses production env vars (EIA_API_KEY + Supabase).
 */

import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { LoadRepository } from "@/lib/db/repositories/load.repository";
import { EIAProvider } from "@/lib/providers/eia.provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADMIN_TOKEN = "gv-run-once-Xk9mP3qZnT8vL2wR";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${ADMIN_TOKEN}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  if (!process.env.EIA_API_KEY) {
    return NextResponse.json({ error: "EIA_API_KEY not set" }, { status: 503 });
  }

  const daysParam = new URL(request.url).searchParams.get("days");
  const days = Math.min(Math.max(parseInt(daysParam ?? "7", 10), 1), 14);

  const repo = new LoadRepository(getServerClient());
  const provider = new EIAProvider();

  const breakdown: { date: string; fetched: number; error?: string }[] = [];
  let totalUpserted = 0;

  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().slice(0, 10);

    try {
      const readings = await provider.fetchDay(date);

      if (readings.length > 0) {
        const { error } = await getServerClient()
          .from("iso_load_history")
          .upsert(
            readings.map((r) => ({
              timestamp: r.timestamp,
              actual_load_mw: r.actualLoadMW,
              forecast_load_mw: r.actualLoadMW,
            })),
            { onConflict: "timestamp" }
          );

        if (error) throw new Error(error.message);
        totalUpserted += readings.length;
      }

      breakdown.push({ date: dateStr, fetched: readings.length });
    } catch (err) {
      breakdown.push({ date: dateStr, fetched: 0, error: (err as Error).message });
    }
  }

  const totalInTable = await repo.getCount();

  return NextResponse.json({
    status: "ok",
    days_requested: days,
    rows_upserted: totalUpserted,
    total_in_table: totalInTable,
    breakdown,
  });
}
