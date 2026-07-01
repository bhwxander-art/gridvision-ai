/**
 * INFRA-011 — DC power flow engine tests
 *
 * Test plan:
 *  1. computeDcPowerFlow — 2-bus and 3-bus loop hand-derived analytic reference
 *  2. Cross-validation vs PTDF — superposition: F = Σ_k Φ[:,k]·P_k
 *  3. Arbitrary slack bus selection — flows are slack-invariant, angle
 *     differences are slack-invariant
 *  4. Power balance — generation/load/slack bookkeeping, KCL residual
 *  5. Input validation — slack bus in injections, unknown bus, non-finite value
 *  6. computeDcPowerFlowBatch — factor reuse produces identical results to
 *     individual computeDcPowerFlow calls
 *  7. applyLodfContingency — integration with the LODF engine
 *  8. dcBusAngleLookup / dcBranchFlowLookup
 *  9. computeDcPowerFlowForModel(Batch) pipeline — repository integration,
 *     tenant scoping, baseMva default, topology-staleness guard
 * 10. API route — request validation
 * 11. Error cases — single-bus model, no branches, disconnected network
 * 12. Performance benchmarks
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import * as dcpfPipeline from "@/lib/dcpf/dcpf-pipeline";
import { computePtdf, ptdfLookup } from "@/lib/ptdf/ptdf-engine";
import { computeLodf } from "@/lib/lodf/lodf-engine";
import {
  computeDcPowerFlow,
  computeDcPowerFlowBatch,
  dcBusAngleLookup,
  dcBranchFlowLookup,
  applyLodfContingency,
} from "@/lib/dcpf/dcpf-engine";
import {
  computeDcPowerFlowForModel,
  computeDcPowerFlowForModelBatch,
} from "@/lib/dcpf/dcpf-pipeline";
import type { DcPowerFlowResult } from "@/lib/dcpf/types";
import { contingencyImpact } from "@/lib/lodf/lodf-engine";

// ── Test fixture helpers (mirrors tests/ptdf-engine.test.ts / lodf-engine.test.ts) ──

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

const THREE_BUS_BUSES: SimpleBus[] = [
  { busNumber: 1, busType: "SLACK" },
  { busNumber: 2 },
  { busNumber: 3 },
];
const THREE_BUS_BRANCHES: SimpleBranch[] = [
  { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 1.0 },
  { branchNumber: 2, fromBusNumber: 1, toBusNumber: 3, xPu: 1.0 },
  { branchNumber: 3, fromBusNumber: 2, toBusNumber: 3, xPu: 1.0 },
];

// ── 1. Hand-derived analytic reference ────────────────────────────────────────

describe("computeDcPowerFlow — 2-bus analytic reference", () => {
  it("bus2 generates 50 MW; all of it flows back toward the slack", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 }]
    );
    const result = computeDcPowerFlow(buses, branches, { 2: 50 }, { baseMva: 100 });

    expect(dcBranchFlowLookup(result, 1)).toBeCloseTo(-50, 9);
    expect(dcBusAngleLookup(result, 2)).toBeCloseTo((0.05 * 180) / Math.PI, 9); // theta = Ppu/b = 0.5/10=0.05 rad
    expect(result.powerBalance.slackInjectionMw).toBeCloseTo(-50, 9);
    expect(result.powerBalance.totalGenerationMw).toBeCloseTo(50, 9);
    expect(result.powerBalance.totalLoadMw).toBeCloseTo(50, 9); // slack absorbs it as a 50 MW load
    expect(result.powerBalance.balanced).toBe(true);
  });
});

describe("computeDcPowerFlow — 3-bus symmetric loop analytic reference", () => {
  /**
   * B_reduced = [[2,-1],[-1,2]], inverse = (1/3)[[2,1],[1,2]]
   * P2=60MW, P3=30MW (baseMva=100 -> Ppu2=0.6, Ppu3=0.3)
   *   theta2 = (2*0.6+0.3)/3 = 0.5 rad
   *   theta3 = (0.6+2*0.3)/3 = 0.4 rad
   *   F(br1,1->2) = -theta2 = -0.5 pu = -50 MW
   *   F(br2,1->3) = -theta3 = -0.4 pu = -40 MW
   *   F(br3,2->3) = theta2-theta3 = 0.1 pu = 10 MW
   */
  function build(): DcPowerFlowResult {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    return computeDcPowerFlow(buses, branches, { 2: 60, 3: 30 }, { baseMva: 100 });
  }

  it("matches hand-derived angles", () => {
    const r = build();
    expect(dcBusAngleLookup(r, 2)).toBeCloseTo((0.5 * 180) / Math.PI, 9);
    expect(dcBusAngleLookup(r, 3)).toBeCloseTo((0.4 * 180) / Math.PI, 9);
    expect(dcBusAngleLookup(r, 1)).toBe(0); // slack reference
  });

  it("matches hand-derived branch flows", () => {
    const r = build();
    expect(dcBranchFlowLookup(r, 1)).toBeCloseTo(-50, 9);
    expect(dcBranchFlowLookup(r, 2)).toBeCloseTo(-40, 9);
    expect(dcBranchFlowLookup(r, 3)).toBeCloseTo(10, 9);
  });

  it("slack absorbs the full 90 MW net injection", () => {
    const r = build();
    expect(r.powerBalance.slackInjectionMw).toBeCloseTo(-90, 9);
    expect(r.powerBalance.balanced).toBe(true);
    expect(r.powerBalance.maxMismatchMw).toBeLessThan(1e-6);
  });
});

// ── 2. Cross-validation vs PTDF (superposition principle) ────────────────────

describe("computeDcPowerFlow — cross-validation vs PTDF superposition", () => {
  it("3-bus loop: F = Σ Φ[:,k]·P_k for every branch", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    const ptdf = computePtdf(buses, branches);
    const injections = { 2: 60, 3: 30 };
    const dcpf = computeDcPowerFlow(buses, branches, injections, { baseMva: 100 });

    for (const bn of [1, 2, 3]) {
      const predicted =
        ptdfLookup(ptdf, bn, 2) * injections[2] + ptdfLookup(ptdf, bn, 3) * injections[3];
      expect(dcBranchFlowLookup(dcpf, bn)).toBeCloseTo(predicted, 7);
    }
  });

  it("IEEE14: F = Σ Φ[:,k]·P_k for a multi-bus injection pattern", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const ptdf = computePtdf(buses, branches);
    const injections: Record<number, number> = { 3: 40, 9: -25, 13: 15, 14: -30 };
    const dcpf = computeDcPowerFlow(buses, branches, injections, { baseMva: 100 });

    for (const bn of ptdf.branchNumbers) {
      let predicted = 0;
      for (const [busStr, mw] of Object.entries(injections)) {
        predicted += ptdfLookup(ptdf, bn, Number(busStr)) * mw;
      }
      expect(dcBranchFlowLookup(dcpf, bn)).toBeCloseTo(predicted, 6);
    }
  });
});

// ── 3. Arbitrary slack bus selection ──────────────────────────────────────────

describe("computeDcPowerFlow — slack bus invariance", () => {
  it("branch flows are identical regardless of slack bus choice", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    // Injections avoid both candidate slack buses (1 and 6)
    const injections = { 9: 40, 10: -15, 11: -25 };

    const resultSlack1 = computeDcPowerFlow(buses, branches, injections, {
      slackBusNumber: 1,
      baseMva: 100,
    });
    const resultSlack6 = computeDcPowerFlow(buses, branches, injections, {
      slackBusNumber: 6,
      baseMva: 100,
    });

    for (const bn of resultSlack1.branchFlows.map((f) => f.branchNumber)) {
      expect(dcBranchFlowLookup(resultSlack1, bn)).toBeCloseTo(
        dcBranchFlowLookup(resultSlack6, bn),
        6
      );
    }
  });

  it("angle differences between common non-slack buses are slack-invariant", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const injections = { 9: 40, 10: -15, 11: -25 };

    const r1 = computeDcPowerFlow(buses, branches, injections, { slackBusNumber: 1 });
    const r6 = computeDcPowerFlow(buses, branches, injections, { slackBusNumber: 6 });

    // Bus 9 and bus 10 angle difference should match under either reference
    const diff1 = dcBusAngleLookup(r1, 9) - dcBusAngleLookup(r1, 10);
    const diff6 = dcBusAngleLookup(r6, 9) - dcBusAngleLookup(r6, 10);
    expect(diff1).toBeCloseTo(diff6, 6);
  });

  it("uses busType=SLACK automatically when no override given", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 5, busType: "SLACK" }, { busNumber: 10 }],
      [{ branchNumber: 1, fromBusNumber: 5, toBusNumber: 10, xPu: 0.1 }]
    );
    const result = computeDcPowerFlow(buses, branches, { 10: 20 });
    expect(result.slackBusNumber).toBe(5);
  });
});

// ── 4. Power balance / physical invariants ────────────────────────────────────

describe("computeDcPowerFlow — power balance & physical invariants", () => {
  it("generation minus load exactly balances to zero (lossless DC model)", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const r = computeDcPowerFlow(buses, branches, { 3: 40, 9: -25, 13: 15, 14: -30 });
    expect(r.powerBalance.totalGenerationMw - r.powerBalance.totalLoadMw).toBeCloseTo(0, 6);
  });

  it("recomputing flows from reported angles + raw branch reactances matches reported flows", () => {
    // Independent re-derivation using ONLY public output fields (busAngles) and
    // the network's own branch reactances — not the engine's internal state.
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const r = computeDcPowerFlow(buses, branches, { 3: 40, 9: -25, 13: 15, 14: -30 });

    const thetaByBus = new Map(r.busAngles.map((a) => [a.busNumber, (a.thetaDeg * Math.PI) / 180]));
    const busIdToNum = new Map(buses.map((b) => [b.id, b.busNumber]));

    for (const br of branches) {
      const fromNum = busIdToNum.get(br.fromBusId)!;
      const toNum = busIdToNum.get(br.toBusId)!;
      const thetaFrom = thetaByBus.get(fromNum)!;
      const thetaTo = thetaByBus.get(toNum)!;
      const expectedPu = (1 / br.xPu) * (thetaFrom - thetaTo);
      const expectedMw = expectedPu * r.baseMva;
      expect(dcBranchFlowLookup(r, br.branchNumber)).toBeCloseTo(expectedMw, 6);
    }
  });

  it("default baseMva is 100 when not specified", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    const r = computeDcPowerFlow(buses, branches, { 2: 10, 3: 5 });
    expect(r.baseMva).toBe(100);
  });
});

// ── 5. Input validation ───────────────────────────────────────────────────────

describe("computeDcPowerFlow — input validation", () => {
  it("throws when injections includes the slack bus", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    expect(() => computeDcPowerFlow(buses, branches, { 1: 10, 2: 5 })).toThrow(
      "must not include the slack bus"
    );
  });

  it("throws for an unknown bus number", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    expect(() => computeDcPowerFlow(buses, branches, { 999: 10 })).toThrow(
      "unknown bus number 999"
    );
  });

  it("throws for a non-finite injection value", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    expect(() => computeDcPowerFlow(buses, branches, { 2: NaN })).toThrow("finite number");
  });

  it("throws for non-positive baseMva", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    expect(() => computeDcPowerFlow(buses, branches, { 2: 10 }, { baseMva: 0 })).toThrow(
      "baseMva must be positive"
    );
  });

  it("throws for a negative mismatchToleranceMw", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    expect(() =>
      computeDcPowerFlow(buses, branches, { 2: 10 }, { mismatchToleranceMw: -1e-6 })
    ).toThrow("mismatchToleranceMw must be non-negative");
  });

  it("accepts mismatchToleranceMw of exactly zero (no validation false-positive)", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    // A zero tolerance is a valid (if strict) request — only negative values are rejected.
    expect(() =>
      computeDcPowerFlow(buses, branches, {}, { mismatchToleranceMw: 0 })
    ).not.toThrow();
  });

  it("buses with no supplied injection default to zero net injection", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const r = computeDcPowerFlow(buses, branches, { 3: 10 });
    expect(r.busAngles.length).toBe(14);
    expect(r.branchFlows.length).toBe(20);
  });
});

// ── 6. Batch solve — factor reuse ─────────────────────────────────────────────

describe("computeDcPowerFlowBatch", () => {
  it("returns [] for an empty scenario list without touching the network", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    expect(computeDcPowerFlowBatch(buses, branches, [])).toEqual([]);
  });

  it("produces identical results to individual computeDcPowerFlow calls", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const scenarios: Record<number, number>[] = [
      { 3: 40, 9: -25 },
      { 4: 20, 7: -10, 13: -10 },
      { 2: 0 }, // degenerate all-zero scenario
    ];

    const batch = computeDcPowerFlowBatch(buses, branches, scenarios, { baseMva: 100 });
    expect(batch.length).toBe(3);

    for (let i = 0; i < scenarios.length; i++) {
      const individual = computeDcPowerFlow(buses, branches, scenarios[i], { baseMva: 100 });
      for (const bn of individual.branchFlows.map((f) => f.branchNumber)) {
        expect(dcBranchFlowLookup(batch[i], bn)).toBeCloseTo(dcBranchFlowLookup(individual, bn), 9);
      }
    }
  });

  it("an all-zero injection scenario yields all-zero flows and angles", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const r = computeDcPowerFlow(buses, branches, {});
    for (const a of r.busAngles) expect(a.thetaRad).toBeCloseTo(0, 12);
    for (const f of r.branchFlows) expect(f.flowMw).toBeCloseTo(0, 9);
    expect(r.powerBalance.slackInjectionMw).toBeCloseTo(0, 9);
  });
});

// ── 7. LODF contingency integration ───────────────────────────────────────────

describe("applyLodfContingency", () => {
  it("matches a direct contingencyImpact() call using the same base flows", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);
    const flow = computeDcPowerFlow(buses, branches, { 2: 60, 3: 30 });

    const viaEngine = applyLodfContingency(flow, lodf, 1);

    const baseFlowsMw = new Map(flow.branchFlows.map((f) => [f.branchNumber, f.flowMw]));
    const direct = contingencyImpact(lodf, baseFlowsMw, 1);

    expect(viaEngine).toEqual(direct);
  });

  it("reports islanding for a bridge-branch outage", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }, { busNumber: 3 }],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 },
        { branchNumber: 2, fromBusNumber: 2, toBusNumber: 3, xPu: 0.1 },
      ]
    );
    const ptdf = computePtdf(buses, branches);
    const lodf = computeLodf(buses, branches, ptdf);
    const flow = computeDcPowerFlow(buses, branches, { 3: 10 });

    const result = applyLodfContingency(flow, lodf, 1);
    expect(result.isIslanding).toBe(true);
  });
});

// ── 8. Lookups ─────────────────────────────────────────────────────────────────

describe("dcBusAngleLookup / dcBranchFlowLookup", () => {
  it("return NaN for unknown bus/branch numbers", () => {
    const { buses, branches } = makeNetwork(THREE_BUS_BUSES, THREE_BUS_BRANCHES);
    const r = computeDcPowerFlow(buses, branches, { 2: 10, 3: 5 });
    expect(Number.isNaN(dcBusAngleLookup(r, 999))).toBe(true);
    expect(Number.isNaN(dcBranchFlowLookup(r, 999))).toBe(true);
  });
});

// ── 9. Pipeline — repository integration ──────────────────────────────────────

describe("computeDcPowerFlowForModel(Batch) — pipeline", () => {
  function makeMockRepo(baseMva = 100, topologyHash: string | null = "abc123") {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    let listBusesCallCount = 0;

    const repo = {
      getModel: async (_tid: string, _mid: string) => ({
        id: "model-1",
        tenantId: "tenant-1",
        ptdfValid: false,
        lodfValid: false,
        topologyHash,
        iso: "PJM" as const,
        name: "Test Model",
        version: "1.0",
        baseMva,
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
    };

    return {
      repo: repo as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository,
      getListBusesCallCount: () => listBusesCallCount,
    };
  }

  it("solves using the model's base_mva when not overridden", async () => {
    const { repo } = makeMockRepo(50);
    const { flow } = await computeDcPowerFlowForModel("tenant-1", "model-1", repo, { 3: 10 });
    expect(flow.baseMva).toBe(50);
  });

  it("caller-supplied baseMva overrides the model default", async () => {
    const { repo } = makeMockRepo(50);
    const { flow } = await computeDcPowerFlowForModel("tenant-1", "model-1", repo, { 3: 10 }, { baseMva: 100 });
    expect(flow.baseMva).toBe(100);
  });

  it("propagates the baseMva validation error through the pipeline (H1)", async () => {
    const { repo } = makeMockRepo(50);
    await expect(
      computeDcPowerFlowForModel("tenant-1", "model-1", repo, { 3: 10 }, { baseMva: -1 })
    ).rejects.toThrow("baseMva must be positive");
  });

  it("propagates the mismatchToleranceMw validation error through the pipeline (H2)", async () => {
    const { repo } = makeMockRepo(50);
    await expect(
      computeDcPowerFlowForModel("tenant-1", "model-1", repo, { 3: 10 }, { mismatchToleranceMw: -1e-6 })
    ).rejects.toThrow("mismatchToleranceMw must be non-negative");
  });

  it("throws when model not found (tenant isolation boundary)", async () => {
    const repo = {
      getModel: async () => null,
    } as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository;

    await expect(
      computeDcPowerFlowForModel("tenant-1", "nonexistent", repo, { 3: 10 })
    ).rejects.toThrow("not found");
  });

  it("throws when expectedTopologyHash no longer matches (staleness guard)", async () => {
    const { repo } = makeMockRepo(100, "current-hash");
    await expect(
      computeDcPowerFlowForModel("tenant-1", "model-1", repo, { 3: 10 }, {
        expectedTopologyHash: "stale-hash",
      })
    ).rejects.toThrow("Topology has changed");
  });

  it("passes when expectedTopologyHash matches", async () => {
    const { repo } = makeMockRepo(100, "current-hash");
    const { flow } = await computeDcPowerFlowForModel("tenant-1", "model-1", repo, { 3: 10 }, {
      expectedTopologyHash: "current-hash",
    });
    expect(flow.topologyHash).toBe("current-hash");
  });

  it("batch pipeline solves multiple scenarios with a single topology load", async () => {
    const { repo, getListBusesCallCount } = makeMockRepo(100);
    const { flows } = await computeDcPowerFlowForModelBatch("tenant-1", "model-1", repo, [
      { 3: 10 },
      { 9: -20 },
    ]);
    expect(flows.length).toBe(2);
    expect(getListBusesCallCount()).toBe(1); // one topology load, two solves
  });

  it("batch pipeline returns [] without loading topology for an empty scenario list", async () => {
    const { repo, getListBusesCallCount } = makeMockRepo(100);
    const { flows } = await computeDcPowerFlowForModelBatch("tenant-1", "model-1", repo, []);
    expect(flows).toEqual([]);
    expect(getListBusesCallCount()).toBe(0);
  });
});

// ── 10. API route — request validation ────────────────────────────────────────

describe("POST /api/network/[modelId]/dcpf — request validation", () => {
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
    const { POST } = await import("@/app/api/network/[modelId]/dcpf/route");
    const request = new Request(`http://localhost/api/network/model-1/dcpf${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    return POST(request, { params: Promise.resolve({ modelId: "model-1" }) });
  }

  it("400s when tenant_id is missing", async () => {
    const res = await callRoute("", { injections: { 2: 10 } });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/tenant_id/);
  });

  it("400s when the request body is not valid JSON", async () => {
    const res = await callRoute("?tenant_id=t1", undefined, "{not json");
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/valid JSON/);
  });

  it("400s when 'injections' is missing from the body", async () => {
    const res = await callRoute("?tenant_id=t1", { slackBusNumber: 1 });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/injections/);
  });

  it("400s when 'injections' is an array rather than an object", async () => {
    const res = await callRoute("?tenant_id=t1", { injections: [1, 2, 3] });
    expect(res.status).toBe(400);
  });

  it("400s when outage_branch is not a valid integer", async () => {
    const res = await callRoute("?tenant_id=t1&outage_branch=abc", { injections: { 2: 10 } });
    expect(res.status).toBe(400);
  });

  it("400s (not 500) when the pipeline rejects with an invalid-baseMva error (H1)", async () => {
    const spy = vi
      .spyOn(dcpfPipeline, "computeDcPowerFlowForModel")
      .mockRejectedValueOnce(new Error("[DCPF] baseMva must be positive"));
    try {
      const res = await callRoute("?tenant_id=t1", { injections: { 2: 10 }, baseMva: -1 });
      expect(res.status).toBe(400);
      const b = await res.json();
      expect(b.error).toMatch(/baseMva must be positive/);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s (not 500) when the pipeline rejects with a negative mismatchToleranceMw error (H2)", async () => {
    const spy = vi
      .spyOn(dcpfPipeline, "computeDcPowerFlowForModel")
      .mockRejectedValueOnce(new Error("[DCPF] mismatchToleranceMw must be non-negative"));
    try {
      const res = await callRoute("?tenant_id=t1", { injections: { 2: 10 }, mismatchToleranceMw: -1e-6 });
      expect(res.status).toBe(400);
      const b = await res.json();
      expect(b.error).toMatch(/mismatchToleranceMw must be non-negative/);
    } finally {
      spy.mockRestore();
    }
  });

  it("existing 'not found' mapping to 404 still works (unaffected by H1/H2 changes)", async () => {
    const spy = vi
      .spyOn(dcpfPipeline, "computeDcPowerFlowForModel")
      .mockRejectedValueOnce(new Error("[DCPF] Model model-1 not found for tenant t1"));
    try {
      const res = await callRoute("?tenant_id=t1", { injections: { 2: 10 } });
      expect(res.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("existing 'Topology has changed' mapping to 409 still works (unaffected by H1/H2 changes)", async () => {
    const spy = vi
      .spyOn(dcpfPipeline, "computeDcPowerFlowForModel")
      .mockRejectedValueOnce(new Error("[DCPF] Topology has changed since injections were prepared"));
    try {
      const res = await callRoute("?tenant_id=t1", { injections: { 2: 10 } });
      expect(res.status).toBe(409);
    } finally {
      spy.mockRestore();
    }
  });

  it("existing '[DCPF] injection' mapping to 400 still works (unaffected by H1/H2 changes)", async () => {
    const spy = vi
      .spyOn(dcpfPipeline, "computeDcPowerFlowForModel")
      .mockRejectedValueOnce(new Error("[DCPF] injection specified for unknown bus number 999"));
    try {
      const res = await callRoute("?tenant_id=t1", { injections: { 2: 10 } });
      expect(res.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
  });

  it("500s with a clear message when Supabase credentials are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callRoute("?tenant_id=t1", { injections: { 2: 10 } });
    expect(res.status).toBe(500);
    const b = await res.json();
    expect(b.error).toMatch(/Supabase/);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  });
});

// ── 11. Error cases ────────────────────────────────────────────────────────────

describe("computeDcPowerFlow — error cases", () => {
  it("throws for single-bus model", () => {
    const { buses, branches } = makeNetwork([{ busNumber: 1, busType: "SLACK" }], []);
    expect(() => computeDcPowerFlow(buses, branches, {})).toThrow("at least 2 buses");
  });

  it("throws when no in-service branches exist", () => {
    const { buses, branches } = makeNetwork(
      [{ busNumber: 1, busType: "SLACK" }, { busNumber: 2 }],
      [{ branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 }]
    );
    branches[0].inService = false;
    expect(() => computeDcPowerFlow(buses, branches, {})).toThrow("No in-service branches");
  });

  it("throws for a disconnected network (island isolation)", () => {
    const { buses, branches } = makeNetwork(
      [
        { busNumber: 1, busType: "SLACK" },
        { busNumber: 2 },
        { busNumber: 3 },
        { busNumber: 4 },
      ],
      [
        { branchNumber: 1, fromBusNumber: 1, toBusNumber: 2, xPu: 0.1 },
        { branchNumber: 2, fromBusNumber: 3, toBusNumber: 4, xPu: 0.1 },
      ]
    );
    expect(() => computeDcPowerFlow(buses, branches, {})).toThrow("not positive-definite");
  });
});

// ── 12. Performance benchmarks ─────────────────────────────────────────────────

describe("computeDcPowerFlow — performance", () => {
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

  it("IEEE14 single solve completes in < 5 ms", () => {
    const { buses, branches } = makeNetwork(IEEE14_BUSES, IEEE14_BRANCHES);
    const t0 = performance.now();
    computeDcPowerFlow(buses, branches, { 3: 40, 9: -25 });
    expect(performance.now() - t0).toBeLessThan(5);
  });

  it("500-bus ring single solve completes in < 300 ms", () => {
    const { buses: sb, branches: br } = makeRingNetwork(500);
    const { buses, branches } = makeNetwork(sb, br);
    const injections: Record<number, number> = { 250: 100, 400: -60 };
    const t0 = performance.now();
    const r = computeDcPowerFlow(buses, branches, injections);
    const elapsed = performance.now() - t0;
    expect(r.branchFlows.length).toBe(500);
    expect(elapsed).toBeLessThan(300);
  });

  it("1000-bus ring single solve completes in < 2 s", { timeout: 10_000 }, () => {
    const { buses: sb, branches: br } = makeRingNetwork(1000);
    const { buses, branches } = makeNetwork(sb, br);
    const injections: Record<number, number> = { 500: 100, 800: -60 };
    const t0 = performance.now();
    const r = computeDcPowerFlow(buses, branches, injections);
    const elapsed = performance.now() - t0;
    expect(r.branchFlows.length).toBe(1000);
    expect(elapsed).toBeLessThan(2000);
  });

  it("batch of 20 scenarios on a 500-bus ring reuses the factorisation efficiently", () => {
    const { buses: sb, branches: br } = makeRingNetwork(500);
    const { buses, branches } = makeNetwork(sb, br);
    const scenarios: Record<number, number>[] = Array.from({ length: 20 }, (_, i) => ({
      [100 + i]: 50,
      [300 + i]: -50,
    }));
    const t0 = performance.now();
    const results = computeDcPowerFlowBatch(buses, branches, scenarios);
    const elapsed = performance.now() - t0;
    expect(results.length).toBe(20);
    expect(elapsed).toBeLessThan(1000);
  });
});
