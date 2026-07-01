/**
 * POST /api/ife/analyses/[analysisId]/explanations
 *
 * Generates a deterministic, template-based assumptions/limitations list
 * for an existing, already-completed ife_analyses record and persists it to
 * ife_explanations (INFRA-004), reusing the already-persisted Hosting
 * Capacity / Upgrade Analysis / Time-to-Power / Confidence & Risk results.
 * Nested under the analysis it extends, matching the rest of the IFE
 * sequel-step routes.
 *
 * This route has NO dependency on PTDF, LODF, DC power flow, or network
 * topology, and takes no tunable parameters — the assumptions[] content is
 * fully determined by which upstream analyses exist for this analysisId.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Request body: none required (accepted if present and empty, for route
 * consistency with the rest of the IFE sequel-step endpoints).
 *
 * Response 200: { analysis, explanations, computeMs }
 *   Note: baselineWithdrawalProb, predictedWithdrawalProb, coxModelVersion,
 *   and costModelVersion are always null; withdrawalShapValues and
 *   costDrivers are always empty arrays — each requires a Cox PH
 *   withdrawal model or a cost model, neither of which exists yet (see the
 *   approved technical specification). assumptions is the real output of
 *   this milestone: a fixed-order, deterministic list of plain-English
 *   caveats about what this specific analysis does and does not cover.
 * Response 400: analysis not yet completed
 * Response 404: analysis not found for this tenant
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { computeAndPersistExplanations } from "@/lib/explanations/explanations-pipeline";
import { IfeValidationError } from "@/lib/db/types-ife";

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

  const rawBody = await request.text();
  if (rawBody.trim().length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const ifeRepo = new IfeRepository(client);

  try {
    const { analysis, explanations, computeMs } = await computeAndPersistExplanations(
      tenantId,
      analysisId,
      ifeRepo
    );

    return NextResponse.json({ analysis, explanations, computeMs });
  } catch (err) {
    if (err instanceof IfeValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("is not completed") || msg.includes("no usable hosting capacity result")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json(
      { error: `Explanations computation failed: ${msg}` },
      { status: 500 }
    );
  }
}
