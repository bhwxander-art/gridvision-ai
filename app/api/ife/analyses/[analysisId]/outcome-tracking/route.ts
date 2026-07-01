/**
 * POST/GET /api/ife/analyses/[analysisId]/outcome-tracking
 *
 * Pure persistence/read feature (INFRA-020). Records actual observed
 * project outcomes against an existing, completed ife_analyses record and
 * retrieves them. No prediction, no model execution, no recalibration, no
 * modification of any prior analysis result. The only derived values
 * (cost_residual_m, cod_residual_months) come from the existing BEFORE
 * INSERT database trigger (migration 015) — nothing is computed here.
 *
 * POST is fully resource-idempotent: analysisId is the natural idempotency
 * key. If an outcome record already exists for the given analysisId, it is
 * returned unchanged (200), never a 409. This check-then-insert is
 * application-level, not atomic (ife_outcome_tracking.analysis_id has no
 * UNIQUE constraint — see IfeOutcomeTrackingRepository's docstring); a rare
 * concurrent race could still produce two rows for one analysis, an
 * accepted limitation consistent with existing idempotency patterns
 * elsewhere in this codebase (INFRA-012/014/019), not a guarantee this
 * route can make absolute without a schema change.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * POST request body (JSON, all fields optional):
 *   {
 *     "queueProjectId": string | null,
 *     "actualCostM": number | null,
 *     "actualCod": string | null,
 *     "actualFeasible": boolean | null,
 *     "actualWithdrawn": boolean | null,
 *     "outcomeObservedAt": string | null,
 *     "notes": string | null,
 *     "idempotencyKey": string   // accepted but ignored for persistence — analysisId is the key
 *   }
 *
 * Response 200 POST: { analysis, outcomeTracking, computeMs }
 * Response 200 GET:  { analysis, outcomeTracking }
 * Response 400: invalid payload field, or (POST only) analysis not yet completed
 * Response 404: analysis not found — this is also returned for a cross-tenant analysisId,
 *   which is never distinguished from "not found" (see the approved architecture review);
 *   GET only: also returned when no outcome record exists yet for an otherwise-valid analysis
 * Response 500: unexpected/storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { IfeOutcomeTrackingRepository } from "@/lib/db/repositories/ife-outcome-tracking.repository";
import { computeAndPersistOutcomeTracking } from "@/lib/outcome-tracking/outcome-tracking-pipeline";
import { IfeValidationError } from "@/lib/db/types-ife";
import type { OutcomeTrackingRequest } from "@/lib/outcome-tracking/types";

function stringOrNull(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "string") {
    throw new IfeValidationError(`'${field}' must be a string or null`, field);
  }
  // Treat an empty string as "not provided" rather than passing it through — actualCod and
  // outcomeObservedAt feed DATE/TIMESTAMPTZ columns (and the residual-computing DB trigger)
  // that reject "" outright, which would otherwise surface as an opaque 500.
  if (value === "") return undefined;
  return value;
}

function booleanOrNull(value: unknown, field: string): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "boolean") {
    throw new IfeValidationError(`'${field}' must be a boolean or null`, field);
  }
  return value;
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

  const {
    queueProjectId,
    actualCostM,
    actualCod,
    actualFeasible,
    actualWithdrawn,
    outcomeObservedAt,
    notes,
    idempotencyKey,
  } = body as {
    queueProjectId?: unknown;
    actualCostM?: unknown;
    actualCod?: unknown;
    actualFeasible?: unknown;
    actualWithdrawn?: unknown;
    outcomeObservedAt?: unknown;
    notes?: unknown;
    idempotencyKey?: unknown;
  };

  let outcomeRequest: OutcomeTrackingRequest;
  try {
    if (
      actualCostM !== undefined &&
      actualCostM !== null &&
      (typeof actualCostM !== "number" || !Number.isFinite(actualCostM))
    ) {
      throw new IfeValidationError("'actualCostM' must be a finite number or null", "actualCostM");
    }
    // idempotencyKey is accepted for client convenience but never persisted or compared —
    // analysisId is the natural idempotency key (approved spec, resolved finding B1).
    if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
      throw new IfeValidationError("'idempotencyKey' must be a string", "idempotencyKey");
    }

    outcomeRequest = {
      queueProjectId: stringOrNull(queueProjectId, "queueProjectId"),
      actualCostM: actualCostM as number | null | undefined,
      actualCod: stringOrNull(actualCod, "actualCod"),
      actualFeasible: booleanOrNull(actualFeasible, "actualFeasible"),
      actualWithdrawn: booleanOrNull(actualWithdrawn, "actualWithdrawn"),
      outcomeObservedAt: stringOrNull(outcomeObservedAt, "outcomeObservedAt"),
      notes: stringOrNull(notes, "notes"),
    };
  } catch (err) {
    if (err instanceof IfeValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    throw err;
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const ifeRepo = new IfeRepository(client);
  const outcomeRepo = new IfeOutcomeTrackingRepository(client);

  try {
    const { analysis, outcomeTracking, computeMs } = await computeAndPersistOutcomeTracking(
      tenantId,
      analysisId,
      ifeRepo,
      outcomeRepo,
      outcomeRequest
    );
    return NextResponse.json({ analysis, outcomeTracking, computeMs });
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
    // Postgres constraint errors for genuinely invalid payload values that pass basic
    // typeof/finite checks but fail at the database — e.g. actualCod: "not-a-date",
    // queueProjectId referencing a nonexistent row, or actualCostM overflowing
    // NUMERIC(10,2). These are client input errors (the spec requires rejecting
    // "invalid payload"), not server faults, so they map to 400 rather than 500.
    if (
      msg.includes("invalid input syntax") ||
      msg.includes("violates foreign key constraint") ||
      msg.includes("numeric field overflow")
    ) {
      return NextResponse.json({ error: `Invalid payload: ${msg}` }, { status: 400 });
    }
    return NextResponse.json({ error: `Outcome tracking failed: ${msg}` }, { status: 500 });
  }
}

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
  const outcomeRepo = new IfeOutcomeTrackingRepository(client);

  try {
    const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
    if (!analysis) {
      // Same response for "doesn't exist" and "exists under a different tenant" — never
      // distinguished, per the approved architecture review (resolved finding B2).
      return NextResponse.json(
        { error: `Analysis ${analysisId} not found for this tenant` },
        { status: 404 }
      );
    }

    const outcomeTracking = await outcomeRepo.getOutcomeTrackingByAnalysisId(tenantId, analysisId);
    if (!outcomeTracking) {
      return NextResponse.json(
        { error: `No outcome record exists for analysis ${analysisId}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ analysis, outcomeTracking });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to fetch outcome tracking: ${msg}` }, { status: 500 });
  }
}
