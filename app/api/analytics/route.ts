import { NextResponse } from "next/server";
import type { AnalyticsData } from "@/lib/types";
import {
  loadGrowthData,
  evImpactData,
  dataCenterImpactData,
  monthlyLoadTrend,
} from "@/lib/sample-data";

// Real integration point: replace with forecast model / historian queries.
// Response shape: AnalyticsData
export async function GET(): Promise<NextResponse<AnalyticsData>> {
  try {
    const body: AnalyticsData = {
      loadGrowth: loadGrowthData,
      evImpact: evImpactData,
      dataCenterImpact: dataCenterImpactData,
      monthlyTrend: monthlyLoadTrend,
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        "X-Data-Source": "mock",
      },
    });
  } catch (err) {
    console.error("[api/analytics] handler error", err);
    return NextResponse.json(
      { error: "Failed to load analytics" } as unknown as AnalyticsData,
      { status: 500 }
    );
  }
}
