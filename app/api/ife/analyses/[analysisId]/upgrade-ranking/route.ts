/**
 * GET /api/ife/analyses/[analysisId]/upgrade-ranking
 *
 * Pure post-processing read over an existing, already-computed Upgrade
 * Analysis result — INFRA-023. Reuses getUpgradeRankingForAnalysis()
 * unmodified; performs no electrical computation and no writes. This route
 * is GET (not POST, unlike its sibling /upgrade-analysis route) because it
 * computes nothing new and persists nothing — it only ranks data that
 * already exists.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Response 200: { analysis, ranking, computeMs }
 * Response 400: missing tenant_id or analysisId
 * Response 404: analysis not found for this tenant
 * Response 500: missing Supabase credentials, or unexpected error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { getUpgradeRankingForAnalysis } from "@/lib/upgrade-ranking/upgrade-ranking-pipeline";

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
  const ifeRepo = new IfeRepository(client);

  try {
    const { analysis, ranking, computeMs } = await getUpgradeRankingForAnalysis(
      tenantId,
      analysisId,
      ifeRepo
    );

    return NextResponse.json({ analysis, ranking, computeMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Upgrade ranking failed: ${msg}` },
      { status: 500 }
    );
  }
}
