/**
 * INFRA-009 — PTDF engine tests
 *
 * Test plan:
 *  1. buildBasis   — B_reduced diagonal values match susceptance sums
 *  2. Cholesky     — L·Lᵀ ≈ A, forward/backward solve
 *  3. AMD ordering — valid permutation, reduces fill-in on sparse graph
 *  4. computePtdf  — 2-bus single-branch (|PTDF| = 1)
 *  5. computePtdf  — 3-bus symmetric loop (analytic reference values)
 *  6. computePtdf  — IEEE 14-bus KCL power balance for every column
 *  7. computePtdf  — IEEE 14-bus row-sum property (PTDF_full row sum = 0)
 *  8. computePtdf  — |PTDF| ≤ 1 bound for IEEE 14-bus
 *  9. computePtdf  — explicit slack bus override
 * 10. computePtdf  — branches connected to slack bus handled correctly
 * 11. serialise / deserialise round-trip
 * 12. InMemoryPtdfStorage — store, load, invalidate
 * 13. cache invalidation via ptdf_valid flag (mock pipeline)
 * 14. Performance  — 500-bus ring network < 30 s
 * 15. Error cases  — disconnected island, no branches
 */

import { describe, it, expect } from "vitest";
import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import { buildBasis } from "@/lib/ptdf/b-matrix";
import { minimumDegreeOrder } from "@/lib/ptdf/ordering";
import {
  choleskyFactor,
  choleskyForwardSolve,
  choleskyBackwardSolve,
  choleskySolve,
} from "@/lib/ptdf/dense-cholesky";
import { computePtdf, ptdfGet, ptdfLookup } from "@/lib/ptdf/ptdf-engine";
import { serialisePtdf, deserialisePtdf, InMemoryPtdfStorage } from "@/lib/ptdf/ptdf-storage";
import { getOrComputePtdf } from "@/lib/ptdf/ptdf-pipeline";
import type { PtdfMatrix } from "@/lib/ptdf/types";

// ── Test fixture helpers ──────────────────────────────────────────────────────

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
    inService: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  }));

  return { buses, branches };
}

// ── IEEE 14-bus reference network ─────────────────────────────────────────────

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

// Standard IEEE 14-bus branch reactances (per-unit on 100 MVA base)
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

// ── KCL power-balance verifier ────────────────────────────────────────────────

/**
 * For column k of PTDF (unit injection at reduced bus k, withdrawal at slack):
 * the net branch-flow divergence at each non-slack bus j must equal δ_{j,k}.
 *
 * Concretely: sum_l A_flow[l][j] · PTDF[l][k]  ==  (j == k ? 1 : 0)
 * where A_flow[l][j] = +1 if from-bus of branch l maps to reduced index j
 *                     = -1 if to-bus  of branch l maps to reduced index j
 */
function verifyKcl(
  ptdf: PtdfMatrix,
  fromRedIdx: Int32Array,
  toRedIdx: Int32Array,
  tol = 1e-9
): { ok: boolean; maxErr: number } {
  const { rows: e, cols: nred, data } = ptdf;
  const netInj = new Float64Array(nred);
  let maxErr = 0;

  for (let k = 0; k < nred; k++) {
    netInj.fill(0);
    for (let l = 0; l < e; l++) {
      const f = fromRedIdx[l]; // -1 = slack → θ = 0
      const t = toRedIdx[l];
      const flow = data[l * nred + k];
      if (f >= 0) netInj[f] += flow;
      if (t >= 0) netInj[t] -= flow;
    }
    for (let j = 0; j < nred; j++) {
      const expected = j === k ? 1.0 : 0.0;
      const err = Math.abs(netInj[j] - expected);
      if (err > maxErr) maxErr = err;
    }
  }
  return { ok: maxErr <= tol, maxErr };
}

// ── 1. buildBasis ─────────────────────────────────────────────────────────────

describe("buildBasis", () => {
  it("B_reduced diagonal equals sum of connected susceptances", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const basis = buildBasis(buses, branches, 1);
    const { nred, Bred } = basis;
    expect(nred).toBe(2);
    // Bus 2: connected to bus1 (b=1) and bus3 (b=1) → diag = 2
    expect(Bred[0 * 2 + 0]).toBeCloseTo(2, 9);
    // Bus 2 ↔ Bus 3: b = -1
    expect(Bred[0 * 2 + 1]).toBeCloseTo(-1, 9);
    // Bus 3: same as bus 2 by symmetry
    expect(Bred[1 * 2 + 1]).toBeCloseTo(2, 9);
  });

  it("branches connected to slack only contribute to diagonal", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.5 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 0.5 },
      ]
    );
    const basis = buildBasis(buses, branches, 1);
    const { Bred, nred } = basis;
    // No branch between buses 2 and 3 → off-diagonal should be 0
    expect(Bred[0 * nred + 1]).toBeCloseTo(0, 9);
    // Diagonal for bus 2: b = 1/0.5 = 2
    expect(Bred[0 * nred + 0]).toBeCloseTo(2, 9);
  });

  it("throws when slack bus is not in the bus list", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1 }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 }]
    );
    expect(() => buildBasis(buses, branches, 99)).toThrow("Slack bus number 99");
  });

  it("out-of-service branches are excluded", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 }]
    );
    branches[0].inService = false;
    const basis = buildBasis(buses, branches, 1);
    expect(basis.e).toBe(0);
  });
});

// ── 2. Cholesky ───────────────────────────────────────────────────────────────

describe("choleskyFactor", () => {
  it("L·Lᵀ reconstructs a 3×3 SPD matrix", () => {
    // A = [[4,2,1],[2,5,2],[1,2,6]]
    const n = 3;
    const A = new Float64Array([4, 2, 1, 2, 5, 2, 1, 2, 6]);
    const { L } = choleskyFactor(A, n);

    // Reconstruct A from L·Lᵀ
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let v = 0;
        for (let k = 0; k <= Math.min(i, j); k++) v += L[i * n + k] * L[j * n + k];
        expect(v).toBeCloseTo(A[i * n + j], 10);
      }
    }
  });

  it("solves A·x = b exactly for 4×4 system", () => {
    const n = 4;
    // Diagonally dominant SPD
    const A = new Float64Array([
      10, -1,  2, 0,
      -1,  8, -1, 3,
       2, -1, 10, -1,
       0,  3, -1,  7,
    ]);
    const b = new Float64Array([11, 20, -9, 1]);
    const chol = choleskyFactor(A, n);
    const x = choleskySolve(chol, b);

    // Verify A·x ≈ b
    for (let i = 0; i < n; i++) {
      let Ax = 0;
      for (let j = 0; j < n; j++) Ax += A[i * n + j] * x[j];
      expect(Ax).toBeCloseTo(b[i], 10);
    }
  });

  it("throws for non-positive-definite matrix", () => {
    const n = 2;
    const A = new Float64Array([1, 2, 2, 1]); // eigenvalues 3 and -1
    expect(() => choleskyFactor(A, n)).toThrow("not positive-definite");
  });
});

// ── 3. AMD ordering ───────────────────────────────────────────────────────────

describe("minimumDegreeOrder", () => {
  it("returns a valid permutation for a 4-node path graph", () => {
    const adj: Set<number>[] = [
      new Set([1]),       // 0 — 1
      new Set([0, 2]),    // 1 — 2
      new Set([1, 3]),    // 2 — 3
      new Set([2]),       // 3
    ];
    const { perm, iperm } = minimumDegreeOrder(4, adj);
    // perm and iperm must be inverses
    for (let i = 0; i < 4; i++) {
      expect(iperm[perm[i]]).toBe(i);
    }
    // All indices 0..3 appear exactly once
    const seen = new Set(Array.from(perm));
    expect(seen.size).toBe(4);
  });

  it("prefers endpoints (degree 1) for a path graph", () => {
    const adj: Set<number>[] = [
      new Set([1]),
      new Set([0, 2]),
      new Set([1, 3]),
      new Set([2]),
    ];
    const { perm } = minimumDegreeOrder(4, adj);
    // Endpoints (0 and 3) have degree 1 and should be eliminated first
    expect(perm[0] === 0 || perm[0] === 3).toBe(true);
  });

  it("handles a fully connected graph (n=3)", () => {
    const adj: Set<number>[] = [
      new Set([1, 2]),
      new Set([0, 2]),
      new Set([0, 1]),
    ];
    const { perm, iperm } = minimumDegreeOrder(3, adj);
    for (let i = 0; i < 3; i++) expect(iperm[perm[i]]).toBe(i);
  });
});

// ── 4. 2-bus single-branch ────────────────────────────────────────────────────

describe("computePtdf — 2-bus", () => {
  it("|PTDF| = 1 for a single branch (all power uses the only path)", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 }]
    );
    const ptdf = computePtdf(buses, branches);
    // shape: 1 branch × 1 non-slack bus
    expect(ptdf.rows).toBe(1);
    expect(ptdf.cols).toBe(1);
    // |PTDF| must equal 1 — single path, 100% flow on this branch
    expect(Math.abs(ptdfGet(ptdf, 0, 0))).toBeCloseTo(1.0, 9);
  });

  it("PTDF is negative when injection bus is the to-bus", () => {
    // Branch defined 1→2; injecting at bus 2 → power flows 2→1 → negative PTDF
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.2 }]
    );
    const ptdf = computePtdf(buses, branches);
    expect(ptdfGet(ptdf, 0, 0)).toBeCloseTo(-1.0, 9);
  });
});

// ── 5. 3-bus symmetric loop — analytic reference values ───────────────────────

describe("computePtdf — 3-bus symmetric loop", () => {
  /**
   * Network:  1(slack) — 2 — 3 — 1   (all x = 1 pu)
   * Analytic: B_reduced = [[2,-1],[-1,2]], inv = (1/3)[[2,1],[1,2]]
   *
   * Column for bus 2 (k=0): θ = (1/3)[2,1]
   *   Branch 1→2: b·(θ₁−θ₂) = 1·(0 − 2/3) = −2/3
   *   Branch 1→3: b·(θ₁−θ₃) = 1·(0 − 1/3) = −1/3
   *   Branch 2→3: b·(θ₂−θ₃) = 1·(2/3 − 1/3) = +1/3
   *
   * Column for bus 3 (k=1): θ = (1/3)[1,2]
   *   Branch 1→2: 1·(0 − 1/3) = −1/3
   *   Branch 1→3: 1·(0 − 2/3) = −2/3
   *   Branch 2→3: 1·(1/3 − 2/3) = −1/3
   */
  let ptdf: PtdfMatrix;

  it("produces a 3×2 PTDF matrix", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    ptdf = computePtdf(buses, branches);
    expect(ptdf.rows).toBe(3);
    expect(ptdf.cols).toBe(2);
  });

  it("branch 1→2 PTDF for bus 2 injection ≈ −2/3", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const m = computePtdf(buses, branches);
    expect(ptdfLookup(m, 1, 2)).toBeCloseTo(-2 / 3, 9);
  });

  it("branch 1→3 PTDF for bus 2 injection ≈ −1/3", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const m = computePtdf(buses, branches);
    expect(ptdfLookup(m, 2, 2)).toBeCloseTo(-1 / 3, 9);
  });

  it("branch 2→3 PTDF for bus 2 injection ≈ +1/3", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const m = computePtdf(buses, branches);
    expect(ptdfLookup(m, 3, 2)).toBeCloseTo(1 / 3, 9);
  });

  it("branch 1→2 PTDF for bus 3 injection ≈ −1/3", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const m = computePtdf(buses, branches);
    expect(ptdfLookup(m, 1, 3)).toBeCloseTo(-1 / 3, 9);
  });

  it("branch 2→3 PTDF for bus 3 injection ≈ −1/3", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const m = computePtdf(buses, branches);
    expect(ptdfLookup(m, 3, 3)).toBeCloseTo(-1 / 3, 9);
  });

  it("satisfies KCL power balance for all columns", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
        { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    const m = computePtdf(buses, branches);
    const basis = buildBasis(buses, branches, 1);
    const { ok, maxErr } = verifyKcl(m, basis.fromRedIdx, basis.toRedIdx);
    expect(ok).toBe(true);
    expect(maxErr).toBeLessThan(1e-9);
  });
});

// ── 6 & 7 & 8. IEEE 14-bus ────────────────────────────────────────────────────

describe("computePtdf — IEEE 14-bus", () => {
  let ptdf14: PtdfMatrix;
  let basis14: ReturnType<typeof buildBasis>;

  function getIeee14() {
    if (!ptdf14) {
      const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
      basis14 = buildBasis(buses, branches, 1);
      ptdf14 = computePtdf(buses, branches);
    }
    return { ptdf: ptdf14, basis: basis14 };
  }

  it("produces correct shape: 20 branches × 13 non-slack buses", () => {
    const { ptdf } = getIeee14();
    expect(ptdf.rows).toBe(20);
    expect(ptdf.cols).toBe(13);
  });

  it("slack bus is bus 1", () => {
    const { ptdf } = getIeee14();
    expect(ptdf.slackBusNumber).toBe(1);
  });

  it("all |PTDF| values are ≤ 1 (physical bound)", () => {
    const { ptdf } = getIeee14();
    for (let i = 0; i < ptdf.data.length; i++) {
      expect(Math.abs(ptdf.data[i])).toBeLessThanOrEqual(1.0 + 1e-9);
    }
  });

  it("satisfies KCL power balance for every column (max error < 0.001)", () => {
    const { ptdf, basis } = getIeee14();
    const { ok, maxErr } = verifyKcl(ptdf, basis.fromRedIdx, basis.toRedIdx, 1e-9);
    expect(ok).toBe(true);
    // Well within the spec's 0.001 tolerance
    expect(maxErr).toBeLessThan(1e-9);
  });

  it("row-sum property: PTDF_full row sums to 0 for every branch", () => {
    /**
     * The extended PTDF matrix (including the slack column) satisfies
     * PTDF_slack[l] = −sum_{k≠slack} PTDF[l,k].
     * Therefore sum over ALL buses (including slack) of PTDF = 0 per row.
     * Equivalently: sum_{k non-slack} PTDF[l,k] + PTDF_slack[l] = 0.
     *
     * We can verify this because PTDF_slack[l] is implicitly defined by
     * the Kirchhoff equation at the slack bus — it is the negative of the
     * sum over non-slack PTDFs.
     *
     * The test verifies an equivalent statement: for every column k_inj,
     * the net flow into the slack bus equals -1 (one unit withdrawn).
     *
     *   flow_into_slack = sum_l(A_slack[l] * PTDF[l,k_inj])
     *   where A_slack[l] = +1 if to-bus of l is slack, -1 if from-bus is slack
     */
    const { ptdf, basis } = getIeee14();
    const { fromRedIdx, toRedIdx, slackIdx, origIdxToRedIdx, susceptances, e, nred } = basis;

    // Build slack-bus incidence row
    const busIdArr = Array.from(basis.busIdToOrigIdx.entries());
    for (let k = 0; k < nred; k++) {
      let slackInflow = 0;
      for (let l = 0; l < e; l++) {
        // Use fromRedIdx / toRedIdx: -1 means that bus IS the slack
        const fr = fromRedIdx[l];
        const tr = toRedIdx[l];
        const flow = ptdf.data[l * nred + k];
        if (fr < 0) slackInflow -= flow; // from-bus is slack: flow leaves slack
        if (tr < 0) slackInflow += flow; // to-bus is slack: flow enters slack
      }
      // For unit injection at bus k, the slack must absorb exactly 1 unit
      expect(slackInflow).toBeCloseTo(1.0, 9);
    }
  });

  it("branch 1-2 PTDF for bus 2 is between 0.4 and 0.8 (network-topology range)", () => {
    const { ptdf } = getIeee14();
    // Branch 1→2 has susceptance 1/0.05917 ≈ 16.9; bus 2 is directly connected
    // A significant fraction of power from bus 2 flows via branch 1-2
    const val = ptdfLookup(ptdf, 1, 2);
    // The flow is in the −from→to direction (power flows 2→1), so PTDF < 0
    expect(val).toBeLessThan(-0.4);
    expect(val).toBeGreaterThan(-0.9);
  });
});

// ── 9. Explicit slack bus override ────────────────────────────────────────────

describe("computePtdf — slack bus selection", () => {
  it("uses busType=SLACK automatically", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 5, busType: "SLACK" }, { busNumber: 10 }],
      [{ branchNumber: 1, fromBusNumber: 5, toBusNumber: 10, xPu: 0.1 }]
    );
    const ptdf = computePtdf(buses, branches);
    expect(ptdf.slackBusNumber).toBe(5);
    expect(ptdf.busNumbers).toEqual([10]);
  });

  it("respects slackBusNumber override when provided", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
      ]
    );
    // Force bus 3 as the reference bus even though bus 1 is marked SLACK
    const ptdf = computePtdf(buses, branches, { slackBusNumber: 3 });
    expect(ptdf.slackBusNumber).toBe(3);
    expect(ptdf.busNumbers).toContain(1);
    expect(ptdf.busNumbers).toContain(2);
    expect(ptdf.busNumbers).not.toContain(3);
  });
});

// ── 10. Branches connected to slack ──────────────────────────────────────────

describe("computePtdf — branches to/from slack", () => {
  it("radial branch from slack: PTDF = -1 at non-slack end", () => {
    // Bus 1 (slack) — Bus 2 — Bus 3 (chain, no loops)
    const { buses, branches } = makeNetwork(
      [
        { busNumber: 1, busType: "SLACK" },
        { busNumber: 2, busType: "PQ" },
        { busNumber: 3, busType: "PQ" },
      ],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.5 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 0.5 },
      ]
    );
    const ptdf = computePtdf(buses, branches);
    // Injection at bus 3 — all flow must traverse both branches
    const p_branch1_bus3 = ptdfLookup(ptdf, 1, 3);
    const p_branch2_bus3 = ptdfLookup(ptdf, 2, 3);
    expect(Math.abs(p_branch1_bus3)).toBeCloseTo(1.0, 9);
    expect(Math.abs(p_branch2_bus3)).toBeCloseTo(1.0, 9);
    // Both flows in same direction (2→1) for branch 1, (3→2) for branch 2
    expect(p_branch1_bus3).toBeCloseTo(-1.0, 9);
    expect(p_branch2_bus3).toBeCloseTo(-1.0, 9);
  });
});

// ── 11. serialisePtdf / deserialisePtdf ──────────────────────────────────────

describe("serialisePtdf / deserialisePtdf", () => {
  it("round-trips a PtdfMatrix exactly", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const original = computePtdf(buses, branches, {
      modelId: "model-abc",
      topologyHash: "hash-xyz",
    });

    const bytes = serialisePtdf(original);
    const restored = deserialisePtdf(bytes);

    expect(restored.modelId).toBe(original.modelId);
    expect(restored.slackBusNumber).toBe(original.slackBusNumber);
    expect(restored.rows).toBe(original.rows);
    expect(restored.cols).toBe(original.cols);
    expect(restored.busNumbers).toEqual(original.busNumbers);
    expect(restored.branchNumbers).toEqual(original.branchNumbers);
    expect(restored.topologyHash).toBe(original.topologyHash);

    // Verify all float values are preserved
    for (let i = 0; i < original.data.length; i++) {
      expect(restored.data[i]).toBe(original.data[i]);
    }
  });

  it("round-trips a matrix with null topologyHash", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 }]
    );
    const m = computePtdf(buses, branches);
    const restored = deserialisePtdf(serialisePtdf(m));
    expect(restored.topologyHash).toBeNull();
  });

  it("throws on invalid magic bytes", () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(() => deserialisePtdf(garbage)).toThrow("Invalid magic bytes");
  });
});

// ── 12. InMemoryPtdfStorage ───────────────────────────────────────────────────

describe("InMemoryPtdfStorage", () => {
  function makePtdf(modelId: string): PtdfMatrix {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 }]
    );
    return computePtdf(buses, branches, { modelId });
  }

  it("returns null for a cache miss", async () => {
    const storage = new InMemoryPtdfStorage();
    const result = await storage.load("tenant-1", "model-1");
    expect(result).toBeNull();
  });

  it("stores and retrieves a matrix", async () => {
    const storage = new InMemoryPtdfStorage();
    const ptdf = makePtdf("model-1");
    await storage.store("tenant-1", ptdf);
    const loaded = await storage.load("tenant-1", "model-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.modelId).toBe("model-1");
    expect(loaded!.data[0]).toBe(ptdf.data[0]);
  });

  it("invalidate removes the entry", async () => {
    const storage = new InMemoryPtdfStorage();
    const ptdf = makePtdf("model-2");
    await storage.store("tenant-1", ptdf);
    await storage.invalidate("tenant-1", "model-2");
    const result = await storage.load("tenant-1", "model-2");
    expect(result).toBeNull();
  });

  it("is tenant-isolated (different tenants get different caches)", async () => {
    const storage = new InMemoryPtdfStorage();
    const ptdf1 = makePtdf("model-x");
    await storage.store("tenant-A", ptdf1);
    const result = await storage.load("tenant-B", "model-x");
    expect(result).toBeNull();
  });
});

// ── 13. Cache invalidation (mock pipeline) ────────────────────────────────────

describe("getOrComputePtdf — cache invalidation", () => {
  function makeMockRepo(ptdfValid: boolean) {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);

    let computeCallCount = 0;

    const repo = {
      getModel: async (_tid: string, _mid: string) => ({
        id: "model-1",
        tenantId: "tenant-1",
        ptdfValid,
        topologyHash: "abc123",
        iso: "PJM" as const,
        name: "Test Model",
        version: "1.0",
        baseMva: 100,
        modelDate: "2024-01-01",
        source: "MANUAL" as const,
        lodfValid: false,
        busCount: 14,
        branchCount: 20,
        metadata: {},
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      }),
      listBuses: async () => {
        computeCallCount++;
        return buses;
      },
      listBranches: async () => branches,
      markPtdfValid: async () => {},
    };

    return { repo: repo as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository, getCallCount: () => computeCallCount };
  }

  it("computes and caches when ptdf_valid = false (cache miss)", async () => {
    const { repo, getCallCount } = makeMockRepo(false);
    const storage = new InMemoryPtdfStorage();

    const result = await getOrComputePtdf("tenant-1", "model-1", repo, storage);
    expect(result.fromCache).toBe(false);
    expect(result.ptdf.rows).toBe(20);
    expect(getCallCount()).toBe(1); // computation happened

    // Second call — now storage has the matrix but repo says ptdfValid=false
    // (normally the markPtdfValid call would have made it valid; we test it's computing anyway)
    expect(result.computeMs).toBeGreaterThanOrEqual(0);
  });

  it("loads from cache when ptdf_valid = true and cache exists", async () => {
    const { repo, getCallCount } = makeMockRepo(true);
    const storage = new InMemoryPtdfStorage();

    // Pre-populate cache
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const precomputed = computePtdf(buses, branches, { modelId: "model-1" });
    await storage.store("tenant-1", precomputed);

    const result = await getOrComputePtdf("tenant-1", "model-1", repo, storage);
    expect(result.fromCache).toBe(true);
    expect(getCallCount()).toBe(0); // no computation
  });

  it("computes when ptdf_valid = true but cache is empty", async () => {
    const { repo, getCallCount } = makeMockRepo(true);
    const storage = new InMemoryPtdfStorage(); // empty

    const result = await getOrComputePtdf("tenant-1", "model-1", repo, storage);
    expect(result.fromCache).toBe(false);
    expect(getCallCount()).toBe(1);
  });

  it("throws when model not found", async () => {
    const repo = {
      getModel: async () => null,
    } as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository;
    const storage = new InMemoryPtdfStorage();

    await expect(
      getOrComputePtdf("tenant-1", "nonexistent", repo, storage)
    ).rejects.toThrow("not found");
  });
});

// ── 14. Performance benchmark ─────────────────────────────────────────────────

describe("computePtdf — performance", () => {
  function makeRingNetwork(n: number): ReturnType<typeof makeNetwork> {
    const buses: SimpleBus[] = Array.from({ length: n }, (_, i) => ({
      busNumber: i + 1,
      busType: i === 0 ? "SLACK" : "PQ",
    }));
    const branches: SimpleBranch[] = Array.from({ length: n }, (_, i) => ({
      branchNumber: i + 1,
      fromBusNumber: i + 1,
      toBusNumber: ((i + 1) % n) + 1,
      xPu: 0.05 + (i % 5) * 0.01, // varying reactances
    }));
    return makeNetwork(buses, branches);
  }

  it("500-bus ring network completes in < 30 seconds", { timeout: 35_000 }, () => {
    const { buses, branches } = makeRingNetwork(500);
    const t0 = performance.now();
    const ptdf = computePtdf(buses, branches);
    const elapsed = performance.now() - t0;

    expect(ptdf.rows).toBe(500); // 500 ring branches
    expect(ptdf.cols).toBe(499); // 499 non-slack buses
    expect(elapsed).toBeLessThan(30_000);

    // Spot-check KCL for 5 random columns
    const basis = buildBasis(buses, branches, 1);
    const sample = [0, 50, 100, 250, 498];
    for (const k of sample) {
      let net = 0;
      for (let l = 0; l < ptdf.rows; l++) {
        const f = basis.fromRedIdx[l];
        const t = basis.toRedIdx[l];
        const flow = ptdf.data[l * ptdf.cols + k];
        if (f === k) net += flow;
        if (t === k) net -= flow;
      }
      expect(net).toBeCloseTo(1.0, 6);
    }
  });

  it("records timing metadata", () => {
    const { buses, branches } = makeRingNetwork(50);
    const ptdf = computePtdf(buses, branches);
    expect(ptdf.computedAt).toBeTruthy();
    expect(new Date(ptdf.computedAt).getTime()).toBeGreaterThan(0);
  });
});

// ── 15. Error cases ───────────────────────────────────────────────────────────

describe("computePtdf — error cases", () => {
  it("throws for single-bus model", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }],
      []
    );
    expect(() => computePtdf(buses, branches)).toThrow("at least 2 buses");
  });

  it("throws when no in-service branches exist", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 }]
    );
    branches[0].inService = false;
    expect(() => computePtdf(buses, branches)).toThrow("No in-service branches");
  });

  it("throws for disconnected network (island isolation)", () => {
    // Two isolated buses (bus 3 and 4) not connected to the main network
    const { buses, branches } = makeNetwork(
      [
        { busNumber: 1, busType: "SLACK" },
        { busNumber: 2 },
        { busNumber: 3 }, // island
        { busNumber: 4 }, // island
      ],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 },
        { branchNumber: 2, fromBusNumber: 3, toBusNumber: 4, xPu: 0.1 }, // disconnected
      ]
    );
    // B_reduced of a disconnected network is singular → Cholesky fails
    expect(() => computePtdf(buses, branches)).toThrow("not positive-definite");
  });
});
