import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { getPilotMetrics } from "@/lib/services/pilot-tracking.service";
import { handleDatabaseError } from "@/lib/utils/safe-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/pilot/metrics
 * Get pilot program metrics (super admin only)
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
        inEvaluation: 0,
        inPilot: 0,
        decisions30Days: 0,
        avgFeedbackScore: 0,
        conversionRate: 0,
        servicingMW: 0,
        servicingCustomers: 0,
      },
      { status: 200 }
    );
  }

  try {
    const client = getServerClient();
    const metrics = await getPilotMetrics(client);

    return NextResponse.json(metrics, {
      headers: {
        "Cache-Control": "max-age=3600, stale-while-revalidate=7200",
      },
    });
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/pilot/metrics");
    return NextResponse.json(safe, { status: 500 });
  }
}
