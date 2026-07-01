/**
 * INFRA-019 — Scenario Analysis Engine tests
 *
 * Test plan:
 *  1. network-delta.ts pure functions: bus/branch clone construction, the
 *     mandatory bus UUID remapping (Phase 2 review, Blocking B1), rejection
 *     of deltas referencing unknown branches, and delta hashing/dedup
 *     determinism (order-independence — Non-blocking Note 2).
 *  2. scenario-pipeline.ts (mocked repos, orchestrateIfeAnalysis mocked via
 *     vi.spyOn exactly like tests/ife-orchestrator.test.ts mocks the HC/UA
 *     pipelines): no-delta path skips materialization entirely, delta path
 *     materializes and cleans up on failure, dedup reuse, idempotency
 *     fast path.
 *  3. API route request validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NetworkBus, NetworkBranch, DbNetworkBusInsert } from "@/lib/db/types-network";
import {
  buildClonedBusInserts,
  buildClonedBranchInserts,
  hashNetworkDelta,
  canonicalizeNetworkDelta,
} from "@/lib/ife-scenario/network-delta";
import type { NetworkDeltaOp, ScenarioRequest } from "@/lib/ife-scenario/types";
import { IfeScenarioValidationError } from "@/lib/db/types-ife-scenario";
import * as orchestratorModule from "@/lib/ife-orchestrator/ife-orchestrator-pipeline";
import { runScenario } from "@/lib/ife-scenario/scenario-pipeline";
import { IfeScenarioStageError } from "@/lib/ife-scenario/types";

// ── Fixtures ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function uid(): string {
  return `00000000-0000-0000-0000-${String(++_idCounter).padStart(12, "0")}`;
}

function makeBus(busNumber: number, id = uid()): NetworkBus {
  return {
    id,
    modelId: "base-model",
    tenantId: "tenant-1",
    busNumber,
    name: `Bus${busNumber}`,
    baseKv: 345,
    busType: busNumber === 1 ? "SLACK" : "PQ",
    latitude: null,
    longitude: null,
    zone: null,
    area: null,
    vminPu: 0.95,
    vmaxPu: 1.05,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

function makeBranch(
  branchNumber: number,
  fromBus: NetworkBus,
  toBus: NetworkBus,
  overrides: Partial<NetworkBranch> = {}
): NetworkBranch {
  return {
    id: uid(),
    modelId: "base-model",
    tenantId: "tenant-1",
    branchNumber,
    name: `Br${branchNumber}`,
    branchType: "LINE",
    fromBusId: fromBus.id,
    toBusId: toBus.id,
    rPu: 0,
    xPu: 0.1,
    bPu: 0,
    rateAMw: 100,
    rateBMw: null,
    rateCMw: null,
    tapRatio: 1,
    phaseShiftDeg: 0,
    inService: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── 1. network-delta.ts pure function tests ──────────────────────────────────

describe("buildClonedBusInserts", () => {
  it("clones every bus field into a new model_id/tenant_id, unchanged otherwise", () => {
    const bus1 = makeBus(1);
    const bus2 = makeBus(2);
    const inserts = buildClonedBusInserts([bus1, bus2], "tenant-1", "derived-model");

    expect(inserts).toHaveLength(2);
    expect(inserts[0].model_id).toBe("derived-model");
    expect(inserts[0].tenant_id).toBe("tenant-1");
    expect(inserts[0].bus_number).toBe(1);
    expect(inserts[1].bus_number).toBe(2);
  });
});

describe("buildClonedBranchInserts — bus UUID remapping (Blocking B1)", () => {
  it("resolves from_bus_id/to_bus_id through the new bus mapping, never the base model's bus UUIDs", () => {
    const bus1 = makeBus(1);
    const bus2 = makeBus(2);
    const branch = makeBranch(1, bus1, bus2);

    // Simulate createBusesBatch() having returned brand-new UUIDs for the clone.
    const newBus1Id = uid();
    const newBus2Id = uid();
    const busNumberToNewId = new Map([
      [1, newBus1Id],
      [2, newBus2Id],
    ]);
    const baseBusIdToNumber = new Map([
      [bus1.id, 1],
      [bus2.id, 2],
    ]);

    const inserts = buildClonedBranchInserts(
      [branch],
      [],
      "tenant-1",
      "derived-model",
      busNumberToNewId,
      baseBusIdToNumber
    );

    expect(inserts).toHaveLength(1);
    expect(inserts[0].from_bus_id).toBe(newBus1Id);
    expect(inserts[0].to_bus_id).toBe(newBus2Id);
    // Must never equal the base model's own bus UUIDs.
    expect(inserts[0].from_bus_id).not.toBe(bus1.id);
    expect(inserts[0].to_bus_id).not.toBe(bus2.id);
  });

  it("applies set_branch_in_service and set_branch_rating deltas to the matching branch only", () => {
    const bus1 = makeBus(1);
    const bus2 = makeBus(2);
    const bus3 = makeBus(3);
    const branch1 = makeBranch(1, bus1, bus2, { rateAMw: 100 });
    const branch2 = makeBranch(2, bus2, bus3, { rateAMw: 200 });

    const busNumberToNewId = new Map([
      [1, uid()],
      [2, uid()],
      [3, uid()],
    ]);
    const baseBusIdToNumber = new Map([
      [bus1.id, 1],
      [bus2.id, 2],
      [bus3.id, 3],
    ]);

    const delta: NetworkDeltaOp[] = [
      { op: "set_branch_in_service", branchNumber: 1, inService: false },
      { op: "set_branch_rating", branchNumber: 2, rateAMw: 250, rateBMw: 300 },
    ];

    const inserts = buildClonedBranchInserts(
      [branch1, branch2],
      delta,
      "tenant-1",
      "derived-model",
      busNumberToNewId,
      baseBusIdToNumber
    );

    const b1 = inserts.find((i) => i.branch_number === 1)!;
    const b2 = inserts.find((i) => i.branch_number === 2)!;
    expect(b1.in_service).toBe(false);
    expect(b2.rate_a_mw).toBe(250);
    expect(b2.rate_b_mw).toBe(300);
    // Untouched branch keeps its original in_service value.
    expect(b2.in_service).toBe(true);
  });

  it("preserves the base branch's rateBMw/rateCMw when a rating delta omits them", () => {
    const bus1 = makeBus(1);
    const bus2 = makeBus(2);
    const branch = makeBranch(1, bus1, bus2, { rateAMw: 100, rateBMw: 200, rateCMw: 250 });
    const busNumberToNewId = new Map([[1, uid()], [2, uid()]]);
    const baseBusIdToNumber = new Map([[bus1.id, 1], [bus2.id, 2]]);

    // Caller only wants to change rateAMw — rateBMw/rateCMw are intentionally omitted.
    const delta: NetworkDeltaOp[] = [{ op: "set_branch_rating", branchNumber: 1, rateAMw: 150 }];

    const [insert] = buildClonedBranchInserts(
      [branch],
      delta,
      "tenant-1",
      "derived-model",
      busNumberToNewId,
      baseBusIdToNumber
    );

    expect(insert.rate_a_mw).toBe(150);
    expect(insert.rate_b_mw).toBe(200); // preserved from the base branch, not nulled out
    expect(insert.rate_c_mw).toBe(250); // preserved from the base branch, not nulled out
  });

  it("explicit null for rateBMw clears it, distinct from omitting the field", () => {
    const bus1 = makeBus(1);
    const bus2 = makeBus(2);
    const branch = makeBranch(1, bus1, bus2, { rateAMw: 100, rateBMw: 200, rateCMw: 250 });
    const busNumberToNewId = new Map([[1, uid()], [2, uid()]]);
    const baseBusIdToNumber = new Map([[bus1.id, 1], [bus2.id, 2]]);

    const delta: NetworkDeltaOp[] = [
      { op: "set_branch_rating", branchNumber: 1, rateAMw: 150, rateBMw: null },
    ];

    const [insert] = buildClonedBranchInserts(
      [branch],
      delta,
      "tenant-1",
      "derived-model",
      busNumberToNewId,
      baseBusIdToNumber
    );

    expect(insert.rate_b_mw).toBeNull(); // explicitly cleared
    expect(insert.rate_c_mw).toBe(250); // still preserved (untouched by this delta)
  });

  it("throws when the delta references a branch_number absent from the base model", () => {
    const bus1 = makeBus(1);
    const bus2 = makeBus(2);
    const branch = makeBranch(1, bus1, bus2);
    const busNumberToNewId = new Map([[1, uid()], [2, uid()]]);
    const baseBusIdToNumber = new Map([[bus1.id, 1], [bus2.id, 2]]);

    expect(() =>
      buildClonedBranchInserts(
        [branch],
        [{ op: "set_branch_in_service", branchNumber: 999, inService: false }],
        "tenant-1",
        "derived-model",
        busNumberToNewId,
        baseBusIdToNumber
      )
    ).toThrow(IfeScenarioValidationError);
  });
});

describe("hashNetworkDelta / canonicalizeNetworkDelta", () => {
  it("returns null for an empty delta", () => {
    expect(hashNetworkDelta([])).toBeNull();
  });

  it("is deterministic regardless of array order and key order", () => {
    const deltaA: NetworkDeltaOp[] = [
      { op: "set_branch_rating", branchNumber: 5, rateAMw: 300, rateBMw: null, rateCMw: null },
      { op: "set_branch_in_service", branchNumber: 1, inService: false },
    ];
    const deltaB: NetworkDeltaOp[] = [
      { op: "set_branch_in_service", inService: false, branchNumber: 1 },
      { op: "set_branch_rating", rateCMw: null, rateBMw: null, branchNumber: 5, rateAMw: 300 },
    ];

    expect(hashNetworkDelta(deltaA)).toBe(hashNetworkDelta(deltaB));
    expect(canonicalizeNetworkDelta(deltaA)).toEqual(canonicalizeNetworkDelta(deltaB));
  });

  it("produces different hashes for different deltas", () => {
    const deltaA: NetworkDeltaOp[] = [{ op: "set_branch_in_service", branchNumber: 1, inService: false }];
    const deltaB: NetworkDeltaOp[] = [{ op: "set_branch_in_service", branchNumber: 2, inService: false }];
    expect(hashNetworkDelta(deltaA)).not.toBe(hashNetworkDelta(deltaB));
  });
});

// ── 2. scenario-pipeline.ts tests ─────────────────────────────────────────────

function makeMockNetworkRepo() {
  const bus1 = makeBus(1);
  const bus2 = makeBus(2);
  const branch1 = makeBranch(1, bus1, bus2);

  const createModel = vi.fn(async (insert: Record<string, unknown>) => ({
    id: "derived-model-1",
    tenantId: insert.tenant_id as string,
    iso: insert.iso as "PJM",
    name: insert.name as string,
    version: insert.version as string,
    baseMva: insert.base_mva as number,
    modelDate: insert.model_date as string,
    source: insert.source as "MANUAL",
    topologyHash: null,
    ptdfValid: false,
    lodfValid: false,
    busCount: insert.bus_count as number,
    branchCount: insert.branch_count as number,
    metadata: insert.metadata as Record<string, unknown>,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  }));
  const createBusesBatch = vi.fn(async (inserts: DbNetworkBusInsert[]) =>
    inserts.map((insert) => ({
      id: uid(),
      modelId: insert.model_id,
      tenantId: insert.tenant_id,
      busNumber: insert.bus_number,
      name: insert.name,
      baseKv: insert.base_kv,
      busType: insert.bus_type ?? "PQ",
      latitude: null,
      longitude: null,
      zone: null,
      area: null,
      vminPu: insert.vmin_pu ?? 0.95,
      vmaxPu: insert.vmax_pu ?? 1.05,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    }))
  );
  const createBranchesBatch = vi.fn(async () => []);
  const deleteModel = vi.fn(async () => {});

  return {
    repo: {
      getModel: vi.fn(async () => ({
        id: "base-model",
        tenantId: "tenant-1",
        iso: "PJM" as const,
        name: "Base Model",
        version: "1.0",
        baseMva: 100,
        modelDate: "2024-01-01",
        source: "MANUAL" as const,
        topologyHash: "hash-abc",
        ptdfValid: false,
        lodfValid: false,
        busCount: 2,
        branchCount: 1,
        metadata: {},
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      })),
      listBuses: vi.fn(async () => [bus1, bus2]),
      listBranches: vi.fn(async () => [branch1]),
      createModel,
      createBusesBatch,
      createBranchesBatch,
      deleteModel,
    } as unknown as import("@/lib/db/repositories/network.repository").NetworkRepository,
    createModel,
    createBusesBatch,
    createBranchesBatch,
    deleteModel,
  };
}

function makeMockScenarioRepo() {
  const scenarios = new Map<string, Record<string, unknown>>();
  let counter = 0;
  return {
    repo: {
      createScenario: vi.fn(async (insert: Record<string, unknown>) => {
        const id = `scenario-${++counter}`;
        const row = {
          id,
          tenantId: insert.tenant_id,
          baseNetworkModelId: insert.base_network_model_id,
          derivedNetworkModelId: insert.derived_network_model_id ?? null,
          name: insert.name,
          description: insert.description ?? null,
          poiBusNumber: insert.poi_bus_number,
          isoId: insert.iso_id,
          capacityMw: insert.capacity_mw,
          projectType: insert.project_type,
          targetCod: insert.target_cod ?? null,
          injectionOverridesMw: insert.injection_overrides_mw ?? {},
          networkDelta: insert.network_delta ?? [],
          networkDeltaHash: insert.network_delta_hash ?? null,
          status: "pending",
          errorMessage: null,
          resultAnalysisId: null,
          idempotencyKey: insert.idempotency_key ?? null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        };
        scenarios.set(id, row);
        return row;
      }),
      getScenarioByIdempotencyKey: vi.fn(async (_t: string, key: string) => {
        for (const s of scenarios.values()) if (s.idempotencyKey === key) return s;
        return null;
      }),
      getScenarioByDeltaHash: vi.fn(async (_t: string, _m: string, hash: string) => {
        for (const s of scenarios.values()) if (s.networkDeltaHash === hash) return s;
        return null;
      }),
      updateScenarioStatus: vi.fn(async (_t: string, id: string, status: string, opts?: Record<string, unknown>) => {
        const row = scenarios.get(id)!;
        const updated = { ...row, status, ...(opts?.resultAnalysisId !== undefined ? { resultAnalysisId: opts.resultAnalysisId } : {}) };
        scenarios.set(id, updated);
        return updated;
      }),
    } as unknown as import("@/lib/db/repositories/ife-scenario.repository").IfeScenarioRepository,
    scenarios,
  };
}

function makeScenarioRequest(overrides: Partial<ScenarioRequest> = {}): ScenarioRequest {
  return {
    baseNetworkModelId: "base-model",
    name: "Test scenario",
    poiBusNumber: 2,
    isoId: "PJM",
    capacityMw: 10,
    projectType: "solar",
    baseCaseInjectionsMw: { 2: 10 },
    ...overrides,
  };
}

const FAKE_ORCHESTRATION_RESULT = {
  analysis: { id: "analysis-1" } as never,
  hostingCapacity: { id: "hc-1" } as never,
  upgradeResults: null,
  overallStatus: "completed_no_upgrade_needed" as const,
  computeMs: { hostingCapacityMs: 1, upgradeAnalysisMs: 0, totalMs: 1 },
};

describe("runScenario", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("no-delta path: skips materialization entirely and calls the orchestrator against the base model id", async () => {
    const { repo: networkRepo, createModel, createBusesBatch } = makeMockNetworkRepo();
    const { repo: scenarioRepo } = makeMockScenarioRepo();
    const orchestrateSpy = vi
      .spyOn(orchestratorModule, "orchestrateIfeAnalysis")
      .mockResolvedValue(FAKE_ORCHESTRATION_RESULT);

    const result = await runScenario(
      "tenant-1",
      makeScenarioRequest(),
      networkRepo,
      {} as never,
      scenarioRepo,
      {} as never,
      {} as never
    );

    expect(createModel).not.toHaveBeenCalled();
    expect(createBusesBatch).not.toHaveBeenCalled();
    expect(orchestrateSpy).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ networkModelId: "base-model" }),
      networkRepo,
      {},
      {},
      {}
    );
    expect(result.scenario.derivedNetworkModelId).toBeNull();
    expect(result.scenario.resultAnalysisId).toBe("analysis-1");
  });

  it("delta path: materializes a clone and calls the orchestrator against the derived model id", async () => {
    const { repo: networkRepo, createModel, createBusesBatch, createBranchesBatch } = makeMockNetworkRepo();
    const { repo: scenarioRepo } = makeMockScenarioRepo();
    const orchestrateSpy = vi
      .spyOn(orchestratorModule, "orchestrateIfeAnalysis")
      .mockResolvedValue(FAKE_ORCHESTRATION_RESULT);

    const result = await runScenario(
      "tenant-1",
      makeScenarioRequest({
        networkDelta: [{ op: "set_branch_in_service", branchNumber: 1, inService: false }],
      }),
      networkRepo,
      {} as never,
      scenarioRepo,
      {} as never,
      {} as never
    );

    expect(createModel).toHaveBeenCalledTimes(1);
    expect(createBusesBatch).toHaveBeenCalledTimes(1);
    expect(createBranchesBatch).toHaveBeenCalledTimes(1);
    expect(orchestrateSpy).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ networkModelId: "derived-model-1" }),
      networkRepo,
      {},
      {},
      {}
    );
    expect(result.scenario.derivedNetworkModelId).toBe("derived-model-1");
  });

  it("dedup: a second scenario with an identical delta reuses the first's derived model id without re-cloning", async () => {
    const { repo: networkRepo, createModel } = makeMockNetworkRepo();
    const { repo: scenarioRepo } = makeMockScenarioRepo();
    vi.spyOn(orchestratorModule, "orchestrateIfeAnalysis").mockResolvedValue(FAKE_ORCHESTRATION_RESULT);

    const delta: NetworkDeltaOp[] = [{ op: "set_branch_in_service", branchNumber: 1, inService: false }];

    const first = await runScenario(
      "tenant-1",
      makeScenarioRequest({ name: "First", networkDelta: delta }),
      networkRepo,
      {} as never,
      scenarioRepo,
      {} as never,
      {} as never
    );
    const second = await runScenario(
      "tenant-1",
      makeScenarioRequest({ name: "Second", networkDelta: delta }),
      networkRepo,
      {} as never,
      scenarioRepo,
      {} as never,
      {} as never
    );

    expect(createModel).toHaveBeenCalledTimes(1); // not called again for the second scenario
    expect(second.scenario.derivedNetworkModelId).toBe(first.scenario.derivedNetworkModelId);
    expect(second.scenario.id).not.toBe(first.scenario.id); // still two distinct scenario rows
  });

  it("idempotency: a repeat request with the same idempotencyKey short-circuits without touching the orchestrator", async () => {
    const { repo: networkRepo } = makeMockNetworkRepo();
    const { repo: scenarioRepo } = makeMockScenarioRepo();
    const orchestrateSpy = vi
      .spyOn(orchestratorModule, "orchestrateIfeAnalysis")
      .mockResolvedValue(FAKE_ORCHESTRATION_RESULT);
    const ifeRepoMock = {
      getAnalysis: vi.fn(async () => ({ id: "analysis-1" })),
      getHostingCapacityByAnalysisId: vi.fn(async () => ({ id: "hc-1" })),
      getUpgradeResultsByAnalysisId: vi.fn(async () => null),
    } as unknown as import("@/lib/db/repositories/ife.repository").IfeRepository;

    const request = makeScenarioRequest({ idempotencyKey: "key-1" });
    await runScenario("tenant-1", request, networkRepo, ifeRepoMock, scenarioRepo, {} as never, {} as never);
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);

    const second = await runScenario(
      "tenant-1",
      request,
      networkRepo,
      ifeRepoMock,
      scenarioRepo,
      {} as never,
      {} as never
    );
    expect(orchestrateSpy).toHaveBeenCalledTimes(1); // not called again
    expect(second.scenario.resultAnalysisId).toBe("analysis-1");
  });

  it("materialization failure cleans up the partial clone and throws a stage-tagged error", async () => {
    const { repo: networkRepo, createBranchesBatch, deleteModel } = makeMockNetworkRepo();
    createBranchesBatch.mockRejectedValueOnce(new Error("insert failed"));
    const { repo: scenarioRepo } = makeMockScenarioRepo();

    await expect(
      runScenario(
        "tenant-1",
        makeScenarioRequest({
          networkDelta: [{ op: "set_branch_in_service", branchNumber: 1, inService: false }],
        }),
        networkRepo,
        {} as never,
        scenarioRepo,
        {} as never,
        {} as never
      )
    ).rejects.toThrow(IfeScenarioStageError);

    expect(deleteModel).toHaveBeenCalledWith("tenant-1", "derived-model-1");
  });

  it("createScenario failure after a successful clone cleans up the clone instead of leaking it", async () => {
    const { repo: networkRepo, deleteModel } = makeMockNetworkRepo();
    const { repo: scenarioRepo } = makeMockScenarioRepo();
    (scenarioRepo.createScenario as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("insert validation failed")
    );

    await expect(
      runScenario(
        "tenant-1",
        makeScenarioRequest({
          networkDelta: [{ op: "set_branch_in_service", branchNumber: 1, inService: false }],
        }),
        networkRepo,
        {} as never,
        scenarioRepo,
        {} as never,
        {} as never
      )
    ).rejects.toThrow("insert validation failed");

    expect(deleteModel).toHaveBeenCalledWith("tenant-1", "derived-model-1");
  });

  it("idempotency: a retry after a prior failed attempt with the same key throws instead of violating the unique constraint", async () => {
    const { repo: networkRepo } = makeMockNetworkRepo();
    const { repo: scenarioRepo } = makeMockScenarioRepo();
    vi.spyOn(orchestratorModule, "orchestrateIfeAnalysis").mockRejectedValueOnce(new Error("orchestration boom"));

    const request = makeScenarioRequest({ idempotencyKey: "key-retry" });

    await expect(
      runScenario("tenant-1", request, networkRepo, {} as never, scenarioRepo, {} as never, {} as never)
    ).rejects.toThrow(IfeScenarioStageError);

    // Retry with the same idempotencyKey must not fall through to createScenario (which would
    // violate the UNIQUE constraint on idempotency_key) — it should throw a clear validation
    // error instead of a raw DB unique-violation.
    await expect(
      runScenario("tenant-1", request, networkRepo, {} as never, scenarioRepo, {} as never, {} as never)
    ).rejects.toThrow(IfeScenarioValidationError);
  });
});
