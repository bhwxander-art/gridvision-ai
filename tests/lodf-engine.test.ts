/**
 * INFRA-010 — LODF engine tests
 *
 * Test plan:
 *  1. computeLodf   — 3-bus symmetric loop (hand-derived analytic reference)
 *  2. computeLodf   — brute-force cross-validation (recompute PTDF with the
 *                     branch physically removed; compare vs LODF prediction)
 *                     for 3-bus loop, IEEE14, and random synthetic meshes
 *  3. Islanding      — radial chain (every branch is a bridge), mixed
 *                     loop+spur network, parallel-branch safety
 *  4. Physical invariants — diagonal always -1, non-islanding cells finite
 *  5. lodfLookup / contingencyImpact
 *  6. serialise / deserialise round-trip (incl. NaN-bearing islanding columns)
 *  7. InMemoryLodfStorage — store, load, invalidate, tenant isolation
 *  8. getOrComputeLodf — cache invalidation, PTDF cache reuse, idempotency
 *  9. API route — request validation (tenant_id, branch params, slack_bus)
 * 10. Performance — IEEE14 <5ms, 500-bus ring <300ms, 1000-bus ring <2s
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import { computePtdf, ptdfLookup } from "@/lib/ptdf/ptdf-engine";
import type { PtdfMatrix } from "@/lib/ptdf/types";
import {
  computeLodf,
  lodfLookup,
  lodfGet,
  isIslandingOutage,
  contingencyImpact,
} from "@/lib/lodf/lodf-engine";
import {
  serialiseLodf,
  deserialiseLodf,
  InMemoryLodfStorage,
} from "@/lib/lodf/lodf-storage";
import { InMemoryPtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { getOrComputeLodf } from "@/lib/lodf/lodf-pipeline";
import type { LodfMatrix } from "@/lib/lodf/types";

// ── Test fixture helpers (mirrors tests/ptdf-engine.test.ts conventions) ──────

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
  inService?: boolean;
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
    rateAMw: 9999,
    rateBMw: null,
    rateCMw: null,
    tapRatio: 1,
    phaseShiftDeg: 0,
    inService: br.inService ?? true,
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
  { branchNumber: 1,  fromBusNumber: 1,  toBusNumber: 2,  xPu: 0.05917 },
  { branchNumber: 2,  fromBusNumber: 1,  toBusNumber: 5,  xPu: 0.22304 },
  { branchNumber: 3,  fromBusNumber: 2,  toBusNumber: 3,  xPu: 0.19797 },
  { branchNumber: 4,  fromBusNumber: 2,  toBusNumber: 4,  xPu: 0.17632 },
  { branchNumber: 5,  fromBusNumber: 2,  toBusNumber: 5,  xPu: 0.17388 },
  { branchNumber: 6,  fromBusNumber: 3,  toBusNumber: 4,  xPu: 0.17103 },
  { branchNumber: 7,  fromBusNumber: 4,  toBusNumber: 5,  xPu: 0.04211 },
  { branchNumber: 8,  fromBusNumber: 4,  toBusNumber: 7,  xPu: 0.20912 },
  { branchNumber: 9,  fromBusNumber: 4,  toBusNumber: 9,  xPu: 0.55618 },
  { branchNumber: 10, fromBusNumber: 5,  toBusNumber: 6,  xPu: 0.25202 },
  { branchNumber: 11, fromBusNumber: 6,  toBusNumber: 11, xPu: 0.19890 },
  { branchNumber: 12, fromBusNumber: 6,  toBusNumber: 12, xPu: 0.25581 },
  { branchNumber: 13, fromBusNumber: 6,  toBusNumber: 13, xPu: 0.13027 },
  { branchNumber: 14, fromBusNumber: 7,  toBusNumber: 8,  xPu: 0.17615 },
  { branchNumber: 15, fromBusNumber: 7,  toBusNumber: 9,  xPu: 0.11001 },
  { branchNumber: 16, fromBusNumber: 9,  toBusNumber: 10, xPu: 0.08450 },
  { branchNumber: 17, fromBusNumber: 9,  toBusNumber: 14, xPu: 0.27038 },
  { branchNumber: 18, fromBusNumber: 10, toBusNumber: 11, xPu: 0.19207 },
  { branchNumber: 19, fromBusNumber: 12, toBusNumber: 13, xPu: 0.19988 },
  { branchNumber: 20, fromBusNumber: 13, toBusNumber: 14, xPu: 0.34802 },
];

// Deterministic PRNG (mulberry32) — reproducible "random" synthetic networks
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random meshed network: a spanning tree (guarantees connectivity) plus
 * extra random chords (guarantees loops / non-bridge branches to exercise
 * the LODF division path, not just islanding shortcuts).
 */
function makeRandomMeshNetwork(
  n: number,
  extraEdges: number,
  seed: number
): { buses: SimpleBus[]; branches: SimpleBranch[] } {
  const rand = mulberry32(seed);
  const buses: SimpleBus[] = Array.from({ length: n }, (_, i) => ({
    busNumber: i + 1,
    busType: i === 0 ? "SLACK" : "PQ",
  }));

  const branches: SimpleBranch[] = [];
  let branchNumber = 1;
  const edgeSet = new Set<string>();

  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    branches.push({
      branchNumber: branchNumber++,
      fromBusNumber: a,
      toBusNumber: b,
      xPu: 0.05 + rand() * 0.3,
    });
    return true;
  };

  // Random spanning tree: attach each new bus to a random already-connected bus
  for (let i = 2; i <= n; i++) {
    const parent = 1 + Math.floor(rand() * (i - 1));
    addEdge(parent, i);
  }

  // Extra chords to create loops (non-bridge branches)
  let added = 0;
  let attempts = 0;
  while (added < extraEdges && attempts < extraEdges * 20) {
    attempts++;
    const a = 1 + Math.floor(rand() * n);
    const b = 1 + Math.floor(rand() * n);
    if (a === b) continue;
    if (addEdge(a, b)) added++;
  }

  return { buses, branches };
}

// ── Brute-force cross-validation helper ───────────────────────────────────────

/**
 * Verifies LODF[·,k] for outage of `outageBranchNumber` by comparing against
 * an independently recomputed PTDF with that branch physically removed
 * (in_service = false). Uses a unit injection at `injBusNumber` as the
 * representative pre-contingency flow pattern F_l = PTDF[l, injBusNumber].
 *
 * This validates the full closed-form LODF formula end-to-end against the
 * ground-truth DC power-flow solve, independent of the formula's own logic.
 */
function bruteForceVerifyLodf(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  ptdfFull: PtdfMatrix,
  lodf: LodfMatrix,
  outageBranchNumber: number,
  injBusNumber: number,
  tol = 1e-7
): { ok: boolean; maxErr: number; comparedCount: number } {
  const modifiedBranches = branches.map((br) =>
    br.branchNumber === outageBranchNumber ? { ...br, inService: false } : br
  );
  const ptdfReduced = computePtdf(buses, modifiedBranches, {
    slackBusNumber: ptdfFull.slackBusNumber,
  });

  const Fk = ptdfLookup(ptdfFull, outageBranchNumber, injBusNumber);
  let maxErr = 0;
  let comparedCount = 0;

  for (const bn of ptdfFull.branchNumbers) {
    if (bn === outageBranchNumber) continue;
    const Fl = ptdfLookup(ptdfFull, bn, injBusNumber);
    const lodfVal = lodfLookup(lodf, bn, outageBranchNumber);
    const predicted = Fl + lodfVal * Fk;
    const bruteForce = ptdfLookup(ptdfReduced, bn, injBusNumber);
    const err = Math.abs(predicted - bruteForce);
    if (err > maxErr) maxErr = err;
    comparedCount++;
  }

  return { ok: maxErr <= tol, maxErr, comparedCount };
}

// ── 1. 3-bus symmetric loop — hand-derived analytic reference ────────────────

describe("computeLodf — 3-bus symmetric loop", () => {
  /**
   * Network: 1(slack) — 2 — 3 — 1, all x = 1 pu (triangle, no bridges).
   * From PTDF (see tests/ptdf-engine.test.ts):
   *   col bus2: br1(1-2)=-2/3, br2(1-3)=-1/3, br3(2-3)=+1/3
   *   col bus3: br1(1-2)=-1/3, br2(1-3)=-2/3, br3(2-3)=-1/3
   *
   * LODF[l,k] = (Φ[l,i_k]-Φ[l,j_k]) / (1-(Φ[k,i_k]-Φ[k,j_k])), Φ[·,slack]=0
   *
   * Outage of branch1 (1→2, i=slack, j=bus2):
   *   denom = 1 - (0 - (-2/3)) = 1/3
   *   LODF[br2,br1] = (0 - (-1/3)) / (1/3) = 1
   *   LODF[br3,br1] = (0 - (1/3)) / (1/3) = -1
   */
  function build() {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);
    return { buses, branches, ptdf, lodf };
  }

  it("produces a 3×3 LODF matrix", () => {
    const { lodf } = build();
    expect(lodf.size).toBe(3);
    expect(lodf.data.length).toBe(9);
  });

  it("no branch is an islanding outage (triangle has no bridges)", () => {
    const { lodf } = build();
    expect(lodf.islandingBranches).toEqual([]);
  });

  it("LODF[br2,br1] = 1 and LODF[br3,br1] = -1 (analytic)", () => {
    const { lodf } = build();
    expect(lodfLookup(lodf, 2, 1)).toBeCloseTo(1.0, 9);
    expect(lodfLookup(lodf, 3, 1)).toBeCloseTo(-1.0, 9);
  });

  it("diagonal is always -1", () => {
    const { lodf } = build();
    expect(lodfLookup(lodf, 1, 1)).toBeCloseTo(-1.0, 9);
    expect(lodfLookup(lodf, 2, 2)).toBeCloseTo(-1.0, 9);
    expect(lodfLookup(lodf, 3, 3)).toBeCloseTo(-1.0, 9);
  });

  it("matrix is symmetric under this particular (all-equal-reactance) topology", () => {
    // Not a general property of LODF, but true for this fully symmetric triangle
    const { lodf } = build();
    expect(lodfLookup(lodf, 1, 3)).toBeCloseTo(lodfLookup(lodf, 3, 1), 9);
  });
});

// ── 2. Brute-force cross-validation ───────────────────────────────────────────

describe("computeLodf — brute-force cross-validation vs recomputed PTDF", () => {
  it("3-bus loop: every (outage, injection) pair matches brute-force PTDF", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);

    for (const outage of [1, 2, 3]) {
      for (const injBus of [2, 3]) {
        const { ok, maxErr } = bruteForceVerifyLodf(buses, branches, ptdf, lodf, outage, injBus);
        expect(ok, `outage=${outage} inj=${injBus} maxErr=${maxErr}`).toBe(true);
      }
    }
  });

  it("IEEE14: sampled (outage, injection) pairs match brute-force PTDF", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);

    const sampleOutages = [1, 6, 7, 14, 16, 20];
    const sampleInjBuses = [2, 9, 14];
    for (const outage of sampleOutages) {
      if (lodf.islandingBranches.includes(outage)) continue;
      for (const injBus of sampleInjBuses) {
        const { ok, maxErr } = bruteForceVerifyLodf(buses, branches, ptdf, lodf, outage, injBus, 1e-6);
        expect(ok, `outage=${outage} inj=${injBus} maxErr=${maxErr}`).toBe(true);
      }
    }
  });

  it("random synthetic mesh networks: LODF matches brute-force PTDF", () => {
    for (const seed of [1, 2, 3]) {
      const { buses: simpleBuses, branches: simpleBranches } = makeRandomMeshNetwork(30, 15, seed);
      const { buses, branches } = makeNetwork(simpleBuses, simpleBranches);
      const ptdf = computePtdf(buses, branches);
      const lodf = computeLodf(buses, branches, ptdf);

      const rand = mulberry32(seed * 1000);
      let checked = 0;
      let attempts = 0;
      while (checked < 5 && attempts < 50) {
        attempts++;
        const outageIdx = Math.floor(rand() * lodf.branchNumbers.length);
        const outage = lodf.branchNumbers[outageIdx];
        if (lodf.islandingBranches.includes(outage)) continue;
        const injBus = ptdf.busNumbers[Math.floor(rand() * ptdf.busNumbers.length)];
        const { ok, maxErr } = bruteForceVerifyLodf(buses, branches, ptdf, lodf, outage, injBus, 1e-6);
        expect(ok, `seed=${seed} outage=${outage} inj=${injBus} maxErr=${maxErr}`).toBe(true);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });
});

// ── 3. Islanding detection ─────────────────────────────────────────────────────

describe("islanding detection", () => {
  it("radial chain: every branch outage is an islanding outage", () => {
    const { buses, branches } = makeNetwork(
      [
        { busNumber: 1, busType: "SLACK" },
        { busNumber: 2 },
        { busNumber: 3 },
        { busNumber: 4 },
      ],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 0.1 },
        { branchNumber: 3, fromBusNumber: 3, toBusNumber: 4, xPu: 0.1 },
      ]
    );
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);

    expect(lodf.islandingBranches.sort()).toEqual([1, 2, 3]);
    for (const bn of [1, 2, 3]) {
      expect(isIslandingOutage(buses, branches, bn)).toBe(true);
    }

    // Islanding columns: diagonal -1, all other cells NaN
    for (const k of [0, 1, 2]) {
      for (let l = 0; l < 3; l++) {
        const v = lodfGet(lodf, l, k);
        if (l === k) expect(v).toBe(-1);
        else expect(Number.isNaN(v)).toBe(true);
      }
    }
  });

  it("mixed loop + radial spur: loop branches are not islanding, spur is", () => {
    // Triangle 1(slack)-2-3-1 plus a radial spur 3-4
    const { buses, branches } = makeNetwork(
      [
        { busNumber: 1, busType: "SLACK" },
        { busNumber: 2 },
        { busNumber: 3 },
        { busNumber: 4 },
      ],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 4, fromBusNumber: 3, toBusNumber: 4, xPu: 0.5 },
      ]
    );
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);

    expect(lodf.islandingBranches).toEqual([4]);
    expect(isIslandingOutage(buses, branches, 1)).toBe(false);
    expect(isIslandingOutage(buses, branches, 2)).toBe(false);
    expect(isIslandingOutage(buses, branches, 3)).toBe(false);
    expect(isIslandingOutage(buses, branches, 4)).toBe(true);
  });

  it("parallel branches: neither is a bridge (multi-edge safety)", () => {
    // Two parallel branches directly connecting slack and bus2 — removing
    // either one alone leaves the other providing connectivity.
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 2, xPu: 0.2 },
      ]
    );
    expect(isIslandingOutage(buses, branches, 1)).toBe(false);
    expect(isIslandingOutage(buses, branches, 2)).toBe(false);

    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);
    expect(lodf.islandingBranches).toEqual([]);
  });

  it("isIslandingOutage returns false for an out-of-service branch", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1, inService: false }]
    );
    expect(isIslandingOutage(buses, branches, 1)).toBe(false);
  });
});

// ── 4. Physical invariants (IEEE14) ───────────────────────────────────────────

describe("computeLodf — physical invariants (IEEE14)", () => {
  function build() {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);
    return { lodf };
  }

  it("shape is 20×20 (20 in-service branches)", () => {
    const { lodf } = build();
    expect(lodf.size).toBe(20);
    expect(lodf.branchNumbers.length).toBe(20);
  });

  it("diagonal is exactly -1 for every branch", () => {
    const { lodf } = build();
    for (let i = 0; i < lodf.size; i++) {
      expect(lodfGet(lodf, i, i)).toBeCloseTo(-1.0, 9);
    }
  });

  it("branch 14 (7-8, bus 8 is a degree-1 leaf) is the sole islanding outage", () => {
    const { lodf } = build();
    // Bus 8 connects only via branch 14 — its outage strands bus 8 as an island.
    expect(lodf.islandingBranches).toEqual([14]);
  });

  it("non-islanding columns are fully finite; the islanding column is NaN off-diagonal", () => {
    const { lodf } = build();
    for (let k = 0; k < lodf.size; k++) {
      const outageBn = lodf.branchNumbers[k];
      const isIslanding = lodf.islandingBranches.includes(outageBn);
      for (let l = 0; l < lodf.size; l++) {
        const v = lodfGet(lodf, l, k);
        if (l === k) {
          expect(v).toBeCloseTo(-1.0, 9);
        } else if (isIslanding) {
          expect(Number.isNaN(v)).toBe(true);
        } else {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });
});

// ── 5. lodfLookup / contingencyImpact ─────────────────────────────────────────

describe("contingencyImpact", () => {
  function build() {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);
    return { lodf };
  }

  it("computes post-contingency flows from a base-case flow map", () => {
    const { lodf } = build();
    const baseFlows = new Map([[1, 100], [2, 50], [3, -20]]);
    const result = contingencyImpact(lodf, baseFlows, 1);

    expect(result.isIslanding).toBe(false);
    const br2 = result.impacts.find((i) => i.branchNumber === 2)!;
    // LODF[br2,br1] = 1 → post = 50 + 1*100 = 150
    expect(br2.postContingencyFlowMw).toBeCloseTo(150, 9);
    const br3 = result.impacts.find((i) => i.branchNumber === 3)!;
    // LODF[br3,br1] = -1 → post = -20 + (-1)*100 = -120
    expect(br3.postContingencyFlowMw).toBeCloseTo(-120, 9);
    const br1 = result.impacts.find((i) => i.branchNumber === 1)!;
    expect(br1.postContingencyFlowMw).toBe(0);
  });

  it("reports NaN post-contingency flows for an islanding outage", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 0.1 },
      ]
    );
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);
    const result = contingencyImpact(lodf, { 1: 10, 2: 10 }, 1);
    expect(result.isIslanding).toBe(true);
    const br2 = result.impacts.find((i) => i.branchNumber === 2)!;
    expect(Number.isNaN(br2.postContingencyFlowMw)).toBe(true);
  });

  it("throws for an unknown outaged branch number", () => {
    const { lodf } = build();
    expect(() => contingencyImpact(lodf, {}, 999)).toThrow("not found");
  });
});

// ── 6. serialise / deserialise ────────────────────────────────────────────────

describe("serialiseLodf / deserialiseLodf", () => {
  it("round-trips a LodfMatrix exactly, including NaN islanding cells", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 0.1 },
      ]
    );
    const ptdf = computePtdf(buses, branches, { modelId: "model-abc", topologyHash: "hash-xyz" });
    const original = computeLodf(buses, branches, ptdf, { modelId: "model-abc", topologyHash: "hash-xyz" });

    const bytes = serialiseLodf(original);
    const restored = deserialiseLodf(bytes);

    expect(restored.modelId).toBe(original.modelId);
    expect(restored.size).toBe(original.size);
    expect(restored.branchNumbers).toEqual(original.branchNumbers);
    expect(restored.islandingBranches).toEqual(original.islandingBranches);
    expect(restored.topologyHash).toBe(original.topologyHash);

    for (let i = 0; i < original.data.length; i++) {
      if (Number.isNaN(original.data[i])) {
        expect(Number.isNaN(restored.data[i])).toBe(true);
      } else {
        expect(restored.data[i]).toBe(original.data[i]);
      }
    }
  });

  it("round-trips a matrix with null topologyHash (IEEE14 has one bridge: branch 14)", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);
    const restored = deserialiseLodf(serialiseLodf(lodf));
    expect(restored.topologyHash).toBeNull();
    expect(restored.islandingBranches).toEqual([14]);
  });

  it("throws on invalid magic bytes", () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(() => deserialiseLodf(garbage)).toThrow("Invalid magic bytes");
  });
});

// ── 7. InMemoryLodfStorage ─────────────────────────────────────────────────────

describe("InMemoryLodfStorage", () => {
  function makeLodf(modelId: string): LodfMatrix {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const ptdf = computePtdf(buses, branches, { modelId });
    return computeLodf(buses, branches, ptdf, { modelId });
  }

  it("returns null for a cache miss", async () => {
    const storage = new InMemoryLodfStorage();
    const result = await storage.load("tenant-1", "model-1");
    expect(result).toBeNull();
  });

  it("stores and retrieves a matrix", async () => {
    const storage = new InMemoryLodfStorage();
    const lodf = makeLodf("model-1");
    await storage.store("tenant-1", lodf);
    const loaded = await storage.load("tenant-1", "model-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.modelId).toBe("model-1");
    expect(loaded!.data[0]).toBe(lodf.data[0]);
  });

  it("invalidate removes the entry", async () => {
    const storage = new InMemoryLodfStorage();
    const lodf = makeLodf("model-2");
    await storage.store("tenant-1", lodf);
    await storage.invalidate("tenant-1", "model-2");
    const result = await storage.load("tenant-1", "model-2");
    expect(result).toBeNull();
  });

  it("is tenant-isolated (different tenants get different caches)", async () => {
    const storage = new InMemoryLodfStorage();
    const lodf1 = makeLodf("model-x");
    await storage.store("tenant-A", lodf1);
    const result = await storage.load("tenant-B", "model-x");
    expect(result).toBeNull();
  });
});

// ── 8. getOrComputeLodf — cache invalidation & PTDF reuse ────────────────────

describe("getOrComputeLodf", () => {
  function makeMockRepo(opts: { ptdfValid: boolean; lodfValid: boolean }) {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);

    let listBusesCallCount = 0;
    let markLodfValidCallCount = 0;

    const repo = {
      getModel: async (_tid: string, _mid: string) => ({
        id: "model-1",
        tenantId: "tenant-1",
        ptdfValid: opts.ptdfValid,
        lodfValid: opts.lodfValid,
        topologyHash: "abc123",
        iso: "PJM" as const,
        name: "Test Model",
        version: "1.0",
        baseMva: 100,
        modelDate: "2024-01-01",
        source: "MANUAL" as const,
        busCount: 14,
        branchCount: 20,
        metadata: {},
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      }),
      listBuses: async () => {
        listBusesCallCount++;
        return buses;
      },
      listBranches: async () => branches,
      markPtdfValid: async () => {},
      markLodfValid: async () => {
        markLodfValidCallCount++;
      },
    };

    return {
      repo: repo as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository,
      getListBusesCallCount: () => listBusesCallCount,
      getMarkLodfValidCallCount: () => markLodfValidCallCount,
    };
  }

  it("computes PTDF and LODF from scratch when both caches are invalid", async () => {
    const { repo, getListBusesCallCount, getMarkLodfValidCallCount } = makeMockRepo({
      ptdfValid: false,
      lodfValid: false,
    });
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    const result = await getOrComputeLodf("tenant-1", "model-1", repo, ptdfStorage, lodfStorage);
    expect(result.fromCache).toBe(false);
    expect(result.lodf.size).toBe(20);
    expect(getMarkLodfValidCallCount()).toBe(1);
    // listBuses is called once by getOrComputePtdf (compute) and once more
    // directly by the LODF pipeline to build the from/to lookup — both
    // legitimate reads, not redundant PTDF recomputation.
    expect(getListBusesCallCount()).toBeGreaterThanOrEqual(1);
  });

  it("reuses an already-valid PTDF cache instead of recomputing it", async () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const precomputedPtdf = computePtdf(buses, branches, { modelId: "model-1" });

    const ptdfStorage = new InMemoryPtdfStorage();
    await ptdfStorage.store("tenant-1", precomputedPtdf);
    const lodfStorage = new InMemoryLodfStorage();

    const { repo } = makeMockRepo({ ptdfValid: true, lodfValid: false });
    const result = await getOrComputeLodf("tenant-1", "model-1", repo, ptdfStorage, lodfStorage);

    expect(result.fromCache).toBe(false); // LODF itself was still computed
    expect(result.lodf.size).toBe(20);
  });

  it("loads from cache when lodf_valid = true and cache exists", async () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const ptdf = computePtdf(buses, branches, { modelId: "model-1" });
    const precomputed = computeLodf(buses, branches, ptdf, { modelId: "model-1" });

    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();
    await lodfStorage.store("tenant-1", precomputed);

    const { repo, getListBusesCallCount } = makeMockRepo({ ptdfValid: true, lodfValid: true });
    const result = await getOrComputeLodf("tenant-1", "model-1", repo, ptdfStorage, lodfStorage);

    expect(result.fromCache).toBe(true);
    expect(getListBusesCallCount()).toBe(0); // no network reload at all
  });

  it("computes when lodf_valid = true but cache is empty (idempotent recovery)", async () => {
    const { repo } = makeMockRepo({ ptdfValid: true, lodfValid: true });
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage(); // empty despite lodf_valid=true

    const result = await getOrComputeLodf("tenant-1", "model-1", repo, ptdfStorage, lodfStorage);
    expect(result.fromCache).toBe(false);
    expect(result.lodf.size).toBe(20);
  });

  it("is idempotent across repeated calls once cached", async () => {
    const { repo } = makeMockRepo({ ptdfValid: false, lodfValid: false });
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    const first = await getOrComputeLodf("tenant-1", "model-1", repo, ptdfStorage, lodfStorage);
    expect(first.fromCache).toBe(false);

    // Simulate the repo now reporting lodf_valid=true (as markLodfValid would persist)
    const { repo: repoValid } = makeMockRepo({ ptdfValid: true, lodfValid: true });
    const second = await getOrComputeLodf("tenant-1", "model-1", repoValid, ptdfStorage, lodfStorage);
    expect(second.fromCache).toBe(true);
    expect(second.lodf.data).toEqual(first.lodf.data);
  });

  it("throws when model not found", async () => {
    const repo = {
      getModel: async () => null,
    } as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository;
    const ptdfStorage = new InMemoryPtdfStorage();
    const lodfStorage = new InMemoryLodfStorage();

    await expect(
      getOrComputeLodf("tenant-1", "nonexistent", repo, ptdfStorage, lodfStorage)
    ).rejects.toThrow("not found");
  });
});

// ── 9. API route — request validation ─────────────────────────────────────────

describe("GET /api/network/[modelId]/lodf — request validation", () => {
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

  async function callRoute(query: string) {
    const { GET } = await import("@/app/api/network/[modelId]/lodf/route");
    const request = new Request(`http://localhost/api/network/model-1/lodf${query}`);
    return GET(request, { params: Promise.resolve({ modelId: "model-1" }) });
  }

  it("400s when tenant_id is missing", async () => {
    const res = await callRoute("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/tenant_id/);
  });

  it("400s when slack_bus is not a positive integer", async () => {
    const res = await callRoute("?tenant_id=t1&slack_bus=-5");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/slack_bus/);
  });

  it("400s when format=branch is missing the branch parameter", async () => {
    const res = await callRoute("?tenant_id=t1&format=branch");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/branch/);
  });

  it("400s when format=branch has a non-numeric branch parameter", async () => {
    const res = await callRoute("?tenant_id=t1&format=branch&branch=abc");
    expect(res.status).toBe(400);
  });

  it("400s when format=branch has a non-numeric monitor parameter", async () => {
    const res = await callRoute("?tenant_id=t1&format=branch&branch=1&monitor=xyz");
    expect(res.status).toBe(400);
  });

  it("500s with a clear message when Supabase credentials are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callRoute("?tenant_id=t1");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Supabase/);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  });
});

// ── 10. Performance benchmarks ─────────────────────────────────────────────────

describe("computeLodf — performance", () => {
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
    }));
    return { buses, branches };
  }

  it("IEEE14 completes in < 5 ms", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const ptdf = computePtdf(buses, branches);

    const t0 = performance.now();
    const lodf = computeLodf(buses, branches, ptdf);
    const elapsed = performance.now() - t0;

    expect(lodf.size).toBe(20);
    expect(elapsed).toBeLessThan(5);
  });

  it("500-bus ring network completes in < 300 ms", () => {
    const { buses: simpleBuses, branches: simpleBranches } = makeRingNetwork(500);
    const { buses, branches } = makeNetwork(simpleBuses, simpleBranches);
    const ptdf = computePtdf(buses, branches);

    const t0 = performance.now();
    const lodf = computeLodf(buses, branches, ptdf);
    const elapsed = performance.now() - t0;

    expect(lodf.size).toBe(500);
    expect(lodf.islandingBranches).toEqual([]); // a ring has no bridges
    expect(elapsed).toBeLessThan(300);
  });

  it("1000-bus ring network completes in < 2 s", { timeout: 10_000 }, () => {
    const { buses: simpleBuses, branches: simpleBranches } = makeRingNetwork(1000);
    const { buses, branches } = makeNetwork(simpleBuses, simpleBranches);
    const ptdf = computePtdf(buses, branches);

    const t0 = performance.now();
    const lodf = computeLodf(buses, branches, ptdf);
    const elapsed = performance.now() - t0;

    expect(lodf.size).toBe(1000);
    expect(elapsed).toBeLessThan(2000);
  });
});
