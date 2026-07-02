/**
 * Upgrade Ranking repository-integrated pipeline — INFRA-023
 *
 * Read-only wrapper around the pure computeUpgradeRanking() engine. Reuses
 * two existing, unmodified IfeRepository methods — getAnalysis() and
 * getUpgradeResultsByAnalysisId() — and introduces no new repository
 * surface. Performs no writes.
 *
 * Not-found handling mirrors every other IFE pipeline (e.g.
 * computeAndPersistUpgradeAnalysis, computeAndPersistHostingCapacity): a
 * missing analysis throws a plain Error whose message contains "not found",
 * which the route layer pattern-matches to a 404 — no new error taxonomy is
 * introduced here.
 *
 * When no ife_upgrade_results row exists yet for the analysis (hosting
 * capacity alone was sufficient, or Upgrade Analysis was never run), this
 * pipeline returns an empty ranking rather than an error — mirroring the
 * existing IfeOrchestrationResult "completed_no_upgrade_needed" terminal
 * state, which already treats "no upgrade needed" as a valid outcome
 * elsewhere in the codebase.
 */

import "server-only";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { IfeAnalysis } from "@/lib/db/types-ife";
import { computeUpgradeRanking } from "./upgrade-ranking-engine";
import type { UpgradeRankingResult } from "./types";

export interface UpgradeRankingPipelineResult {
  analysis: IfeAnalysis;
  ranking: UpgradeRankingResult;
  computeMs: number;
}

export async function getUpgradeRankingForAnalysis(
  tenantId: string,
  analysisId: string,
  ifeRepo: IfeRepository
): Promise<UpgradeRankingPipelineResult> {
  const t0 = performance.now();

  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    throw new Error(`[UpgradeRanking] Analysis ${analysisId} not found for tenant ${tenantId}`);
  }

  const upgradeResults = await ifeRepo.getUpgradeResultsByAnalysisId(tenantId, analysisId);

  // No ife_upgrade_results row yet is a valid, expected outcome (hosting
  // capacity alone may have been sufficient, or Upgrade Analysis may simply
  // not have been run for this analysis) — not an error. Rank an empty
  // array rather than short-circuiting, so the response shape is identical
  // either way.
  const upgradeDetails = upgradeResults?.upgradeDetails ?? [];

  const ranking = computeUpgradeRanking(upgradeDetails);

  return {
    analysis,
    ranking,
    computeMs: Math.round(performance.now() - t0),
  };
}
