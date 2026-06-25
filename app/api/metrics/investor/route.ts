import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { getInvestorMetrics, projectRevenue, identifyChurnRisk } from "@/lib/services/customer-metrics.service";
import { handleDatabaseError } from "@/lib/utils/safe-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics/investor
 * Investor dashboard with executive-level KPIs (super admin only)
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
        metrics: {
          totalARR: 0,
          totalMRR: 0,
          activeTenants: 0,
          trialConversions: 0,
          churnRate: 0,
          avgMRRPerTenant: 0,
          totalActiveUsers: 0,
          totalAssets: 0,
          totalScenarios: 0,
          totalApiRequests: 0,
          platformUtilization: 0,
          monthlyGrowthRate: 0,
          customerLTV: 0,
          topPlanByCount: "starter",
          revenueByPlan: { starter: 0, professional: 0, enterprise: 0 },
        },
        projections: [],
        churnRisks: [],
      },
      { status: 200 }
    );
  }

  try {
    const client = getServerClient();

    // Get metrics
    const metrics = await getInvestorMetrics(client);

    // Get revenue projections
    const projections = projectRevenue(metrics.totalARR, metrics.monthlyGrowthRate, 12);

    // Identify churn risks
    const churnRisks = await identifyChurnRisk(client);

    return NextResponse.json(
      {
        metrics,
        projections,
        churnRisks: churnRisks.slice(0, 10), // Top 10 at-risk customers
      },
      {
        headers: {
          "Cache-Control": "max-age=3600, stale-while-revalidate=7200",
        },
      }
    );
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/metrics/investor");
    return NextResponse.json(safe, { status: 500 });
  }
}
