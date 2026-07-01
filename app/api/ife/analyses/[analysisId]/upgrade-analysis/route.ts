/**
 * POST /api/ife/analyses/[analysisId]/upgrade-analysis
 *
 * Computes the minimum set of branch thermal uprates required to accommodate
 * the requested interconnection capacity recorded on an existing, already-
 * completed ife_analyses record — reusing PTDF/LODF/DCPF/Hosting Capacity
 * unmodified. Nested under the analysis it extends rather than a flat
 * top-level route, since it is a sequel step on an existing analysis, not
 * an independent request (all inputs are re-derived from that analysis).
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Request body (JSON, all optional):
 *   {
 *     "slackBusNumber": number,
 *     "sensitivityEpsilon": number,
 *     "ratingMarginMultiplier": number,
 *     "maxIterations": number
 *   }
 *
 * Response 200: { analysis, upgradeResults, computeMs }
 *   Note: cost_p10/p50/p90_m, project_share_p50_m, milp_optimality_gap_pct,
 *   milp_solve_seconds, and each upgrade's cost_p50_m are always null —
 *   cost estimation and MILP optimization are out of scope for INFRA-013
 *   (see the approved technical specification).
 * Response 400: invalid options, or hosting capacity not yet completed
 * Response 404: analysis, network model, or POI bus not found for this tenant
 * Response 409: topology has changed since hosting capacity was computed
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { SupabasePtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { SupabaseLodfStorage } from "@/lib/lodf/lodf-storage";
import { computeAndPersistUpgradeAnalysis } from "@/lib/upgrade-analysis/upgrade-analysis-pipeline";
import { UpgradeAnalysisInfeasibleError } from "@/lib/upgrade-analysis/types";

export async function POST(
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

  let body: unknown = {};
  const rawBody = await request.text();
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const { slackBusNumber, sensitivityEpsilon, ratingMarginMultiplier, maxIterations } = body as {
    slackBusNumber?: unknown;
    sensitivityEpsilon?: unknown;
    ratingMarginMultiplier?: unknown;
    maxIterations?: unknown;
  };

  for (const [name, value] of [
    ["slackBusNumber", slackBusNumber],
    ["sensitivityEpsilon", sensitivityEpsilon],
    ["ratingMarginMultiplier", ratingMarginMultiplier],
    ["maxIterations", maxIterations],
  ] as const) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      return NextResponse.json({ error: `'${name}' must be a finite number` }, { status: 400 });
    }
  }

  if (
    maxIterations !== undefined &&
    (!Number.isInteger(maxIterations as number) || (maxIterations as number) <= 0)
  ) {
    return NextResponse.json(
      { error: "'maxIterations' must be an integer greater than 0" },
      { status: 400 }
    );
  }
  if (ratingMarginMultiplier !== undefined && (ratingMarginMultiplier as number) <= 0) {
    return NextResponse.json(
      { error: "'ratingMarginMultiplier' must be greater than 0" },
      { status: 400 }
    );
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const repo = new NetworkRepository(client);
  const ifeRepo = new IfeRepository(client);
  const ptdfStorage = new SupabasePtdfStorage(client);
  const lodfStorage = new SupabaseLodfStorage(client);

  try {
    const { analysis, upgradeResults, computeMs } = await computeAndPersistUpgradeAnalysis(
      tenantId,
      analysisId,
      repo,
      ifeRepo,
      ptdfStorage,
      lodfStorage,
      {
        slackBusNumber: slackBusNumber as number | undefined,
        sensitivityEpsilon: sensitivityEpsilon as number | undefined,
        ratingMarginMultiplier: ratingMarginMultiplier as number | undefined,
        maxIterations: maxIterations as number | undefined,
      }
    );

    return NextResponse.json({ analysis, upgradeResults, computeMs });
  } catch (err) {
    if (err instanceof UpgradeAnalysisInfeasibleError) {
      return NextResponse.json(
        { error: err.message, iterationsAttempted: err.iterationsAttempted },
        { status: 500 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("Topology has changed")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg.includes("is not completed") || msg.includes("No hosting capacity result found")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json(
      { error: `Upgrade analysis computation failed: ${msg}` },
      { status: 500 }
    );
  }
}
