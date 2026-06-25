import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getErrorStats } from "@/lib/monitoring/error-tracking";
import { STRIPE_CONFIG } from "@/lib/integrations/stripe-config";
import { isOAuthConfigured } from "@/lib/auth/oauth-config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const now = new Date();
  const health = {
    status: "healthy" as "healthy" | "degraded" | "unhealthy",
    timestamp: now.toISOString(),
    uptime: process.uptime(),
    services: {
      database: "unknown" as "healthy" | "degraded" | "unhealthy" | "unavailable" | "unknown",
      stripe: "healthy" as "healthy" | "unavailable" | "unknown",
      oauth: "healthy" as "healthy" | "unavailable" | "unknown",
    },
    errors: getErrorStats(),
  };

  // Check database
  if (isDbConfigured()) {
    try {
      const client = getServerClient();
      const { error } = await client.from("tenants").select("count", { count: "exact" }).limit(1);
      health.services.database = error ? "degraded" : "healthy";
    } catch {
      health.services.database = "unhealthy";
      health.status = "degraded";
    }
  } else {
    health.services.database = "unavailable";
  }

  // Check Stripe
  health.services.stripe = STRIPE_CONFIG.isConfigured ? "healthy" : "unavailable";

  // Check OAuth
  health.services.oauth = isOAuthConfigured() ? "healthy" : "unavailable";

  // Determine overall status
  const criticalServices = Object.values(health.services).filter(
    (s) => s === "unhealthy" || s === "unavailable"
  );

  if (criticalServices.length > 0) {
    health.status = "unhealthy";
  } else if (Object.values(health.services).includes("degraded")) {
    health.status = "degraded";
  }

  const statusCode = health.status === "healthy" ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
