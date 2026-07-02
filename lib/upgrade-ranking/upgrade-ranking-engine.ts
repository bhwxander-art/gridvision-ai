/**
 * Upgrade Ranking engine — INFRA-023
 *
 * Pure post-processing step over the existing Upgrade Analysis output
 * (IfeUpgradeResults.upgradeDetails, INFRA-013). Performs no electrical
 * computation and reimplements no part of PTDF, LODF, DCPF, Hosting
 * Capacity, or Upgrade Analysis — it only ranks upgrades that Upgrade
 * Analysis has already produced.
 *
 * Two ranking dimensions, per the approved specification:
 *   1. sequenceRank       — formalises the existing Upgrade Analysis
 *                            resolution order (already documented as
 *                            "ordered = ranked, most-limiting first" on
 *                            UpgradeAnalysisResult.upgrades).
 *   2. capacityImpactRank — sorts by capacityIncreaseMw descending, ties
 *                            broken by sequenceRank ascending for full
 *                            determinism.
 *
 * Fully deterministic and total: given the same input array, always
 * produces the same rankings; cannot throw for any valid UpgradeDetail[]
 * input.
 *
 * Phase 1 (INFRA-023): signature and documentation only — no ranking logic
 * yet. Implemented in a later phase.
 */

import type { UpgradeDetail } from "@/lib/db/types-ife";
import type { UpgradeRankingResult } from "./types";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute sequence and capacity-impact rankings for an existing Upgrade
 * Analysis result's upgrade_details array.
 * Pure function — no I/O, synchronous, total (never throws).
 *
 * @param upgradeDetails  The upgrade_details array from an already-computed
 *                        IfeUpgradeResults row (as returned by
 *                        IfeRepository.getUpgradeResultsByAnalysisId).
 */
export function computeUpgradeRanking(
  upgradeDetails: UpgradeDetail[]
): UpgradeRankingResult {
  throw new Error(
    "[UpgradeRanking] computeUpgradeRanking is not yet implemented (INFRA-023 Phase 1 — signatures only)"
  );
}
