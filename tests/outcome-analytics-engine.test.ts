/**
 * INFRA-021 — Outcome Analytics Engine tests
 *
 * Test plan:
 *  1. interval-coverage.ts pure functions: null-propagation for every missing
 *     input, inclusive boundary values, clearly in/out of range.
 *  2. IfeOutcomeAnalyticsRepository (mocked Supabase client): only touches
 *     the field(s) present in the patch, each guarded by its own
 *     `.is(column, null)` filter — the approved database-level guard.
 *  3. computeAndPersistOutcomeAnalytics pipeline (mocked repos): analysis
 *     not found, no outcome record yet, both fields already resolved (no
 *     write issued), partial resolution (only the unresolved field is
 *     computed/written), neither resolvable (no write issued).
 *  4. API route — validation, tenant isolation (identical 404), 404 for a
 *     missing outcome record, 200 success shape, and an unexpected request
 *     body is ignored rather than rejected.
 *  5. Performance.
 *
 * Backward compatibility is verified by the full suite passing unchanged —
 * no existing engine, pipeline, repository, or route is modified here.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import type { IfeAnalysis } from "@/lib/db/types-ife";
import type { IfeOutcomeTracking } from "@/lib/outcome-tracking/types";
import {
  computeWithinCostP10P90,
  computeWithinCodP25P75,
} from "@/lib/outcome-analytics/interval-coverage";
import { IfeOutcomeAnalyticsRepository } from "@/lib/db/repositories/ife-outcome-analytics.repository";
import { computeAndPersistOutcomeAnalytics } from "@/lib/outcome-analytics/outcome-analytics-pipeline";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";
import { POST } from "@/app/api/ife/analyses/[analysisId]/outcome-analytics/route";

// ── 1. interval-coverage.ts pure functions ────────────────────────────────────

describe("computeWithinCostP10P90", () => {
  it("returns null when actualCostM is missing", () => {
    expect(computeWithinCostP10P90(null, 10, 90)).toBeNull();
  });
  it("returns null when costP10M is missing", () => {
    expect(computeWithinCostP10P90(50, null, 90)).toBeNull();
  });
  it("returns null when costP90M is missing", () => {
    expect(computeWithinCostP10P90(50, 10, null)).toBeNull();
  });
  it("returns true for a value strictly inside the interval", () => {
    expect(computeWithinCostP10P90(50, 10, 90)).toBe(true);
  });
  it("returns true at the inclusive lower boundary", () => {
    expect(computeWithinCostP10P90(10, 10, 90)).toBe(true);
  });
  it("returns true at the inclusive upper boundary", () => {
    expect(computeWithinCostP10P90(90, 10, 90)).toBe(true);
  });
  it("returns false below the interval", () => {
    expect(computeWithinCostP10P90(9, 10, 90)).toBe(false);
  });
  it("returns false above the interval", () => {
    expect(computeWithinCostP10P90(91, 10, 90)).toBe(false);
  });
});

describe("computeWithinCodP25P75", () => {
  it("returns null when actualCod is missing", () => {
    expect(computeWithinCodP25P75(null, "2027-01-01", "2027-06-01")).toBeNull();
  });
  it("returns null when codP25 is missing", () => {
    expect(computeWithinCodP25P75("2027-03-01", null, "2027-06-01")).toBeNull();
  });
  it("returns null when codP75 is missing", () => {
    expect(computeWithinCodP25P75("2027-03-01", "2027-01-01", null)).toBeNull();
  });
  it("returns true for a date strictly inside the interval", () => {
    expect(computeWithinCodP25P75("2027-03-01", "2027-01-01", "2027-06-01")).toBe(true);
  });
  it("returns true at the inclusive lower boundary", () => {
    expect(computeWithinCodP25P75("2027-01-01", "2027-01-01", "2027-06-01")).toBe(true);
  });
  it("returns true at the inclusive upper boundary", () => {
    expect(computeWithinCodP25P75("2027-06-01", "2027-01-01", "2027-06-01")).toBe(true);
  });
  it("returns false before the interval", () => {
    expect(computeWithinCodP25P75("2026-12-31", "2027-01-01", "2027-06-01")).toBe(false);
  });
  it("returns false after the interval", () => {
    expect(computeWithinCodP25P75("2027-06-02", "2027-01-01", "2027-06-01")).toBe(false);
  });
});

// ── 2. IfeOutcomeAnalyticsRepository ──────────────────────────────────────────

describe("IfeOutcomeAnalyticsRepository", () => {
  function makeMockSupabase() {
    const calls: Array<{
      table: string;
      payload: unknown;
      eqFilters: Array<[string, unknown]>;
      guardColumn: string;
    }> = [];
    const client = {
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => {
          const eqFilters: Array<[string, unknown]> = [];
          const builder = {
            eq: (col: string, val: unknown) => {
              eqFilters.push([col, val]);
              return builder;
            },
            is: async (guardColumn: string) => {
              calls.push({ table, payload, eqFilters, guardColumn });
              return { error: null };
            },
          };
          return builder;
        },
      }),
    };
    return { client: client as never, calls };
  }

  it("scopes the write by the outcome row's own id, not analysisId — never by analysis_id", async () => {
    const { client, calls } = makeMockSupabase();
    const repo = new IfeOutcomeAnalyticsRepository(client);
    await repo.updateOutcomeAnalytics("t1", "outcome-row-1", { withinCostP10P90: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].eqFilters).toEqual([
      ["id", "outcome-row-1"],
      ["tenant_id", "t1"],
    ]);
    // Guards against regressing back to analysis_id-scoping, which could write onto a
    // sibling duplicate row for the same analysis (INFRA-021 review finding).
    expect(calls[0].eqFilters.some(([col]) => col === "analysis_id")).toBe(false);
  });

  it("writes only within_cost_p10_p90 when only that field is in the patch, guarded by IS NULL on that column", async () => {
    const { client, calls } = makeMockSupabase();
    const repo = new IfeOutcomeAnalyticsRepository(client);
    await repo.updateOutcomeAnalytics("t1", "outcome-row-1", { withinCostP10P90: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual({ within_cost_p10_p90: true });
    expect(calls[0].guardColumn).toBe("within_cost_p10_p90");
  });

  it("writes only within_cod_p25_p75 when only that field is in the patch", async () => {
    const { client, calls } = makeMockSupabase();
    const repo = new IfeOutcomeAnalyticsRepository(client);
    await repo.updateOutcomeAnalytics("t1", "outcome-row-1", { withinCodP25P75: false });

    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual({ within_cod_p25_p75: false });
    expect(calls[0].guardColumn).toBe("within_cod_p25_p75");
  });

  it("issues two independently-guarded writes when both fields are in the patch", async () => {
    const { client, calls } = makeMockSupabase();
    const repo = new IfeOutcomeAnalyticsRepository(client);
    await repo.updateOutcomeAnalytics("t1", "outcome-row-1", {
      withinCostP10P90: true,
      withinCodP25P75: false,
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.guardColumn).sort()).toEqual(["within_cod_p25_p75", "within_cost_p10_p90"]);
    for (const call of calls) {
      expect(call.eqFilters).toEqual([
        ["id", "outcome-row-1"],
        ["tenant_id", "t1"],
      ]);
    }
  });

  it("issues no writes when the patch is empty", async () => {
    const { client, calls } = makeMockSupabase();
    const repo = new IfeOutcomeAnalyticsRepository(client);
    await repo.updateOutcomeAnalytics("t1", "outcome-row-1", {});
    expect(calls).toHaveLength(0);
  });
});

// ── 3. computeAndPersistOutcomeAnalytics pipeline ─────────────────────────────

function makeAnalysis(overrides: Partial<IfeAnalysis> = {}): IfeAnalysis {
  return {
    id: "analysis-1",
    tenantId: "tenant-1",
    networkModelId: "model-1",
    poiBusId: "bus-1",
    isoId: "PJM",
    capacityMw: 100,
    projectType: "solar",
    targetCod: null,
    inputSnapshot: {},
    status: "completed",
    progressPct: 100,
    errorMessage: null,
    queuedAt: "2024-01-01T00:00:00Z",
    startedAt: "2024-01-01T00:00:00Z",
    completedAt: "2024-01-01T00:05:00Z",
    idempotencyKey: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<IfeOutcomeTracking> = {}): IfeOutcomeTracking {
  return {
    id: "ot-1",
    analysisId: "analysis-1",
    tenantId: "tenant-1",
    queueProjectId: null,
    actualCostM: null,
    actualCod: null,
    actualFeasible: null,
    actualWithdrawn: null,
    outcomeObservedAt: null,
    costResidualM: null,
    codResidualMonths: null,
    withinCostP10P90: null,
    withinCodP25P75: null,
    notes: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMockIfeRepo(opts: {
  analysis?: IfeAnalysis | null;
  upgradeResults?: { costP10M: number | null; costP90M: number | null } | null;
  timeToPower?: { codP25: string | null; codP75: string | null } | null;
}) {
  return {
    getAnalysis: vi.fn(async () => opts.analysis ?? null),
    getUpgradeResultsByAnalysisId: vi.fn(async () => opts.upgradeResults ?? null),
    getTimeToPowerByAnalysisId: vi.fn(async () => opts.timeToPower ?? null),
  } as unknown as import("@/lib/db/repositories/ife.repository").IfeRepository;
}

function makeMockOutcomeRepo(initial: IfeOutcomeTracking | null) {
  let current = initial;
  return {
    getOutcomeTrackingByAnalysisId: vi.fn(async () => current),
    _setCurrent: (row: IfeOutcomeTracking | null) => {
      current = row;
    },
  } as unknown as import("@/lib/db/repositories/ife-outcome-tracking.repository").IfeOutcomeTrackingRepository & {
    _setCurrent: (row: IfeOutcomeTracking | null) => void;
  };
}

function makeMockAnalyticsRepo(onUpdate?: (patch: Record<string, unknown>) => void) {
  return {
    updateOutcomeAnalytics: vi.fn(async (_t: string, _a: string, patch: Record<string, unknown>) => {
      onUpdate?.(patch);
    }),
  } as unknown as import("@/lib/db/repositories/ife-outcome-analytics.repository").IfeOutcomeAnalyticsRepository;
}

describe("computeAndPersistOutcomeAnalytics", () => {
  it("throws when the analysis does not exist for the tenant", async () => {
    const ifeRepo = makeMockIfeRepo({ analysis: null });
    const outcomeRepo = makeMockOutcomeRepo(null);
    const analyticsRepo = makeMockAnalyticsRepo();
    await expect(
      computeAndPersistOutcomeAnalytics("tenant-1", "analysis-1", ifeRepo, outcomeRepo, analyticsRepo)
    ).rejects.toThrow("not found");
  });

  it("the not-found error message does not embed tenantId (identical for wrong-tenant and truly-missing)", async () => {
    const ifeRepo = makeMockIfeRepo({ analysis: null });
    const outcomeRepo = makeMockOutcomeRepo(null);
    const analyticsRepo = makeMockAnalyticsRepo();

    async function captureMessage(tenantId: string): Promise<string> {
      try {
        await computeAndPersistOutcomeAnalytics(tenantId, "analysis-1", ifeRepo, outcomeRepo, analyticsRepo);
        throw new Error("expected rejection");
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    }

    const [a, b] = await Promise.all([captureMessage("tenant-a"), captureMessage("tenant-b")]);
    expect(a).toBe(b);
  });

  it("throws when no outcome record exists yet for the analysis", async () => {
    const ifeRepo = makeMockIfeRepo({ analysis: makeAnalysis() });
    const outcomeRepo = makeMockOutcomeRepo(null);
    const analyticsRepo = makeMockAnalyticsRepo();
    await expect(
      computeAndPersistOutcomeAnalytics("tenant-1", "analysis-1", ifeRepo, outcomeRepo, analyticsRepo)
    ).rejects.toThrow("No outcome record exists yet");
  });

  it("issues no write and returns the row unchanged when both fields are already resolved", async () => {
    const ifeRepo = makeMockIfeRepo({ analysis: makeAnalysis() });
    const outcomeRepo = makeMockOutcomeRepo(
      makeOutcome({ withinCostP10P90: true, withinCodP25P75: false })
    );
    const analyticsRepo = makeMockAnalyticsRepo();

    const result = await computeAndPersistOutcomeAnalytics(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      outcomeRepo,
      analyticsRepo
    );

    expect(result.outcomeTracking.withinCostP10P90).toBe(true);
    expect(result.outcomeTracking.withinCodP25P75).toBe(false);
    expect(analyticsRepo.updateOutcomeAnalytics).not.toHaveBeenCalled();
  });

  it("passes the outcome row's own id (not analysisId) to the analytics repository's write", async () => {
    const ifeRepo = makeMockIfeRepo({
      analysis: makeAnalysis(),
      upgradeResults: { costP10M: 10, costP90M: 90 },
    });
    const outcomeRepo = makeMockOutcomeRepo(
      makeOutcome({ id: "ot-distinct-from-analysis-id", actualCostM: 50 })
    );
    const analyticsRepo = makeMockAnalyticsRepo();

    await computeAndPersistOutcomeAnalytics("tenant-1", "analysis-1", ifeRepo, outcomeRepo, analyticsRepo);

    // Regression guard for the review finding: scoping by analysisId instead of the row's
    // own id could let a write land on a sibling duplicate row (analysis_id has no UNIQUE
    // constraint). Must always be the outcome row's id, never the analysisId string.
    expect(analyticsRepo.updateOutcomeAnalytics).toHaveBeenCalledWith(
      "tenant-1",
      "ot-distinct-from-analysis-id",
      expect.anything()
    );
  });

  it("computes and writes both fields when both are resolvable", async () => {
    const ifeRepo = makeMockIfeRepo({
      analysis: makeAnalysis(),
      upgradeResults: { costP10M: 10, costP90M: 90 },
      timeToPower: { codP25: "2027-01-01", codP75: "2027-06-01" },
    });
    const outcomeRepo = makeMockOutcomeRepo(
      makeOutcome({ actualCostM: 50, actualCod: "2027-03-01" })
    );
    let capturedPatch: Record<string, unknown> | undefined;
    const analyticsRepo = makeMockAnalyticsRepo((patch) => {
      capturedPatch = patch;
      outcomeRepo._setCurrent(
        makeOutcome({
          actualCostM: 50,
          actualCod: "2027-03-01",
          withinCostP10P90: true,
          withinCodP25P75: true,
        })
      );
    });

    const result = await computeAndPersistOutcomeAnalytics(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      outcomeRepo,
      analyticsRepo
    );

    expect(capturedPatch).toEqual({ withinCostP10P90: true, withinCodP25P75: true });
    expect(result.outcomeTracking.withinCostP10P90).toBe(true);
    expect(result.outcomeTracking.withinCodP25P75).toBe(true);
  });

  it("only computes and writes the still-unresolved field, leaving an already-resolved one untouched", async () => {
    const ifeRepo = makeMockIfeRepo({
      analysis: makeAnalysis(),
      timeToPower: { codP25: "2027-01-01", codP75: "2027-06-01" },
    });
    const outcomeRepo = makeMockOutcomeRepo(
      makeOutcome({
        actualCostM: 50,
        actualCod: "2027-03-01",
        withinCostP10P90: true, // already resolved — must not be recomputed or re-sent
        withinCodP25P75: null, // still unresolved
      })
    );
    let capturedPatch: Record<string, unknown> | undefined;
    const analyticsRepo = makeMockAnalyticsRepo((patch) => {
      capturedPatch = patch;
    });

    await computeAndPersistOutcomeAnalytics("tenant-1", "analysis-1", ifeRepo, outcomeRepo, analyticsRepo);

    expect(capturedPatch).toEqual({ withinCodP25P75: true });
    expect(ifeRepo.getUpgradeResultsByAnalysisId).not.toHaveBeenCalled();
  });

  it("issues no write when neither field is resolvable (no upgrade results, no time-to-power)", async () => {
    const ifeRepo = makeMockIfeRepo({ analysis: makeAnalysis() });
    const outcomeRepo = makeMockOutcomeRepo(makeOutcome({ actualCostM: 50, actualCod: "2027-03-01" }));
    const analyticsRepo = makeMockAnalyticsRepo();

    const result = await computeAndPersistOutcomeAnalytics(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      outcomeRepo,
      analyticsRepo
    );

    expect(result.outcomeTracking.withinCostP10P90).toBeNull();
    expect(result.outcomeTracking.withinCodP25P75).toBeNull();
    expect(analyticsRepo.updateOutcomeAnalytics).not.toHaveBeenCalled();
  });
});

// ── 4. API route ───────────────────────────────────────────────────────────

const ANALYSIS_ROW = {
  id: "a1",
  tenant_id: "t1",
  network_model_id: "model-1",
  poi_bus_id: "bus-1",
  iso_id: "PJM",
  capacity_mw: 100,
  project_type: "solar",
  target_cod: null,
  input_snapshot: {},
  status: "completed",
  progress_pct: 100,
  error_message: null,
  queued_at: "2024-01-01T00:00:00Z",
  started_at: "2024-01-01T00:00:00Z",
  completed_at: "2024-01-01T00:05:00Z",
  idempotency_key: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const OUTCOME_ROW = {
  id: "ot-1",
  analysis_id: "a1",
  tenant_id: "t1",
  queue_project_id: null,
  actual_cost_m: 50,
  actual_cod: "2027-03-01",
  actual_feasible: true,
  actual_withdrawn: false,
  outcome_observed_at: "2027-03-05T00:00:00Z",
  cost_residual_m: null,
  cod_residual_months: null,
  within_cost_p10_p90: null,
  within_cod_p25_p75: null,
  notes: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

function makeFakeSupabaseClient(opts: {
  analysis?: Record<string, unknown> | null;
  outcome?: Record<string, unknown> | null;
}) {
  return {
    from: (table: string) => {
      if (table === "ife_analyses") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.analysis ?? null, error: null }) }) }),
          }),
        };
      }
      if (table === "ife_outcome_tracking") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: opts.outcome ?? null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }),
        };
      }
      if (table === "ife_upgrade_results" || table === "ife_time_to_power") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function mockClient(opts: Parameters<typeof makeFakeSupabaseClient>[0]) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(makeFakeSupabaseClient(opts));
}

describe("outcome-analytics API route", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  it("returns 400 when tenant_id is missing", async () => {
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-analytics", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the analysis does not exist", async () => {
    mockClient({ analysis: null });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-analytics?tenant_id=t1", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(404);
  });

  it("tenant isolation: a wrong-tenant analysisId returns the identical 404 as a truly-nonexistent one", async () => {
    mockClient({ analysis: null });
    const reqWrongTenant = new Request(
      "http://localhost/api/ife/analyses/a1/outcome-analytics?tenant_id=other-tenant",
      { method: "POST" }
    );
    const reqNonexistent = new Request("http://localhost/api/ife/analyses/a1/outcome-analytics?tenant_id=t1", {
      method: "POST",
    });
    const [resA, resB] = await Promise.all([
      POST(reqWrongTenant, { params: Promise.resolve({ analysisId: "a1" }) }),
      POST(reqNonexistent, { params: Promise.resolve({ analysisId: "a1" }) }),
    ]);
    expect(resA.status).toBe(404);
    expect(resA.status).toBe(resB.status);
    expect(await resA.json()).toEqual(await resB.json());
  });

  it("returns 404 when no outcome record exists yet", async () => {
    mockClient({ analysis: ANALYSIS_ROW, outcome: null });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-analytics?tenant_id=t1", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 200 with { analysis, outcomeTracking, computeMs } on success", async () => {
    mockClient({ analysis: ANALYSIS_ROW, outcome: OUTCOME_ROW });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-analytics?tenant_id=t1", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis.id).toBe("a1");
    expect(body.outcomeTracking.id).toBe("ot-1");
    expect(typeof body.computeMs).toBe("number");
  });

  it("ignores an unexpected request body instead of rejecting it", async () => {
    mockClient({ analysis: ANALYSIS_ROW, outcome: OUTCOME_ROW });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-analytics?tenant_id=t1", {
      method: "POST",
      body: "{not even valid json",
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(200);
  });
});

// ── 5. Performance ─────────────────────────────────────────────────────────

describe("performance", () => {
  it("pipeline overhead stays well under bound beyond mocked repository calls", async () => {
    const ifeRepo = makeMockIfeRepo({
      analysis: makeAnalysis(),
      upgradeResults: { costP10M: 10, costP90M: 90 },
      timeToPower: { codP25: "2027-01-01", codP75: "2027-06-01" },
    });
    const outcomeRepo = makeMockOutcomeRepo(makeOutcome({ actualCostM: 50, actualCod: "2027-03-01" }));
    const analyticsRepo = makeMockAnalyticsRepo();

    const result = await computeAndPersistOutcomeAnalytics(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      outcomeRepo,
      analyticsRepo
    );

    expect(result.computeMs).toBeLessThan(50);
  });
});
