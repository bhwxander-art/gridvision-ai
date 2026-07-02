import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { isAiConfigured, getAiConfigError } from "@/lib/ai/service";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import { handleDatabaseError } from "@/lib/utils/safe-error";

export const dynamic = "force-dynamic";

export interface HealthStatus {
  status: "healthy" | "degraded" | "down";
  database: "up" | "down";
  tenantCount: number;
  userCount: number;
  uptime: number;
  buildVersion: string;
  timestamp: string;
  checks: {
    database: {
      status: "up" | "down";
      latency: number;
    };
    ai: {
      status: "up" | "down";
      error: string | null;
    };
  };
}

export async function GET(): Promise<NextResponse<HealthStatus | { error: string }>> {
  const ctx = await getCurrentTenant();

  // Health check can be accessed by authenticated users with admin:read_health permission
  // Super admins and utility executives get full health data
  if (ctx && !hasPermission(ctx.role, "admin:read_health")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startTime = Date.now();
  let dbStatus: "up" | "down" = "down";
  let dbLatency = 0;
  let tenantCount = 0;
  let userCount = 0;

  if (isDbConfigured()) {
    try {
      const client = getServerClient();
      const dbStart = Date.now();

      // Test database connection with a simple query
      const { error: tenantError, count: tCount } = await client
        .from("tenants")
        .select("*", { count: "exact", head: true });

      const { error: userError, count: uCount } = await client
        .from("users")
        .select("*", { count: "exact", head: true });

      dbLatency = Date.now() - dbStart;

      if (!tenantError && !userError) {
        dbStatus = "up";
        tenantCount = tCount ?? 0;
        userCount = uCount ?? 0;
      }
    } catch (err) {
      console.error("[health] Database check failed:", err);
      dbStatus = "down";
    }
  }

  const uptime = Math.floor(process.uptime());
  const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "unknown";
  const aiConfigError = getAiConfigError();
  const aiStatus: "up" | "down" = isAiConfigured() ? "up" : "down";
  const overallStatus = dbStatus === "up" && aiStatus === "up" ? "healthy" : "degraded";

  return NextResponse.json(
    {
      status: overallStatus,
      database: dbStatus,
      tenantCount,
      userCount,
      uptime,
      buildVersion,
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: dbStatus,
          latency: dbLatency,
        },
        ai: {
          status: aiStatus,
          error: aiConfigError,
        },
      },
    },
    {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
}
