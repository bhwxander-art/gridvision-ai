import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import {
  parseCSV,
  validateSubstationCSV,
  importSubstations,
  generateSubstationCSVTemplate,
  type SubstationCSVRecord,
} from "@/lib/services/csv-import.service";
import { handleDatabaseError, handleValidationError } from "@/lib/utils/safe-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ImportAssetsSchema = z.object({
  csvContent: z.string().min(10).max(100000),
  assetType: z.enum(["substations", "transformers", "feeders"]),
  validateOnly: z.boolean().default(false),
});

/**
 * POST /api/onboarding/import-assets
 * Import utility assets from CSV
 *
 * Supported asset types:
 * - substations: main power system nodes
 * - transformers: voltage conversion equipment
 * - feeders: distribution lines
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(ctx.role, "admin:manage_users")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ImportAssetsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      handleValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      ),
      { status: 422 }
    );
  }

  try {
    // Parse CSV
    const rows = parseCSV(parsed.data.csvContent);

    if (parsed.data.assetType === "substations") {
      // Validate substation CSV
      const validation = validateSubstationCSV(rows);

      if (parsed.data.validateOnly) {
        return NextResponse.json({
          validation,
          preview: validation.preview,
        });
      }

      if (!validation.isValid) {
        return NextResponse.json(
          {
            error: "CSV validation failed",
            validation,
          },
          { status: 422 }
        );
      }

      // Import to database
      if (!isDbConfigured()) {
        return NextResponse.json(
          { error: "Database not configured" },
          { status: 503 }
        );
      }

      const client = getServerClient();
      const result = await importSubstations(
        client,
        ctx.tenantId,
        validation.preview as SubstationCSVRecord[]
      );

      return NextResponse.json(
        {
          success: true,
          imported: result.imported,
          failed: result.failed,
          errors: result.errors,
          message: `Successfully imported ${result.imported} substations`,
        },
        { status: 200 }
      );
    }

    // Other asset types not yet implemented
    return NextResponse.json(
      { error: `Asset type '${parsed.data.assetType}' not yet implemented` },
      { status: 501 }
    );
  } catch (err) {
    const safe = handleDatabaseError(err, "POST /api/onboarding/import-assets");
    return NextResponse.json(safe, { status: 500 });
  }
}

/**
 * GET /api/onboarding/import-assets
 * Get CSV template for asset import
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assetType = req.nextUrl.searchParams.get("type") || "substations";

  let template = "";
  switch (assetType) {
    case "substations":
      template = generateSubstationCSVTemplate();
      break;
    default:
      return NextResponse.json(
        { error: `Unknown asset type: ${assetType}` },
        { status: 400 }
      );
  }

  return NextResponse.json({
    assetType,
    template,
    headers: template.split("\n")[0].split(","),
  });
}
