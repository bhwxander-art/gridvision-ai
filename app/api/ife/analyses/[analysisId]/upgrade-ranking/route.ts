/**
 * GET /api/ife/analyses/[analysisId]/upgrade-ranking
 *
 * Pure post-processing read over an existing, already-computed Upgrade
 * Analysis result — INFRA-023. Reuses getUpgradeRankingForAnalysis()
 * unmodified; performs no electrical computation and no writes. This route
 * is GET (not POST, unlike its sibling /upgrade-analysis route) because it
 * computes nothing new and persists nothing — it only ranks data that
 * already exists.
 *
 * Query parameters:
 *   tenant_id — required; UUID of the owning tenant
 *
 * Response 200: { analysis, ranking, computeMs }
 * Response 400: missing tenant_id or analysisId
 * Response 404: analysis not found for this tenant
 * Response 500: unexpected error
 *
 * Phase 1 (INFRA-023): route signature and documentation only — no request
 * handling logic yet. Implemented in a later phase.
 */

import "server-only";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ analysisId: string }> }
): Promise<Response> {
  throw new Error(
    "[UpgradeRanking] GET /api/ife/analyses/[analysisId]/upgrade-ranking is not yet implemented (INFRA-023 Phase 1 — signatures only)"
  );
}
