/**
 * INFRA-017 — Explanations engine tests
 *
 * Test plan:
 *  1. computeExplanations — fixed deterministic order across all
 *     upgrade/time-to-power/confidence-risk presence combinations;
 *     withdrawal/cost fields always null/empty
 *  2. IfeRepository — ife_explanations CRUD against a mocked SupabaseClient
 *  3. computeAndPersistExplanations pipeline — repository integration,
 *     idempotency, precondition rejections
 *  4. API route — request validation
 *  5. Performance benchmark
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { computeExplanations } from "@/lib/explanations/explanations-engine";
import {
  ASSUMPTION_CONFIDENCE_RISK_NOT_COMPUTED,
  ASSUMPTION_CONFIDENCE_RISK_PARTIAL,
  ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY,
  ASSUMPTION_TIME_TO_POWER_EMPIRICAL,
  ASSUMPTION_TIME_TO_POWER_NOT_COMPUTED,
  ASSUMPTION_UPGRADE_ANALYSIS_NOT_YET_COMPUTED,
  ASSUMPTION_UPGRADE_COST_NOT_ESTIMATED,
  ASSUMPTION_WITHDRAWAL_PROBABILITY_NOT_MODELED,
} from "@/lib/explanations/assumption-templates";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import * as expPipeline from "@/lib/explanations/explanations-pipeline";
import { computeAndPersistExplanations } from "@/lib/explanations/explanations-pipeline";
import type {
  IfeAnalysis,
  IfeConfidenceRisk,
  IfeHostingCapacity,
  IfeTimeToPower,
  IfeUpgradeResults,
} from "@/lib/db/types-ife";
import type { IfeExplanations as DomainIfeExplanations } from "@/lib/explanations/types";

let _idCounter = 0;
function uid(): string {
  return `00000000-0000-0000-0000-${String(++_idCounter).padStart(12, "0")}`;
}

// ── 1. computeExplanations ──────────────────────────────────────────────────────

describe("computeExplanations — fixed deterministic order", () => {
  it("upgrade not required, time-to-power absent, confidence-risk absent", () => {
    const result = computeExplanations({
      upgradeAnalysisRequired: false,
      upgradeResultsPresent: false,
      timeToPowerPresent: false,
      confidenceRiskPresent: false,
    });
    expect(result.assumptions).toEqual([
      ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY,
      ASSUMPTION_TIME_TO_POWER_NOT_COMPUTED,
      ASSUMPTION_CONFIDENCE_RISK_NOT_COMPUTED,
      ASSUMPTION_WITHDRAWAL_PROBABILITY_NOT_MODELED,
    ]);
  });

  it("upgrade required but not yet computed, time-to-power present, confidence-risk present", () => {
    const result = computeExplanations({
      upgradeAnalysisRequired: true,
      upgradeResultsPresent: false,
      timeToPowerPresent: true,
      confidenceRiskPresent: true,
    });
    expect(result.assumptions).toEqual([
      ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY,
      ASSUMPTION_UPGRADE_ANALYSIS_NOT_YET_COMPUTED,
      ASSUMPTION_TIME_TO_POWER_EMPIRICAL,
      ASSUMPTION_CONFIDENCE_RISK_PARTIAL,
      ASSUMPTION_WITHDRAWAL_PROBABILITY_NOT_MODELED,
    ]);
  });

  it("upgrade required and computed, time-to-power present, confidence-risk absent", () => {
    const result = computeExplanations({
      upgradeAnalysisRequired: true,
      upgradeResultsPresent: true,
      timeToPowerPresent: true,
      confidenceRiskPresent: false,
    });
    expect(result.assumptions).toEqual([
      ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY,
      ASSUMPTION_UPGRADE_COST_NOT_ESTIMATED,
      ASSUMPTION_TIME_TO_POWER_EMPIRICAL,
      ASSUMPTION_CONFIDENCE_RISK_NOT_COMPUTED,
      ASSUMPTION_WITHDRAWAL_PROBABILITY_NOT_MODELED,
    ]);
  });

  it("omits the upgrade topic entirely when upgrade analysis was not required", () => {
    const result = computeExplanations({
      upgradeAnalysisRequired: false,
      upgradeResultsPresent: false,
      timeToPowerPresent: false,
      confidenceRiskPresent: false,
    });
    expect(result.assumptions).not.toContain(ASSUMPTION_UPGRADE_ANALYSIS_NOT_YET_COMPUTED);
    expect(result.assumptions).not.toContain(ASSUMPTION_UPGRADE_COST_NOT_ESTIMATED);
  });

  it("is deterministic: repeated calls with identical inputs produce byte-identical arrays", () => {
    const inputs = {
      upgradeAnalysisRequired: true,
      upgradeResultsPresent: true,
      timeToPowerPresent: false,
      confidenceRiskPresent: true,
    };
    const a = computeExplanations(inputs);
    const b = computeExplanations(inputs);
    expect(a.assumptions).toEqual(b.assumptions);
  });

  it("baseline/predicted withdrawal prob, shap values, cost drivers, and model versions are always null/empty", () => {
    const result = computeExplanations({
      upgradeAnalysisRequired: true,
      upgradeResultsPresent: true,
      timeToPowerPresent: true,
      confidenceRiskPresent: true,
    });
    expect(result.baselineWithdrawalProb).toBeNull();
    expect(result.predictedWithdrawalProb).toBeNull();
    expect(result.withdrawalShapValues).toEqual([]);
    expect(result.costDrivers).toEqual([]);
    expect(result.coxModelVersion).toBeNull();
    expect(result.costModelVersion).toBeNull();
  });
});

// ── 2. IfeRepository — ife_explanations ────────────────────────────────────────

describe("IfeRepository — ife_explanations", () => {
  function makeMockSupabase(overrides: Record<string, unknown> = {}) {
    const client = {
      from: (table: string) => ({
        insert: (payload: unknown) => ({
          select: () => ({
            single: async () => {
              const key = `insert:${table}`;
              if (overrides[key]) return overrides[key];
              return { data: { id: uid(), ...(payload as object) }, error: null };
            },
          }),
        }),
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
    return { client: client as never };
  }

  it("createExplanations validates and inserts", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    const row = await repo.createExplanations({
      analysis_id: "a1",
      tenant_id: "t1",
      baseline_withdrawal_prob: null,
      predicted_withdrawal_prob: null,
      withdrawal_shap_values: [],
      cost_drivers: [],
      assumptions: [ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY],
      cox_model_version: null,
      cost_model_version: null,
    });
    expect(row.analysisId).toBe("a1");
    expect(row.assumptions).toEqual([ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY]);
  });

  it("createExplanations rejects an out-of-range baseline_withdrawal_prob", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    await expect(
      repo.createExplanations({
        analysis_id: "a1",
        tenant_id: "t1",
        baseline_withdrawal_prob: 1.5,
        predicted_withdrawal_prob: null,
        withdrawal_shap_values: [],
        cost_drivers: [],
        assumptions: null,
        cox_model_version: null,
        cost_model_version: null,
      })
    ).rejects.toThrow("baseline_withdrawal_prob must be between 0 and 1");
  });

  it("createExplanations rejects an out-of-range predicted_withdrawal_prob", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    await expect(
      repo.createExplanations({
        analysis_id: "a1",
        tenant_id: "t1",
        baseline_withdrawal_prob: null,
        predicted_withdrawal_prob: -0.1,
        withdrawal_shap_values: [],
        cost_drivers: [],
        assumptions: null,
        cox_model_version: null,
        cost_model_version: null,
      })
    ).rejects.toThrow("predicted_withdrawal_prob must be between 0 and 1");
  });

  it("getExplanationsByAnalysisId returns null when no row exists", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    const row = await repo.getExplanationsByAnalysisId("t1", "a1");
    expect(row).toBeNull();
  });
});

// ── 3. computeAndPersistExplanations pipeline ──────────────────────────────────

describe("computeAndPersistExplanations — pipeline", () => {
  function makeAnalysis(overrides: Partial<IfeAnalysis> = {}): IfeAnalysis {
    return {
      id: "analysis-1",
      tenantId: "tenant-1",
      networkModelId: "model-1",
      poiBusId: "bus-1",
      isoId: "PJM",
      capacityMw: 50,
      projectType: "solar",
      targetCod: null,
      inputSnapshot: {},
      status: "completed",
      progressPct: 100,
      errorMessage: null,
      queuedAt: "2026-06-01T00:00:00Z",
      startedAt: "2026-06-01T00:00:01Z",
      completedAt: "2026-06-01T00:00:02Z",
      idempotencyKey: null,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      ...overrides,
    };
  }

  const sufficientHc: IfeHostingCapacity = {
    id: "hc-1",
    analysisId: "analysis-1",
    tenantId: "tenant-1",
    hcDeterministicMw: 60,
    bindingLineId: null,
    bindingContingencyId: null,
    hcP10Mw: null,
    hcP50Mw: null,
    hcP90Mw: null,
    mcScenariosRun: null,
    mcConvergencePct: null,
    violationProbability: null,
    vminHeadroomPu: null,
    vmaxHeadroomPu: null,
    computedAt: "2026-06-01T00:00:00Z",
  };

  const insufficientHc: IfeHostingCapacity = { ...sufficientHc, hcDeterministicMw: 30 };

  function makeMockIfeRepo(opts: {
    analysis: IfeAnalysis | null;
    hostingCapacity?: IfeHostingCapacity | null;
    upgradeResults?: IfeUpgradeResults | null;
    timeToPower?: IfeTimeToPower | null;
    confidenceRisk?: IfeConfidenceRisk | null;
  }) {
    const store = new Map<string, DomainIfeExplanations>();
    const repo = {
      getAnalysis: vi.fn(async () => opts.analysis),
      getExplanationsByAnalysisId: vi.fn(async (_t: string, id: string) => store.get(id) ?? null),
      getHostingCapacityByAnalysisId: vi.fn(async () => opts.hostingCapacity ?? null),
      getUpgradeResultsByAnalysisId: vi.fn(async () => opts.upgradeResults ?? null),
      getTimeToPowerByAnalysisId: vi.fn(async () => opts.timeToPower ?? null),
      getConfidenceRiskByAnalysisId: vi.fn(async () => opts.confidenceRisk ?? null),
      createExplanations: vi.fn(async (insert: Record<string, unknown>) => {
        const row = {
          id: `exp-${uid()}`,
          analysisId: insert.analysis_id,
          tenantId: insert.tenant_id,
          baselineWithdrawalProb: insert.baseline_withdrawal_prob,
          predictedWithdrawalProb: insert.predicted_withdrawal_prob,
          withdrawalShapValues: insert.withdrawal_shap_values,
          costDrivers: insert.cost_drivers,
          assumptions: insert.assumptions,
          coxModelVersion: insert.cox_model_version,
          costModelVersion: insert.cost_model_version,
          computedAt: new Date().toISOString(),
        } as unknown as DomainIfeExplanations;
        store.set(insert.analysis_id as string, row);
        return row;
      }),
    };
    return { repo: repo as unknown as IfeRepository, store };
  }

  it("computes and persists exactly one explanations row", async () => {
    const { repo: ifeRepo, store } = makeMockIfeRepo({
      analysis: makeAnalysis(),
      hostingCapacity: sufficientHc,
    });

    const { analysis, explanations } = await computeAndPersistExplanations(
      "tenant-1",
      "analysis-1",
      ifeRepo
    );

    expect(analysis.id).toBe("analysis-1");
    expect(explanations.assumptions).toContain(ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY);
    expect(store.size).toBe(1);
  });

  it("selects the upgrade-required topic when hosting capacity is insufficient", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({
      analysis: makeAnalysis(),
      hostingCapacity: insufficientHc,
      upgradeResults: null,
    });

    const { explanations } = await computeAndPersistExplanations("tenant-1", "analysis-1", ifeRepo);
    expect(explanations.assumptions).toContain(ASSUMPTION_UPGRADE_ANALYSIS_NOT_YET_COMPUTED);
  });

  it("throws when the analysis is not found", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: null });
    await expect(computeAndPersistExplanations("tenant-1", "analysis-1", ifeRepo)).rejects.toThrow(
      "not found"
    );
  });

  it("throws when the analysis is not yet completed", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: makeAnalysis({ status: "running" }) });
    await expect(computeAndPersistExplanations("tenant-1", "analysis-1", ifeRepo)).rejects.toThrow(
      "is not completed"
    );
  });

  it("throws when hosting capacity has not been computed (data-consistency invariant)", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: makeAnalysis(), hostingCapacity: null });
    await expect(computeAndPersistExplanations("tenant-1", "analysis-1", ifeRepo)).rejects.toThrow(
      "no usable hosting capacity result"
    );
  });

  it("idempotency: a repeat call returns the existing row without recomputing", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: makeAnalysis(), hostingCapacity: sufficientHc });

    const first = await computeAndPersistExplanations("tenant-1", "analysis-1", ifeRepo);
    const createSpy = ifeRepo.createExplanations as ReturnType<typeof vi.fn>;
    const callsAfterFirst = createSpy.mock.calls.length;

    const second = await computeAndPersistExplanations("tenant-1", "analysis-1", ifeRepo);

    expect(second.explanations.id).toBe(first.explanations.id);
    expect(createSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});

// ── 4. API route — request validation ──────────────────────────────────────────

describe("POST /api/ife/analyses/[analysisId]/explanations — request validation", () => {
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

  async function callRoute(query: string, rawBody?: string) {
    const { POST } = await import("@/app/api/ife/analyses/[analysisId]/explanations/route");
    const request = new Request(`http://localhost/api/ife/analyses/analysis-1/explanations${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
    });
    return POST(request, { params: Promise.resolve({ analysisId: "analysis-1" }) });
  }

  it("400s when tenant_id is missing", async () => {
    const res = await callRoute("");
    expect(res.status).toBe(400);
  });

  it("400s when a non-empty body is not valid JSON", async () => {
    const res = await callRoute("?tenant_id=t1", "{not json");
    expect(res.status).toBe(400);
  });

  it("succeeds with no body at all", async () => {
    const spy = vi.spyOn(expPipeline, "computeAndPersistExplanations").mockResolvedValueOnce({
      analysis: { id: "analysis-1" } as never,
      explanations: { id: "exp-1" } as never,
      computeMs: 1,
    });
    try {
      const res = await callRoute("?tenant_id=t1");
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("500s with a clear message when Supabase credentials are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callRoute("?tenant_id=t1");
    expect(res.status).toBe(500);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  });

  it("404s when the pipeline rejects with a 'not found' error", async () => {
    const spy = vi
      .spyOn(expPipeline, "computeAndPersistExplanations")
      .mockRejectedValueOnce(new Error("[Explanations] Analysis analysis-1 not found for tenant t1"));
    try {
      const res = await callRoute("?tenant_id=t1");
      expect(res.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when the pipeline rejects with a precondition failure ('is not completed')", async () => {
    const spy = vi
      .spyOn(expPipeline, "computeAndPersistExplanations")
      .mockRejectedValueOnce(new Error("[Explanations] Analysis analysis-1 is not completed (status: running)"));
    try {
      const res = await callRoute("?tenant_id=t1");
      expect(res.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
  });

  it("500s on an unrecognized pipeline error", async () => {
    const spy = vi
      .spyOn(expPipeline, "computeAndPersistExplanations")
      .mockRejectedValueOnce(new Error("boom"));
    try {
      const res = await callRoute("?tenant_id=t1");
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 5. Performance benchmark ────────────────────────────────────────────────────

describe("computeExplanations — performance", () => {
  it("10k calls complete well under 200 ms (pure template selection, no I/O)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      computeExplanations({
        upgradeAnalysisRequired: i % 2 === 0,
        upgradeResultsPresent: i % 3 === 0,
        timeToPowerPresent: i % 4 === 0,
        confidenceRiskPresent: i % 5 === 0,
      });
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
  });
});
