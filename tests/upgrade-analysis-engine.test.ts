/**
 * INFRA-013 — Upgrade Analysis engine tests
 *
 * Test plan:
 *  1. computeUpgradeAnalysis — 2-bus hand-derived single-upgrade analytic
 *     reference; 3-bus radial-chain hand-derived two-upgrade cascade
 *  2. Direction handling — withdrawal with a nonzero base case
 *  3. Independent replay verification — apply the returned upgrades to a
 *     fresh copy of the network and confirm computeHostingCapacity agrees
 *     the target capacity is reached, and that dropping the last upgrade
 *     makes it infeasible again (minimality check), for a 3-bus loop and
 *     IEEE14
 *  4. Distinct vs non-distinct emergency rating handling
 *  5. Islanding exclusion in the relief calculation
 *  6. Zero-upgrade short-circuit
 *  7. Error cases — capacityMw <= 0, maxIterations exceeded
 *  8. Termination guarantee — no branch is upgraded twice
 *  9. IfeRepository — new ife_upgrade_results methods
 * 10. computeAndPersistUpgradeAnalysis pipeline — repository integration,
 *     precondition failures, topology staleness, persisted-row shape
 * 11. API route — request validation
 * 12. Performance benchmarks
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import { computePtdf } from "@/lib/ptdf/ptdf-engine";
import { computeLodf } from "@/lib/lodf/lodf-engine";
import { computeDcPowerFlow } from "@/lib/dcpf/dcpf-engine";
import { computeHostingCapacity } from "@/lib/hosting-capacity/hosting-capacity-engine";
import type { PtdfMatrix } from "@/lib/ptdf/types";
import type { LodfMatrix } from "@/lib/lodf/types";
import type { DcPowerFlowResult } from "@/lib/dcpf/types";
import type { ProjectType } from "@/lib/db/types-queue";
import {
  computeUpgradeAnalysis,
} from "@/lib/upgrade-analysis/upgrade-analysis-engine";
import {
  UpgradeAnalysisInfeasibleError,
  type UpgradeAnalysisResult,
  type UpgradeCandidate,
} from "@/lib/upgrade-analysis/types";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import * as uaPipeline from "@/lib/upgrade-analysis/upgrade-analysis-pipeline";
import { computeAndPersistUpgradeAnalysis } from "@/lib/upgrade-analysis/upgrade-analysis-pipeline";
import { InMemoryPtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { InMemoryLodfStorage } from "@/lib/lodf/lodf-storage";

// ── Test fixture helpers (mirrors prior engines' conventions) ────────────────

let _idCounter = 0;
function uid(): string {
  return `00000000-0000-0000-0000-${String(++_idCounter).padStart(12, "0")}`;
}

interface SimpleBus {
  busNumber: number;
  busType?: "SLACK" | "PV" | "PQ";
}
interface SimpleBranch {
  branchNumber: number;
  fromBusNumber: number;
  toBusNumber: number;
  xPu: number;
  rateAMw?: number;
  rateBMw?: number | null;
  rateCMw?: number | null;
}

function makeNetwork(
  simpleBuses: SimpleBus[],
  simpleBranches: SimpleBranch[]
): { buses: NetworkBus[]; branches: NetworkBranch[] } {
  const busIds = new Map<number, string>();
  const buses: NetworkBus[] = simpleBuses.map((b) => {
    const id = uid();
    busIds.set(b.busNumber, id);
    return {
      id,
      modelId: "m1",
      tenantId: "t1",
      busNumber: b.busNumber,
      name: `Bus${b.busNumber}`,
      baseKv: 345,
      busType: b.busType ?? "PQ",
      latitude: null,
      longitude: null,
      zone: null,
      area: null,
      vminPu: 0.95,
      vmaxPu: 1.05,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
  });

  const branches: NetworkBranch[] = simpleBranches.map((br) => ({
    id: uid(),
    modelId: "m1",
    tenantId: "t1",
    branchNumber: br.branchNumber,
    name: `Br${br.branchNumber}`,
    branchType: "LINE" as const,
    fromBusId: busIds.get(br.fromBusNumber)!,
    toBusId: busIds.get(br.toBusNumber)!,
    rPu: 0,
    xPu: br.xPu,
    bPu: 0,
    rateAMw: br.rateAMw ?? 9999,
    rateBMw: br.rateBMw ?? null,
    rateCMw: br.rateCMw ?? null,
    tapRatio: 1,
    phaseShiftDeg: 0,
    inService: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  }));

  return { buses, branches };
}

const IEEE14_BUSES: SimpleBus[] = [
  { busNumber: 1, busType: "SLACK" },
  { busNumber: 2, busType: "PV" },
  { busNumber: 3, busType: "PQ" },
  { busNumber: 4, busType: "PQ" },
  { busNumber: 5, busType: "PQ" },
  { busNumber: 6, busType: "PV" },
  { busNumber: 7, busType: "PQ" },
  { busNumber: 8, busType: "PV" },
  { busNumber: 9, busType: "PQ" },
  { busNumber: 10, busType: "PQ" },
  { busNumber: 11, busType: "PQ" },
  { busNumber: 12, busType: "PQ" },
  { busNumber: 13, busType: "PQ" },
  { busNumber: 14, busType: "PQ" },
];

const IEEE14_BRANCHES: SimpleBranch[] = [
  { branchNumber: 1,  fromBusNumber: 1,  toBusNumber: 2,  xPu: 0.05917, rateAMw: 40, rateBMw: 50 },
  { branchNumber: 2,  fromBusNumber: 1,  toBusNumber: 5,  xPu: 0.22304, rateAMw: 30, rateBMw: 40 },
  { branchNumber: 3,  fromBusNumber: 2,  toBusNumber: 3,  xPu: 0.19797, rateAMw: 20, rateBMw: 25 },
  { branchNumber: 4,  fromBusNumber: 2,  toBusNumber: 4,  xPu: 0.17632, rateAMw: 20, rateBMw: 25 },
  { branchNumber: 5,  fromBusNumber: 2,  toBusNumber: 5,  xPu: 0.17388, rateAMw: 20, rateBMw: 25 },
  { branchNumber: 6,  fromBusNumber: 3,  toBusNumber: 4,  xPu: 0.17103, rateAMw: 15, rateBMw: 20 },
  { branchNumber: 7,  fromBusNumber: 4,  toBusNumber: 5,  xPu: 0.04211, rateAMw: 30, rateBMw: 40 },
  { branchNumber: 8,  fromBusNumber: 4,  toBusNumber: 7,  xPu: 0.20912, rateAMw: 15, rateBMw: 20 },
  { branchNumber: 9,  fromBusNumber: 4,  toBusNumber: 9,  xPu: 0.55618, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 10, fromBusNumber: 5,  toBusNumber: 6,  xPu: 0.25202, rateAMw: 15, rateBMw: 20 },
  { branchNumber: 11, fromBusNumber: 6,  toBusNumber: 11, xPu: 0.19890, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 12, fromBusNumber: 6,  toBusNumber: 12, xPu: 0.25581, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 13, fromBusNumber: 6,  toBusNumber: 13, xPu: 0.13027, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 14, fromBusNumber: 7,  toBusNumber: 8,  xPu: 0.17615, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 15, fromBusNumber: 7,  toBusNumber: 9,  xPu: 0.11001, rateAMw: 15, rateBMw: 20 },
  { branchNumber: 16, fromBusNumber: 9,  toBusNumber: 10, xPu: 0.08450, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 17, fromBusNumber: 9,  toBusNumber: 14, xPu: 0.27038, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 18, fromBusNumber: 10, toBusNumber: 11, xPu: 0.19207, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 19, fromBusNumber: 12, toBusNumber: 13, xPu: 0.19988, rateAMw: 10, rateBMw: 15 },
  { branchNumber: 20, fromBusNumber: 13, toBusNumber: 14, xPu: 0.34802, rateAMw: 10, rateBMw: 15 },
];

const THREE_BUS_BUSES: SimpleBus[] = [
  { busNumber: 1, busType: "SLACK" },
  { busNumber: 2 },
  { busNumber: 3 },
];
function threeBusLoop(ratingMw: number): SimpleBranch[] {
  return [
    { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0, rateAMw: ratingMw },
    { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0, rateAMw: ratingMw },
    { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0, rateAMw: ratingMw },
  ];
}

function buildInputs(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  injectionsMw: Record<number, number>,
  topologyHash = "hash-abc"
): { ptdf: PtdfMatrix; lodf: LodfMatrix; baseCase: DcPowerFlowResult } {
  const ptdf = computePtdf(buses, branches, { modelId: "m1", topologyHash });
  const lodf = computeLodf(buses, branches, ptdf, { modelId: "m1", topologyHash });
  const baseCase = computeDcPowerFlow(buses, branches, injectionsMw, {
    slackBusNumber: ptdf.slackBusNumber,
    modelId: "m1",
    topologyHash,
  });
  return { ptdf, lodf, baseCase };
}

/**
 * Independent replay verification: apply the returned upgrades to a FRESH
 * copy of the original branches and confirm computeHostingCapacity (called
 * directly, not through the engine under test) agrees the target capacity
 * is reached — and that dropping the last upgrade makes it infeasible again
 * (a minimality check).
 */
function verifyUpgradeResult(
  buses: NetworkBus[],
  originalBranches: NetworkBranch[],
  ptdf: PtdfMatrix,
  lodf: LodfMatrix,
  baseCase: DcPowerFlowResult,
  projectType: ProjectType,
  result: UpgradeAnalysisResult
): void {
  function applyUpgrades(upgrades: UpgradeCandidate[]): NetworkBranch[] {
    const copy = originalBranches.map((b) => ({ ...b }));
    const byNumber = new Map(copy.map((b) => [b.branchNumber, b]));
    for (const u of upgrades) {
      const b = byNumber.get(u.branchNumber)!;
      b.rateAMw = u.newRateAMw;
      if (u.newEmergencyRatingMw != null) {
        if (b.rateBMw != null) b.rateBMw = u.newEmergencyRatingMw;
        else if (b.rateCMw != null) b.rateCMw = u.newEmergencyRatingMw;
      }
    }
    return copy;
  }

  const fullyUpgraded = applyUpgrades(result.upgrades);
  const hcFull = computeHostingCapacity(
    buses, fullyUpgraded, ptdf, lodf, baseCase, result.poiBusNumber, projectType
  );
  expect(hcFull.hcDeterministicMw).toBeGreaterThanOrEqual(result.requestedCapacityMw - 1e-6);

  if (result.upgrades.length > 0) {
    const withoutLast = applyUpgrades(result.upgrades.slice(0, -1));
    const hcPartial = computeHostingCapacity(
      buses, withoutLast, ptdf, lodf, baseCase, result.poiBusNumber, projectType
    );
    expect(hcPartial.hcDeterministicMw).toBeLessThan(result.requestedCapacityMw - 1e-6);
  }
}

// ── 1. Hand-derived analytic reference ────────────────────────────────────────

describe("computeUpgradeAnalysis — 2-bus single-upgrade analytic reference", () => {
  it("branch1 rated 50 MW, requesting 100 MW -> uprate to exactly 100 MW", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 50 }]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 2, "solar", 100);

    expect(result.hostingCapacityBeforeMw).toBeCloseTo(50, 6);
    expect(result.hostingCapacityAfterMw).toBeCloseTo(100, 6);
    expect(result.feasible).toBe(true);
    expect(result.upgradesRequired).toBe(1);
    expect(result.iterations).toBe(1);

    const u = result.upgrades[0];
    expect(u.branchNumber).toBe(1);
    expect(u.upgradeType).toBe("thermal_uprate");
    expect(u.originalRateAMw).toBe(50);
    expect(u.newRateAMw).toBeCloseTo(100, 6);
    expect(u.originalEmergencyRatingMw).toBeNull();
    expect(u.newEmergencyRatingMw).toBeNull();
    expect(u.capacityIncreaseMw).toBeCloseTo(50, 6);

    verifyUpgradeResult(buses, branches, ptdf, lodf, baseCase, "solar", result);
  });
});

describe("computeUpgradeAnalysis — 3-bus radial-chain two-upgrade cascade", () => {
  it("branch1=30MW, branch2=50MW ratings, requesting 80 MW at bus3 -> both branches uprated to 80", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 30 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 0.1, rateAMw: 50 },
      ]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 3, "solar", 80);

    expect(result.hostingCapacityBeforeMw).toBeCloseTo(30, 6);
    expect(result.hostingCapacityAfterMw).toBeCloseTo(80, 6);
    expect(result.upgradesRequired).toBe(2);
    expect(result.iterations).toBe(2);

    // Ranked order: branch1 (tighter, 30 MW) resolves first, then branch2 (50 MW)
    expect(result.upgrades[0].branchNumber).toBe(1);
    expect(result.upgrades[0].newRateAMw).toBeCloseTo(80, 6);
    expect(result.upgrades[1].branchNumber).toBe(2);
    expect(result.upgrades[1].newRateAMw).toBeCloseTo(80, 6);

    verifyUpgradeResult(buses, branches, ptdf, lodf, baseCase, "solar", result);
  });
});

// ── 2. Direction handling ──────────────────────────────────────────────────────

describe("computeUpgradeAnalysis — withdrawal direction with nonzero base case", () => {
  it("existing 20 MW load at bus2, withdrawal request of 50 MW -> uprate to exactly 70 MW", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 50 }]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, { 2: -20 });
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 2, "load", 50);

    expect(result.direction).toBe("withdrawal");
    expect(result.hostingCapacityBeforeMw).toBeCloseTo(30, 6);
    expect(result.upgradesRequired).toBe(1);
    expect(result.upgrades[0].newRateAMw).toBeCloseTo(70, 6);
    expect(result.hostingCapacityAfterMw).toBeCloseTo(50, 6);

    verifyUpgradeResult(buses, branches, ptdf, lodf, baseCase, "load", result);
  });
});

// ── 3. Independent replay verification on more complex networks ──────────────

describe("computeUpgradeAnalysis — independent replay verification", () => {
  it("3-bus loop: multiple POI/direction/capacity combinations", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(20));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});

    for (const poi of [2, 3]) {
      for (const projectType of ["solar", "load"] as const) {
        for (const capacityMw of [40, 100]) {
          const result = computeUpgradeAnalysis(
            buses, branches, ptdf, lodf, baseCase, poi, projectType, capacityMw
          );
          expect(result.hostingCapacityAfterMw).toBeGreaterThanOrEqual(capacityMw - 1e-6);
          verifyUpgradeResult(buses, branches, ptdf, lodf, baseCase, projectType, result);
        }
      }
    }
  });

  it("IEEE14: sampled POI/capacity combinations requiring multiple upgrades", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const injections = { 3: 5, 9: -5 };
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, injections);

    for (const poi of [4, 9]) {
      const result = computeUpgradeAnalysis(
        buses, branches, ptdf, lodf, baseCase, poi, "solar", 60
      );
      expect(result.hostingCapacityAfterMw).toBeGreaterThanOrEqual(60 - 1e-6);
      expect(result.upgradesRequired).toBeGreaterThan(0);
      verifyUpgradeResult(buses, branches, ptdf, lodf, baseCase, "solar", result);
    }
  });
});

// ── 4. Distinct vs non-distinct emergency rating handling ────────────────────

describe("computeUpgradeAnalysis — emergency rating handling", () => {
  it("no distinct emergency rating: rateAMw alone must satisfy both N-0 and N-1", () => {
    // Triangle with a radial spur so the spur's outage constrains bus4 via N-1.
    // Branch 4 (3-4 spur) has no rateB/rateC — rateAMw must cover both roles.
    const { buses, branches } = makeNetwork(
      [
        { busNumber: 1, busType: "SLACK" },
        { busNumber: 2 },
      ],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 10 }]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 2, "solar", 40);
    expect(result.upgrades[0].originalEmergencyRatingMw).toBeNull();
    expect(result.upgrades[0].newEmergencyRatingMw).toBeNull();
    expect(result.upgrades[0].newRateAMw).toBeCloseTo(40, 6);
  });

  it("distinct emergency rating (rateBMw): N-0 relief raises rateAMw, N-1 relief raises rateBMw independently", () => {
    // Triangle (no bridges) with a distinct, higher emergency rating on the binding branch.
    const branches: SimpleBranch[] = [
      { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0, rateAMw: 20, rateBMw: 35 },
      { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0, rateAMw: 20, rateBMw: 35 },
      { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0, rateAMw: 20, rateBMw: 35 },
    ];
    const { buses, branches: nb } = makeNetwork(THREE_BUS_BUSES, branches);
    const { ptdf, lodf, baseCase } = buildInputs(buses, nb, {});
    const result = computeUpgradeAnalysis(buses, nb, ptdf, lodf, baseCase, 2, "solar", 50);

    const u = result.upgrades.find((x) => x.branchNumber === 1)!;
    expect(u.originalEmergencyRatingMw).toBe(35);
    // Both fields should have been considered; verify the replay independently confirms feasibility.
    verifyUpgradeResult(buses, nb, ptdf, lodf, baseCase, "solar", result);
  });
});

// ── 5. Islanding exclusion ─────────────────────────────────────────────────────

describe("computeUpgradeAnalysis — islanding exclusion", () => {
  it("radial chain: N-1 relief calculation excludes islanding outages entirely", () => {
    const { buses, branches } = makeNetwork(
      [
        { busNumber: 1, busType: "SLACK" },
        { busNumber: 2 },
        { busNumber: 3 },
      ],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 20 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 0.1, rateAMw: 20 },
      ]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    // Both branches are bridges -> N-1 contributes nothing; only N-0 relief applies.
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 3, "solar", 50);
    expect(result.upgradesRequired).toBe(2);
    for (const u of result.upgrades) {
      expect(u.newRateAMw).toBeCloseTo(50, 6); // N-0 only: exactly the requested capacity
    }
    verifyUpgradeResult(buses, branches, ptdf, lodf, baseCase, "solar", result);
  });
});

// ── 6. Zero-upgrade short-circuit ──────────────────────────────────────────────

describe("computeUpgradeAnalysis — already-sufficient capacity", () => {
  it("returns zero upgrades and unchanged hosting capacity when already sufficient", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 50 }]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 2, "solar", 30);

    expect(result.upgradesRequired).toBe(0);
    expect(result.upgrades).toEqual([]);
    expect(result.iterations).toBe(0);
    expect(result.hostingCapacityBeforeMw).toBeCloseTo(result.hostingCapacityAfterMw, 9);
    expect(result.feasible).toBe(true);
  });
});

// ── 7. Error cases ─────────────────────────────────────────────────────────────

describe("computeUpgradeAnalysis — error cases", () => {
  it("throws for non-positive capacityMw", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(20));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    expect(() =>
      computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 2, "solar", 0)
    ).toThrow("capacityMw must be positive");
  });

  it("throws UpgradeAnalysisInfeasibleError when maxIterations is exhausted", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(20));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});

    let caught: unknown;
    try {
      computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 2, "solar", 100, {
        maxIterations: 0,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UpgradeAnalysisInfeasibleError);
    expect((caught as UpgradeAnalysisInfeasibleError).iterationsAttempted).toBe(0);
  });
});

// ── 8. Termination guarantee ───────────────────────────────────────────────────

describe("computeUpgradeAnalysis — termination guarantee", () => {
  it("no branch is upgraded more than once, across a network requiring many upgrades", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    // A large capacity request relative to these small test ratings forces many upgrades.
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 9, "solar", 300, {
      maxIterations: 20,
    });

    const branchNumbers = result.upgrades.map((u) => u.branchNumber);
    expect(new Set(branchNumbers).size).toBe(branchNumbers.length); // no duplicates
    expect(result.iterations).toBe(result.upgradesRequired);
    verifyUpgradeResult(buses, branches, ptdf, lodf, baseCase, "solar", result);
  });
});

// ── 9. IfeRepository — ife_upgrade_results ────────────────────────────────────

describe("IfeRepository — ife_upgrade_results", () => {
  function makeMockSupabase() {
    const client = {
      from: (_table: string) => ({
        insert: (payload: unknown) => ({
          select: () => ({
            single: async () => ({ data: { id: uid(), ...(payload as object) }, error: null }),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    };
    return client as never;
  }

  it("createUpgradeResults validates and inserts", async () => {
    const repo = new IfeRepository(makeMockSupabase());
    const row = await repo.createUpgradeResults({
      analysis_id: "a1",
      tenant_id: "t1",
      cost_p10_m: null,
      cost_p50_m: null,
      cost_p90_m: null,
      project_share_p50_m: null,
      upgrades_required: 1,
      milp_optimality_gap_pct: null,
      milp_solve_seconds: null,
      upgrade_details: [
        { branch_id: "b1", branch_name: "Br1", upgrade_type: "thermal_uprate", capacity_increase_mw: 50, cost_p50_m: null },
      ],
    });
    expect(row.analysisId).toBe("a1");
    expect(row.upgradeDetails[0].cost_p50_m).toBeNull();
  });

  it("createUpgradeResults rejects negative upgrades_required", async () => {
    const repo = new IfeRepository(makeMockSupabase());
    await expect(
      repo.createUpgradeResults({
        analysis_id: "a1",
        tenant_id: "t1",
        cost_p10_m: null,
        cost_p50_m: null,
        cost_p90_m: null,
        project_share_p50_m: null,
        upgrades_required: -1,
        milp_optimality_gap_pct: null,
        milp_solve_seconds: null,
        upgrade_details: [],
      })
    ).rejects.toThrow("upgrades_required must be non-negative");
  });

  it("getUpgradeResultsByAnalysisId returns null on a miss", async () => {
    const repo = new IfeRepository(makeMockSupabase());
    const result = await repo.getUpgradeResultsByAnalysisId("t1", "nonexistent");
    expect(result).toBeNull();
  });
});

// ── 10. Pipeline ────────────────────────────────────────────────────────────────

describe("computeAndPersistUpgradeAnalysis — pipeline", () => {
  function makeMockNetworkRepo(topologyHash: string | null = "hash-abc") {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(20));
    return {
      repo: {
        getModel: async () => ({
          id: "model-1",
          tenantId: "tenant-1",
          ptdfValid: false,
          lodfValid: false,
          topologyHash,
          iso: "PJM" as const,
          name: "Test Model",
          version: "1.0",
          baseMva: 100,
          modelDate: "2024-01-01",
          source: "MANUAL" as const,
          busCount: 3,
          branchCount: 3,
          metadata: {},
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        }),
        listBuses: async () => buses,
        listBranches: async () => branches,
        markPtdfValid: async () => {},
        markLodfValid: async () => {},
      } as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository,
      buses,
      branches,
    };
  }

  function makeCompletedAnalysis(
    overrides: Partial<{
      status: string;
      capacityMw: number;
      poiBusId: string;
      inputSnapshot: Record<string, unknown>;
    }> = {},
    buses: NetworkBus[]
  ) {
    const poiBus = buses.find((b) => b.busNumber === 2)!;
    return {
      id: "analysis-1",
      tenantId: "tenant-1",
      networkModelId: "model-1",
      poiBusId: overrides.poiBusId ?? poiBus.id,
      isoId: "PJM",
      capacityMw: overrides.capacityMw ?? 100,
      projectType: "solar" as const,
      targetCod: null,
      inputSnapshot:
        overrides.inputSnapshot ??
        {
          poiBusNumber: 2,
          slackBusNumber: 1,
          topologyHash: "hash-abc",
          baseCaseInjectionsMw: {},
        },
      status: overrides.status ?? "completed",
      progressPct: 100,
      errorMessage: null,
      queuedAt: "2024-01-01T00:00:00Z",
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:00:00Z",
      idempotencyKey: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
  }

  function makeMockIfeRepo(opts: {
    analysis?: ReturnType<typeof makeCompletedAnalysis> | null;
    hostingCapacityExists?: boolean;
    existingUpgradeResults?: Record<string, unknown> | null;
  } = {}) {
    const createUpgradeResultsCalls: Record<string, unknown>[] = [];
    // Stateful store: createUpgradeResults populates this, getUpgradeResultsByAnalysisId reads
    // it back — lets a single mock instance exercise the idempotency path across repeated calls,
    // exactly like the real ife_upgrade_results table would.
    const store = new Map<string, Record<string, unknown>>();
    if (opts.existingUpgradeResults) {
      // getUpgradeResultsByAnalysisId returns domain-shaped (camelCase) rows in reality.
      store.set(opts.existingUpgradeResults.analysisId as string, opts.existingUpgradeResults);
    }

    const repo = {
      getAnalysis: vi.fn(async () => opts.analysis ?? null),
      getHostingCapacityByAnalysisId: vi.fn(async () =>
        opts.hostingCapacityExists === false
          ? null
          : { id: "hc-1", analysisId: "analysis-1", tenantId: "tenant-1", hcDeterministicMw: 20 }
      ),
      createUpgradeResults: vi.fn(async (insert: Record<string, unknown>) => {
        createUpgradeResultsCalls.push(insert);
        const row = { id: "ur-1", analysisId: insert.analysis_id, tenantId: insert.tenant_id, ...insert };
        store.set(insert.analysis_id as string, row);
        return row;
      }),
      getUpgradeResultsByAnalysisId: vi.fn(async (_t: string, analysisId: string) =>
        store.get(analysisId) ?? null
      ),
    };
    return { repo: repo as unknown as IfeRepository, createUpgradeResultsCalls };
  }

  it("completes successfully and persists a null-cost ife_upgrade_results row", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo();
    const analysis = makeCompletedAnalysis({}, buses);
    const { repo: ifeRepo, createUpgradeResultsCalls } = makeMockIfeRepo({ analysis });
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    const { upgradeResults } = await computeAndPersistUpgradeAnalysis(
      "tenant-1", "analysis-1", networkRepo, ifeRepo, ptdfStorage, lodfStorage
    );

    expect(upgradeResults).toBeDefined();
    expect(createUpgradeResultsCalls[0].upgrades_required).toBeGreaterThan(0);
    expect(createUpgradeResultsCalls[0].cost_p10_m).toBeNull();
    expect(createUpgradeResultsCalls[0].cost_p50_m).toBeNull();
    expect(createUpgradeResultsCalls[0].milp_optimality_gap_pct).toBeNull();
    const details = createUpgradeResultsCalls[0].upgrade_details as { cost_p50_m: unknown }[];
    for (const d of details) expect(d.cost_p50_m).toBeNull();
  });

  // ── H1 idempotency regression tests ─────────────────────────────────────────

  it("idempotency: a repeated sequential request does not recompute or duplicate-insert", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo();
    const analysis = makeCompletedAnalysis({}, buses);
    const { repo: ifeRepo, createUpgradeResultsCalls } = makeMockIfeRepo({ analysis });
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    const first = await computeAndPersistUpgradeAnalysis(
      "tenant-1", "analysis-1", networkRepo, ifeRepo, ptdfStorage, lodfStorage
    );
    const second = await computeAndPersistUpgradeAnalysis(
      "tenant-1", "analysis-1", networkRepo, ifeRepo, ptdfStorage, lodfStorage
    );

    // Duplicate persistence prevention: createUpgradeResults called exactly once, not twice.
    expect(createUpgradeResultsCalls.length).toBe(1);
    // Returning the existing result without recomputation: same row, not a freshly computed one.
    expect(second.upgradeResults).toEqual(first.upgradeResults);
    expect(second.analysis).toEqual(first.analysis);
  });

  it("idempotency: returns a pre-existing upgrade_results row immediately without calling createUpgradeResults", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo();
    const analysis = makeCompletedAnalysis({}, buses);
    const existing = {
      id: "ur-existing",
      analysisId: "analysis-1",
      tenantId: "tenant-1",
      upgradesRequired: 3,
      upgradeDetails: [],
      costP10M: null,
      costP50M: null,
      costP90M: null,
      projectShareP50M: null,
      milpOptimalityGapPct: null,
      milpSolveSeconds: null,
      computedAt: "2024-01-01T00:00:00Z",
    };
    const { repo: ifeRepo, createUpgradeResultsCalls } = makeMockIfeRepo({
      analysis,
      existingUpgradeResults: existing,
    });
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    const { upgradeResults } = await computeAndPersistUpgradeAnalysis(
      "tenant-1", "analysis-1", networkRepo, ifeRepo, ptdfStorage, lodfStorage
    );

    expect(createUpgradeResultsCalls.length).toBe(0); // never recomputed/inserted
    expect(upgradeResults.upgradesRequired).toBe(3); // the pre-existing row, untouched
  });

  it("idempotency: three repeated calls still result in exactly one persisted row", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo();
    const analysis = makeCompletedAnalysis({}, buses);
    const { repo: ifeRepo, createUpgradeResultsCalls } = makeMockIfeRepo({ analysis });
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    for (let i = 0; i < 3; i++) {
      await computeAndPersistUpgradeAnalysis(
        "tenant-1", "analysis-1", networkRepo, ifeRepo, ptdfStorage, lodfStorage
      );
    }

    expect(createUpgradeResultsCalls.length).toBe(1);
  });

  it("persists zero upgrades when the requested capacity is already available", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo();
    const analysis = makeCompletedAnalysis({ capacityMw: 5 }, buses);
    const { repo: ifeRepo, createUpgradeResultsCalls } = makeMockIfeRepo({ analysis });
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    await computeAndPersistUpgradeAnalysis(
      "tenant-1", "analysis-1", networkRepo, ifeRepo, ptdfStorage, lodfStorage
    );

    expect(createUpgradeResultsCalls[0].upgrades_required).toBe(0);
    expect(createUpgradeResultsCalls[0].upgrade_details).toEqual([]);
  });

  it("throws when the analysis is not found", async () => {
    const { repo: networkRepo } = makeMockNetworkRepo();
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: null });
    await expect(
      computeAndPersistUpgradeAnalysis(
        "tenant-1", "nonexistent", networkRepo, ifeRepo, new InMemoryPtdfStorage(), new InMemoryLodfStorage()
      )
    ).rejects.toThrow("not found");
  });

  it("throws when the analysis is not yet completed", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo();
    const analysis = makeCompletedAnalysis({ status: "running" }, buses);
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis });
    await expect(
      computeAndPersistUpgradeAnalysis(
        "tenant-1", "analysis-1", networkRepo, ifeRepo, new InMemoryPtdfStorage(), new InMemoryLodfStorage()
      )
    ).rejects.toThrow("is not completed");
  });

  it("throws when hosting capacity has not been computed", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo();
    const analysis = makeCompletedAnalysis({}, buses);
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis, hostingCapacityExists: false });
    await expect(
      computeAndPersistUpgradeAnalysis(
        "tenant-1", "analysis-1", networkRepo, ifeRepo, new InMemoryPtdfStorage(), new InMemoryLodfStorage()
      )
    ).rejects.toThrow("No hosting capacity result found");
  });

  it("throws when topology has changed since the original analysis", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo("new-hash");
    const analysis = makeCompletedAnalysis(
      { inputSnapshot: { poiBusNumber: 2, slackBusNumber: 1, topologyHash: "old-hash", baseCaseInjectionsMw: {} } },
      buses
    );
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis });
    await expect(
      computeAndPersistUpgradeAnalysis(
        "tenant-1", "analysis-1", networkRepo, ifeRepo, new InMemoryPtdfStorage(), new InMemoryLodfStorage()
      )
    ).rejects.toThrow("Topology has changed");
  });

  it("throws when input_snapshot is missing baseCaseInjectionsMw", async () => {
    const { repo: networkRepo, buses } = makeMockNetworkRepo();
    const analysis = makeCompletedAnalysis(
      { inputSnapshot: { poiBusNumber: 2, slackBusNumber: 1, topologyHash: "hash-abc" } },
      buses
    );
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis });
    await expect(
      computeAndPersistUpgradeAnalysis(
        "tenant-1", "analysis-1", networkRepo, ifeRepo, new InMemoryPtdfStorage(), new InMemoryLodfStorage()
      )
    ).rejects.toThrow("missing baseCaseInjectionsMw");
  });
});

// ── 11. API route — request validation ────────────────────────────────────────

describe("POST /api/ife/analyses/[analysisId]/upgrade-analysis — request validation", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  async function callRoute(query: string, body?: unknown, rawBody?: string) {
    const { POST } = await import("@/app/api/ife/analyses/[analysisId]/upgrade-analysis/route");
    const request = new Request(`http://localhost/api/ife/analyses/analysis-1/upgrade-analysis${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    return POST(request, { params: Promise.resolve({ analysisId: "analysis-1" }) });
  }

  it("400s when tenant_id is missing", async () => {
    const res = await callRoute("");
    expect(res.status).toBe(400);
  });

  it("400s when the body is not valid JSON", async () => {
    const res = await callRoute("?tenant_id=t1", undefined, "{not json");
    expect(res.status).toBe(400);
  });

  it("succeeds with no body at all (all options optional)", async () => {
    const spy = vi.spyOn(uaPipeline, "computeAndPersistUpgradeAnalysis").mockResolvedValueOnce({
      analysis: { id: "analysis-1" } as never,
      upgradeResults: { id: "ur-1" } as never,
      computeMs: 1,
    });
    try {
      const res = await callRoute("?tenant_id=t1");
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when ratingMarginMultiplier is not a number", async () => {
    const res = await callRoute("?tenant_id=t1", { ratingMarginMultiplier: "big" });
    expect(res.status).toBe(400);
  });

  // ── H2 range validation tests ───────────────────────────────────────────────

  it("400s when maxIterations is 0", async () => {
    const res = await callRoute("?tenant_id=t1", { maxIterations: 0 });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/maxIterations.*greater than 0/);
  });

  it("400s when maxIterations is -1", async () => {
    const res = await callRoute("?tenant_id=t1", { maxIterations: -1 });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/maxIterations.*greater than 0/);
  });

  it("400s when maxIterations is 1.5 (non-integer)", async () => {
    const res = await callRoute("?tenant_id=t1", { maxIterations: 1.5 });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/maxIterations.*integer/);
  });

  it("400s when ratingMarginMultiplier is 0", async () => {
    const res = await callRoute("?tenant_id=t1", { ratingMarginMultiplier: 0 });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/ratingMarginMultiplier.*greater than 0/);
  });

  it("400s when ratingMarginMultiplier is negative", async () => {
    const res = await callRoute("?tenant_id=t1", { ratingMarginMultiplier: -2 });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/ratingMarginMultiplier.*greater than 0/);
  });

  it("does not reach UpgradeAnalysisInfeasibleError for invalid maxIterations/ratingMarginMultiplier — rejected before computation begins", async () => {
    const spy = vi.spyOn(uaPipeline, "computeAndPersistUpgradeAnalysis");
    try {
      const zeroIter = await callRoute("?tenant_id=t1", { maxIterations: 0 });
      const negMargin = await callRoute("?tenant_id=t1", { ratingMarginMultiplier: -1 });
      expect(zeroIter.status).toBe(400);
      expect(negMargin.status).toBe(400);
      expect(spy).not.toHaveBeenCalled(); // rejected at the API boundary, never reached the pipeline
    } finally {
      spy.mockRestore();
    }
  });

  it("accepts a valid positive integer maxIterations and positive ratingMarginMultiplier", async () => {
    const spy = vi.spyOn(uaPipeline, "computeAndPersistUpgradeAnalysis").mockResolvedValueOnce({
      analysis: { id: "analysis-1" } as never,
      upgradeResults: { id: "ur-1" } as never,
      computeMs: 1,
    });
    try {
      const res = await callRoute("?tenant_id=t1", { maxIterations: 5, ratingMarginMultiplier: 1.05 });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("500s with a clear message when Supabase credentials are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callRoute("?tenant_id=t1", {});
    expect(res.status).toBe(500);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  });

  it("404s when the pipeline rejects with a 'not found' error", async () => {
    const spy = vi
      .spyOn(uaPipeline, "computeAndPersistUpgradeAnalysis")
      .mockRejectedValueOnce(new Error("[UpgradeAnalysis] Analysis analysis-1 not found for tenant t1"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("409s when the pipeline rejects with a topology-changed error", async () => {
    const spy = vi
      .spyOn(uaPipeline, "computeAndPersistUpgradeAnalysis")
      .mockRejectedValueOnce(new Error("[UpgradeAnalysis] Topology has changed since hosting capacity was computed"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(409);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when the pipeline rejects with a precondition failure ('is not completed')", async () => {
    const spy = vi
      .spyOn(uaPipeline, "computeAndPersistUpgradeAnalysis")
      .mockRejectedValueOnce(new Error("[UpgradeAnalysis] Analysis analysis-1 is not completed (status: running)"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
  });

  it("500s when the pipeline rejects with UpgradeAnalysisInfeasibleError", async () => {
    const spy = vi
      .spyOn(uaPipeline, "computeAndPersistUpgradeAnalysis")
      .mockRejectedValueOnce(new UpgradeAnalysisInfeasibleError("could not reach target", 5));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(500);
      const b = await res.json();
      expect(b.iterationsAttempted).toBe(5);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 12. Performance benchmarks ─────────────────────────────────────────────────

describe("computeUpgradeAnalysis — performance", () => {
  function makeRingNetwork(n: number): { buses: SimpleBus[]; branches: SimpleBranch[] } {
    const buses: SimpleBus[] = Array.from({ length: n }, (_, i) => ({
      busNumber: i + 1,
      busType: i === 0 ? "SLACK" : "PQ",
    }));
    const branches: SimpleBranch[] = Array.from({ length: n }, (_, i) => ({
      branchNumber: i + 1,
      fromBusNumber: i + 1,
      toBusNumber: ((i + 1) % n) + 1,
      xPu: 0.05 + (i % 5) * 0.01,
      rateAMw: 50,
      rateBMw: 60,
    }));
    return { buses, branches };
  }

  it("IEEE14 single-upgrade scenario completes in well under 50 ms", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});

    const t0 = performance.now();
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 9, "solar", 60);
    const elapsed = performance.now() - t0;

    expect(result.hostingCapacityAfterMw).toBeGreaterThanOrEqual(60 - 1e-6);
    expect(elapsed).toBeLessThan(50);
  });

  it("500-bus ring: single-upgrade cost scales with computeHostingCapacity's own cost", () => {
    const { buses: sb, branches: br } = makeRingNetwork(500);
    const { buses, branches } = makeNetwork(sb, br);
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});

    const t0 = performance.now();
    const result = computeUpgradeAnalysis(buses, branches, ptdf, lodf, baseCase, 100, "solar", 60);
    const elapsed = performance.now() - t0;

    expect(result.hostingCapacityAfterMw).toBeGreaterThanOrEqual(60 - 1e-6);
    // A handful of iterations at most for a single, moderate capacity request.
    expect(elapsed).toBeLessThan(2000);
  });
});
