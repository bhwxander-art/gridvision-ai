/**
 * POST /api/ife/scenarios
 *
 * Runs a deterministic "what-if" scenario against an existing network model
 * by reusing the existing, unmodified IFE orchestrator (INFRA-014) — either
 * directly against the base model (POI/capacity/COD/injection-only changes)
 * or against a cloned network model with a branch-level delta applied
 * (branch outage / rating adjustment changes). No electrical engine is
 * modified or reimplemented by this route (INFRA-019).
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Request body (JSON):
 *   {
 *     "baseNetworkModelId": string,        // required
 *     "name": string,                      // required
 *     "description": string | null,        // optional
 *     "poiBusNumber": number,              // required
 *     "isoId": string,                     // required
 *     "capacityMw": number,                // required, > 0
 *     "projectType": string,               // required; ProjectType enum value
 *     "targetCod": string | null,          // optional
 *     "baseCaseInjectionsMw": { "<busNumber>": <mw>, ... }, // required
 *     "injectionOverridesMw": { "<busNumber>": <mw>, ... }, // optional, merged over baseCaseInjectionsMw
 *     "networkDelta": [                                      // optional
 *       { "op": "set_branch_in_service", "branchNumber": number, "inService": boolean } |
 *       { "op": "set_branch_rating", "branchNumber": number, "rateAMw": number, "rateBMw"?: number|null, "rateCMw"?: number|null }
 *     ],
 *     "idempotencyKey": string             // optional
 *   }
 *
 * Response 200: { scenario, orchestration }
 *   orchestration has the exact shape of POST /api/ife/analyses's response.
 * Response 400: invalid request body/delta operation
 * Response 404: baseNetworkModelId not found for this tenant
 * Response 409: networkDelta references a branch that doesn't exist in the base model
 * Response 500: materialization or orchestration error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { IfeScenarioRepository } from "@/lib/db/repositories/ife-scenario.repository";
import { SupabasePtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { SupabaseLodfStorage } from "@/lib/lodf/lodf-storage";
import { runScenario } from "@/lib/ife-scenario/scenario-pipeline";
import { IfeScenarioStageError, type ScenarioRequest, type NetworkDeltaOp } from "@/lib/ife-scenario/types";
import { IfeScenarioValidationError } from "@/lib/db/types-ife-scenario";
import { IfeValidationError } from "@/lib/db/types-ife";
import { BaseCaseViolationError } from "@/lib/hosting-capacity/types";
import { UpgradeAnalysisInfeasibleError } from "@/lib/upgrade-analysis/types";
import type { ProjectType } from "@/lib/db/types-queue";
import type { BusInjectionsMw } from "@/lib/dcpf/types";

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Server configuration error: missing Supabase credentials" },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id")?.trim();
  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing required query parameter: tenant_id" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const {
    baseNetworkModelId,
    name,
    description,
    poiBusNumber,
    isoId,
    capacityMw,
    projectType,
    targetCod,
    baseCaseInjectionsMw,
    injectionOverridesMw,
    networkDelta,
    idempotencyKey,
  } = body as {
    baseNetworkModelId?: unknown;
    name?: unknown;
    description?: unknown;
    poiBusNumber?: unknown;
    isoId?: unknown;
    capacityMw?: unknown;
    projectType?: unknown;
    targetCod?: unknown;
    baseCaseInjectionsMw?: unknown;
    injectionOverridesMw?: unknown;
    networkDelta?: unknown;
    idempotencyKey?: unknown;
  };

  if (typeof baseNetworkModelId !== "string" || baseNetworkModelId.trim().length === 0) {
    return NextResponse.json({ error: "'baseNetworkModelId' is required" }, { status: 400 });
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "'name' is required" }, { status: 400 });
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return NextResponse.json({ error: "'description' must be a string or null" }, { status: 400 });
  }
  if (typeof poiBusNumber !== "number" || !Number.isFinite(poiBusNumber)) {
    return NextResponse.json({ error: "'poiBusNumber' must be a finite number" }, { status: 400 });
  }
  if (typeof isoId !== "string" || isoId.trim().length === 0) {
    return NextResponse.json({ error: "'isoId' is required" }, { status: 400 });
  }
  if (typeof capacityMw !== "number" || !Number.isFinite(capacityMw)) {
    return NextResponse.json({ error: "'capacityMw' must be a finite number" }, { status: 400 });
  }
  if (typeof projectType !== "string" || projectType.trim().length === 0) {
    return NextResponse.json({ error: "'projectType' is required" }, { status: 400 });
  }
  if (targetCod !== undefined && targetCod !== null && typeof targetCod !== "string") {
    return NextResponse.json({ error: "'targetCod' must be a string or null" }, { status: 400 });
  }
  if (
    typeof baseCaseInjectionsMw !== "object" ||
    baseCaseInjectionsMw === null ||
    Array.isArray(baseCaseInjectionsMw)
  ) {
    return NextResponse.json(
      { error: "'baseCaseInjectionsMw' must be a JSON object mapping bus_number -> MW" },
      { status: 400 }
    );
  }
  if (
    injectionOverridesMw !== undefined &&
    (typeof injectionOverridesMw !== "object" || injectionOverridesMw === null || Array.isArray(injectionOverridesMw))
  ) {
    return NextResponse.json(
      { error: "'injectionOverridesMw' must be a JSON object mapping bus_number -> MW" },
      { status: 400 }
    );
  }
  if (networkDelta !== undefined && !Array.isArray(networkDelta)) {
    return NextResponse.json({ error: "'networkDelta' must be an array" }, { status: 400 });
  }
  if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
    return NextResponse.json({ error: "'idempotencyKey' must be a string" }, { status: 400 });
  }

  const scenarioRequest: ScenarioRequest = {
    baseNetworkModelId,
    name,
    description: (description as string | null | undefined) ?? null,
    poiBusNumber,
    isoId,
    capacityMw,
    projectType: projectType as ProjectType,
    targetCod: (targetCod as string | null | undefined) ?? null,
    baseCaseInjectionsMw: baseCaseInjectionsMw as BusInjectionsMw,
    injectionOverridesMw: injectionOverridesMw as Record<number, number> | undefined,
    networkDelta: networkDelta as NetworkDeltaOp[] | undefined,
    idempotencyKey: idempotencyKey as string | undefined,
  };

  const client = createClient(supabaseUrl, supabaseKey);
  const networkRepo = new NetworkRepository(client);
  const ifeRepo = new IfeRepository(client);
  const scenarioRepo = new IfeScenarioRepository(client);
  const ptdfStorage = new SupabasePtdfStorage(client);
  const lodfStorage = new SupabaseLodfStorage(client);

  try {
    const result = await runScenario(
      tenantId,
      scenarioRequest,
      networkRepo,
      ifeRepo,
      scenarioRepo,
      ptdfStorage,
      lodfStorage
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IfeScenarioStageError) {
      const cause = err.cause instanceof Error ? err.cause : new Error(String(err.cause));
      return mapStageError(err.stage, cause);
    }
    if (err instanceof IfeScenarioValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Scenario execution failed: ${msg}` }, { status: 500 });
  }
}

function mapStageError(stage: "materialization" | "orchestration", cause: Error): Response {
  // Message-substring checks run before the IfeScenarioValidationError
  // instanceof branch below: buildClonedBranchInserts throws exactly that
  // error class for an unknown branch_number, so checking instanceof first
  // would make this route's own documented 409 contract unreachable.
  const msg = cause.message;
  if (msg.includes("does not exist in the base model")) {
    return NextResponse.json({ error: msg, stage }, { status: 409 });
  }
  if (cause instanceof IfeScenarioValidationError) {
    return NextResponse.json({ error: cause.message, field: cause.field, stage }, { status: 400 });
  }
  if (cause instanceof IfeValidationError) {
    return NextResponse.json({ error: cause.message, field: cause.field, stage }, { status: 400 });
  }
  if (cause instanceof BaseCaseViolationError) {
    return NextResponse.json(
      { error: cause.message, branchNumber: cause.branchNumber, flowMw: cause.flowMw, ratingMw: cause.ratingMw, stage },
      { status: 400 }
    );
  }
  if (cause instanceof UpgradeAnalysisInfeasibleError) {
    return NextResponse.json(
      { error: cause.message, iterationsAttempted: cause.iterationsAttempted, stage },
      { status: 500 }
    );
  }
  if (msg.includes("not found")) {
    return NextResponse.json({ error: msg, stage }, { status: 404 });
  }
  if (msg.includes("Topology has changed") || msg.includes("Topology hash mismatch")) {
    return NextResponse.json({ error: msg, stage }, { status: 409 });
  }
  // Same substring set app/api/ife/analyses/route.ts's mapStageError checks —
  // these are errors the reused, unmodified orchestrator/hosting-capacity/
  // DCPF code can throw, so the same message families must map to the same
  // status code regardless of which route reached them.
  if (
    msg.includes("is not completed") ||
    msg.includes("No hosting capacity result found") ||
    msg.includes("[DCPF] injection") ||
    msg.includes("cannot be the slack bus")
  ) {
    return NextResponse.json({ error: msg, stage }, { status: 400 });
  }
  return NextResponse.json(
    { error: `Scenario execution failed at stage '${stage}': ${msg}`, stage },
    { status: 500 }
  );
}
