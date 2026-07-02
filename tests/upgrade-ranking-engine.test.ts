/**
 * INFRA-023 — Upgrade Ranking engine tests
 *
 * Phase 2 (INFRA-023): computeUpgradeRanking is now implemented; the block
 * below covers it per the approved technical specification's Test Plan
 * (§11, items 1-6). The getUpgradeRankingForAnalysis pipeline is not
 * implemented yet (Phase 3) — its tests remain `it.todo` below.
 */

import { describe, it, expect } from "vitest";
import type { UpgradeDetail } from "@/lib/db/types-ife";
import { computeUpgradeRanking } from "@/lib/upgrade-ranking/upgrade-ranking-engine";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDetail(overrides: Partial<UpgradeDetail> = {}): UpgradeDetail {
  return {
    branch_id: "branch-1",
    branch_name: "Branch 1",
    upgrade_type: "thermal_uprate",
    capacity_increase_mw: 10,
    cost_p50_m: null,
    ...overrides,
  };
}

describe("computeUpgradeRanking", () => {
  it("returns an empty ranking for an empty upgrade_details array", () => {
    const result = computeUpgradeRanking([]);

    expect(result.upgradesRanked).toBe(0);
    expect(result.rankings).toEqual([]);
    expect(typeof result.computedAt).toBe("string");
  });

  it("assigns sequenceRank 1 and capacityImpactRank 1 for a single upgrade", () => {
    const detail = makeDetail({ branch_id: "b1", capacity_increase_mw: 25 });

    const result = computeUpgradeRanking([detail]);

    expect(result.upgradesRanked).toBe(1);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0]).toMatchObject({
      branchId: "b1",
      branchName: detail.branch_name,
      upgradeType: detail.upgrade_type,
      capacityIncreaseMw: 25,
      costP50M: null,
      sequenceRank: 1,
      capacityImpactRank: 1,
    });
  });

  it("assigns sequenceRank 1..n in original input order for multiple upgrades", () => {
    const details = [
      makeDetail({ branch_id: "b1", capacity_increase_mw: 5 }),
      makeDetail({ branch_id: "b2", capacity_increase_mw: 50 }),
      makeDetail({ branch_id: "b3", capacity_increase_mw: 20 }),
    ];

    const result = computeUpgradeRanking(details);

    expect(result.upgradesRanked).toBe(3);
    // rankings is returned in sequenceRank order, i.e. unchanged input order.
    expect(result.rankings.map((r) => r.branchId)).toEqual(["b1", "b2", "b3"]);
    expect(result.rankings.map((r) => r.sequenceRank)).toEqual([1, 2, 3]);
  });

  it("assigns capacityImpactRank by capacityIncreaseMw descending, independent of input order", () => {
    // Deliberately not sorted by capacity, and not sorted by branch_id, to
    // confirm capacityImpactRank tracks the value, not the input position.
    const details = [
      makeDetail({ branch_id: "low", capacity_increase_mw: 5 }),
      makeDetail({ branch_id: "high", capacity_increase_mw: 50 }),
      makeDetail({ branch_id: "mid", capacity_increase_mw: 20 }),
    ];

    const result = computeUpgradeRanking(details);

    const rankByBranch = new Map(result.rankings.map((r) => [r.branchId, r.capacityImpactRank]));
    expect(rankByBranch.get("high")).toBe(1);
    expect(rankByBranch.get("mid")).toBe(2);
    expect(rankByBranch.get("low")).toBe(3);

    // sequenceRank must be unaffected by the capacity-based reordering.
    expect(result.rankings.map((r) => r.sequenceRank)).toEqual([1, 2, 3]);
  });

  it("breaks capacityImpactRank ties by sequenceRank ascending, deterministically", () => {
    const details = [
      makeDetail({ branch_id: "first", capacity_increase_mw: 30 }),
      makeDetail({ branch_id: "second", capacity_increase_mw: 30 }),
      makeDetail({ branch_id: "third", capacity_increase_mw: 30 }),
    ];

    const result = computeUpgradeRanking(details);

    // All three tie on capacity_increase_mw, so capacityImpactRank must
    // follow sequenceRank (i.e. original input order) exactly.
    expect(result.rankings.map((r) => [r.branchId, r.capacityImpactRank])).toEqual([
      ["first", 1],
      ["second", 2],
      ["third", 3],
    ]);
  });

  it("is deterministic across repeated calls on the same input", () => {
    const details = [
      makeDetail({ branch_id: "b1", capacity_increase_mw: 15 }),
      makeDetail({ branch_id: "b2", capacity_increase_mw: 15 }),
      makeDetail({ branch_id: "b3", capacity_increase_mw: 40 }),
      makeDetail({ branch_id: "b4", capacity_increase_mw: 5 }),
    ];

    const first = computeUpgradeRanking(details);
    const second = computeUpgradeRanking(details);

    expect(second.upgradesRanked).toBe(first.upgradesRanked);
    expect(second.rankings).toEqual(first.rankings);
  });

  it("does not mutate the input array or its elements", () => {
    const details = [
      makeDetail({ branch_id: "b1", capacity_increase_mw: 5 }),
      makeDetail({ branch_id: "b2", capacity_increase_mw: 50 }),
      makeDetail({ branch_id: "b3", capacity_increase_mw: 20 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(details)) as UpgradeDetail[];

    const result = computeUpgradeRanking(details);

    expect(details).toEqual(snapshot);
    // Every returned entry must be a newly constructed object, not a
    // reference into the input array.
    for (const ranked of result.rankings) {
      expect(details).not.toContain(ranked);
    }
  });
});

describe("getUpgradeRankingForAnalysis", () => {
  it.todo("returns null when the analysis is not found for the tenant");
  it.todo("returns an empty ranking (not an error) when no ife_upgrade_results row exists yet");
  it.todo("returns a ranking matching a hand-computed expectation when upgrade results are present");
});
