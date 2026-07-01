/**
 * POST /api/ife/analyses/[analysisId]/outcome-analytics
 *
 * Pure deterministic interval-coverage computation (INFRA-021): compares
 * already-persisted actual outcome values (ife_outcome_tracking) against
 * already-persisted deterministic prediction intervals (ife_upgrade_results
 * cost_p10_m/cost_p90_m, ife_time_to_power cod_p25/cod_p75) and persists
 * within_cost_p10_p90/within_cod_p25_p75 — the two analytics columns
 * INFRA-020 deliberately left null. No modeling, no prediction, no
 * modification of any existing analysis result.
 *
 * No GET endpoint is added here: the existing, unmodified
 * GET /api/ife/analyses/[analysisId]/outcome-tracking already returns the
 * full ife_outcome_tracking row, including these two fields — once this
 * endpoint populates them, that route surfaces the real values for free.
 *
 * This endpoint takes no client-supplied input — every value it compares is
 * already server-side and already validated by the pipelines that produced
 * it. A request body, if sent, is intentionally ignored rather than
 * rejected, matching sibling routes' leniency toward an unnecessary body.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Response 200: { analysis, outcomeTracking, computeMs }
 * Response 400: missing tenant_id or analysisId
 * Response 404: analysis not found — also returned for a cross-tenant
 *   analysisId, never distinguished from "not found"; or no outcome record
 *   exists yet for this analysis (Outcome Tracking must run first)
 * Response 500: unexpected/storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { IfeOutcomeTrackingRepository } from "@/lib/db/repositories/ife-outcome-tracking.repository";
import { IfeOutcomeAnalyticsRepository } from "@/lib/db/repositories/ife-outcome-analytics.repository";
import { computeAndPersistOutcomeAnalytics } from "@/lib/outcome-analytics/outcome-analytics-pipeline";

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

  // Request body is intentionally never read or validated — this endpoint has no
  // client-supplied input to accept.

  const client = createClient(supabaseUrl, supabaseKey);
  const ifeRepo = new IfeRepository(client);
  const outcomeRepo = new IfeOutcomeTrackingRepository(client);
  const analyticsRepo = new IfeOutcomeAnalyticsRepository(client);

  try {
    const { analysis, outcomeTracking, computeMs } = await computeAndPersistOutcomeAnalytics(
      tenantId,
      analysisId,
      ifeRepo,
      outcomeRepo,
      analyticsRepo
    );
    return NextResponse.json({ analysis, outcomeTracking, computeMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("No outcome record exists")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: `Outcome analytics failed: ${msg}` }, { status: 500 });
  }
}
