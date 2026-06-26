import "server-only";
import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { LoadRepository } from "@/lib/db/repositories/load.repository";
import { IsoForecastRepository } from "@/lib/db/repositories/iso-forecast.repository";
import { WeightedHourOfDayModel } from "@/lib/forecasting/weighted-average";
import type { LoadPoint } from "@/lib/forecasting/model";

export const dynamic = "force-dynamic";

export interface CurrentForecastEntry {
  forecastFor: string;
  predictedLoadMW: number;
  confidenceLowMW: number;
  confidenceHighMW: number;
  actualLoadMW: number | null;
  modelType: string;
  modelVersion: string;
  generatedAt: string;
}

export interface CurrentForecastResponse {
  forecasts: CurrentForecastEntry[];
  generatedAt: string | null;
  modelType: string;
  horizonHours: number;
  currentLoadMW: number | null;
}

export async function GET(): Promise<NextResponse<CurrentForecastResponse | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      {
        forecasts: [],
        generatedAt: null,
        modelType: "weighted-hour-of-day",
        horizonHours: 24,
        currentLoadMW: null,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600",
        },
      }
    );
  }

  const client = getServerClient();
  const loadRepo = new LoadRepository(client);
  const forecastRepo = new IsoForecastRepository(client);

  // Fetch current load and last 24h actuals in parallel
  const [currentLoad, history] = await Promise.all([
    loadRepo.getCurrent(),
    loadRepo.getHistory(24),
  ]);

  // Build a lookup of actuals by approximate timestamp (floored to hour)
  const actualByHour = new Map<number, number>();
  for (const h of history) {
    const hourMs = Math.floor(new Date(h.timestamp).getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000;
    actualByHour.set(hourMs, h.currentLoadMW);
  }

  // Try to fetch stored forecasts for the next 24h
  let upcomingForecasts = await forecastRepo.getUpcoming(24).catch(() => []);

  // If no forecasts in DB, generate on-the-fly
  if (upcomingForecasts.length === 0 && history.length >= 24) {
    const loadPoints: LoadPoint[] = history.map((h) => ({
      timestamp: new Date(h.timestamp),
      actualLoadMW: h.currentLoadMW,
    }));

    // For on-the-fly we use a wider history
    const fullHistory = await loadRepo.getHistory(720).catch(() => history);
    const fullPoints: LoadPoint[] = fullHistory.map((h) => ({
      timestamp: new Date(h.timestamp),
      actualLoadMW: h.currentLoadMW,
    }));

    const model = new WeightedHourOfDayModel();
    const generated = model.generate(fullPoints.length >= 24 ? fullPoints : loadPoints, 24);

    // Best-effort save (don't fail if it errors)
    await forecastRepo.saveBatch(generated).catch(() => null);

    upcomingForecasts = generated.map((p) => ({
      id: "",
      forecastFor: p.forecastFor.toISOString(),
      predictedLoadMW: p.predictedLoadMW,
      confidenceLowMW: p.confidenceLowMW,
      confidenceHighMW: p.confidenceHighMW,
      modelType: p.modelType,
      modelVersion: p.modelVersion,
      generatedAt: new Date().toISOString(),
    }));
  }

  const generatedAt =
    upcomingForecasts.length > 0 ? upcomingForecasts[0].generatedAt : null;

  const forecasts: CurrentForecastEntry[] = upcomingForecasts.map((f) => {
    const hourMs =
      Math.floor(new Date(f.forecastFor).getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000;
    return {
      forecastFor: f.forecastFor,
      predictedLoadMW: f.predictedLoadMW,
      confidenceLowMW: f.confidenceLowMW,
      confidenceHighMW: f.confidenceHighMW,
      actualLoadMW: actualByHour.get(hourMs) ?? null,
      modelType: f.modelType,
      modelVersion: f.modelVersion,
      generatedAt: f.generatedAt,
    };
  });

  return NextResponse.json(
    {
      forecasts,
      generatedAt,
      modelType: "weighted-hour-of-day",
      horizonHours: 24,
      currentLoadMW: currentLoad?.currentLoadMW ?? null,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600",
      },
    }
  );
}
