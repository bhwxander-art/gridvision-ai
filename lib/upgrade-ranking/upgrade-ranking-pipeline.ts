/**
 * Upgrade Ranking repository-integrated pipeline — INFRA-023
 *
 * Read-only wrapper around the pure computeUpgradeRanking() engine. Reuses
 * two existing, unmodified IfeRepository methods — getAnalysis() and
 * getUpgradeResultsByAnalysisId() — and introduces no new repository
 * surface. Performs no writes.
 *
 * When no ife_upgrade_results row exists yet for the analysis (hosting
 * capacity alone was sufficient, or Upgrade Analysis was never run), this
 * pipeline returns an empty ranking rather than an error — mirroring the
 * existing IfeOrchestrationResult "completed_no_upgrade_needed" terminal
 * state, which already treats "no upgrade needed" as a valid outcome
 * elsewhere in the codebase.
 *
 * Phase 1 (INFRA-023): signature and documentation only — no pipeline logic
 * yet. Implemented in a later phase.
 */

import "server-only";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { IfeAnalysis } from "@/lib/db/types-ife";
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
  throw new Error(
    "[UpgradeRanking] getUpgradeRankingForAnalysis is not yet implemented (INFRA-023 Phase 1 — signatures only)"
  );
}
