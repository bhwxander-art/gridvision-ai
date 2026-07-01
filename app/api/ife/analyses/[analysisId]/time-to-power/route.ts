/**
 * POST /api/ife/analyses/[analysisId]/time-to-power
 *
 * Computes deterministic, empirically-derived time-to-power estimates
 * (expected COD percentiles, expected months to study completion, and
 * competing queue depth at the POI) for an existing, already-completed
 * ife_analyses record and persists them to ife_time_to_power (INFRA-004).
 * Nested under the analysis it extends, matching the Upgrade Analysis
 * route's rationale — a sequel step on an existing resource, not an
 * independent request.
 *
 * This route has NO dependency on PTDF, LODF, DC power flow, or network
 * topology — it only reads queue-domain data (QueueRepository,
 * QueueAnalyticsRepository) and the ife_analyses/ife_time_to_power tables.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Request body (JSON, optional):
 *   { "minSampleSize": number }
 *
 * Response 200: { analysis, timeToPower, computeMs }
 *   Note: survival_12m/24m/36m are always null — the Cox proportional-
 *   hazards model is out of scope for INFRA-015 (see the approved technical
 *   specification). cod_p25/p50/p75 and months_to_study_completion may also
 *   be null when historical sample size is insufficient — this is a valid,
 *   documented outcome, not an error.
 * Response 400: analysis not yet completed, or invalid minSampleSize
 * Response 404: analysis not found for this tenant
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { QueueRepository } from "@/lib/db/repositories/queue.repository";
import { QueueAnalyticsRepository } from "@/lib/db/repositories/queue-analytics.repository";
import { computeAndPersistTimeToPower } from "@/lib/time-to-power/time-to-power-pipeline";
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

  const { minSampleSize } = body as { minSampleSize?: unknown };
  if (
    minSampleSize !== undefined &&
    (typeof minSampleSize !== "number" || !Number.isInteger(minSampleSize) || minSampleSize <= 0)
  ) {
    return NextResponse.json(
      { error: "'minSampleSize' must be an integer greater than 0" },
      { status: 400 }
    );
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const ifeRepo = new IfeRepository(client);
  const queueRepo = new QueueRepository(client);
  const queueAnalyticsRepo = new QueueAnalyticsRepository(client);

  try {
    const { analysis, timeToPower, computeMs } = await computeAndPersistTimeToPower(
      tenantId,
      analysisId,
      ifeRepo,
      queueRepo,
      queueAnalyticsRepo,
      { minSampleSize: minSampleSize as number | undefined }
    );

    return NextResponse.json({ analysis, timeToPower, computeMs });
  } catch (err) {
    if (err instanceof IfeValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("is not completed")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json(
      { error: `Time-to-power computation failed: ${msg}` },
      { status: 500 }
    );
  }
}
