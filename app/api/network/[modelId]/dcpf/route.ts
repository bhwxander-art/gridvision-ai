/**
 * POST /api/network/[modelId]/dcpf
 *
 * Solves DC power flow for the specified network model against a caller-
 * supplied bus injection pattern. Unlike the PTDF/LODF GET endpoints, this
 * is a POST because the input (a per-bus MW injection map, potentially
 * covering hundreds of buses) does not fit cleanly into query parameters.
 *
 * Query parameters:
 *   tenant_id      — required; UUID of the owning tenant
 *   format         — optional; "json" (default) | "summary"
 *                       json:    full angles + flows + power balance
 *                       summary: counts + power balance + timings only
 *   outage_branch  — optional; branch_number to additionally screen via the
 *                    cached LODF matrix (N-1 contingency impact of this
 *                    base case), reusing lib/lodf's contingencyImpact()
 *
 * Request body (JSON):
 *   {
 *     "injections": { "<busNumber>": <mw>, ... },  // required; MW, + = gen, - = load
 *     "slackBusNumber": number,                     // optional
 *     "baseMva": number,                            // optional; defaults to the model's base_mva
 *     "mismatchToleranceMw": number,                // optional
 *     "expectedTopologyHash": string | null          // optional staleness guard
 *   }
 *
 * Response 200: solved operating point (+ optional contingency block)
 * Response 400: missing/invalid query params or request body
 * Response 404: model not found for this tenant
 * Response 409: expectedTopologyHash no longer matches the model's topology
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { SupabasePtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { SupabaseLodfStorage } from "@/lib/lodf/lodf-storage";
import { getOrComputeLodf } from "@/lib/lodf/lodf-pipeline";
import { computeDcPowerFlowForModel } from "@/lib/dcpf/dcpf-pipeline";
import { applyLodfContingency } from "@/lib/dcpf/dcpf-engine";
import type { BusInjectionsMw } from "@/lib/dcpf/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ modelId: string }> }
): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Server configuration error: missing Supabase credentials" },
      { status: 500 }
    );
  }

  const { modelId } = await params;
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id")?.trim();
  const format = url.searchParams.get("format")?.toLowerCase() ?? "json";
  const outageBranchRaw = url.searchParams.get("outage_branch")?.trim();

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing required query parameter: tenant_id" },
      { status: 400 }
    );
  }
  if (!modelId) {
    return NextResponse.json({ error: "Missing model ID in path" }, { status: 400 });
  }

  let outageBranch: number | undefined;
  if (outageBranchRaw) {
    outageBranch = parseInt(outageBranchRaw, 10);
    if (!Number.isFinite(outageBranch)) {
      return NextResponse.json(
        { error: "outage_branch must be an integer branch_number" },
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
  if (typeof body !== "object" || body === null || !("injections" in body)) {
    return NextResponse.json(
      { error: "Request body must include an 'injections' object mapping bus_number -> MW" },
      { status: 400 }
    );
  }
  const {
    injections,
    slackBusNumber,
    baseMva,
    mismatchToleranceMw,
    expectedTopologyHash,
  } = body as {
    injections: unknown;
    slackBusNumber?: number;
    baseMva?: number;
    mismatchToleranceMw?: number;
    expectedTopologyHash?: string | null;
  };
  if (typeof injections !== "object" || injections === null || Array.isArray(injections)) {
    return NextResponse.json(
      { error: "'injections' must be a JSON object mapping bus_number -> MW" },
      { status: 400 }
    );
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const repo = new NetworkRepository(client);

  try {
    const { flow, computeMs } = await computeDcPowerFlowForModel(
      tenantId,
      modelId,
      repo,
      injections as BusInjectionsMw,
      { slackBusNumber, baseMva, mismatchToleranceMw, expectedTopologyHash }
    );

    let contingency: unknown;
    if (outageBranch !== undefined) {
      const ptdfStorage = new SupabasePtdfStorage(client);
      const lodfStorage = new SupabaseLodfStorage(client);
      const { lodf } = await getOrComputeLodf(tenantId, modelId, repo, ptdfStorage, lodfStorage);
      contingency = applyLodfContingency(flow, lodf, outageBranch);
    }

    if (format === "summary") {
      return NextResponse.json({
        modelId: flow.modelId,
        slackBusNumber: flow.slackBusNumber,
        baseMva: flow.baseMva,
        busCount: flow.busAngles.length,
        branchCount: flow.branchFlows.length,
        powerBalance: flow.powerBalance,
        computedAt: flow.computedAt,
        topologyHash: flow.topologyHash,
        contingency,
        computeMs,
      });
    }

    return NextResponse.json({
      modelId: flow.modelId,
      slackBusNumber: flow.slackBusNumber,
      baseMva: flow.baseMva,
      busAngles: flow.busAngles,
      branchFlows: flow.branchFlows,
      powerBalance: flow.powerBalance,
      computedAt: flow.computedAt,
      topologyHash: flow.topologyHash,
      contingency,
      computeMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("Topology has changed")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg.includes("[DCPF] injection")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes("baseMva must be positive")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes("mismatchToleranceMw must be non-negative")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: `DC power flow computation failed: ${msg}` }, { status: 500 });
  }
}
