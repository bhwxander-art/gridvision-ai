/**
 * INFRA-012 — Hosting Capacity engine tests
 *
 * Test plan:
 *  1. computeHostingCapacity — 2-bus hand-derived analytic reference
 *     (zero base case, then nonzero base case for direction asymmetry)
 *  2. Brute-force cross-validation (recompute DC power flow + LODF
 *     contingency screening at the computed boundary; must be feasible
 *     just below it, infeasible just above it) for a 3-bus loop and IEEE14
 *  3. Rating fallback (rateB/rateC/rateA) for N-0 vs N-1 screening
 *  4. Islanding exclusion
 *  5. BaseCaseViolationError
 *  6. POI validation (not found, is slack bus)
 *  7. Cross-input consistency (slack mismatch, topology hash mismatch)
 *  8. Sensitivity-epsilon — no constraint found (degenerate case)
 *  9. IfeRepository — CRUD against a mocked SupabaseClient
 * 10. computeAndPersistHostingCapacity pipeline — repository integration,
 *     idempotency, failure path (no hosting_capacity row on failure)
 * 11. API route — request validation
 * 12. Performance benchmarks
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import { computePtdf } from "@/lib/ptdf/ptdf-engine";
import { computeLodf, contingencyImpact } from "@/lib/lodf/lodf-engine";
import { computeDcPowerFlow } from "@/lib/dcpf/dcpf-engine";
import type { PtdfMatrix } from "@/lib/ptdf/types";
import type { LodfMatrix } from "@/lib/lodf/types";
import type { DcPowerFlowResult } from "@/lib/dcpf/types";
import type { BusInjectionsMw } from "@/lib/dcpf/types";
import {
  computeHostingCapacity,
} from "@/lib/hosting-capacity/hosting-capacity-engine";
import { BaseCaseViolationError, type HostingCapacityResult } from "@/lib/hosting-capacity/types";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import * as hcPipeline from "@/lib/hosting-capacity/hosting-capacity-pipeline";
import { computeAndPersistHostingCapacity } from "@/lib/hosting-capacity/hosting-capacity-pipeline";
import { InMemoryPtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { InMemoryLodfStorage } from "@/lib/lodf/lodf-storage";

// ── Test fixture helpers (mirrors ptdf/lodf/dcpf test conventions) ──────────

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
  { branchNumber: 1,  fromBusNumber: 1,  toBusNumber: 2,  xPu: 0.05917, rateAMw: 200, rateBMw: 250 },
  { branchNumber: 2,  fromBusNumber: 1,  toBusNumber: 5,  xPu: 0.22304, rateAMw: 150, rateBMw: 180 },
  { branchNumber: 3,  fromBusNumber: 2,  toBusNumber: 3,  xPu: 0.19797, rateAMw: 100, rateBMw: 130 },
  { branchNumber: 4,  fromBusNumber: 2,  toBusNumber: 4,  xPu: 0.17632, rateAMw: 100, rateBMw: 130 },
  { branchNumber: 5,  fromBusNumber: 2,  toBusNumber: 5,  xPu: 0.17388, rateAMw: 100, rateBMw: 130 },
  { branchNumber: 6,  fromBusNumber: 3,  toBusNumber: 4,  xPu: 0.17103, rateAMw: 80,  rateBMw: 100 },
  { branchNumber: 7,  fromBusNumber: 4,  toBusNumber: 5,  xPu: 0.04211, rateAMw: 150, rateBMw: 180 },
  { branchNumber: 8,  fromBusNumber: 4,  toBusNumber: 7,  xPu: 0.20912, rateAMw: 80,  rateBMw: 100 },
  { branchNumber: 9,  fromBusNumber: 4,  toBusNumber: 9,  xPu: 0.55618, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 10, fromBusNumber: 5,  toBusNumber: 6,  xPu: 0.25202, rateAMw: 80,  rateBMw: 100 },
  { branchNumber: 11, fromBusNumber: 6,  toBusNumber: 11, xPu: 0.19890, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 12, fromBusNumber: 6,  toBusNumber: 12, xPu: 0.25581, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 13, fromBusNumber: 6,  toBusNumber: 13, xPu: 0.13027, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 14, fromBusNumber: 7,  toBusNumber: 8,  xPu: 0.17615, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 15, fromBusNumber: 7,  toBusNumber: 9,  xPu: 0.11001, rateAMw: 80,  rateBMw: 100 },
  { branchNumber: 16, fromBusNumber: 9,  toBusNumber: 10, xPu: 0.08450, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 17, fromBusNumber: 9,  toBusNumber: 14, xPu: 0.27038, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 18, fromBusNumber: 10, toBusNumber: 11, xPu: 0.19207, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 19, fromBusNumber: 12, toBusNumber: 13, xPu: 0.19988, rateAMw: 60,  rateBMw: 80 },
  { branchNumber: 20, fromBusNumber: 13, toBusNumber: 14, xPu: 0.34802, rateAMw: 60,  rateBMw: 80 },
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

/** Builds ptdf/lodf/baseCase against a consistent slack + topologyHash, ready for computeHostingCapacity. */
function buildInputs(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  injectionsMw: BusInjectionsMw,
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

// ── Brute-force boundary verification ─────────────────────────────────────────

/**
 * Verifies a HostingCapacityResult by physically sweeping ΔP: the network
 * must be N-0/N-1-feasible just below hcDeterministicMw, and infeasible
 * just above it. Uses only computeDcPowerFlow + LODF's contingencyImpact
 * (ground truth), independent of the closed-form OTDF formula being tested.
 */
function checkFeasible(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  ptdf: PtdfMatrix,
  lodf: LodfMatrix,
  baseInjectionsMw: BusInjectionsMw,
  poiBusNumber: number,
  sign: number,
  deltaP: number
): boolean {
  const entries: [number, number][] =
    baseInjectionsMw instanceof Map
      ? Array.from(baseInjectionsMw.entries())
      : Object.entries(baseInjectionsMw).map(([k, v]) => [Number(k), v] as [number, number]);
  const injections = new Map(entries);
  injections.set(poiBusNumber, (injections.get(poiBusNumber) ?? 0) + sign * deltaP);

  const flow = computeDcPowerFlow(buses, branches, injections, {
    slackBusNumber: ptdf.slackBusNumber,
  });

  const branchByNumber = new Map(branches.map((b) => [b.branchNumber, b]));

  for (const f of flow.branchFlows) {
    const rating = branchByNumber.get(f.branchNumber)!.rateAMw;
    if (Math.abs(f.flowMw) > rating + 1e-6) return false;
  }

  const baseFlowsMw = new Map(flow.branchFlows.map((f) => [f.branchNumber, f.flowMw]));
  for (const k of lodf.branchNumbers) {
    if (lodf.islandingBranches.includes(k)) continue;
    const impact = contingencyImpact(lodf, baseFlowsMw, k);
    for (const imp of impact.impacts) {
      if (imp.branchNumber === k) continue;
      const br = branchByNumber.get(imp.branchNumber)!;
      const emergency = br.rateBMw ?? br.rateCMw ?? br.rateAMw;
      if (Math.abs(imp.postContingencyFlowMw) > emergency + 1e-6) return false;
    }
  }
  return true;
}

function bruteForceVerify(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  ptdf: PtdfMatrix,
  lodf: LodfMatrix,
  baseInjectionsMw: BusInjectionsMw,
  result: HostingCapacityResult,
  marginMw = 0.1
): { feasibleBelow: boolean; violatesAbove: boolean } {
  const sign = result.direction === "injection" ? 1 : -1;
  const feasibleBelow = checkFeasible(
    buses, branches, ptdf, lodf, baseInjectionsMw, result.poiBusNumber, sign,
    Math.max(0, result.hcDeterministicMw - marginMw)
  );
  const violatesAbove = !checkFeasible(
    buses, branches, ptdf, lodf, baseInjectionsMw, result.poiBusNumber, sign,
    result.hcDeterministicMw + marginMw
  );
  return { feasibleBelow, violatesAbove };
}

// ── 1. Hand-derived analytic reference (2-bus) ────────────────────────────────

describe("computeHostingCapacity — 2-bus analytic reference", () => {
  it("zero base case: hc = rating / |PTDF| = 50 MW, binding is the only branch, N-0", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 50 }]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 2, "solar");

    expect(result.direction).toBe("injection");
    expect(result.hcDeterministicMw).toBeCloseTo(50, 6);
    expect(result.binding).not.toBeNull();
    expect(result.binding!.branchNumber).toBe(1);
    expect(result.binding!.outagedBranchNumber).toBeNull();
    expect(result.binding!.ratingMw).toBe(50);
    // Single branch — outaging it islands bus 2, excluded from N-1 screening
    expect(result.contingenciesScreened).toBe(0);
    expect(result.islandingContingenciesExcluded).toEqual([1]);
  });

  it("nonzero base case: injection vs withdrawal headroom is asymmetric (70 vs 30 MW)", () => {
    // Existing 20 MW load at bus 2 -> branch1 already carries +20 MW (1->2 direction)
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 50 }]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, { 2: -20 });
    expect(baseCase.branchFlows[0].flowMw).toBeCloseTo(20, 6);

    const injectionResult = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 2, "solar");
    expect(injectionResult.hcDeterministicMw).toBeCloseTo(70, 6);

    const withdrawalResult = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 2, "load");
    expect(withdrawalResult.direction).toBe("withdrawal");
    expect(withdrawalResult.hcDeterministicMw).toBeCloseTo(30, 6);
  });
});

// ── 2. Brute-force cross-validation ───────────────────────────────────────────

describe("computeHostingCapacity — brute-force boundary verification", () => {
  it("3-bus loop: feasible just below hc, infeasible just above it (multiple POI/direction combos)", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));

    for (const poi of [2, 3]) {
      for (const projectType of ["solar", "load"] as const) {
        const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
        const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, poi, projectType);
        const { feasibleBelow, violatesAbove } = bruteForceVerify(
          buses, branches, ptdf, lodf, {}, result
        );
        expect(feasibleBelow, `poi=${poi} type=${projectType} hc=${result.hcDeterministicMw}`).toBe(true);
        expect(violatesAbove, `poi=${poi} type=${projectType} hc=${result.hcDeterministicMw}`).toBe(true);
      }
    }
  });

  it("3-bus loop with a nonzero base case", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));
    const injections = { 2: 10, 3: -15 };
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, injections);

    const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 2, "solar");
    const { feasibleBelow, violatesAbove } = bruteForceVerify(buses, branches, ptdf, lodf, injections, result);
    expect(feasibleBelow).toBe(true);
    expect(violatesAbove).toBe(true);
  });

  it("IEEE14: feasible just below hc, infeasible just above it (sampled POI/direction combos)", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const injections = { 3: 20, 9: -10, 13: 5 };

    for (const poi of [4, 9, 11]) {
      for (const projectType of ["solar", "load"] as const) {
        const { ptdf, lodf, baseCase } = buildInputs(buses, branches, injections);
        const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, poi, projectType);
        const { feasibleBelow, violatesAbove } = bruteForceVerify(
          buses, branches, ptdf, lodf, injections, result
        );
        expect(feasibleBelow, `poi=${poi} type=${projectType} hc=${result.hcDeterministicMw}`).toBe(true);
        expect(violatesAbove, `poi=${poi} type=${projectType} hc=${result.hcDeterministicMw}`).toBe(true);
      }
    }
  });
});

// ── 3. Rating fallback ────────────────────────────────────────────────────────

describe("computeHostingCapacity — rating fallback", () => {
  it("uses rateAMw for both N-0 and N-1 when no emergency rating is set", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 2, "solar");
    // All ratings are rateAMw=50 for every branch/contingency pair considered
    expect(result.binding!.ratingMw).toBe(50);
  });

  it("uses the emergency rating (rateBMw) for N-1 screening when set higher than rateAMw", () => {
    const branches: SimpleBranch[] = [
      { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0, rateAMw: 50, rateBMw: 90 },
      { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0, rateAMw: 50, rateBMw: 90 },
      { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0, rateAMw: 50, rateBMw: 90 },
    ];
    const { buses, branches: nb } = makeNetwork(THREE_BUS_BUSES, branches);
    const { ptdf, lodf, baseCase } = buildInputs(buses, nb, {});
    const result = computeHostingCapacity(buses, nb, ptdf, lodf, baseCase, 2, "solar");

    // Cross-check against ground truth: with a higher emergency rating, hc should be
    // larger than the all-rateA=50 case computed above (contingencies less binding).
    const allNormal = threeBusLoop(50);
    const { buses: b2, branches: br2 } = makeNetwork(THREE_BUS_BUSES, allNormal);
    const { ptdf: p2, lodf: l2, baseCase: bc2 } = buildInputs(b2, br2, {});
    const baseline = computeHostingCapacity(b2, br2, p2, l2, bc2, 2, "solar");

    expect(result.hcDeterministicMw).toBeGreaterThanOrEqual(baseline.hcDeterministicMw);
  });
});

// ── 4. Islanding exclusion ─────────────────────────────────────────────────────

describe("computeHostingCapacity — islanding exclusion", () => {
  it("radial chain: every branch outage is islanding and excluded from N-1 screening", () => {
    const { buses, branches } = makeNetwork(
      [
        { busNumber: 1, busType: "SLACK" },
        { busNumber: 2 },
        { busNumber: 3 },
      ],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 50 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 0.1, rateAMw: 50 },
      ]
    );
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 3, "solar");

    expect(result.contingenciesScreened).toBe(0);
    expect(result.islandingContingenciesExcluded.sort()).toEqual([1, 2]);
    // Only N-0 constrains: hc = rating / |PTDF radial chain| = 50 (both branches carry full flow)
    expect(result.hcDeterministicMw).toBeCloseTo(50, 6);
  });
});

// ── 5. BaseCaseViolationError ──────────────────────────────────────────────────

describe("computeHostingCapacity — BaseCaseViolationError", () => {
  it("throws distinctly when the base case already violates a normal rating", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, rateAMw: 10 }]
    );
    // 50 MW injection on a 10 MW branch -> already violating
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, { 2: 50 });

    let caught: unknown;
    try {
      computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 2, "solar");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BaseCaseViolationError);
    const err = caught as InstanceType<typeof BaseCaseViolationError>;
    expect(err.branchNumber).toBe(1);
    expect(err.ratingMw).toBe(10);
    expect(Math.abs(err.flowMw)).toBeCloseTo(50, 6);
  });
});

// ── 6. POI validation ──────────────────────────────────────────────────────────

describe("computeHostingCapacity — POI validation", () => {
  it("throws when the POI bus does not exist", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    expect(() => computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 999, "solar")).toThrow(
      "not found"
    );
  });

  it("throws when the POI bus is the slack bus", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    expect(() => computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 1, "solar")).toThrow(
      "cannot be the slack bus"
    );
  });
});

// ── 7. Cross-input consistency ─────────────────────────────────────────────────

describe("computeHostingCapacity — cross-input consistency validation", () => {
  it("throws on PTDF/base-case slack bus mismatch", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    const mismatchedBaseCase = { ...baseCase, slackBusNumber: 999 };
    expect(() =>
      computeHostingCapacity(buses, branches, ptdf, lodf, mismatchedBaseCase, 2, "solar")
    ).toThrow("does not match the base-case DC power flow slack bus");
  });

  it("throws on topology hash mismatch between PTDF/LODF/base case", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {}, "hash-A");
    const staleLodf = { ...lodf, topologyHash: "hash-B" };
    expect(() =>
      computeHostingCapacity(buses, branches, ptdf, staleLodf, baseCase, 2, "solar")
    ).toThrow("Topology hash mismatch");
  });
});

// ── 8. Sensitivity epsilon / degenerate case ──────────────────────────────────

describe("computeHostingCapacity — sensitivity epsilon", () => {
  it("reports hc=0 and binding=null when every sensitivity is below the epsilon threshold", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, {});
    // Real sensitivities in this fixture are all well under 1 in magnitude — an epsilon of 10
    // makes every pair "no constraint", forcing the degenerate bestBound===Infinity path.
    const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 2, "solar", {
      sensitivityEpsilon: 10,
    });
    expect(result.hcDeterministicMw).toBe(0);
    expect(result.binding).toBeNull();
  });
});

// ── 9. IfeRepository ────────────────────────────────────────────────────────────

describe("IfeRepository", () => {
  function makeMockSupabase(overrides: Record<string, unknown> = {}) {
    const calls: { table: string; op: string; payload?: unknown }[] = [];
    const client = {
      from: (table: string) => ({
        insert: (payload: unknown) => {
          calls.push({ table, op: "insert", payload });
          return {
            select: () => ({
              single: async () => {
                const key = `insert:${table}`;
                if (overrides[key]) return overrides[key];
                return { data: { id: uid(), ...( payload as object) }, error: null };
              },
            }),
          };
        },
        update: (payload: unknown) => {
          calls.push({ table, op: "update", payload });
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => {
                    const key = `update:${table}`;
                    if (overrides[key]) return overrides[key];
                    return { data: { id: uid(), ...(payload as object) }, error: null };
                  },
                }),
              }),
            }),
          };
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const key = `select:${table}`;
                if (overrides[key]) return overrides[key];
                return { data: null, error: null };
              },
            }),
          }),
        }),
      }),
    };
    return { client: client as never, calls };
  }

  it("createAnalysis validates and inserts", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    const analysis = await repo.createAnalysis({
      tenant_id: "t1",
      network_model_id: "m1",
      poi_bus_id: "b1",
      iso_id: "PJM",
      capacity_mw: 50,
      project_type: "solar",
      target_cod: null,
      input_snapshot: {},
    });
    expect(analysis.tenantId).toBe("t1");
  });

  it("createAnalysis rejects invalid capacity_mw", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    await expect(
      repo.createAnalysis({
        tenant_id: "t1",
        network_model_id: "m1",
        poi_bus_id: "b1",
        iso_id: "PJM",
        capacity_mw: -5,
        project_type: "solar",
        target_cod: null,
        input_snapshot: {},
      })
    ).rejects.toThrow("capacity_mw must be positive");
  });

  it("createHostingCapacity rejects hc_p10_mw > hc_p50_mw", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    await expect(
      repo.createHostingCapacity({
        analysis_id: "a1",
        tenant_id: "t1",
        hc_deterministic_mw: 50,
        binding_line_id: null,
        binding_contingency_id: null,
        hc_p10_mw: 60,
        hc_p50_mw: 50,
        hc_p90_mw: null,
        mc_scenarios_run: null,
        mc_convergence_pct: null,
        violation_probability: null,
        vmin_headroom_pu: null,
        vmax_headroom_pu: null,
      })
    ).rejects.toThrow("hc_p10_mw must be");
  });
});

// ── 10. Pipeline ────────────────────────────────────────────────────────────────

describe("computeAndPersistHostingCapacity — pipeline", () => {
  function makeMockNetworkRepo(topologyHash: string | null = "hash-abc") {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(50));
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

  function makeMockIfeRepo() {
    const analyses = new Map<string, { id: string; status: string; [k: string]: unknown }>();
    const hostingCapacities = new Map<string, unknown>();
    let idCounter = 0;

    const repo = {
      createAnalysis: vi.fn(async (insert: Record<string, unknown>) => {
        const id = `analysis-${++idCounter}`;
        const row = { id, status: "pending", ...insert };
        analyses.set(id, row as never);
        return row;
      }),
      getAnalysis: vi.fn(async (_t: string, id: string) => analyses.get(id) ?? null),
      getAnalysisByIdempotencyKey: vi.fn(async (_t: string, key: string) => {
        for (const a of analyses.values()) {
          if ((a as { idempotency_key?: string }).idempotency_key === key) return a;
        }
        return null;
      }),
      updateAnalysisStatus: vi.fn(async (_t: string, id: string, status: string, opts?: { errorMessage?: string | null }) => {
        const row = analyses.get(id)!;
        row.status = status;
        if (opts?.errorMessage !== undefined) (row as { errorMessage?: string | null }).errorMessage = opts.errorMessage;
        return row;
      }),
      createHostingCapacity: vi.fn(async (insert: Record<string, unknown>) => {
        const id = `hc-${++idCounter}`;
        const row = { id, ...insert };
        hostingCapacities.set(insert.analysis_id as string, row);
        return row;
      }),
      getHostingCapacityByAnalysisId: vi.fn(async (_t: string, analysisId: string) =>
        hostingCapacities.get(analysisId) ?? null
      ),
    };
    return { repo: repo as unknown as IfeRepository, analyses, hostingCapacities };
  }

  it("completes successfully and persists exactly one hosting_capacity row", async () => {
    const { repo: networkRepo } = makeMockNetworkRepo();
    const { repo: ifeRepo, hostingCapacities } = makeMockIfeRepo();
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    const { analysis, hostingCapacity } = await computeAndPersistHostingCapacity(
      "tenant-1",
      {
        networkModelId: "model-1",
        poiBusNumber: 2,
        isoId: "PJM",
        capacityMw: 10,
        projectType: "solar",
        baseCaseInjectionsMw: {},
      },
      networkRepo,
      ifeRepo,
      ptdfStorage,
      lodfStorage
    );

    expect(analysis.status).toBe("completed");
    expect(hostingCapacity).not.toBeNull();
    expect(hostingCapacity!.hcDeterministicMw ?? (hostingCapacity as unknown as { hc_deterministic_mw: number }).hc_deterministic_mw).toBeDefined();
    expect(hostingCapacities.size).toBe(1);
  });

  it("Monte Carlo and voltage-headroom fields are always persisted as null", async () => {
    const { repo: networkRepo } = makeMockNetworkRepo();
    const { repo: ifeRepo } = makeMockIfeRepo();
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    await computeAndPersistHostingCapacity(
      "tenant-1",
      {
        networkModelId: "model-1",
        poiBusNumber: 2,
        isoId: "PJM",
        capacityMw: 10,
        projectType: "solar",
        baseCaseInjectionsMw: {},
      },
      networkRepo,
      ifeRepo,
      ptdfStorage,
      lodfStorage
    );

    const insertCall = (ifeRepo.createHostingCapacity as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertCall.hc_p10_mw).toBeNull();
    expect(insertCall.hc_p50_mw).toBeNull();
    expect(insertCall.hc_p90_mw).toBeNull();
    expect(insertCall.mc_scenarios_run).toBeNull();
    expect(insertCall.mc_convergence_pct).toBeNull();
    expect(insertCall.violation_probability).toBeNull();
    expect(insertCall.vmin_headroom_pu).toBeNull();
    expect(insertCall.vmax_headroom_pu).toBeNull();
  });

  it("failure path: status becomes 'failed' with an error_message and no hosting_capacity row is created", async () => {
    const { repo: networkRepo } = makeMockNetworkRepo();
    const { repo: ifeRepo, hostingCapacities } = makeMockIfeRepo();
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    await expect(
      computeAndPersistHostingCapacity(
        "tenant-1",
        {
          networkModelId: "model-1",
          poiBusNumber: 1, // slack bus -> engine throws
          isoId: "PJM",
          capacityMw: 10,
          projectType: "solar",
          baseCaseInjectionsMw: {},
        },
        networkRepo,
        ifeRepo,
        ptdfStorage,
        lodfStorage
      )
    ).rejects.toThrow("cannot be the slack bus");

    expect(hostingCapacities.size).toBe(0);
    const updateCalls = (ifeRepo.updateAnalysisStatus as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = updateCalls[updateCalls.length - 1];
    expect(lastCall[2]).toBe("failed");
    expect(lastCall[3].errorMessage).toMatch(/cannot be the slack bus/);
  });

  it("throws when the network model is not found", async () => {
    const networkRepo = {
      getModel: async () => null,
    } as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository;
    const { repo: ifeRepo } = makeMockIfeRepo();
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    await expect(
      computeAndPersistHostingCapacity(
        "tenant-1",
        {
          networkModelId: "nonexistent",
          poiBusNumber: 2,
          isoId: "PJM",
          capacityMw: 10,
          projectType: "solar",
          baseCaseInjectionsMw: {},
        },
        networkRepo,
        ifeRepo,
        ptdfStorage,
        lodfStorage
      )
    ).rejects.toThrow("not found");
  });

  it("throws when the POI bus does not exist in the model", async () => {
    const { repo: networkRepo } = makeMockNetworkRepo();
    const { repo: ifeRepo } = makeMockIfeRepo();
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    await expect(
      computeAndPersistHostingCapacity(
        "tenant-1",
        {
          networkModelId: "model-1",
          poiBusNumber: 999,
          isoId: "PJM",
          capacityMw: 10,
          projectType: "solar",
          baseCaseInjectionsMw: {},
        },
        networkRepo,
        ifeRepo,
        ptdfStorage,
        lodfStorage
      )
    ).rejects.toThrow("not found");
  });

  it("idempotency: a repeat call with the same key returns the existing completed analysis without recomputing", async () => {
    const { repo: networkRepo, buses, branches } = makeMockNetworkRepo();
    void buses;
    void branches;
    const { repo: ifeRepo } = makeMockIfeRepo();
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    const request = {
      networkModelId: "model-1",
      poiBusNumber: 2,
      isoId: "PJM",
      capacityMw: 10,
      projectType: "solar" as const,
      baseCaseInjectionsMw: {},
      idempotencyKey: "idem-key-1",
    };

    const first = await computeAndPersistHostingCapacity(
      "tenant-1", request, networkRepo, ifeRepo, ptdfStorage, lodfStorage
    );
    const createAnalysisSpy = ifeRepo.createAnalysis as unknown as ReturnType<typeof vi.fn>;
    const callsAfterFirst = createAnalysisSpy.mock.calls.length;

    const second = await computeAndPersistHostingCapacity(
      "tenant-1", request, networkRepo, ifeRepo, ptdfStorage, lodfStorage
    );

    expect(second.analysis.id).toBe(first.analysis.id);
    expect(createAnalysisSpy.mock.calls.length).toBe(callsAfterFirst); // no new analysis created
  });
});

// ── 11. API route — request validation ────────────────────────────────────────

describe("POST /api/ife/hosting-capacity — request validation", () => {
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

  const validBody = {
    networkModelId: "model-1",
    poiBusNumber: 2,
    isoId: "PJM",
    capacityMw: 50,
    projectType: "solar",
    baseCaseInjectionsMw: { 2: 10 },
  };

  async function callRoute(query: string, body?: unknown, rawBody?: string) {
    const { POST } = await import("@/app/api/ife/hosting-capacity/route");
    const request = new Request(`http://localhost/api/ife/hosting-capacity${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    return POST(request);
  }

  it("400s when tenant_id is missing", async () => {
    const res = await callRoute("", validBody);
    expect(res.status).toBe(400);
  });

  it("400s when the body is not valid JSON", async () => {
    const res = await callRoute("?tenant_id=t1", undefined, "{not json");
    expect(res.status).toBe(400);
  });

  it("400s when networkModelId is missing", async () => {
    const { networkModelId, ...rest } = validBody;
    void networkModelId;
    const res = await callRoute("?tenant_id=t1", rest);
    expect(res.status).toBe(400);
  });

  it("400s when poiBusNumber is not a number", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, poiBusNumber: "two" });
    expect(res.status).toBe(400);
  });

  it("400s when baseCaseInjectionsMw is an array", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, baseCaseInjectionsMw: [1, 2] });
    expect(res.status).toBe(400);
  });

  it("400s when slack_bus is not a positive integer", async () => {
    const res = await callRoute("?tenant_id=t1&slack_bus=-1", validBody);
    expect(res.status).toBe(400);
  });

  it("500s with a clear message when Supabase credentials are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callRoute("?tenant_id=t1", validBody);
    expect(res.status).toBe(500);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  });

  it("404s when the pipeline rejects with a 'not found' error", async () => {
    const spy = vi
      .spyOn(hcPipeline, "computeAndPersistHostingCapacity")
      .mockRejectedValueOnce(new Error("[HostingCapacity] Model model-1 not found for tenant t1"));
    try {
      const res = await callRoute("?tenant_id=t1", validBody);
      expect(res.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("409s when the pipeline rejects with a topology hash mismatch", async () => {
    const spy = vi
      .spyOn(hcPipeline, "computeAndPersistHostingCapacity")
      .mockRejectedValueOnce(new Error("[HostingCapacity] Topology hash mismatch between PTDF and LODF"));
    try {
      const res = await callRoute("?tenant_id=t1", validBody);
      expect(res.status).toBe(409);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when the pipeline rejects with a BaseCaseViolationError", async () => {
    const spy = vi
      .spyOn(hcPipeline, "computeAndPersistHostingCapacity")
      .mockRejectedValueOnce(new BaseCaseViolationError("base case violates rating", 1, 100, 50));
    try {
      const res = await callRoute("?tenant_id=t1", validBody);
      expect(res.status).toBe(400);
      const b = await res.json();
      expect(b.branchNumber).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when the pipeline rejects with 'cannot be the slack bus'", async () => {
    const spy = vi
      .spyOn(hcPipeline, "computeAndPersistHostingCapacity")
      .mockRejectedValueOnce(new Error("[HostingCapacity] POI bus cannot be the slack bus (bus 1)"));
    try {
      const res = await callRoute("?tenant_id=t1", validBody);
      expect(res.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 12. Performance benchmarks ─────────────────────────────────────────────────

describe("computeHostingCapacity — performance", () => {
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
      rateAMw: 500,
      rateBMw: 600,
    }));
    return { buses, branches };
  }

  it("IEEE14 incremental cost (given already-computed PTDF/LODF/DCPF) is well under 10 ms", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, { 3: 20, 9: -10 });

    const t0 = performance.now();
    const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 4, "solar");
    const elapsed = performance.now() - t0;

    expect(result.hcDeterministicMw).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(10);
  });

  it("500-bus ring incremental cost is well under 300 ms", () => {
    const { buses: sb, branches: br } = makeRingNetwork(500);
    const { buses, branches } = makeNetwork(sb, br);
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, { 250: 100 });

    const t0 = performance.now();
    const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 100, "solar");
    const elapsed = performance.now() - t0;

    expect(result.hcDeterministicMw).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(300);
  });

  it("1000-bus ring incremental cost is well under 2 s", { timeout: 10_000 }, () => {
    const { buses: sb, branches: br } = makeRingNetwork(1000);
    const { buses, branches } = makeNetwork(sb, br);
    const { ptdf, lodf, baseCase } = buildInputs(buses, branches, { 500: 100 });

    const t0 = performance.now();
    const result = computeHostingCapacity(buses, branches, ptdf, lodf, baseCase, 200, "solar");
    const elapsed = performance.now() - t0;

    expect(result.hcDeterministicMw).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(2000);
  });
});
