import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { IsoForecastRepository } from "@/lib/db/repositories/iso-forecast.repository";
import { LoadRepository } from "@/lib/db/repositories/load.repository";

export const dynamic = "force-dynamic";

const MAX_DAYS = 30;
const DEFAULT_DAYS = 7;

export interface ForecastHistoryEntry {
  forecastFor: string;
  predictedLoadMW: number;
  confidenceLowMW: number;
  confidenceHighMW: number;
  actualLoadMW: number | null;
}

export interface ForecastHistoryResponse {
  records: ForecastHistoryEntry[];
  days: number;
  count: number;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<ForecastHistoryResponse | { error: string }>> {
  const { searchParams } = new URL(request.url);
  const rawDays = parseInt(searchParams.get("days") ?? String(DEFAULT_DAYS), 10);
  const days = isNaN(rawDays) || rawDays < 1 ? DEFAULT_DAYS : Math.min(rawDays, MAX_DAYS);

  if (!isDbConfigured()) {
    return NextResponse.json({ records: [], days, count: 0 });
  }

  const client = getServerClient();
  const forecastRepo = new IsoForecastRepository(client);
  const loadRepo = new LoadRepository(client);

  const [forecastRecords, history] = await Promise.all([
    forecastRepo.getRecentHistory(days),
    loadRepo.getHistory(days * 24),
  ]);

  // Build actual lookup keyed by hour bucket (ms)
  const actualByHour = new Map<number, number>();
  for (const h of history) {
    const hourMs =
      Math.floor(new Date(h.timestamp).getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000;
    actualByHour.set(hourMs, h.currentLoadMW);
  }

  const records: ForecastHistoryEntry[] = forecastRecords.map((f) => {
    const hourMs =
      Math.floor(new Date(f.forecastFor).getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000;
    return {
      forecastFor: f.forecastFor,
      predictedLoadMW: f.predictedLoadMW,
      confidenceLowMW: f.confidenceLowMW,
      confidenceHighMW: f.confidenceHighMW,
      actualLoadMW: actualByHour.get(hourMs) ?? null,
    };
  });

  return NextResponse.json({ records, days, count: records.length });
}
