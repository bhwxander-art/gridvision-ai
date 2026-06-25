import { NextRequest, NextResponse } from "next/server";
import { calculateUtilityROI, getRoiHeadline, performSensitivityAnalysis } from "@/lib/services/roi-calculator.service";
import { handleValidationError } from "@/lib/utils/safe-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ROIRequestSchema = z.object({
  annualCapitalSpend: z.number().min(1000000).max(10000000000),
  planningTeamSize: z.number().min(1).max(500),
  substationsManaged: z.number().min(1).max(10000),
  assetsManaged: z.number().min(1).max(100000),
  scenariosPerYear: z.number().min(1).max(1000),
  averageImplementationTime: z.number().min(1).max(60),
  plan: z.enum(["starter", "professional", "enterprise"]).default("professional"),
});

export interface ROIResponse {
  headline: string;
  calculation: ReturnType<typeof calculateUtilityROI>;
  sensitivity: Record<string, ReturnType<typeof calculateUtilityROI>>;
}

/**
 * POST /api/demos/roi-calculator
 * Calculate ROI for a utility using GridVision AI
 *
 * This is a public endpoint (no auth required) for demonstration purposes
 */
export async function POST(req: NextRequest): Promise<NextResponse<ROIResponse | { error: string }>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = ROIRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      handleValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      ),
      { status: 422 }
    );
  }

  try {
    const calculation = calculateUtilityROI(parsed.data, parsed.data.plan);
    const sensitivity = performSensitivityAnalysis(parsed.data);
    const headline = getRoiHeadline(calculation);

    return NextResponse.json(
      {
        headline,
        calculation,
        sensitivity,
      },
      {
        headers: {
          "Cache-Control": "max-age=86400", // Cache for 24 hours
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
