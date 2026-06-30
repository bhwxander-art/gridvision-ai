/**
 * GET /api/cron/eia-generators
 *
 * Vercel Cron job that refreshes the EIA Form 860 operating generator
 * inventory for all configured balancing authorities.
 *
 * Schedule: weekly at 04:00 UTC on Sundays (data is annual; weekly is more
 * than sufficient and absorbs publication lag without hammering the EIA API).
 * Configure in vercel.json:
 *   { "path": "/api/cron/eia-generators", "schedule": "0 4 * * 0" }
 *
 * Environment variables:
 *   EIA_API_KEY                    — EIA Open Data API key (required)
 *   EIA_GENERATOR_TENANT_ID        — tenant that receives the upserted rows (required)
 *   EIA_GENERATOR_BA_CODES         — comma-separated BA codes, e.g. "ISNE,PJM,MISO"
 *                                    (optional; omit to fetch all US generators)
 *   EIA_GENERATOR_DATA_YEAR        — override data year (optional; default: last year)
 *   CRON_SECRET                    — bearer token set by Vercel (optional in dev)
 *
 * Response body: EiaGeneratorPipelineReport JSON.
 * HTTP status:
 *   200 — pipeline ran without a fetch error
 *   207 — pipeline completed but a fetch error occurred (partial data possible)
 *   400 — EIA_GENERATOR_TENANT_ID not configured
 *   401 — bearer token mismatch
 *   503 — database not configured
 */

import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { runEiaGeneratorPipeline } from "@/lib/ingestion/eia-generators/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const tenantId = process.env.EIA_GENERATOR_TENANT_ID;
  if (!tenantId) {
    return NextResponse.json(
      { error: "EIA_GENERATOR_TENANT_ID environment variable is not set" },
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

  // ── Optional configuration from environment ───────────────────────────────
  const rawBaCodes = process.env.EIA_GENERATOR_BA_CODES ?? "";
  const baCodes = rawBaCodes
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const rawDataYear = process.env.EIA_GENERATOR_DATA_YEAR;
  const dataYear = rawDataYear ? parseInt(rawDataYear, 10) : undefined;

  // Also allow ?ba=ISNE,PJM query param for ad-hoc selective re-runs
  const { searchParams } = new URL(request.url);
  const queryBa = searchParams
    .get("ba")
    ?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const resolvedBaCodes = queryBa?.length ? queryBa : baCodes;

  console.log(
    `[eia-generators] starting run tenant=${tenantId} baCodes=${resolvedBaCodes.join(",") || "ALL"} dataYear=${dataYear ?? "auto"}`
  );

  // ── Run pipeline ──────────────────────────────────────────────────────────
  const report = await runEiaGeneratorPipeline({
    tenantId,
    db,
    baCodes: resolvedBaCodes,
    dataYear,
  });

  console.log(
    `[eia-generators] completed run=${report.runId} upserted=${report.upsertedCount} errors=${report.parseErrors + report.validationErrors}`
  );

  const status = report.fetchError ? 207 : 200;
  return NextResponse.json(report, { status });
}
