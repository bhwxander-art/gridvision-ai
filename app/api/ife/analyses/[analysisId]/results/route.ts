/**
 * GET /api/ife/analyses/[analysisId]/results
 *
 * Read-only aggregation endpoint that assembles all completed IFE results
 * into one deterministic response (INFRA-018).
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Response 200: { analysis, hostingCapacity, upgradeResults, timeToPower,
 *   confidenceRisk, explanations, completeness, computeMs }
 *   All domain objects are returned exactly as persisted by their respective
 *   engines (INFRA-012 through INFRA-017).
 * Response 400: missing tenant_id, missing analysisId, or analysis not completed
 * Response 404: analysis not found for this tenant
 * Response 500: database or configuration error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { aggregateIfeResults } from "@/lib/ife-results/results-pipeline";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ analysisId: string }> }
): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Server configuration error: missing Supabase credentials" },
      { status: 500 }
    );
  }

  const { analysisId } = await params;
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id")?.trim();

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing required query parameter: tenant_id" },
      { status: 400 }
    );
  }
  if (!analysisId) {
    return NextResponse.json({ error: "Missing analysis ID in path" }, { status: 400 });
  }

  const client = createClient(supabaseUrl, supabaseKey);

  try {
    const response = await aggregateIfeResults(client, tenantId, analysisId);
    return NextResponse.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Analysis not found for this tenant
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }

    // Analysis exists but is not completed
    if (msg.includes("is not completed")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Unexpected error
    return NextResponse.json(
      { error: `Results aggregation failed: ${msg}` },
      { status: 500 }
    );
  }
}
