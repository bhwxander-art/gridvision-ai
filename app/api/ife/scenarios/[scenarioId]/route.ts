/**
 * GET /api/ife/scenarios/[scenarioId]
 *
 * Fetches a scenario's stored definition and status. Full IFE results for a
 * completed scenario are reached through the existing, unmodified
 * GET /api/ife/analyses/[analysisId]/results endpoint (INFRA-018) using
 * scenario.resultAnalysisId — no new results-aggregation endpoint is
 * introduced here.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Response 200: { scenario }
 * Response 400: missing tenant_id or scenarioId
 * Response 404: scenario not found for this tenant
 * Response 500: database or configuration error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IfeScenarioRepository } from "@/lib/db/repositories/ife-scenario.repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ scenarioId: string }> }
): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Server configuration error: missing Supabase credentials" },
      { status: 500 }
    );
  }

  const { scenarioId } = await params;
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id")?.trim();

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing required query parameter: tenant_id" },
      { status: 400 }
    );
  }
  if (!scenarioId) {
    return NextResponse.json({ error: "Missing scenario ID in path" }, { status: 400 });
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const scenarioRepo = new IfeScenarioRepository(client);

  try {
    const scenario = await scenarioRepo.getScenario(tenantId, scenarioId);
    if (!scenario) {
      return NextResponse.json(
        { error: `Scenario ${scenarioId} not found for this tenant` },
        { status: 404 }
      );
    }
    return NextResponse.json({ scenario });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to fetch scenario: ${msg}` }, { status: 500 });
  }
}
