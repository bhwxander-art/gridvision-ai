/**
 * Deterministic Upgrade Ranking engine public types — INFRA-023
 *
 * Pure post-processing types over the existing Upgrade Analysis output
 * (IfeUpgradeResults.upgradeDetails, INFRA-013). No new electrical
 * computation and no new persistence — see the approved INFRA-023
 * technical specification for the full scope rationale.
 */

import type { UpgradeDetail } from "@/lib/db/types-ife";

export interface RankedUpgrade {
  branchId: string;
  branchName: string;
  upgradeType: UpgradeDetail["upgrade_type"];
  capacityIncreaseMw: number;
  costP50M: number | null;

  /**
   * 1-based. Mirrors the existing Upgrade Analysis resolution order — the
   * order upgrade_details was already produced in (documented on
   * UpgradeAnalysisResult.upgrades as "ordered = ranked, most-limiting
   * first"). This field formalises that existing order; it introduces no
   * new ranking signal.
   */
  sequenceRank: number;

  /**
   * 1-based. Sort by capacityIncreaseMw descending; ties broken by
   * sequenceRank ascending for full determinism.
   */
  capacityImpactRank: number;
}

export interface UpgradeRankingResult {
  upgradesRanked: number;
  /** Returned in sequenceRank order — preserves the existing canonical ordering. */
  rankings: RankedUpgrade[];
  computedAt: string;
}
