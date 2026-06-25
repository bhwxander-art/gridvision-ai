import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import {
  generateROIReportData,
  generateROIReportHTML,
  generateROIReportText,
} from "@/lib/services/roi-report-generator.service";
import { handleValidationError } from "@/lib/utils/safe-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ROIReportSchema = z.object({
  utilityProfile: z.object({
    substationsManaged: z.number().min(1),
    planningTeamSize: z.number().min(1),
    annualCapitalSpend: z.number().min(1000000),
    scenariosPerYear: z.number().min(1),
  }),
  roiCalculation: z.object({
    planningTimeSavingsUSD: z.number().min(0),
    capitalSavingsUSD: z.number().min(0),
    riskSavingsUSD: z.number().min(0),
    totalAnnualSavings: z.number().min(0),
    subscriptionCost: z.number().min(0),
    netBenefit: z.number(),
    roi: z.number(),
    paybackMonths: z.number(),
    threeyearNPV: z.number(),
  }),
  scenarios: z
    .array(
      z.object({
        name: z.string(),
        date: z.string().optional(),
        result: z.string().optional(),
        timeToRun: z.string().optional(),
        utilization: z.number().optional(),
      })
    )
    .default([]),
  format: z.enum(["html", "text", "json"]).default("html"),
});

/**
 * POST /api/reports/roi-report
 * Generate ROI report in specified format
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(ctx.role, "data:export")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ROIReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      handleValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      ),
      { status: 422 }
    );
  }

  try {
    const reportData = generateROIReportData(
      ctx.tenantName || "Valued Customer",
      parsed.data.utilityProfile,
      parsed.data.roiCalculation,
      parsed.data.scenarios
    );

    switch (parsed.data.format) {
      case "html": {
        const html = generateROIReportHTML(reportData);
        return new NextResponse(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `attachment; filename="roi-report-${Date.now()}.html"`,
          },
        });
      }

      case "text": {
        const text = generateROIReportText(reportData);
        return new NextResponse(text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="roi-report-${Date.now()}.txt"`,
          },
        });
      }

      case "json":
      default: {
        return NextResponse.json(reportData);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Report generation failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
