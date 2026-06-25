import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import { getCustomerMetrics } from "@/lib/services/customer-metrics.service";
import { handleDatabaseError } from "@/lib/utils/safe-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics/customer-success
 * Customer success dashboard metrics (super admin only)
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  // Require super admin
  if (!ctx?.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      {
        totalARR: 0,
        totalMRR: 0,
        activeTenants: 0,
        trialConversions: 0,
        churnRate: 0,
        avgMRRPerTenant: 0,
        topPlanByCount: "starter",
        revenueByPlan: { starter: 0, professional: 0, enterprise: 0 },
      },
      { status: 200 }
    );
  }

  try {
    const client = getServerClient();
    const metrics = await getCustomerMetrics(client);

    return NextResponse.json(metrics, {
      headers: {
        "Cache-Control": "max-age=3600, stale-while-revalidate=7200",
      },
    });
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/metrics/customer-success");
    return NextResponse.json(safe, { status: 500 });
  }
}
