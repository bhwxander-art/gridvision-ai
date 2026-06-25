import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { getAcquisitionMetrics } from "@/lib/services/acquisition.service";
import { handleDatabaseError } from "@/lib/utils/safe-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/acquisition/metrics
 * Get customer acquisition metrics (founder/super admin only)
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  if (!ctx?.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      {
        totalProspects: 0,
        byStage: {},
        demoCompleted: 0,
        pilotActive: 0,
        customerCount: 0,
        conversionRate: 0,
        arrPipeline: 0,
        avgTimeToDemo: 0,
        avgTimeToClosedWon: 0,
      },
      { status: 200 }
    );
  }

  try {
    const client = getServerClient();
    const metrics = await getAcquisitionMetrics(client);

    return NextResponse.json(metrics, {
      headers: {
        "Cache-Control": "max-age=1800, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/acquisition/metrics");
    return NextResponse.json(safe, { status: 500 });
  }
}
