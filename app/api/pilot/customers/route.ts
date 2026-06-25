import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { getPilotCustomers } from "@/lib/services/pilot-tracking.service";
import { handleDatabaseError } from "@/lib/utils/safe-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/pilot/customers
 * Get list of pilot customers (super admin only)
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  if (!ctx?.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    const client = getServerClient();
    const customers = await getPilotCustomers(client);

    return NextResponse.json(customers, {
      headers: {
        "Cache-Control": "max-age=3600, stale-while-revalidate=7200",
      },
    });
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/pilot/customers");
    return NextResponse.json(safe, { status: 500 });
  }
}
