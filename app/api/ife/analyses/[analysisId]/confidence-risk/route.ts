/**
 * POST /api/ife/analyses/[analysisId]/confidence-risk
 *
 * Computes a deterministic, fully-explainable confidence_score and
 * risk_score (each 0-100) for an existing, already-completed ife_analyses
 * record and persists them to ife_confidence_risk (INFRA-004), reusing the
 * already-persisted Hosting Capacity / Upgrade Analysis / Time-to-Power
 * results plus NetworkRepository.getModel unmodified. Nested under the
 * analysis it extends, matching Upgrade Analysis / Time-to-Power's
 * rationale — a sequel step on an existing resource.
 *
 * This route has NO dependency on PTDF, LODF, DC power flow, or network
 * topology beyond the model's own date/metadata.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Request body (JSON, optional):
 *   {
 *     "confidenceWeights": { "dataFreshness": number, "modelCalibration": number, "inputCompleteness": number, "mcConvergence": number },
 *     "riskWeights": { "costUncertainty": number, "queueDepth": number, "congestionTrend": number, "withdrawal": number }
 *   }
 *   All weight fields are optional overrides of the default equal (25/25/25/25)
 *   weights; unavailable components are excluded and weights renormalized
 *   over whatever remains available — see componentBreakdown in the response.
 *
 * Response 200: { analysis, confidenceRisk, computeMs }
 *   Note: conf_model_calibration, conf_mc_convergence, risk_cost_uncertainty,
 *   risk_congestion_trend, and risk_withdrawal are always null — each
 *   requires infrastructure (historical outcome tracking, Monte Carlo
 *   hosting capacity, a cost model, a congestion time-series, and a Cox PH
 *   withdrawal model respectively) that does not exist yet (see the
 *   approved technical specification). confidence_score and risk_score are
 *   always non-null numbers, computed as a weighted average over whichever
 *   components ARE available (falling back to a neutral 50 only if none
 *   are) — componentBreakdown discloses exactly which components
 *   contributed to each.
 * Response 400: analysis not yet completed, or invalid weight overrides
 * Response 404: analysis or network model not found for this tenant
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { computeAndPersistConfidenceRisk } from "@/lib/confidence-risk/confidence-risk-pipeline";
import { IfeValidationError } from "@/lib/db/types-ife";

function parseWeights(value: unknown, fieldName: string, keys: string[]): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IfeValidationError(`'${fieldName}' must be a JSON object`, fieldName);
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      throw new IfeValidationError(`'${fieldName}.${key}' is not a recognized weight`, fieldName);
    }
    const weight = record[key];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      throw new IfeValidationError(`'${fieldName}.${key}' must be a non-negative finite number`, fieldName);
    }
    result[key] = weight;
  }
  return result;
}

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

  const { confidenceWeights, riskWeights } = body as {
    confidenceWeights?: unknown;
    riskWeights?: unknown;
  };

  let parsedConfidenceWeights: Record<string, number> | undefined;
  let parsedRiskWeights: Record<string, number> | undefined;
  try {
    parsedConfidenceWeights = parseWeights(confidenceWeights, "confidenceWeights", [
      "dataFreshness",
      "modelCalibration",
      "inputCompleteness",
      "mcConvergence",
    ]);
    parsedRiskWeights = parseWeights(riskWeights, "riskWeights", [
      "costUncertainty",
      "queueDepth",
      "congestionTrend",
      "withdrawal",
    ]);
  } catch (err) {
    if (err instanceof IfeValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    throw err;
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const ifeRepo = new IfeRepository(client);
  const networkRepo = new NetworkRepository(client);

  try {
    const { analysis, confidenceRisk, computeMs } = await computeAndPersistConfidenceRisk(
      tenantId,
      analysisId,
      ifeRepo,
      networkRepo,
      {
        confidenceWeights: parsedConfidenceWeights,
        riskWeights: parsedRiskWeights,
      }
    );

    return NextResponse.json({ analysis, confidenceRisk, computeMs });
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
      { error: `Confidence/risk computation failed: ${msg}` },
      { status: 500 }
    );
  }
}
