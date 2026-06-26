import "server-only";
import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { IsoForecastRepository } from "@/lib/db/repositories/iso-forecast.repository";

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

function computeMetrics(
  rows: Array<{ forecastFor: string; predictedLoadMW: number; actualLoadMW: number }>
): ForecastAccuracyAvailable {
  const records: ForecastRecord[] = rows.map((r) => {
    const actual = r.actualLoadMW;
    const forecast = r.predictedLoadMW;
    const errorPct = actual !== 0 ? (Math.abs(actual - forecast) / actual) * 100 : 0;
    return {
      timestamp: r.forecastFor,
      actualMW: actual,
      forecastMW: forecast,
      errorPct,
    };
  });

  const mape = records.reduce((sum, r) => sum + r.errorPct, 0) / records.length;
  const rmse = Math.sqrt(
    records.reduce((sum, r) => sum + Math.pow(r.actualMW - r.forecastMW, 2), 0) / records.length
  );
  const accuracyPct = Math.max(0, 100 - mape);

  return {
    available: true as const,
    records,
    mape: Math.round(mape * 100) / 100,
    rmse: Math.round(rmse * 10) / 10,
    accuracyPct: Math.round(accuracyPct * 10) / 10,
    recordCount: records.length,
  };
}

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

  // Path 1: try iso_load_forecasts joined with actuals (model vs actual)
  try {
    const forecastRepo = new IsoForecastRepository(client);
    const completed = await forecastRepo.getCompletedForecasts(30);

    if (completed.length > 0) {
      return NextResponse.json(computeMetrics(completed));
    }
  } catch {
    // Table may not exist yet — fall through to legacy path
  }

  // Path 2: legacy — compare forecast_load_mw vs actual_load_mw in iso_load_history
  // Fixed column names: timestamp (not recorded_at), actual_load_mw (not load_mw)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from("iso_load_history")
    .select("timestamp, actual_load_mw, forecast_load_mw")
    .gte("timestamp", since)
    .order("timestamp", { ascending: true });

  if (error) {
    return NextResponse.json({
      available: false as const,
      reason: "Forecast tracking not yet active",
      recordCount: 0,
    });
  }

  const rows = (data ?? []) as Array<{
    timestamp: string;
    actual_load_mw: number;
    forecast_load_mw: number | null;
  }>;

  const recordCount = rows.length;

  // Filter to rows where forecast differs from actual (real model forecasts)
  const trackedRows = rows.filter(
    (r) =>
      r.forecast_load_mw != null &&
      Math.abs(r.forecast_load_mw - r.actual_load_mw) > 0.001
  );

  if (trackedRows.length === 0) {
    return NextResponse.json({
      available: false as const,
      reason: "Forecast tracking not yet active",
      recordCount,
    });
  }

  const legacyRows = trackedRows.map((r) => ({
    forecastFor: r.timestamp,
    predictedLoadMW: r.forecast_load_mw!,
    actualLoadMW: r.actual_load_mw,
  }));

  return NextResponse.json(computeMetrics(legacyRows));
}
