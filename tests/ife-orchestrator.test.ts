/**
 * INFRA-014 — Full IFE Analysis Orchestrator tests
 *
 * Test plan:
 *  1. Orchestration logic (mocked HC/UA pipeline modules via vi.spyOn):
 *     sufficient-capacity path (UA never called), insufficient-capacity path
 *     (UA called with the correct analysisId), HC failure (UA never called,
 *     stage-tagged error), UA failure (stage-tagged error), null-hostingCapacity
 *     defensive guard
 *  2. H1 idempotency fast path (mocked IfeRepository only, real orchestrator
 *     logic): sufficient-already short-circuit, upgrade-already-exists
 *     short-circuit, fall-through cases (insufficient+no-upgrade-yet, no
 *     matching analysis, no idempotencyKey) — in every fast-path case, the
 *     underlying HC/UA pipeline functions must never be invoked
 *  3. H2 split compute timing shape and values
 *  4. Real end-to-end pipeline integration (mocked repos, real HC/UA/engine
 *     code) for both "no upgrade needed" and "upgrade needed" networks
 *  5. API route — request validation and status-code mapping
 *  6. Performance
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import type { IfeAnalysis, IfeHostingCapacity, IfeUpgradeResults } from "@/lib/db/types-ife";
import * as hcPipelineModule from "@/lib/hosting-capacity/hosting-capacity-pipeline";
import * as uaPipelineModule from "@/lib/upgrade-analysis/upgrade-analysis-pipeline";
import { orchestrateIfeAnalysis } from "@/lib/ife-orchestrator/ife-orchestrator-pipeline";
import { IfeOrchestrationStageError, type IfeOrchestrationRequest } from "@/lib/ife-orchestrator/types";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { BaseCaseViolationError } from "@/lib/hosting-capacity/types";
import { UpgradeAnalysisInfeasibleError } from "@/lib/upgrade-analysis/types";

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
  rateAMw?: number;
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

function makeRequest(overrides: Partial<IfeOrchestrationRequest> = {}): IfeOrchestrationRequest {
  return {
    networkModelId: "model-1",
    poiBusNumber: 2,
    isoId: "PJM",
    capacityMw: 10,
    projectType: "solar",
    baseCaseInjectionsMw: {},
    ...overrides,
  };
}

// ── Stateful mock repos (shared by orchestration-logic and fast-path tests) ──

function makeMockNetworkRepo(topologyHash: string | null = "hash-abc", ratingMw = 20) {
  const { buses, branches } = makeNetwork(THREE_BUS_BUSES, threeBusLoop(ratingMw));
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

/** Full stateful IfeRepository mock covering every method both HC and UA pipelines call. */
function makeStatefulIfeRepo() {
  const analyses = new Map<string, IfeAnalysis>();
  const hostingCapacities = new Map<string, IfeHostingCapacity>();
  const upgradeResults = new Map<string, IfeUpgradeResults>();
  let counter = 0;

  const repo = {
    createAnalysis: vi.fn(async (insert: Record<string, unknown>) => {
      const id = `analysis-${++counter}`;
      const row: IfeAnalysis = {
        id,
        tenantId: insert.tenant_id as string,
        networkModelId: insert.network_model_id as string,
        poiBusId: insert.poi_bus_id as string,
        isoId: insert.iso_id as string,
        capacityMw: insert.capacity_mw as number,
        projectType: insert.project_type as never,
        targetCod: (insert.target_cod as string | null) ?? null,
        inputSnapshot: insert.input_snapshot as Record<string, unknown>,
        status: "pending",
        progressPct: 0,
        errorMessage: null,
        queuedAt: "2024-01-01T00:00:00Z",
        startedAt: null,
        completedAt: null,
        idempotencyKey: (insert.idempotency_key as string | null) ?? null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };
      analyses.set(id, row);
      return row;
    }),
    getAnalysis: vi.fn(async (_t: string, id: string) => analyses.get(id) ?? null),
    getAnalysisByIdempotencyKey: vi.fn(async (_t: string, key: string) => {
      for (const a of analyses.values()) if (a.idempotencyKey === key) return a;
      return null;
    }),
    updateAnalysisStatus: vi.fn(async (_t: string, id: string, status: string, opts?: { errorMessage?: string | null }) => {
      const row = analyses.get(id)!;
      const updated = { ...row, status: status as never, errorMessage: opts?.errorMessage ?? row.errorMessage };
      analyses.set(id, updated);
      return updated;
    }),
    createHostingCapacity: vi.fn(async (insert: Record<string, unknown>) => {
      const row: IfeHostingCapacity = {
        id: `hc-${++counter}`,
        analysisId: insert.analysis_id as string,
        tenantId: insert.tenant_id as string,
        hcDeterministicMw: insert.hc_deterministic_mw as number,
        bindingLineId: (insert.binding_line_id as string | null) ?? null,
        bindingContingencyId: (insert.binding_contingency_id as string | null) ?? null,
        hcP10Mw: null,
        hcP50Mw: null,
        hcP90Mw: null,
        mcScenariosRun: null,
        mcConvergencePct: null,
        violationProbability: null,
        vminHeadroomPu: null,
        vmaxHeadroomPu: null,
        computedAt: "2024-01-01T00:00:00Z",
      };
      hostingCapacities.set(insert.analysis_id as string, row);
      return row;
    }),
    getHostingCapacityByAnalysisId: vi.fn(async (_t: string, analysisId: string) =>
      hostingCapacities.get(analysisId) ?? null
    ),
    createUpgradeResults: vi.fn(async (insert: Record<string, unknown>) => {
      const row: IfeUpgradeResults = {
        id: `ur-${++counter}`,
        analysisId: insert.analysis_id as string,
        tenantId: insert.tenant_id as string,
        costP10M: null,
        costP50M: null,
        costP90M: null,
        projectShareP50M: null,
        upgradesRequired: insert.upgrades_required as number,
        milpOptimalityGapPct: null,
        milpSolveSeconds: null,
        upgradeDetails: insert.upgrade_details as never,
        computedAt: "2024-01-01T00:00:00Z",
      };
      upgradeResults.set(insert.analysis_id as string, row);
      return row;
    }),
    getUpgradeResultsByAnalysisId: vi.fn(async (_t: string, analysisId: string) =>
      upgradeResults.get(analysisId) ?? null
    ),
  };

  return {
    repo: repo as unknown as IfeRepository,
    analyses,
    hostingCapacities,
    upgradeResults,
  };
}

// ── 1. Orchestration logic (mocked HC/UA pipelines) ───────────────────────────

describe("orchestrateIfeAnalysis — orchestration logic", () => {
  const dummyStorages = () => ({ ptdfStorage: {} as never, lodfStorage: {} as never });

  it("sufficient capacity: upgrade analysis pipeline is never called", async () => {
    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity").mockResolvedValueOnce({
      analysis: { id: "analysis-1", capacityMw: 10, status: "completed" } as never,
      hostingCapacity: { hcDeterministicMw: 50 } as never,
      computeMs: 5,
    });
    const uaSpy = vi.spyOn(uaPipelineModule, "computeAndPersistUpgradeAnalysis");
    const { repo } = makeMockNetworkRepo();
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const { ptdfStorage, lodfStorage } = dummyStorages();

    try {
      const result = await orchestrateIfeAnalysis(
        "tenant-1", makeRequest(), repo, ifeRepo, ptdfStorage, lodfStorage
      );
      expect(result.overallStatus).toBe("completed_no_upgrade_needed");
      expect(result.upgradeResults).toBeNull();
      expect(uaSpy).not.toHaveBeenCalled();
      expect(result.computeMs.upgradeAnalysisMs).toBe(0);
      expect(result.computeMs.totalMs).toBeGreaterThanOrEqual(result.computeMs.hostingCapacityMs);
    } finally {
      hcSpy.mockRestore();
      uaSpy.mockRestore();
    }
  });

  it("insufficient capacity: upgrade analysis pipeline is called with the analysis id from stage 1", async () => {
    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity").mockResolvedValueOnce({
      analysis: { id: "analysis-42", capacityMw: 100, status: "completed" } as never,
      hostingCapacity: { hcDeterministicMw: 30 } as never,
      computeMs: 5,
    });
    const uaSpy = vi.spyOn(uaPipelineModule, "computeAndPersistUpgradeAnalysis").mockResolvedValueOnce({
      analysis: { id: "analysis-42", status: "completed" } as never,
      upgradeResults: { upgradesRequired: 2 } as never,
      computeMs: 8,
    });
    const { repo } = makeMockNetworkRepo();
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const { ptdfStorage, lodfStorage } = dummyStorages();

    try {
      const result = await orchestrateIfeAnalysis(
        "tenant-1", makeRequest({ capacityMw: 100 }), repo, ifeRepo, ptdfStorage, lodfStorage
      );
      expect(result.overallStatus).toBe("completed_with_upgrades");
      expect(result.upgradeResults).toEqual({ upgradesRequired: 2 });
      expect(uaSpy).toHaveBeenCalledWith(
        "tenant-1", "analysis-42", repo, ifeRepo, ptdfStorage, lodfStorage, undefined
      );
      expect(result.computeMs.hostingCapacityMs).toBeGreaterThanOrEqual(0);
      expect(result.computeMs.upgradeAnalysisMs).toBeGreaterThanOrEqual(0);
      expect(result.computeMs.totalMs).toBeGreaterThanOrEqual(0);
    } finally {
      hcSpy.mockRestore();
      uaSpy.mockRestore();
    }
  });

  it("hosting capacity failure: upgrade analysis is never called, error is stage-tagged", async () => {
    const originalErr = new BaseCaseViolationError("base case violates", 1, 100, 50);
    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity").mockRejectedValueOnce(originalErr);
    const uaSpy = vi.spyOn(uaPipelineModule, "computeAndPersistUpgradeAnalysis");
    const { repo } = makeMockNetworkRepo();
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const { ptdfStorage, lodfStorage } = dummyStorages();

    try {
      let caught: unknown;
      try {
        await orchestrateIfeAnalysis("tenant-1", makeRequest(), repo, ifeRepo, ptdfStorage, lodfStorage);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(IfeOrchestrationStageError);
      const stageErr = caught as IfeOrchestrationStageError;
      expect(stageErr.stage).toBe("hosting_capacity");
      expect(stageErr.cause).toBe(originalErr);
      expect(uaSpy).not.toHaveBeenCalled();
    } finally {
      hcSpy.mockRestore();
      uaSpy.mockRestore();
    }
  });

  it("upgrade analysis failure: error is stage-tagged as upgrade_analysis", async () => {
    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity").mockResolvedValueOnce({
      analysis: { id: "analysis-7", capacityMw: 100, status: "completed" } as never,
      hostingCapacity: { hcDeterministicMw: 30 } as never,
      computeMs: 5,
    });
    const originalErr = new UpgradeAnalysisInfeasibleError("could not converge", 5);
    const uaSpy = vi.spyOn(uaPipelineModule, "computeAndPersistUpgradeAnalysis").mockRejectedValueOnce(originalErr);
    const { repo } = makeMockNetworkRepo();
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const { ptdfStorage, lodfStorage } = dummyStorages();

    try {
      let caught: unknown;
      try {
        await orchestrateIfeAnalysis("tenant-1", makeRequest({ capacityMw: 100 }), repo, ifeRepo, ptdfStorage, lodfStorage);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(IfeOrchestrationStageError);
      const stageErr = caught as IfeOrchestrationStageError;
      expect(stageErr.stage).toBe("upgrade_analysis");
      expect(stageErr.cause).toBe(originalErr);
    } finally {
      hcSpy.mockRestore();
      uaSpy.mockRestore();
    }
  });

  it("defensive guard: a null hostingCapacity from HC's own idempotent-failed-retry branch throws a stage-tagged error instead of crashing", async () => {
    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity").mockResolvedValueOnce({
      analysis: { id: "analysis-9", capacityMw: 10, status: "failed" } as never,
      hostingCapacity: null,
      computeMs: 1,
    });
    const uaSpy = vi.spyOn(uaPipelineModule, "computeAndPersistUpgradeAnalysis");
    const { repo } = makeMockNetworkRepo();
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const { ptdfStorage, lodfStorage } = dummyStorages();

    try {
      let caught: unknown;
      try {
        await orchestrateIfeAnalysis("tenant-1", makeRequest(), repo, ifeRepo, ptdfStorage, lodfStorage);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(IfeOrchestrationStageError);
      expect((caught as IfeOrchestrationStageError).stage).toBe("hosting_capacity");
      expect(uaSpy).not.toHaveBeenCalled();
    } finally {
      hcSpy.mockRestore();
      uaSpy.mockRestore();
    }
  });
});

// ── 2. H1 idempotency fast path ────────────────────────────────────────────────

describe("orchestrateIfeAnalysis — H1 idempotency fast path", () => {
  it("sufficient-already: returns immediately without invoking either underlying pipeline", async () => {
    const { repo: ifeRepo, analyses, hostingCapacities } = makeStatefulIfeRepo();
    const analysis = await ifeRepo.createAnalysis({
      tenant_id: "tenant-1", network_model_id: "model-1", poi_bus_id: "poi-1", iso_id: "PJM",
      capacity_mw: 10, project_type: "solar", target_cod: null, input_snapshot: {},
      idempotency_key: "idem-1",
    });
    await ifeRepo.updateAnalysisStatus("tenant-1", analysis.id, "completed");
    analyses.set(analysis.id, { ...analyses.get(analysis.id)!, status: "completed" });
    await ifeRepo.createHostingCapacity({
      analysis_id: analysis.id, tenant_id: "tenant-1", hc_deterministic_mw: 50,
      binding_line_id: null, binding_contingency_id: null,
      hc_p10_mw: null, hc_p50_mw: null, hc_p90_mw: null, mc_scenarios_run: null,
      mc_convergence_pct: null, violation_probability: null,
      vmin_headroom_pu: null, vmax_headroom_pu: null,
    });
    void hostingCapacities;

    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity");
    const uaSpy = vi.spyOn(uaPipelineModule, "computeAndPersistUpgradeAnalysis");
    const { repo } = makeMockNetworkRepo();

    try {
      const result = await orchestrateIfeAnalysis(
        "tenant-1",
        makeRequest({ capacityMw: 10, idempotencyKey: "idem-1" }),
        repo, ifeRepo, {} as never, {} as never
      );
      expect(result.overallStatus).toBe("completed_no_upgrade_needed");
      expect(result.hostingCapacity.hcDeterministicMw).toBe(50);
      expect(result.upgradeResults).toBeNull();
      expect(result.computeMs).toEqual({ hostingCapacityMs: 0, upgradeAnalysisMs: 0, totalMs: expect.any(Number) });
      expect(hcSpy).not.toHaveBeenCalled();
      expect(uaSpy).not.toHaveBeenCalled();
    } finally {
      hcSpy.mockRestore();
      uaSpy.mockRestore();
    }
  });

  it("upgrade-already-exists: returns immediately without invoking either underlying pipeline", async () => {
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const analysis = await ifeRepo.createAnalysis({
      tenant_id: "tenant-1", network_model_id: "model-1", poi_bus_id: "poi-1", iso_id: "PJM",
      capacity_mw: 100, project_type: "solar", target_cod: null, input_snapshot: {},
      idempotency_key: "idem-2",
    });
    await ifeRepo.updateAnalysisStatus("tenant-1", analysis.id, "completed");
    await ifeRepo.createHostingCapacity({
      analysis_id: analysis.id, tenant_id: "tenant-1", hc_deterministic_mw: 30,
      binding_line_id: null, binding_contingency_id: null,
      hc_p10_mw: null, hc_p50_mw: null, hc_p90_mw: null, mc_scenarios_run: null,
      mc_convergence_pct: null, violation_probability: null,
      vmin_headroom_pu: null, vmax_headroom_pu: null,
    });
    await ifeRepo.createUpgradeResults({
      analysis_id: analysis.id, tenant_id: "tenant-1", cost_p10_m: null, cost_p50_m: null,
      cost_p90_m: null, project_share_p50_m: null, upgrades_required: 2,
      milp_optimality_gap_pct: null, milp_solve_seconds: null, upgrade_details: [],
    });

    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity");
    const uaSpy = vi.spyOn(uaPipelineModule, "computeAndPersistUpgradeAnalysis");
    const { repo } = makeMockNetworkRepo();

    try {
      const result = await orchestrateIfeAnalysis(
        "tenant-1",
        makeRequest({ capacityMw: 100, idempotencyKey: "idem-2" }),
        repo, ifeRepo, {} as never, {} as never
      );
      expect(result.overallStatus).toBe("completed_with_upgrades");
      expect(result.upgradeResults?.upgradesRequired).toBe(2);
      expect(hcSpy).not.toHaveBeenCalled();
      expect(uaSpy).not.toHaveBeenCalled();
    } finally {
      hcSpy.mockRestore();
      uaSpy.mockRestore();
    }
  });

  it("falls through to the normal flow when insufficient and no upgrade result exists yet", async () => {
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const analysis = await ifeRepo.createAnalysis({
      tenant_id: "tenant-1", network_model_id: "model-1", poi_bus_id: "poi-1", iso_id: "PJM",
      capacity_mw: 100, project_type: "solar", target_cod: null, input_snapshot: {},
      idempotency_key: "idem-3",
    });
    await ifeRepo.updateAnalysisStatus("tenant-1", analysis.id, "completed");
    await ifeRepo.createHostingCapacity({
      analysis_id: analysis.id, tenant_id: "tenant-1", hc_deterministic_mw: 30,
      binding_line_id: null, binding_contingency_id: null,
      hc_p10_mw: null, hc_p50_mw: null, hc_p90_mw: null, mc_scenarios_run: null,
      mc_convergence_pct: null, violation_probability: null,
      vmin_headroom_pu: null, vmax_headroom_pu: null,
    });
    // No upgrade results yet -- must fall through and actually invoke the HC pipeline.

    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity").mockResolvedValueOnce({
      analysis: { ...analysis, status: "completed" } as never,
      hostingCapacity: { hcDeterministicMw: 30 } as never,
      computeMs: 1,
    });
    const uaSpy = vi.spyOn(uaPipelineModule, "computeAndPersistUpgradeAnalysis").mockResolvedValueOnce({
      analysis: { ...analysis, status: "completed" } as never,
      upgradeResults: { upgradesRequired: 1 } as never,
      computeMs: 1,
    });
    const { repo } = makeMockNetworkRepo();

    try {
      await orchestrateIfeAnalysis(
        "tenant-1",
        makeRequest({ capacityMw: 100, idempotencyKey: "idem-3" }),
        repo, ifeRepo, {} as never, {} as never
      );
      expect(hcSpy).toHaveBeenCalledTimes(1);
      expect(uaSpy).toHaveBeenCalledTimes(1);
    } finally {
      hcSpy.mockRestore();
      uaSpy.mockRestore();
    }
  });

  it("falls through to the normal flow when no analysis matches the idempotencyKey", async () => {
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity").mockResolvedValueOnce({
      analysis: { id: "analysis-x", capacityMw: 10, status: "completed" } as never,
      hostingCapacity: { hcDeterministicMw: 50 } as never,
      computeMs: 1,
    });
    const { repo } = makeMockNetworkRepo();

    try {
      const result = await orchestrateIfeAnalysis(
        "tenant-1",
        makeRequest({ idempotencyKey: "never-seen-before" }),
        repo, ifeRepo, {} as never, {} as never
      );
      expect(hcSpy).toHaveBeenCalledTimes(1);
      expect(result.overallStatus).toBe("completed_no_upgrade_needed");
    } finally {
      hcSpy.mockRestore();
    }
  });

  it("falls through to the normal flow when no idempotencyKey is supplied at all", async () => {
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const hcSpy = vi.spyOn(hcPipelineModule, "computeAndPersistHostingCapacity").mockResolvedValueOnce({
      analysis: { id: "analysis-y", capacityMw: 10, status: "completed" } as never,
      hostingCapacity: { hcDeterministicMw: 50 } as never,
      computeMs: 1,
    });
    const { repo } = makeMockNetworkRepo();

    try {
      await orchestrateIfeAnalysis("tenant-1", makeRequest(), repo, ifeRepo, {} as never, {} as never);
      expect(hcSpy).toHaveBeenCalledTimes(1);
    } finally {
      hcSpy.mockRestore();
    }
  });
});

// ── 4. Real end-to-end pipeline integration (mocked repos, real physics) ──────

describe("orchestrateIfeAnalysis — real end-to-end integration", () => {
  it("no upgrade needed: hosting capacity alone is sufficient", async () => {
    const { repo } = makeMockNetworkRepo("hash-abc", 100); // generous rating -> plenty of headroom
    const { repo: ifeRepo, hostingCapacities, upgradeResults } = makeStatefulIfeRepo();
    const { InMemoryPtdfStorage } = await import("@/lib/ptdf/ptdf-storage");
    const { InMemoryLodfStorage } = await import("@/lib/lodf/lodf-storage");

    const result = await orchestrateIfeAnalysis(
      "tenant-1",
      makeRequest({ capacityMw: 10 }),
      repo, ifeRepo, new InMemoryPtdfStorage(), new InMemoryLodfStorage()
    );

    expect(result.overallStatus).toBe("completed_no_upgrade_needed");
    expect(result.upgradeResults).toBeNull();
    expect(hostingCapacities.size).toBe(1);
    expect(upgradeResults.size).toBe(0);
  });

  it("upgrade needed: hosting capacity alone is insufficient", async () => {
    const { repo } = makeMockNetworkRepo("hash-abc", 5); // tight rating -> forces an upgrade
    const { repo: ifeRepo, hostingCapacities, upgradeResults } = makeStatefulIfeRepo();
    const { InMemoryPtdfStorage } = await import("@/lib/ptdf/ptdf-storage");
    const { InMemoryLodfStorage } = await import("@/lib/lodf/lodf-storage");

    const result = await orchestrateIfeAnalysis(
      "tenant-1",
      makeRequest({ capacityMw: 50 }),
      repo, ifeRepo, new InMemoryPtdfStorage(), new InMemoryLodfStorage()
    );

    expect(result.overallStatus).toBe("completed_with_upgrades");
    expect(result.upgradeResults).not.toBeNull();
    expect(result.upgradeResults!.upgradesRequired).toBeGreaterThan(0);
    expect(hostingCapacities.size).toBe(1);
    expect(upgradeResults.size).toBe(1);
    expect(result.computeMs.hostingCapacityMs).toBeGreaterThanOrEqual(0);
    expect(result.computeMs.upgradeAnalysisMs).toBeGreaterThanOrEqual(0);
    expect(result.computeMs.totalMs).toBeGreaterThanOrEqual(
      result.computeMs.hostingCapacityMs + result.computeMs.upgradeAnalysisMs - 1 // rounding tolerance
    );
  });
});

// ── 5. API route — request validation ─────────────────────────────────────────

describe("POST /api/ife/analyses — request validation", () => {
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
    const { POST } = await import("@/app/api/ife/analyses/route");
    const request = new Request(`http://localhost/api/ife/analyses${query}`, {
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

  it("400s when baseCaseInjectionsMw is an array", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, baseCaseInjectionsMw: [1, 2] });
    expect(res.status).toBe(400);
  });

  it("400s when hostingCapacityOptions.slackBusNumber is not a number", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, hostingCapacityOptions: { slackBusNumber: "x" } });
    expect(res.status).toBe(400);
  });

  it("400s when upgradeAnalysisOptions.maxIterations is 0", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, upgradeAnalysisOptions: { maxIterations: 0 } });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/maxIterations.*greater than 0/);
  });

  it("400s when upgradeAnalysisOptions.maxIterations is -1", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, upgradeAnalysisOptions: { maxIterations: -1 } });
    expect(res.status).toBe(400);
  });

  it("400s when upgradeAnalysisOptions.maxIterations is 1.5 (non-integer)", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, upgradeAnalysisOptions: { maxIterations: 1.5 } });
    expect(res.status).toBe(400);
  });

  it("400s when upgradeAnalysisOptions.ratingMarginMultiplier is 0", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, upgradeAnalysisOptions: { ratingMarginMultiplier: 0 } });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/ratingMarginMultiplier.*greater than 0/);
  });

  it("400s when upgradeAnalysisOptions.ratingMarginMultiplier is negative", async () => {
    const res = await callRoute("?tenant_id=t1", { ...validBody, upgradeAnalysisOptions: { ratingMarginMultiplier: -2 } });
    expect(res.status).toBe(400);
  });

  it("500s with a clear message when Supabase credentials are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callRoute("?tenant_id=t1", validBody);
    expect(res.status).toBe(500);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  });

  it("404s with stage tag when the orchestrator rejects with a stage-tagged 'not found' error", async () => {
    const orchestratorModule = await import("@/lib/ife-orchestrator/ife-orchestrator-pipeline");
    const spy = vi
      .spyOn(orchestratorModule, "orchestrateIfeAnalysis")
      .mockRejectedValueOnce(
        new IfeOrchestrationStageError("hosting_capacity", new Error("[HostingCapacity] Model model-1 not found for tenant t1"))
      );
    try {
      const res = await callRoute("?tenant_id=t1", validBody);
      expect(res.status).toBe(404);
      const b = await res.json();
      expect(b.stage).toBe("hosting_capacity");
    } finally {
      spy.mockRestore();
    }
  });

  it("409s with stage tag when the orchestrator rejects with a stage-tagged topology-changed error", async () => {
    const orchestratorModule = await import("@/lib/ife-orchestrator/ife-orchestrator-pipeline");
    const spy = vi
      .spyOn(orchestratorModule, "orchestrateIfeAnalysis")
      .mockRejectedValueOnce(
        new IfeOrchestrationStageError("upgrade_analysis", new Error("[UpgradeAnalysis] Topology has changed since hosting capacity was computed"))
      );
    try {
      const res = await callRoute("?tenant_id=t1", validBody);
      expect(res.status).toBe(409);
      const b = await res.json();
      expect(b.stage).toBe("upgrade_analysis");
    } finally {
      spy.mockRestore();
    }
  });

  it("400s with branch detail when the orchestrator rejects with a stage-tagged BaseCaseViolationError", async () => {
    const orchestratorModule = await import("@/lib/ife-orchestrator/ife-orchestrator-pipeline");
    const spy = vi
      .spyOn(orchestratorModule, "orchestrateIfeAnalysis")
      .mockRejectedValueOnce(
        new IfeOrchestrationStageError("hosting_capacity", new BaseCaseViolationError("violates", 1, 100, 50))
      );
    try {
      const res = await callRoute("?tenant_id=t1", validBody);
      expect(res.status).toBe(400);
      const b = await res.json();
      expect(b.branchNumber).toBe(1);
      expect(b.stage).toBe("hosting_capacity");
    } finally {
      spy.mockRestore();
    }
  });

  it("500s with iteration count when the orchestrator rejects with a stage-tagged UpgradeAnalysisInfeasibleError", async () => {
    const orchestratorModule = await import("@/lib/ife-orchestrator/ife-orchestrator-pipeline");
    const spy = vi
      .spyOn(orchestratorModule, "orchestrateIfeAnalysis")
      .mockRejectedValueOnce(
        new IfeOrchestrationStageError("upgrade_analysis", new UpgradeAnalysisInfeasibleError("no convergence", 7))
      );
    try {
      const res = await callRoute("?tenant_id=t1", validBody);
      expect(res.status).toBe(500);
      const b = await res.json();
      expect(b.iterationsAttempted).toBe(7);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 6. Performance ─────────────────────────────────────────────────────────────

describe("orchestrateIfeAnalysis — performance", () => {
  it("orchestration overhead is negligible relative to the underlying stage costs", async () => {
    const { repo } = makeMockNetworkRepo("hash-abc", 100);
    const { repo: ifeRepo } = makeStatefulIfeRepo();
    const { InMemoryPtdfStorage } = await import("@/lib/ptdf/ptdf-storage");
    const { InMemoryLodfStorage } = await import("@/lib/lodf/lodf-storage");

    const t0 = performance.now();
    const result = await orchestrateIfeAnalysis(
      "tenant-1", makeRequest({ capacityMw: 10 }), repo, ifeRepo,
      new InMemoryPtdfStorage(), new InMemoryLodfStorage()
    );
    const wallClock = performance.now() - t0;

    expect(result.computeMs.totalMs).toBeLessThanOrEqual(wallClock + 5); // small rounding/measurement slack
    expect(wallClock).toBeLessThan(200);
  });
});
