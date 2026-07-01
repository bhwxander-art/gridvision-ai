/**
 * POST /api/ife/hosting-capacity
 *
 * Runs the deterministic (thermal-only) Hosting Capacity analysis for a
 * point of interconnection and persists it to the existing ife_analyses /
 * ife_hosting_capacity schema (INFRA-004). Reuses the PTDF (INFRA-009),
 * LODF (INFRA-010), and DC power flow (INFRA-011) engines unmodified.
 *
 * This is a POST (not nested under /api/network/[modelId]/...) because an
 * ife_analyses row is its own top-level resource — it references a network
 * model, iso, and POI bus, rather than being a sub-resource of one.
 *
 * Query parameters:
 *   tenant_id     — required; UUID of the owning tenant
 *   slack_bus     — optional; bus_number to use as the reference bus for
 *                   the underlying PTDF/LODF/DCPF computations
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
 *     "idempotencyKey": string         // optional
 *   }
 *
 * Response 200: { analysis, hostingCapacity, computeMs }
 *   Note: hc_p10/p50/p90, mc_scenarios_run, mc_convergence_pct,
 *   violation_probability, vmin/vmax_headroom_pu are always null —
 *   Monte Carlo and voltage-headroom hosting capacity are out of scope
 *   for INFRA-012 (see the approved technical specification).
 * Response 400: missing/invalid query params, request body, or a supplied
 *   base case that already violates a thermal rating
 * Response 404: model or POI bus not found for this tenant
 * Response 409: PTDF/LODF topology hashes disagree (stale cache)
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { SupabasePtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { SupabaseLodfStorage } from "@/lib/lodf/lodf-storage";
import { computeAndPersistHostingCapacity } from "@/lib/hosting-capacity/hosting-capacity-pipeline";
import { BaseCaseViolationError } from "@/lib/hosting-capacity/types";
import { IfeValidationError } from "@/lib/db/types-ife";
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
  const slackBusRaw = url.searchParams.get("slack_bus")?.trim();

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing required query parameter: tenant_id" },
      { status: 400 }
    );
  }

  let slackBusNumber: number | undefined;
  if (slackBusRaw) {
    slackBusNumber = parseInt(slackBusRaw, 10);
    if (!Number.isFinite(slackBusNumber) || slackBusNumber < 1) {
      return NextResponse.json(
        { error: "slack_bus must be a positive integer bus number" },
        { status: 400 }
      );
    }
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
  } = body as {
    networkModelId?: unknown;
    poiBusNumber?: unknown;
    isoId?: unknown;
    capacityMw?: unknown;
    projectType?: unknown;
    targetCod?: unknown;
    baseCaseInjectionsMw?: unknown;
    idempotencyKey?: unknown;
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

  const client = createClient(supabaseUrl, supabaseKey);
  const repo = new NetworkRepository(client);
  const ifeRepo = new IfeRepository(client);
  const ptdfStorage = new SupabasePtdfStorage(client);
  const lodfStorage = new SupabaseLodfStorage(client);

  try {
    const { analysis, hostingCapacity, computeMs } = await computeAndPersistHostingCapacity(
      tenantId,
      {
        networkModelId,
        poiBusNumber,
        isoId,
        capacityMw,
        projectType: projectType as ProjectType,
        targetCod: (targetCod as string | null | undefined) ?? null,
        baseCaseInjectionsMw: baseCaseInjectionsMw as BusInjectionsMw,
        idempotencyKey: idempotencyKey as string | undefined,
      },
      repo,
      ifeRepo,
      ptdfStorage,
      lodfStorage,
      slackBusNumber
    );

    return NextResponse.json({ analysis, hostingCapacity, computeMs });
  } catch (err) {
    if (err instanceof IfeValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    if (err instanceof BaseCaseViolationError) {
      return NextResponse.json(
        {
          error: err.message,
          branchNumber: err.branchNumber,
          flowMw: err.flowMw,
          ratingMw: err.ratingMw,
        },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("Topology hash mismatch")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg.includes("cannot be the slack bus")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json(
      { error: `Hosting capacity computation failed: ${msg}` },
      { status: 500 }
    );
  }
}
