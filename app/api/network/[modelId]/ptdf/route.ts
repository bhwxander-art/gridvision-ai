/**
 * GET /api/network/[modelId]/ptdf
 *
 * Returns the PTDF matrix for the specified network model.  Computes on
 * demand and caches the result in Supabase Storage.  Cache is invalidated
 * automatically when the network topology changes (ptdf_valid = FALSE).
 *
 * Query parameters:
 *   tenant_id  — required; UUID of the owning tenant
 *   slack_bus  — optional; bus_number to use as the reference bus
 *                (defaults to the bus with busType = 'SLACK', or bus 1)
 *   format     — optional; "json" (default) | "summary"
 *                  json:    full PtdfMatrix serialised as JSON
 *                  summary: shape, timings, bus/branch lists only (no float data)
 *
 * Response 200: PtdfMatrix JSON (full) or summary
 * Response 400: missing/invalid query params
 * Response 404: model not found for this tenant
 * Response 500: computation or storage error
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { SupabasePtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { getOrComputePtdf } from "@/lib/ptdf/ptdf-pipeline";

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

  const client = createClient(supabaseUrl, supabaseKey);
  const repo = new NetworkRepository(client);
  const storage = new SupabasePtdfStorage(client);

  try {
    const result = await getOrComputePtdf(
      tenantId,
      modelId,
      repo,
      storage,
      slackBusNumber
    );

    if (format === "summary") {
      const { ptdf, fromCache, computeMs } = result;
      return NextResponse.json({
        modelId: ptdf.modelId,
        slackBusNumber: ptdf.slackBusNumber,
        shape: [ptdf.rows, ptdf.cols],
        busNumbers: ptdf.busNumbers,
        branchNumbers: ptdf.branchNumbers,
        computedAt: ptdf.computedAt,
        topologyHash: ptdf.topologyHash,
        fromCache,
        computeMs,
      });
    }

    // Full JSON — serialise Float64Array as regular array
    const { ptdf, fromCache, computeMs } = result;
    return NextResponse.json({
      modelId: ptdf.modelId,
      slackBusNumber: ptdf.slackBusNumber,
      busNumbers: ptdf.busNumbers,
      branchNumbers: ptdf.branchNumbers,
      rows: ptdf.rows,
      cols: ptdf.cols,
      data: Array.from(ptdf.data),
      computedAt: ptdf.computedAt,
      topologyHash: ptdf.topologyHash,
      fromCache,
      computeMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: `PTDF computation failed: ${msg}` }, { status: 500 });
  }
}
