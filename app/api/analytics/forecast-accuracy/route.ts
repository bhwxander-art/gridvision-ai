import "server-only";
import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { isDbConfigured, getServerClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface ForecastRecord {
  timestamp: string;
  actualMW: number;
  forecastMW: number;
  errorPct: number;
}

interface ForecastAccuracyAvailable {
  available: true;
  records: ForecastRecord[];
  mape: number;
  rmse: number;
  accuracyPct: number;
  recordCount: number;
}

interface ForecastAccuracyUnavailable {
  available: false;
  reason: string;
  recordCount: number;
}

type ForecastAccuracyResponse = ForecastAccuracyAvailable | ForecastAccuracyUnavailable;

export async function GET(): Promise<NextResponse<ForecastAccuracyResponse | { error: string }>> {
  try {
    await requireTenant();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({
      available: false as const,
      reason: "Database not configured",
      recordCount: 0,
    });
  }

  const client = getServerClient();

  // Query last 30 days of load history
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from("iso_load_history")
    .select("recorded_at, load_mw, forecast_load_mw")
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true });

  if (error) {
    // Table might not have forecast_load_mw column yet
    return NextResponse.json({
      available: false as const,
      reason: "Forecast tracking not yet active",
      recordCount: 0,
    });
  }

  const rows = (data ?? []) as Array<{
    recorded_at: string;
    load_mw: number;
    forecast_load_mw: number | null;
  }>;

  const recordCount = rows.length;

  // Filter to rows that actually have different forecast vs actual
  const trackedRows = rows.filter(
    (r) =>
      r.forecast_load_mw != null &&
      Math.abs(r.forecast_load_mw - r.load_mw) > 0.001
  );

  if (trackedRows.length === 0) {
    return NextResponse.json({
      available: false as const,
      reason: "Forecast tracking not yet active",
      recordCount,
    });
  }

  const records: ForecastRecord[] = trackedRows.map((r) => {
    const actual = r.load_mw;
    const forecast = r.forecast_load_mw!;
    const errorPct = actual !== 0 ? (Math.abs(actual - forecast) / actual) * 100 : 0;
    return {
      timestamp: r.recorded_at,
      actualMW: actual,
      forecastMW: forecast,
      errorPct,
    };
  });

  // MAPE = mean(|actual - forecast| / actual) * 100
  const mape =
    records.reduce((sum, r) => sum + r.errorPct, 0) / records.length;

  // RMSE = sqrt(mean((actual - forecast)^2))
  const rmse = Math.sqrt(
    records.reduce(
      (sum, r) => sum + Math.pow(r.actualMW - r.forecastMW, 2),
      0
    ) / records.length
  );

  // Accuracy = 100 - MAPE (capped at 0)
  const accuracyPct = Math.max(0, 100 - mape);

  return NextResponse.json({
    available: true as const,
    records,
    mape: Math.round(mape * 100) / 100,
    rmse: Math.round(rmse * 10) / 10,
    accuracyPct: Math.round(accuracyPct * 10) / 10,
    recordCount: records.length,
  });
}
