import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import { getAuditLog } from "@/lib/db/audit";
import { handleDatabaseError } from "@/lib/utils/safe-error";

export const dynamic = "force-dynamic";

export interface AuditLogsResponse {
  events: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    userName?: string;
    createdAt: string;
    changes?: Record<string, unknown>;
  }>;
  count: number;
}

export async function GET(req: NextRequest): Promise<NextResponse<AuditLogsResponse | { error: string }>> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Require audit read permission
  if (!hasPermission(ctx.role, "admin:read_audit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { events: [], count: 0 },
      { status: 200 }
    );
  }

  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 500);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    const client = getServerClient();
    const events = await getAuditLog(client, ctx.tenantId, limit, offset);

    return NextResponse.json(
      {
        events: events.map((e) => ({
          id: e.id,
          action: e.action,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          userName: e.userName,
          createdAt: e.createdAt,
          changes: e.changes,
        })),
        count: events.length,
      },
      {
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/audit/logs");
    return NextResponse.json(safe, { status: 500 });
  }
}
