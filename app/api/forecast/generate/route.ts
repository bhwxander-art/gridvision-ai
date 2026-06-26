import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { LoadRepository } from "@/lib/db/repositories/load.repository";
import { IsoForecastRepository } from "@/lib/db/repositories/iso-forecast.repository";
import { WeightedHourOfDayModel } from "@/lib/forecasting/weighted-average";
import type { LoadPoint } from "@/lib/forecasting/model";

export const dynamic = "force-dynamic";

const HORIZON_HOURS = 168; // 7 days
const MIN_HISTORY_POINTS = 24;

interface GenerateSuccessResponse {
  status: "ok";
  generated: number;
  horizonHours: number;
  model: string;
  version: string;
}

interface GenerateErrorResponse {
  error: string;
  historyCount?: number;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<GenerateSuccessResponse | GenerateErrorResponse>> {
  // Auth: accept CRON_SECRET header OR authenticated tenant
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCron =
    cronSecret != null &&
    (request.headers.get("x-cron-secret") === cronSecret ||
      authHeader === `Bearer ${cronSecret}`);

  if (!isCron) {
    // Try tenant auth as fallback
    try {
      const { requireTenant } = await import("@/lib/auth/tenant");
      await requireTenant();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const client = getServerClient();
  const loadRepo = new LoadRepository(client);
  const forecastRepo = new IsoForecastRepository(client);

  // Fetch last 30 days of history (720h)
  const history = await loadRepo.getHistory(720);

  if (history.length < MIN_HISTORY_POINTS) {
    return NextResponse.json(
      { error: "Insufficient history", historyCount: history.length },
      { status: 422 }
    );
  }

  // Convert to LoadPoint[]
  const loadPoints: LoadPoint[] = history.map((h) => ({
    timestamp: new Date(h.timestamp),
    actualLoadMW: h.currentLoadMW,
  }));

  // Run model
  const model = new WeightedHourOfDayModel();
  const points = model.generate(loadPoints, HORIZON_HOURS);

  // Save (idempotent upsert)
  await forecastRepo.saveBatch(points);

  return NextResponse.json({
    status: "ok",
    generated: points.length,
    horizonHours: HORIZON_HOURS,
    model: model.modelType,
    version: model.modelVersion,
  });
}
