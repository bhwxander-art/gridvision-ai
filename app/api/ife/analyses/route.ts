/**
 * POST /api/ife/analyses
 *
 * Runs the complete deterministic IFE workflow in one request: Hosting
 * Capacity (INFRA-012), followed by Upgrade Analysis (INFRA-013) only if
 * the requested capacity exceeds what hosting capacity alone provides.
 * Purely additive — POST /api/ife/hosting-capacity and
 * POST /api/ife/analyses/[analysisId]/upgrade-analysis are unchanged and
 * remain independently callable.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Request body (JSON):
 *   {
 *     "networkModelId": string,        // required
 *     "poiBusNumber": number,          // required
 *     "isoId": string,                 // required
 *     "capacityMw": number,            // required, > 0
 *     "projectType": string,           // required; ProjectType enum value
 *     "targetCod": string | null,      // optional
 *     "baseCaseInjectionsMw": { "<busNumber>": <mw>, ... }, // required
 *     "idempotencyKey": string,        // optional
 *     "hostingCapacityOptions": { "slackBusNumber": number },   // optional
 *     "upgradeAnalysisOptions": {                                // optional
 *       "slackBusNumber": number, "sensitivityEpsilon": number,
 *       "ratingMarginMultiplier": number, "maxIterations": number
 *     }
 *   }
 *
 * Response 200: { analysis, hostingCapacity, upgradeResults, overallStatus,
 *   computeMs: { hostingCapacityMs, upgradeAnalysisMs, totalMs } }
 *   upgradeResults is null when hosting capacity alone was already sufficient.
 * Response 400: invalid request body/options, hosting capacity/upgrade-analysis
 *   validation failure (e.g. base case already violates a rating)
 * Response 404: model, POI bus, or analysis not found for this tenant
 * Response 409: topology has changed since a referenced analysis was computed
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { SupabasePtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { SupabaseLodfStorage } from "@/lib/lodf/lodf-storage";
import { orchestrateIfeAnalysis } from "@/lib/ife-orchestrator/ife-orchestrator-pipeline";
import { IfeOrchestrationStageError } from "@/lib/ife-orchestrator/types";
import { BaseCaseViolationError } from "@/lib/hosting-capacity/types";
import { UpgradeAnalysisInfeasibleError } from "@/lib/upgrade-analysis/types";
import { IfeValidationError } from "@/lib/db/types-ife";
import type { ProjectType } from "@/lib/db/types-queue";
import type { BusInjectionsMw } from "@/lib/dcpf/types";
import type { IfeOrchestrationRequest } from "@/lib/ife-orchestrator/types";

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
    networkModelId,
    poiBusNumber,
    isoId,
    capacityMw,
    projectType,
    targetCod,
    baseCaseInjectionsMw,
    idempotencyKey,
    hostingCapacityOptions,
    upgradeAnalysisOptions,
  } = body as {
    networkModelId?: unknown;
    poiBusNumber?: unknown;
    isoId?: unknown;
    capacityMw?: unknown;
    projectType?: unknown;
    targetCod?: unknown;
    baseCaseInjectionsMw?: unknown;
    idempotencyKey?: unknown;
    hostingCapacityOptions?: unknown;
    upgradeAnalysisOptions?: unknown;
  };

  if (typeof networkModelId !== "string" || networkModelId.trim().length === 0) {
    return NextResponse.json({ error: "'networkModelId' is required" }, { status: 400 });
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
  if (targetCod !== undefined && targetCod !== null && typeof targetCod !== "string") {
    return NextResponse.json({ error: "'targetCod' must be a string or null" }, { status: 400 });
  }
  if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
    return NextResponse.json({ error: "'idempotencyKey' must be a string" }, { status: 400 });
  }

  let hcOptions: { slackBusNumber?: number } | undefined;
  if (hostingCapacityOptions !== undefined) {
    if (typeof hostingCapacityOptions !== "object" || hostingCapacityOptions === null) {
      return NextResponse.json(
        { error: "'hostingCapacityOptions' must be a JSON object" },
        { status: 400 }
      );
    }
    const { slackBusNumber: hcSlackBusNumber } = hostingCapacityOptions as { slackBusNumber?: unknown };
    if (
      hcSlackBusNumber !== undefined &&
      (typeof hcSlackBusNumber !== "number" || !Number.isFinite(hcSlackBusNumber))
    ) {
      return NextResponse.json(
        { error: "'hostingCapacityOptions.slackBusNumber' must be a finite number" },
        { status: 400 }
      );
    }
    hcOptions = { slackBusNumber: hcSlackBusNumber as number | undefined };
  }

  let uaOptions:
    | {
        slackBusNumber?: number;
        sensitivityEpsilon?: number;
        ratingMarginMultiplier?: number;
        maxIterations?: number;
      }
    | undefined;
  if (upgradeAnalysisOptions !== undefined) {
    if (typeof upgradeAnalysisOptions !== "object" || upgradeAnalysisOptions === null) {
      return NextResponse.json(
        { error: "'upgradeAnalysisOptions' must be a JSON object" },
        { status: 400 }
      );
    }
    const {
      slackBusNumber: uaSlackBusNumber,
      sensitivityEpsilon,
      ratingMarginMultiplier,
      maxIterations,
    } = upgradeAnalysisOptions as {
      slackBusNumber?: unknown;
      sensitivityEpsilon?: unknown;
      ratingMarginMultiplier?: unknown;
      maxIterations?: unknown;
    };

    for (const [name, value] of [
      ["upgradeAnalysisOptions.slackBusNumber", uaSlackBusNumber],
      ["upgradeAnalysisOptions.sensitivityEpsilon", sensitivityEpsilon],
      ["upgradeAnalysisOptions.ratingMarginMultiplier", ratingMarginMultiplier],
      ["upgradeAnalysisOptions.maxIterations", maxIterations],
    ] as const) {
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
        return NextResponse.json({ error: `'${name}' must be a finite number` }, { status: 400 });
      }
    }
    // Same range checks as the standalone Upgrade Analysis route (INFRA-013 H2) — not re-derived,
    // just re-applied here since this route accepts the same options through a nested field.
    if (
      maxIterations !== undefined &&
      (!Number.isInteger(maxIterations as number) || (maxIterations as number) <= 0)
    ) {
      return NextResponse.json(
        { error: "'upgradeAnalysisOptions.maxIterations' must be an integer greater than 0" },
        { status: 400 }
      );
    }
    if (ratingMarginMultiplier !== undefined && (ratingMarginMultiplier as number) <= 0) {
      return NextResponse.json(
        { error: "'upgradeAnalysisOptions.ratingMarginMultiplier' must be greater than 0" },
        { status: 400 }
      );
    }

    uaOptions = {
      slackBusNumber: uaSlackBusNumber as number | undefined,
      sensitivityEpsilon: sensitivityEpsilon as number | undefined,
      ratingMarginMultiplier: ratingMarginMultiplier as number | undefined,
      maxIterations: maxIterations as number | undefined,
    };
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const repo = new NetworkRepository(client);
  const ifeRepo = new IfeRepository(client);
  const ptdfStorage = new SupabasePtdfStorage(client);
  const lodfStorage = new SupabaseLodfStorage(client);

  const orchestrationRequest: IfeOrchestrationRequest = {
    networkModelId,
    poiBusNumber,
    isoId,
    capacityMw,
    projectType: projectType as ProjectType,
    targetCod: (targetCod as string | null | undefined) ?? null,
    baseCaseInjectionsMw: baseCaseInjectionsMw as BusInjectionsMw,
    idempotencyKey: idempotencyKey as string | undefined,
    hostingCapacityOptions: hcOptions,
    upgradeAnalysisOptions: uaOptions,
  };

  try {
    const result = await orchestrateIfeAnalysis(tenantId, orchestrationRequest, repo, ifeRepo, ptdfStorage, lodfStorage);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IfeOrchestrationStageError) {
      const cause = err.cause instanceof Error ? err.cause : new Error(String(err.cause));
      return mapStageError(err.stage, cause);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `IFE analysis orchestration failed: ${msg}` },
      { status: 500 }
    );
  }
}

function mapStageError(stage: "hosting_capacity" | "upgrade_analysis", cause: Error): Response {
  if (cause instanceof IfeValidationError) {
    return NextResponse.json({ error: cause.message, field: cause.field, stage }, { status: 400 });
  }
  if (cause instanceof BaseCaseViolationError) {
    return NextResponse.json(
      {
        error: cause.message,
        branchNumber: cause.branchNumber,
        flowMw: cause.flowMw,
        ratingMw: cause.ratingMw,
        stage,
      },
      { status: 400 }
    );
  }
  if (cause instanceof UpgradeAnalysisInfeasibleError) {
    return NextResponse.json(
      { error: cause.message, iterationsAttempted: cause.iterationsAttempted, stage },
      { status: 500 }
    );
  }
  const msg = cause.message;
  if (msg.includes("not found")) {
    return NextResponse.json({ error: msg, stage }, { status: 404 });
  }
  if (msg.includes("Topology has changed") || msg.includes("Topology hash mismatch")) {
    return NextResponse.json({ error: msg, stage }, { status: 409 });
  }
  if (
    msg.includes("is not completed") ||
    msg.includes("No hosting capacity result found") ||
    msg.includes("[DCPF] injection") ||
    msg.includes("cannot be the slack bus")
  ) {
    return NextResponse.json({ error: msg, stage }, { status: 400 });
  }
  return NextResponse.json(
    { error: `IFE analysis failed at stage '${stage}': ${msg}`, stage },
    { status: 500 }
  );
}
