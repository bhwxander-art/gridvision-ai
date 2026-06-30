/**
 * GET /api/cron/queue-ingest
 *
 * Vercel Cron job that refreshes the interconnection queue data for all ISOs.
 * Schedule: daily at 06:00 UTC (configured in vercel.json).
 *
 * Security:
 *   Vercel automatically injects Authorization: Bearer {CRON_SECRET} on cron
 *   invocations. The route verifies this when CRON_SECRET is set.
 *   Manual triggers in development work without the header (CRON_SECRET unset).
 *
 * Environment variables required:
 *   QUEUE_INGEST_TENANT_ID — the tenant that receives the upserted rows
 *   CRON_SECRET            — bearer token for cron authentication (optional in dev)
 *
 * Response body: PipelineReport JSON.
 * HTTP status:
 *   200 — all ISOs succeeded (partial errors still possible, check report)
 *   207 — at least one ISO failed (multi-status)
 *   400 — QUEUE_INGEST_TENANT_ID not configured
 *   401 — bearer token mismatch
 *   503 — database not configured
 */

import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import {
  runQueueIngestionPipeline,
  DEFAULT_FETCHERS,
} from "@/lib/ingestion/queue/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // ISO fetches can be slow; Vercel Pro allows up to 300s

export async function GET(request: Request): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Prerequisites ─────────────────────────────────────────────────────────
  const tenantId = process.env.QUEUE_INGEST_TENANT_ID;
  if (!tenantId) {
    return NextResponse.json(
      { error: "QUEUE_INGEST_TENANT_ID environment variable is not set" },
      { status: 400 }
    );
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const db = getServerClient();

  // ── Optional: ISO filter from query param (for selective re-runs) ─────────
  const { searchParams } = new URL(request.url);
  const isoFilter = searchParams.get("iso")?.toUpperCase();

  const fetchers = isoFilter
    ? DEFAULT_FETCHERS.filter((f) => f.isoId === isoFilter)
    : DEFAULT_FETCHERS;

  if (isoFilter && fetchers.length === 0) {
    return NextResponse.json(
      { error: `Unknown ISO: ${isoFilter}` },
      { status: 400 }
    );
  }

  // ── Run pipeline ──────────────────────────────────────────────────────────
  console.log(
    `[queue-ingest] starting run for tenant=${tenantId} isos=${fetchers.map((f) => f.isoId).join(",")}`
  );

  const report = await runQueueIngestionPipeline({
    tenantId,
    fetchers,
    db,
  });

  console.log(
    `[queue-ingest] completed run=${report.runId} upserted=${report.total.upserted} errors=${report.total.errors}`
  );

  // 207 if any ISO had a fetch error
  const anyFetchError = report.isos.some((r) => r.fetchError != null);
  const status = anyFetchError ? 207 : 200;

  return NextResponse.json(report, { status });
}
