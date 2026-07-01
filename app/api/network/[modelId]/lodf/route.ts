/**
 * GET /api/network/[modelId]/lodf
 *
 * Returns the LODF matrix for the specified network model. Computes on
 * demand (reusing the cached PTDF matrix where possible) and caches the
 * result in Supabase Storage. Cache is invalidated automatically when the
 * network topology changes (lodf_valid = FALSE).
 *
 * Query parameters:
 *   tenant_id  — required; UUID of the owning tenant
 *   slack_bus  — optional; bus_number to use as the reference bus, forwarded
 *                to the underlying PTDF computation if it is not yet cached
 *                (defaults to the bus with busType = 'SLACK', or bus 1)
 *   format     — optional; "json" (default) | "summary" | "branch"
 *                  json:    full LodfMatrix serialised as JSON (e×e array)
 *                  summary: shape, timings, branch list, islanding set only
 *                  branch:  single branch lookup — requires `branch`
 *   branch     — required when format=branch; the outaged branch_number
 *   monitor    — optional when format=branch; a specific monitored
 *                branch_number, returns a single scalar LODF value instead
 *                of the full column
 *
 * Note: NaN entries (islanding columns, undefined LODF cells) serialise to
 * `null` in JSON output — JSON has no NaN literal.
 *
 * Response 200: LodfMatrix JSON (full/summary) or branch lookup payload
 * Response 400: missing/invalid query params
 * Response 404: model not found for this tenant
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { SupabasePtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { SupabaseLodfStorage } from "@/lib/lodf/lodf-storage";
import { getOrComputeLodf } from "@/lib/lodf/lodf-pipeline";
import { lodfLookup } from "@/lib/lodf/lodf-engine";

export async function GET(
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
  const slackBusRaw = url.searchParams.get("slack_bus")?.trim();
  const format = url.searchParams.get("format")?.toLowerCase() ?? "json";
  const branchRaw = url.searchParams.get("branch")?.trim();
  const monitorRaw = url.searchParams.get("monitor")?.trim();

  if (!tenantId) {
    return NextResponse.json(
      { error: "Missing required query parameter: tenant_id" },
      { status: 400 }
    );
  }
  if (!modelId) {
    return NextResponse.json(
      { error: "Missing model ID in path" },
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

  let outagedBranch: number | undefined;
  let monitoredBranch: number | undefined;
  if (format === "branch") {
    if (!branchRaw) {
      return NextResponse.json(
        { error: "format=branch requires the 'branch' query parameter (outaged branch_number)" },
        { status: 400 }
      );
    }
    outagedBranch = parseInt(branchRaw, 10);
    if (!Number.isFinite(outagedBranch)) {
      return NextResponse.json(
        { error: "branch must be an integer branch_number" },
        { status: 400 }
      );
    }
    if (monitorRaw) {
      monitoredBranch = parseInt(monitorRaw, 10);
      if (!Number.isFinite(monitoredBranch)) {
        return NextResponse.json(
          { error: "monitor must be an integer branch_number" },
          { status: 400 }
        );
      }
    }
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const repo = new NetworkRepository(client);
  const ptdfStorage = new SupabasePtdfStorage(client);
  const lodfStorage = new SupabaseLodfStorage(client);

  try {
    const result = await getOrComputeLodf(
      tenantId,
      modelId,
      repo,
      ptdfStorage,
      lodfStorage,
      slackBusNumber
    );
    const { lodf, fromCache, computeMs } = result;

    if (format === "summary") {
      return NextResponse.json({
        modelId: lodf.modelId,
        shape: [lodf.size, lodf.size],
        branchNumbers: lodf.branchNumbers,
        islandingBranches: lodf.islandingBranches,
        computedAt: lodf.computedAt,
        topologyHash: lodf.topologyHash,
        fromCache,
        computeMs,
      });
    }

    if (format === "branch") {
      const outagedIdx = lodf.branchNumbers.indexOf(outagedBranch!);
      if (outagedIdx < 0) {
        return NextResponse.json(
          { error: `Branch ${outagedBranch} not found in model ${modelId}` },
          { status: 404 }
        );
      }
      const isIslanding = lodf.islandingBranches.includes(outagedBranch!);

      if (monitoredBranch !== undefined) {
        const value = lodfLookup(lodf, monitoredBranch, outagedBranch!);
        if (lodf.branchNumbers.indexOf(monitoredBranch) < 0) {
          return NextResponse.json(
            { error: `Monitored branch ${monitoredBranch} not found in model ${modelId}` },
            { status: 404 }
          );
        }
        return NextResponse.json({
          modelId: lodf.modelId,
          outagedBranchNumber: outagedBranch,
          monitoredBranchNumber: monitoredBranch,
          isIslanding,
          lodf: Number.isFinite(value) ? value : null,
          fromCache,
          computeMs,
        });
      }

      const values = lodf.branchNumbers.map((bn, l) => {
        const v = lodf.data[l * lodf.size + outagedIdx];
        return { branchNumber: bn, lodf: Number.isFinite(v) ? v : null };
      });
      return NextResponse.json({
        modelId: lodf.modelId,
        outagedBranchNumber: outagedBranch,
        isIslanding,
        values,
        fromCache,
        computeMs,
      });
    }

    // Full JSON — serialise Float64Array as regular array (NaN -> null via JSON.stringify)
    return NextResponse.json({
      modelId: lodf.modelId,
      branchNumbers: lodf.branchNumbers,
      size: lodf.size,
      islandingBranches: lodf.islandingBranches,
      data: Array.from(lodf.data),
      computedAt: lodf.computedAt,
      topologyHash: lodf.topologyHash,
      fromCache,
      computeMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: `LODF computation failed: ${msg}` }, { status: 500 });
  }
}
