import "server-only";
import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { IsoForecastRepository } from "@/lib/db/repositories/iso-forecast.repository";

export const dynamic = "force-dynamic";

interface ForecastAccuracyRecord {
  forecastFor: string;
  predictedLoadMW: number;
  actualLoadMW: number;
  errorPct: number;
}

interface ForecastAccuracyAvailable {
  available: true;
  records: ForecastAccuracyRecord[];
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
  if (!isDbConfigured()) {
    return NextResponse.json(
      {
        available: false as const,
        reason: "Database not configured",
        recordCount: 0,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        },
      }
    );
  }

  const client = getServerClient();
  const forecastRepo = new IsoForecastRepository(client);

  let completed: Awaited<ReturnType<IsoForecastRepository["getCompletedForecasts"]>> = [];

  try {
    completed = await forecastRepo.getCompletedForecasts(30);
  } catch {
    return NextResponse.json(
      {
        available: false as const,
        reason: "Forecast accuracy data unavailable",
        recordCount: 0,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        },
      }
    );
  }

  if (completed.length === 0) {
    return NextResponse.json(
      {
        available: false as const,
        reason: "No completed forecasts yet — generate a forecast to track accuracy",
        recordCount: 0,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        },
      }
    );
  }

  const records: ForecastAccuracyRecord[] = completed.map((r) => {
    const errorPct =
      r.actualLoadMW !== 0
        ? (Math.abs(r.actualLoadMW - r.predictedLoadMW) / r.actualLoadMW) * 100
        : 0;
    return {
      forecastFor: r.forecastFor,
      predictedLoadMW: r.predictedLoadMW,
      actualLoadMW: r.actualLoadMW,
      errorPct,
    };
  });

  const mape = records.reduce((s, r) => s + r.errorPct, 0) / records.length;
  const rmse = Math.sqrt(
    records.reduce(
      (s, r) => s + Math.pow(r.actualLoadMW - r.predictedLoadMW, 2),
      0
    ) / records.length
  );
  const accuracyPct = Math.max(0, 100 - mape);

  return NextResponse.json(
    {
      available: true as const,
      records,
      mape: Math.round(mape * 100) / 100,
      rmse: Math.round(rmse * 10) / 10,
      accuracyPct: Math.round(accuracyPct * 10) / 10,
      recordCount: records.length,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      },
    }
  );
}
