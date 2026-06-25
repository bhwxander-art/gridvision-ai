import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { requireTenant } from "@/lib/auth/tenant";
import { createExportBundle } from "@/lib/export/csv-export";
import { logAuditEvent } from "@/lib/db/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ExportRequestSchema = z.object({
  format: z.enum(["zip", "individual"]).default("individual"),
  includeAssets: z.boolean().default(true),
  includeProjects: z.boolean().default(true),
  includeAccounts: z.boolean().default(true),
  includeScenarios: z.boolean().default(true),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireTenant();

  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = ExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  try {
    const client = getServerClient();

    // Log the export action
    await logAuditEvent(client, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "data_export",
      resourceType: "tenant",
      resourceId: ctx.tenantId,
      changes: {
        format: parsed.data.format,
        datasets: [
          parsed.data.includeAssets && "assets",
          parsed.data.includeProjects && "projects",
          parsed.data.includeAccounts && "accounts",
          parsed.data.includeScenarios && "scenarios",
        ].filter(Boolean),
      },
      ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    const bundle = await createExportBundle(client, ctx.tenantId, {
      includeAssets: parsed.data.includeAssets,
      includeProjects: parsed.data.includeProjects,
      includeAccounts: parsed.data.includeAccounts,
      includeScenarios: parsed.data.includeScenarios,
    });

    if (parsed.data.format === "zip") {
      // Return multiple CSVs as a simple multi-part response or zip
      // For now, return as JSON with CSV data
      return NextResponse.json(
        { files: bundle },
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        }
      );
    } else {
      // Return first available CSV
      const firstKey = Object.keys(bundle)[0];
      const csvContent = bundle[firstKey];

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${firstKey}-${new Date().toISOString().split("T")[0]}.csv"`,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
  } catch (err) {
    console.error("[api/export/csv]", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
