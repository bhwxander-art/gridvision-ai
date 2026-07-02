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
 * Does not mutate its input: upgradeDetails is only ever read, never
 * written to, and every RankedUpgrade returned is a newly constructed
 * object rather than a reference into the caller's array.
 */

import type { UpgradeDetail } from "@/lib/db/types-ife";
import type { RankedUpgrade, UpgradeRankingResult } from "./types";

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
  // ── Step 1: sequenceRank ────────────────────────────────────────────────
  // Formalises the existing Upgrade Analysis resolution order.
  // upgradeDetails is already produced in that order by the (unmodified)
  // upgrade-analysis pipeline — see the file header — so this step only
  // assigns an explicit 1-based rank to each position; it does not reorder
  // anything and does not read upgradeDetails again after this point.
  const withSequenceRank = upgradeDetails.map((detail, index) => ({
    detail,
    sequenceRank: index + 1,
  }));

  // ── Step 2: capacityImpactRank ──────────────────────────────────────────
  // Sort a *copy* of withSequenceRank by capacityIncreaseMw descending.
  // When two upgrades tie exactly on capacityIncreaseMw, break the tie by
  // sequenceRank ascending so the ordering is fully deterministic even on
  // equal inputs (per the approved specification's tie-breaking rule).
  // Spreading into a new array before calling .sort() means neither
  // upgradeDetails nor withSequenceRank is mutated by this step.
  const byCapacityDesc = [...withSequenceRank].sort((a, b) => {
    if (b.detail.capacity_increase_mw !== a.detail.capacity_increase_mw) {
      return b.detail.capacity_increase_mw - a.detail.capacity_increase_mw;
    }
    return a.sequenceRank - b.sequenceRank;
  });

  // ── Step 3: merge ranks by branch_id ────────────────────────────────────
  // branch_id is guaranteed unique within one Upgrade Analysis result — the
  // underlying engine throws before ever upgrading the same branch twice
  // (lib/upgrade-analysis/upgrade-analysis-engine.ts) — so this map is a
  // safe, unambiguous lookup from branch_id to its capacityImpactRank.
  const capacityImpactRankByBranchId = new Map<string, number>();
  byCapacityDesc.forEach(({ detail }, position) => {
    capacityImpactRankByBranchId.set(detail.branch_id, position + 1);
  });

  // ── Step 4: assemble the result ─────────────────────────────────────────
  // Returned in sequenceRank order (i.e. unchanged input order) — preserves
  // the existing canonical ordering rather than silently re-sorting what
  // the caller receives. Every entry is a newly constructed object; none
  // of upgradeDetails's own objects are returned or mutated.
  const rankings: RankedUpgrade[] = withSequenceRank.map(({ detail, sequenceRank }) => ({
    branchId: detail.branch_id,
    branchName: detail.branch_name,
    upgradeType: detail.upgrade_type,
    capacityIncreaseMw: detail.capacity_increase_mw,
    costP50M: detail.cost_p50_m,
    sequenceRank,
    capacityImpactRank: capacityImpactRankByBranchId.get(detail.branch_id)!,
  }));

  return {
    upgradesRanked: rankings.length,
    rankings,
    computedAt: new Date().toISOString(),
  };
}
