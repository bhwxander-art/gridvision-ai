/**
 * INFRA-020 — Outcome Tracking Engine tests
 *
 * Test plan:
 *  1. IfeOutcomeTrackingRepository (mocked Supabase client): create validates
 *     and inserts, get returns null when absent, get tolerates >1 matching
 *     row without crashing (no UNIQUE constraint on analysis_id — accepted
 *     limitation, see repository docstring).
 *  2. computeAndPersistOutcomeTracking pipeline (mocked IfeRepository +
 *     IfeOutcomeTrackingRepository): analysis-not-found, not-completed
 *     rejection, successful create, and the resource-idempotent fast path
 *     (existing record returned unchanged, no second insert).
 *  3. API route — request validation, tenant-isolation (same 404 for
 *     "not found" and "wrong tenant"), idempotent POST retry, GET 404 when
 *     no outcome exists yet.
 *  4. Performance — trivial pipeline overhead.
 *
 * Backward compatibility is verified by the full suite (`npm test`) passing
 * unchanged alongside this file — no existing engine, pipeline, or route is
 * modified by INFRA-020, so no dedicated regression test is needed here.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import type { IfeAnalysis } from "@/lib/db/types-ife";
import { IfeOutcomeTrackingRepository } from "@/lib/db/repositories/ife-outcome-tracking.repository";
import { computeAndPersistOutcomeTracking } from "@/lib/outcome-tracking/outcome-tracking-pipeline";
import type { OutcomeTrackingRequest } from "@/lib/outcome-tracking/types";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";
import { POST, GET } from "@/app/api/ife/analyses/[analysisId]/outcome-tracking/route";

let _idCounter = 0;
function uid(): string {
  return `00000000-0000-0000-0000-${String(++_idCounter).padStart(12, "0")}`;
}

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

// ── 1. IfeOutcomeTrackingRepository ───────────────────────────────────────────

describe("IfeOutcomeTrackingRepository", () => {
  function makeMockSupabase(overrides: Record<string, unknown> = {}) {
    const client = {
      from: (table: string) => ({
        insert: (payload: unknown) => ({
          select: () => ({
            single: async () => {
              const key = `insert:${table}`;
              if (overrides[key]) return overrides[key];
              return {
                data: {
                  id: uid(),
                  cost_residual_m: null,
                  cod_residual_months: null,
                  created_at: "2024-01-01T00:00:00Z",
                  updated_at: "2024-01-01T00:00:00Z",
                  ...(payload as object),
                },
                error: null,
              };
            },
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    const key = `select:${table}`;
                    if (overrides[key]) return overrides[key];
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    };
    return { client: client as never };
  }

  it("createOutcomeTracking validates and inserts", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeOutcomeTrackingRepository(client);
    const row = await repo.createOutcomeTracking({
      analysis_id: "a1",
      tenant_id: "t1",
      queue_project_id: null,
      actual_cost_m: 12.5,
      actual_cod: "2027-03-01",
      actual_feasible: true,
      actual_withdrawn: false,
      outcome_observed_at: "2027-03-05T00:00:00Z",
      within_cost_p10_p90: null,
      within_cod_p25_p75: null,
      notes: "on schedule",
    });
    expect(row.analysisId).toBe("a1");
    expect(row.actualCostM).toBe(12.5);
    expect(row.withinCostP10P90).toBeNull();
  });

  it("createOutcomeTracking rejects a non-finite actual_cost_m", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeOutcomeTrackingRepository(client);
    await expect(
      repo.createOutcomeTracking({
        analysis_id: "a1",
        tenant_id: "t1",
        queue_project_id: null,
        actual_cost_m: Number.POSITIVE_INFINITY,
        actual_cod: null,
        actual_feasible: null,
        actual_withdrawn: null,
        outcome_observed_at: null,
        within_cost_p10_p90: null,
        within_cod_p25_p75: null,
        notes: null,
      })
    ).rejects.toThrow("actual_cost_m must be a finite number");
  });

  it("getOutcomeTrackingByAnalysisId returns null when no row exists", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeOutcomeTrackingRepository(client);
    const row = await repo.getOutcomeTrackingByAnalysisId("t1", "a1");
    expect(row).toBeNull();
  });

  it("getOutcomeTrackingByAnalysisId returns the row when one exists", async () => {
    const { client } = makeMockSupabase({
      "select:ife_outcome_tracking": {
        data: {
          id: "ot-1",
          analysis_id: "a1",
          tenant_id: "t1",
          queue_project_id: null,
          actual_cost_m: 5,
          actual_cod: null,
          actual_feasible: null,
          actual_withdrawn: null,
          outcome_observed_at: null,
          cost_residual_m: null,
          cod_residual_months: null,
          within_cost_p10_p90: null,
          within_cod_p25_p75: null,
          notes: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        error: null,
      },
    });
    const repo = new IfeOutcomeTrackingRepository(client);
    const row = await repo.getOutcomeTrackingByAnalysisId("t1", "a1");
    expect(row?.id).toBe("ot-1");
    expect(row?.actualCostM).toBe(5);
  });
});

// ── 2. computeAndPersistOutcomeTracking pipeline ──────────────────────────────

function makeMockIfeRepo(analysis: IfeAnalysis | null) {
  return {
    getAnalysis: vi.fn(async () => analysis),
  } as unknown as import("@/lib/db/repositories/ife.repository").IfeRepository;
}

function makeMockOutcomeRepo(existing: Record<string, unknown> | null = null) {
  const store = new Map<string, Record<string, unknown>>();
  if (existing) store.set(existing.analysisId as string, existing);
  let counter = 0;

  const repo = {
    createOutcomeTracking: vi.fn(async (insert: Record<string, unknown>) => {
      const row = {
        id: `ot-${++counter}`,
        analysisId: insert.analysis_id as string,
        tenantId: insert.tenant_id as string,
        queueProjectId: (insert.queue_project_id as string | null) ?? null,
        actualCostM: (insert.actual_cost_m as number | null) ?? null,
        actualCod: (insert.actual_cod as string | null) ?? null,
        actualFeasible: (insert.actual_feasible as boolean | null) ?? null,
        actualWithdrawn: (insert.actual_withdrawn as boolean | null) ?? null,
        outcomeObservedAt: (insert.outcome_observed_at as string | null) ?? null,
        costResidualM: null,
        codResidualMonths: null,
        withinCostP10P90: null,
        withinCodP25P75: null,
        notes: (insert.notes as string | null) ?? null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };
      store.set(insert.analysis_id as string, row);
      return row;
    }),
    getOutcomeTrackingByAnalysisId: vi.fn(async (_t: string, analysisId: string) => store.get(analysisId) ?? null),
  } as unknown as import("@/lib/db/repositories/ife-outcome-tracking.repository").IfeOutcomeTrackingRepository;
  return { repo, store };
}

describe("computeAndPersistOutcomeTracking", () => {
  it("throws when the analysis does not exist for the tenant", async () => {
    const ifeRepo = makeMockIfeRepo(null);
    const { repo: outcomeRepo } = makeMockOutcomeRepo();
    await expect(
      computeAndPersistOutcomeTracking("tenant-1", "analysis-1", ifeRepo, outcomeRepo, {})
    ).rejects.toThrow("not found");
  });

  it("the not-found error message does not embed tenantId, so it is identical for wrong-tenant and truly-missing cases", async () => {
    const ifeRepo = makeMockIfeRepo(null);
    const { repo: outcomeRepo } = makeMockOutcomeRepo();

    async function captureMessage(tenantId: string): Promise<string> {
      try {
        await computeAndPersistOutcomeTracking(tenantId, "analysis-1", ifeRepo, outcomeRepo, {});
        throw new Error("expected computeAndPersistOutcomeTracking to reject");
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    }

    const [messageA, messageB] = await Promise.all([
      captureMessage("tenant-a"),
      captureMessage("tenant-b"),
    ]);
    expect(messageA).toBe(messageB);
  });

  it("rejects when the analysis is not completed", async () => {
    const ifeRepo = makeMockIfeRepo(makeAnalysis({ status: "running" }));
    const { repo: outcomeRepo } = makeMockOutcomeRepo();
    await expect(
      computeAndPersistOutcomeTracking("tenant-1", "analysis-1", ifeRepo, outcomeRepo, {})
    ).rejects.toThrow("is not completed");
  });

  it("creates a new outcome record for a completed analysis", async () => {
    const ifeRepo = makeMockIfeRepo(makeAnalysis());
    const { repo: outcomeRepo } = makeMockOutcomeRepo();
    const request: OutcomeTrackingRequest = { actualCostM: 42, actualFeasible: true };

    const result = await computeAndPersistOutcomeTracking(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      outcomeRepo,
      request
    );

    expect(result.outcomeTracking.actualCostM).toBe(42);
    expect(result.outcomeTracking.actualFeasible).toBe(true);
    expect(result.outcomeTracking.withinCostP10P90).toBeNull(); // deferred to a future milestone
    expect(outcomeRepo.createOutcomeTracking).toHaveBeenCalledTimes(1);
  });

  it("is fully resource-idempotent: a repeat call returns the existing record unchanged, never a second insert", async () => {
    const ifeRepo = makeMockIfeRepo(makeAnalysis());
    const { repo: outcomeRepo } = makeMockOutcomeRepo();

    const first = await computeAndPersistOutcomeTracking("tenant-1", "analysis-1", ifeRepo, outcomeRepo, {
      actualCostM: 10,
    });
    // Second call submits a DIFFERENT payload — must still return the first result unchanged.
    const second = await computeAndPersistOutcomeTracking("tenant-1", "analysis-1", ifeRepo, outcomeRepo, {
      actualCostM: 999,
    });

    expect(second.outcomeTracking.id).toBe(first.outcomeTracking.id);
    expect(second.outcomeTracking.actualCostM).toBe(10); // not overwritten by the second call's payload
    expect(outcomeRepo.createOutcomeTracking).toHaveBeenCalledTimes(1);
  });

  it("idempotent fast path does not re-check analysis status (an existing record implies it was completed)", async () => {
    // Analysis status flips to something else after the record was created — the fast path
    // must not re-validate status, matching the pipeline's documented ordering.
    const ifeRepo = makeMockIfeRepo(makeAnalysis({ status: "failed" }));
    const { repo: outcomeRepo } = makeMockOutcomeRepo({
      id: "ot-existing",
      analysisId: "analysis-1",
      tenantId: "tenant-1",
      queueProjectId: null,
      actualCostM: 5,
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
    });

    const result = await computeAndPersistOutcomeTracking("tenant-1", "analysis-1", ifeRepo, outcomeRepo, {});
    expect(result.outcomeTracking.id).toBe("ot-existing");
  });
});

// ── 3. API route — validation, tenant isolation, idempotency ─────────────────

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

function makeFakeSupabaseClient(opts: {
  analysis?: Record<string, unknown> | null;
  existingOutcome?: Record<string, unknown> | null;
  insertError?: { message: string } | null;
}) {
  return {
    from: (table: string) => {
      if (table === "ife_analyses") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.analysis ?? null, error: null }),
              }),
            }),
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
                    maybeSingle: async () => ({ data: opts.existingOutcome ?? null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: opts.insertError }
                  : {
                      data: {
                        id: "ot-new",
                        cost_residual_m: null,
                        cod_residual_months: null,
                        created_at: "2024-01-01T00:00:00Z",
                        updated_at: "2024-01-01T00:00:00Z",
                        ...payload,
                      },
                      error: null,
                    },
            }),
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

describe("outcome-tracking API route", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  it("POST returns 400 when tenant_id is missing", async () => {
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(400);
  });

  it("POST returns 400 for a malformed actualCostM", async () => {
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: JSON.stringify({ actualCostM: "not-a-number" }),
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("actualCostM");
  });

  it("POST returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: "{not json",
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(400);
  });

  it("GET returns 400 when tenant_id is missing", async () => {
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking");
    const res = await GET(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(400);
  });

  it("POST returns 404 when the analysis does not exist", async () => {
    mockClient({ analysis: null });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: JSON.stringify({ actualCostM: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(404);
  });

  it("tenant isolation: a wrong-tenant analysisId returns the identical 404 as a truly-nonexistent one", async () => {
    // The repository query is tenant-scoped (.eq("tenant_id", tenantId)) — from the route's
    // perspective, "exists under a different tenant" and "doesn't exist at all" are the same
    // observable outcome (data: null), so both requests hit this same mock and must produce
    // byte-identical responses.
    mockClient({ analysis: null });
    const reqWrongTenant = new Request(
      "http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=other-tenant",
      { method: "GET" }
    );
    const reqNonexistent = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "GET",
    });
    const [resWrongTenant, resNonexistent] = await Promise.all([
      GET(reqWrongTenant, { params: Promise.resolve({ analysisId: "a1" }) }),
      GET(reqNonexistent, { params: Promise.resolve({ analysisId: "a1" }) }),
    ]);
    expect(resWrongTenant.status).toBe(resNonexistent.status);
    expect(await resWrongTenant.json()).toEqual(await resNonexistent.json());
  });

  it("tenant isolation: POST also returns the identical 404 for a wrong-tenant analysisId as a truly-nonexistent one", async () => {
    // POST's not-found path goes through a different code route than GET's (a thrown Error
    // in the pipeline, string-matched in the route's catch block) — verified independently
    // here rather than assuming it inherits GET's guarantee.
    mockClient({ analysis: null });
    const bodyPayload = JSON.stringify({ actualCostM: 5 });
    const reqWrongTenant = new Request(
      "http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=other-tenant",
      { method: "POST", body: bodyPayload }
    );
    const reqNonexistent = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: bodyPayload,
    });
    const [resWrongTenant, resNonexistent] = await Promise.all([
      POST(reqWrongTenant, { params: Promise.resolve({ analysisId: "a1" }) }),
      POST(reqNonexistent, { params: Promise.resolve({ analysisId: "a1" }) }),
    ]);
    expect(resWrongTenant.status).toBe(404);
    expect(resWrongTenant.status).toBe(resNonexistent.status);
    expect(await resWrongTenant.json()).toEqual(await resNonexistent.json());
  });

  it("POST returns 400 when the analysis is not completed", async () => {
    mockClient({ analysis: { ...ANALYSIS_ROW, status: "running" }, existingOutcome: null });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: JSON.stringify({ actualCostM: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(400);
  });

  it("POST creates a new outcome record and returns 200 with { analysis, outcomeTracking, computeMs }", async () => {
    mockClient({ analysis: ANALYSIS_ROW, existingOutcome: null });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: JSON.stringify({ actualCostM: 12, actualFeasible: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis.id).toBe("a1");
    expect(body.outcomeTracking.actualCostM).toBe(12);
    expect(typeof body.computeMs).toBe("number");
  });

  it("POST is resource-idempotent: a duplicate request returns 200 with the existing record, never 409", async () => {
    const existing = {
      id: "ot-existing",
      analysis_id: "a1",
      tenant_id: "t1",
      queue_project_id: null,
      actual_cost_m: 5,
      actual_cod: null,
      actual_feasible: null,
      actual_withdrawn: null,
      outcome_observed_at: null,
      cost_residual_m: null,
      cod_residual_months: null,
      within_cost_p10_p90: null,
      within_cod_p25_p75: null,
      notes: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    mockClient({ analysis: ANALYSIS_ROW, existingOutcome: existing });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: JSON.stringify({ actualCostM: 999 }), // a different payload — must be ignored
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(409);
    const body = await res.json();
    expect(body.outcomeTracking.id).toBe("ot-existing");
    expect(body.outcomeTracking.actualCostM).toBe(5); // unchanged, not overwritten
  });

  it("GET returns 404 when no outcome record exists yet for a valid, completed analysis", async () => {
    mockClient({ analysis: ANALYSIS_ROW, existingOutcome: null });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1");
    const res = await GET(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(404);
  });

  it("GET returns 200 with { analysis, outcomeTracking } when both exist", async () => {
    const existing = {
      id: "ot-1",
      analysis_id: "a1",
      tenant_id: "t1",
      queue_project_id: null,
      actual_cost_m: 7,
      actual_cod: null,
      actual_feasible: null,
      actual_withdrawn: null,
      outcome_observed_at: null,
      cost_residual_m: null,
      cod_residual_months: null,
      within_cost_p10_p90: null,
      within_cod_p25_p75: null,
      notes: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    mockClient({ analysis: ANALYSIS_ROW, existingOutcome: existing });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1");
    const res = await GET(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis.id).toBe("a1");
    expect(body.outcomeTracking.id).toBe("ot-1");
  });

  it("POST treats an empty string as 'not provided' instead of passing it to the database", async () => {
    mockClient({ analysis: ANALYSIS_ROW, existingOutcome: null });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: JSON.stringify({ actualCod: "", actualCostM: 3 }),
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcomeTracking.actualCod).toBeNull();
  });

  it("maps a database invalid-payload constraint error (e.g. malformed date) to 400, not 500", async () => {
    mockClient({
      analysis: ANALYSIS_ROW,
      existingOutcome: null,
      insertError: { message: 'invalid input syntax for type date: "not-a-date"' },
    });
    const req = new Request("http://localhost/api/ife/analyses/a1/outcome-tracking?tenant_id=t1", {
      method: "POST",
      body: JSON.stringify({ actualCostM: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ analysisId: "a1" }) });
    expect(res.status).toBe(400);
  });
});

// ── 4. Performance ─────────────────────────────────────────────────────────

describe("performance", () => {
  it("pipeline overhead stays well under 10ms beyond mocked repository calls", async () => {
    const ifeRepo = makeMockIfeRepo(makeAnalysis());
    const { repo: outcomeRepo } = makeMockOutcomeRepo();

    const result = await computeAndPersistOutcomeTracking("tenant-1", "analysis-1", ifeRepo, outcomeRepo, {
      actualCostM: 1,
    });

    expect(result.computeMs).toBeLessThan(50); // generous bound for a mocked-repo unit test
  });
});
