/**
 * INFRA-015 — Time-to-Power engine tests
 *
 * Test plan:
 *  1. nearestRankPercentile — boundary/monotonicity behavior
 *  2. computeTimeToPower — cohort fallback ladder, insufficient-data nulls,
 *     negative-duration filtering, cod_p25<=p50<=p75 monotonicity
 *  3. QueueAnalyticsRepository — historical duration queries against a
 *     mocked SupabaseClient
 *  4. IfeRepository — ife_time_to_power CRUD against a mocked SupabaseClient
 *  5. computeAndPersistTimeToPower pipeline — repository integration,
 *     idempotency, status-gate rejection
 *  6. API route — request validation
 *  7. Performance benchmark
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  nearestRankPercentile,
  computeTimeToPower,
} from "@/lib/time-to-power/time-to-power-engine";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { QueueAnalyticsRepository } from "@/lib/db/repositories/queue-analytics.repository";
import * as ttpPipeline from "@/lib/time-to-power/time-to-power-pipeline";
import { computeAndPersistTimeToPower } from "@/lib/time-to-power/time-to-power-pipeline";
import type { IfeAnalysis, IfeTimeToPower } from "@/lib/db/types-ife";
import type { QueueRepository } from "@/lib/db/repositories/queue.repository";

let _idCounter = 0;
function uid(): string {
  return `00000000-0000-0000-0000-${String(++_idCounter).padStart(12, "0")}`;
}

// ── 1. nearestRankPercentile ───────────────────────────────────────────────────

describe("nearestRankPercentile", () => {
  it("throws on an empty sample array", () => {
    expect(() => nearestRankPercentile([], 0.5)).toThrow("non-empty");
  });

  it("single-sample array returns that sample for any p", () => {
    expect(nearestRankPercentile([42], 0.25)).toBe(42);
    expect(nearestRankPercentile([42], 0.5)).toBe(42);
    expect(nearestRankPercentile([42], 0.99)).toBe(42);
  });

  it("p=0 returns the minimum, p close to 1 returns the maximum", () => {
    const samples = [10, 30, 20, 50, 40];
    expect(nearestRankPercentile(samples, 0)).toBe(10);
    expect(nearestRankPercentile(samples, 0.999)).toBe(50);
  });

  it("is monotonic non-decreasing in p", () => {
    const samples = [7, 2, 9, 4, 1, 8, 3, 6, 5];
    const ps = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
    let prev = -Infinity;
    for (const p of ps) {
      const v = nearestRankPercentile(samples, Math.min(p, 0.999));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("does not mutate the input array", () => {
    const samples = [5, 3, 1, 4, 2];
    nearestRankPercentile(samples, 0.5);
    expect(samples).toEqual([5, 3, 1, 4, 2]);
  });
});

// ── 2. computeTimeToPower ──────────────────────────────────────────────────────

describe("computeTimeToPower — cohort fallback and null handling", () => {
  const ANCHOR = "2026-01-15T00:00:00Z";

  it("uses the narrow (project_type) cohort when it meets minSampleSize", () => {
    const result = computeTimeToPower({
      anchorDate: ANCHOR,
      activeQueueProjectsCount: 3,
      narrowExecutedIaDurationsMonths: [10, 12, 14, 16, 18],
      broadExecutedIaDurationsMonths: [1, 1, 1, 1, 1, 1, 1, 1],
      narrowCodDurationSamples: [
        { queueDate: "2020-01-01", actualCod: "2023-01-01" },
        { queueDate: "2020-01-01", actualCod: "2023-07-01" },
        { queueDate: "2020-01-01", actualCod: "2024-01-01" },
        { queueDate: "2020-01-01", actualCod: "2024-07-01" },
        { queueDate: "2020-01-01", actualCod: "2025-01-01" },
      ],
      broadCodDurationSamples: [],
    });

    expect(result.studyCompletionCohort).toBe("project_type");
    expect(result.codCohort).toBe("project_type");
    expect(result.monthsToStudyCompletion).toBe(14); // p50 of [10,12,14,16,18]
    expect(result.activeQueueProjectsCount).toBe(3);
    expect(result.codP25).not.toBeNull();
    expect(result.codP50).not.toBeNull();
    expect(result.codP75).not.toBeNull();
  });

  it("falls back to the broad (iso-wide) cohort when the narrow cohort is too small", () => {
    const result = computeTimeToPower({
      anchorDate: ANCHOR,
      activeQueueProjectsCount: 0,
      narrowExecutedIaDurationsMonths: [10, 12], // below default min sample size (5)
      broadExecutedIaDurationsMonths: [10, 11, 12, 13, 14, 15],
      narrowCodDurationSamples: [],
      broadCodDurationSamples: [
        { queueDate: "2020-01-01", actualCod: "2023-01-01" },
        { queueDate: "2020-01-01", actualCod: "2023-07-01" },
        { queueDate: "2020-01-01", actualCod: "2024-01-01" },
        { queueDate: "2020-01-01", actualCod: "2024-07-01" },
        { queueDate: "2020-01-01", actualCod: "2025-01-01" },
      ],
    });

    expect(result.studyCompletionCohort).toBe("iso_wide");
    expect(result.codCohort).toBe("iso_wide");
    expect(result.monthsToStudyCompletion).not.toBeNull();
  });

  it("returns null fields with 'insufficient_data' when both cohorts are too small", () => {
    const result = computeTimeToPower({
      anchorDate: ANCHOR,
      activeQueueProjectsCount: 2,
      narrowExecutedIaDurationsMonths: [10, 12],
      broadExecutedIaDurationsMonths: [10, 12, 14],
      narrowCodDurationSamples: [],
      broadCodDurationSamples: [],
    });

    expect(result.studyCompletionCohort).toBe("insufficient_data");
    expect(result.codCohort).toBe("insufficient_data");
    expect(result.monthsToStudyCompletion).toBeNull();
    expect(result.codP25).toBeNull();
    expect(result.codP50).toBeNull();
    expect(result.codP75).toBeNull();
    // active queue depth is always computed, independent of historical sample sufficiency
    expect(result.activeQueueProjectsCount).toBe(2);
  });

  it("respects a custom minSampleSize option", () => {
    const result = computeTimeToPower(
      {
        anchorDate: ANCHOR,
        activeQueueProjectsCount: 0,
        narrowExecutedIaDurationsMonths: [10, 12, 14],
        broadExecutedIaDurationsMonths: [],
        narrowCodDurationSamples: [],
        broadCodDurationSamples: [],
      },
      { minSampleSize: 3 }
    );
    expect(result.studyCompletionCohort).toBe("project_type");
    expect(result.monthsToStudyCompletion).toBe(12); // p50 of [10,12,14]
  });

  it("filters out negative-duration data-quality outliers before checking sample size", () => {
    const result = computeTimeToPower({
      anchorDate: ANCHOR,
      activeQueueProjectsCount: 0,
      // 6 raw samples but 2 are negative (bad data) -> only 4 clean, below default min of 5
      narrowExecutedIaDurationsMonths: [10, 12, 14, 16, -5, -1],
      broadExecutedIaDurationsMonths: [],
      narrowCodDurationSamples: [],
      broadCodDurationSamples: [],
    });
    expect(result.studyCompletionCohort).toBe("insufficient_data");
  });

  it("guarantees cod_p25 <= cod_p50 <= cod_p75 by construction", () => {
    const result = computeTimeToPower({
      anchorDate: ANCHOR,
      activeQueueProjectsCount: 0,
      narrowExecutedIaDurationsMonths: [],
      broadExecutedIaDurationsMonths: [],
      narrowCodDurationSamples: Array.from({ length: 10 }, (_, i) => ({
        queueDate: "2020-01-01",
        actualCod: `202${2 + Math.floor(i / 3)}-0${(i % 9) + 1}-01`,
      })),
      broadCodDurationSamples: [],
    });
    expect(result.codP25).not.toBeNull();
    expect(result.codP25! <= result.codP50!).toBe(true);
    expect(result.codP50! <= result.codP75!).toBe(true);
  });

  it("does not use targetCod as an input — anchor is analysis.queuedAt only", () => {
    // Sanity check that the engine signature has no targetCod parameter at all;
    // this test just documents the intent alongside the others.
    const result = computeTimeToPower({
      anchorDate: ANCHOR,
      activeQueueProjectsCount: 0,
      narrowExecutedIaDurationsMonths: [1, 2, 3, 4, 5],
      broadExecutedIaDurationsMonths: [],
      narrowCodDurationSamples: [],
      broadCodDurationSamples: [],
    });
    expect(result.monthsToStudyCompletion).toBe(3);
  });
});

// ── 3. QueueAnalyticsRepository ────────────────────────────────────────────────

describe("QueueAnalyticsRepository", () => {
  function getPath(row: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => {
      if (acc == null || typeof acc !== "object") return undefined;
      return (acc as Record<string, unknown>)[key];
    }, row);
  }

  function makeQueryableClient(tables: Record<string, unknown[]>) {
    const client = {
      from: (table: string) => {
        let rows = tables[table] ?? [];
        const builder = {
          select: () => builder,
          eq: (field: string, value: unknown) => {
            rows = rows.filter((r) => getPath(r, field) === value);
            return builder;
          },
          not: (field: string, op: string, value: unknown) => {
            if (op === "is" && value === null) {
              rows = rows.filter((r) => getPath(r, field) != null);
            }
            return builder;
          },
          then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
            resolve({ data: rows, error: null }),
        };
        return builder;
      },
    };
    return client as never;
  }

  it("getExecutedIaDurationSamples returns months_in_queue_snapshot values, filtered by iso and to_status", () => {
    const client = makeQueryableClient({
      queue_project_status_history: [
        {
          tenant_id: "t1",
          iso_id: "PJM",
          to_status: "executed_ia",
          months_in_queue_snapshot: 18,
          queue_projects: { project_type: "solar" },
        },
        {
          tenant_id: "t1",
          iso_id: "PJM",
          to_status: "withdrawn", // wrong to_status -> excluded
          months_in_queue_snapshot: 5,
          queue_projects: { project_type: "solar" },
        },
        {
          tenant_id: "t1",
          iso_id: "MISO", // wrong ISO -> excluded
          to_status: "executed_ia",
          months_in_queue_snapshot: 20,
          queue_projects: { project_type: "solar" },
        },
      ],
    });
    const repo = new QueueAnalyticsRepository(client);
    return repo.getExecutedIaDurationSamples("t1", "PJM").then((samples) => {
      expect(samples).toEqual([18]);
    });
  });

  it("getExecutedIaDurationSamples filters by project_type when provided", () => {
    const client = makeQueryableClient({
      queue_project_status_history: [
        {
          tenant_id: "t1",
          iso_id: "PJM",
          to_status: "executed_ia",
          months_in_queue_snapshot: 18,
          queue_projects: { project_type: "solar" },
        },
        {
          tenant_id: "t1",
          iso_id: "PJM",
          to_status: "executed_ia",
          months_in_queue_snapshot: 22,
          queue_projects: { project_type: "wind_onshore" },
        },
      ],
    });
    const repo = new QueueAnalyticsRepository(client);
    return repo.getExecutedIaDurationSamples("t1", "PJM", "solar").then((samples) => {
      expect(samples).toEqual([18]);
    });
  });

  it("getCodDurationSamples returns queue_date/actual_cod pairs for in_service projects", () => {
    const client = makeQueryableClient({
      queue_projects: [
        {
          tenant_id: "t1",
          iso_id: "PJM",
          current_status: "in_service",
          actual_cod: "2024-01-01",
          queue_date: "2020-01-01",
          project_type: "solar",
        },
        {
          tenant_id: "t1",
          iso_id: "PJM",
          current_status: "withdrawn", // excluded
          actual_cod: null,
          queue_date: "2020-01-01",
          project_type: "solar",
        },
      ],
    });
    const repo = new QueueAnalyticsRepository(client);
    return repo.getCodDurationSamples("t1", "PJM").then((samples) => {
      expect(samples).toEqual([{ queueDate: "2020-01-01", actualCod: "2024-01-01" }]);
    });
  });
});

// ── 4. IfeRepository — ife_time_to_power ───────────────────────────────────────

describe("IfeRepository — ife_time_to_power", () => {
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

  it("createTimeToPower validates and inserts", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    const row = await repo.createTimeToPower({
      analysis_id: "a1",
      tenant_id: "t1",
      cod_p25: "2027-01-01",
      cod_p50: "2027-06-01",
      cod_p75: "2028-01-01",
      months_to_study_completion: 14,
      active_queue_projects_count: 3,
      survival_12m: null,
      survival_24m: null,
      survival_36m: null,
    });
    expect(row.analysisId).toBe("a1");
    expect(row.codP50).toBe("2027-06-01");
    expect(row.survival12m).toBeNull();
  });

  it("createTimeToPower rejects cod_p25 after cod_p50", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    await expect(
      repo.createTimeToPower({
        analysis_id: "a1",
        tenant_id: "t1",
        cod_p25: "2028-01-01",
        cod_p50: "2027-01-01",
        cod_p75: null,
        months_to_study_completion: null,
        active_queue_projects_count: 0,
        survival_12m: null,
        survival_24m: null,
        survival_36m: null,
      })
    ).rejects.toThrow("cod_p25 must be on or before cod_p50");
  });

  it("createTimeToPower rejects a negative months_to_study_completion", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    await expect(
      repo.createTimeToPower({
        analysis_id: "a1",
        tenant_id: "t1",
        cod_p25: null,
        cod_p50: null,
        cod_p75: null,
        months_to_study_completion: -1,
        active_queue_projects_count: 0,
        survival_12m: null,
        survival_24m: null,
        survival_36m: null,
      })
    ).rejects.toThrow("months_to_study_completion must be non-negative");
  });

  it("createTimeToPower rejects an out-of-range survival probability", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    await expect(
      repo.createTimeToPower({
        analysis_id: "a1",
        tenant_id: "t1",
        cod_p25: null,
        cod_p50: null,
        cod_p75: null,
        months_to_study_completion: null,
        active_queue_projects_count: 0,
        survival_12m: 1.5,
        survival_24m: null,
        survival_36m: null,
      })
    ).rejects.toThrow("survival_12m must be between 0 and 1");
  });

  it("getTimeToPowerByAnalysisId returns null when no row exists", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    const row = await repo.getTimeToPowerByAnalysisId("t1", "a1");
    expect(row).toBeNull();
  });
});

// ── 5. computeAndPersistTimeToPower pipeline ───────────────────────────────────

describe("computeAndPersistTimeToPower — pipeline", () => {
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
      queuedAt: "2026-01-15T00:00:00Z",
      startedAt: "2026-01-15T00:00:01Z",
      completedAt: "2026-01-15T00:00:02Z",
      idempotencyKey: null,
      createdAt: "2026-01-15T00:00:00Z",
      updatedAt: "2026-01-15T00:00:00Z",
      ...overrides,
    };
  }

  function makeMockIfeRepo(analysis: IfeAnalysis | null) {
    const timeToPowerStore = new Map<string, IfeTimeToPower>();
    const repo = {
      getAnalysis: vi.fn(async () => analysis),
      getTimeToPowerByAnalysisId: vi.fn(async (_t: string, id: string) => timeToPowerStore.get(id) ?? null),
      createTimeToPower: vi.fn(async (insert: Record<string, unknown>) => {
        const row = {
          id: `ttp-${uid()}`,
          analysisId: insert.analysis_id,
          tenantId: insert.tenant_id,
          codP25: insert.cod_p25,
          codP50: insert.cod_p50,
          codP75: insert.cod_p75,
          monthsToStudyCompletion: insert.months_to_study_completion,
          activeQueueProjectsCount: insert.active_queue_projects_count,
          survival12m: insert.survival_12m,
          survival24m: insert.survival_24m,
          survival36m: insert.survival_36m,
          computedAt: new Date().toISOString(),
        } as unknown as IfeTimeToPower;
        timeToPowerStore.set(insert.analysis_id as string, row);
        return row;
      }),
    };
    return { repo: repo as unknown as IfeRepository, timeToPowerStore };
  }

  function makeMockQueueRepo(depthEntries: Array<{ poi_bus_id: string; depth: number; total_mw: number }> = []) {
    return {
      getQueueDepthByBus: vi.fn(async () => depthEntries),
    } as unknown as QueueRepository;
  }

  function makeMockQueueAnalyticsRepo(opts: {
    narrowExecutedIa?: number[];
    broadExecutedIa?: number[];
    narrowCod?: Array<{ queueDate: string; actualCod: string }>;
    broadCod?: Array<{ queueDate: string; actualCod: string }>;
  } = {}) {
    return {
      getExecutedIaDurationSamples: vi.fn(async (_t: string, _iso: string, projectType?: string) =>
        projectType ? (opts.narrowExecutedIa ?? []) : (opts.broadExecutedIa ?? [])
      ),
      getCodDurationSamples: vi.fn(async (_t: string, _iso: string, projectType?: string) =>
        projectType ? (opts.narrowCod ?? []) : (opts.broadCod ?? [])
      ),
    } as unknown as QueueAnalyticsRepository;
  }

  it("computes and persists exactly one time_to_power row", async () => {
    const { repo: ifeRepo, timeToPowerStore } = makeMockIfeRepo(makeAnalysis());
    const queueRepo = makeMockQueueRepo([{ poi_bus_id: "bus-1", depth: 4, total_mw: 100 }]);
    const queueAnalyticsRepo = makeMockQueueAnalyticsRepo({
      narrowExecutedIa: [10, 12, 14, 16, 18],
      narrowCod: [
        { queueDate: "2020-01-01", actualCod: "2023-01-01" },
        { queueDate: "2020-01-01", actualCod: "2023-07-01" },
        { queueDate: "2020-01-01", actualCod: "2024-01-01" },
        { queueDate: "2020-01-01", actualCod: "2024-07-01" },
        { queueDate: "2020-01-01", actualCod: "2025-01-01" },
      ],
    });

    const { analysis, timeToPower } = await computeAndPersistTimeToPower(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      queueRepo,
      queueAnalyticsRepo
    );

    expect(analysis.id).toBe("analysis-1");
    expect(timeToPower.activeQueueProjectsCount).toBe(4);
    expect(timeToPower.monthsToStudyCompletion).toBe(14);
    expect(timeToPowerStore.size).toBe(1);
  });

  it("survival fields are always persisted as null", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo(makeAnalysis());
    const queueRepo = makeMockQueueRepo();
    const queueAnalyticsRepo = makeMockQueueAnalyticsRepo();

    await computeAndPersistTimeToPower("tenant-1", "analysis-1", ifeRepo, queueRepo, queueAnalyticsRepo);

    const insertCall = (ifeRepo.createTimeToPower as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertCall.survival_12m).toBeNull();
    expect(insertCall.survival_24m).toBeNull();
    expect(insertCall.survival_36m).toBeNull();
  });

  it("defaults active_queue_projects_count to 0 when the POI bus has no depth entry", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo(makeAnalysis());
    const queueRepo = makeMockQueueRepo([{ poi_bus_id: "some-other-bus", depth: 9, total_mw: 500 }]);
    const queueAnalyticsRepo = makeMockQueueAnalyticsRepo();

    const { timeToPower } = await computeAndPersistTimeToPower(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      queueRepo,
      queueAnalyticsRepo
    );
    expect(timeToPower.activeQueueProjectsCount).toBe(0);
  });

  it("throws when the analysis is not found", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo(null);
    const queueRepo = makeMockQueueRepo();
    const queueAnalyticsRepo = makeMockQueueAnalyticsRepo();

    await expect(
      computeAndPersistTimeToPower("tenant-1", "analysis-1", ifeRepo, queueRepo, queueAnalyticsRepo)
    ).rejects.toThrow("not found");
  });

  it("throws when the analysis is not yet completed", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo(makeAnalysis({ status: "running" }));
    const queueRepo = makeMockQueueRepo();
    const queueAnalyticsRepo = makeMockQueueAnalyticsRepo();

    await expect(
      computeAndPersistTimeToPower("tenant-1", "analysis-1", ifeRepo, queueRepo, queueAnalyticsRepo)
    ).rejects.toThrow("is not completed");
  });

  it("idempotency: a repeat call returns the existing row without recomputing", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo(makeAnalysis());
    const queueRepo = makeMockQueueRepo();
    const queueAnalyticsRepo = makeMockQueueAnalyticsRepo({ narrowExecutedIa: [1, 2, 3, 4, 5] });

    const first = await computeAndPersistTimeToPower(
      "tenant-1", "analysis-1", ifeRepo, queueRepo, queueAnalyticsRepo
    );
    const createSpy = ifeRepo.createTimeToPower as ReturnType<typeof vi.fn>;
    const callsAfterFirst = createSpy.mock.calls.length;

    const second = await computeAndPersistTimeToPower(
      "tenant-1", "analysis-1", ifeRepo, queueRepo, queueAnalyticsRepo
    );

    expect(second.timeToPower.id).toBe(first.timeToPower.id);
    expect(createSpy.mock.calls.length).toBe(callsAfterFirst); // no second insert
  });
});

// ── 6. API route — request validation ─────────────────────────────────────────

describe("POST /api/ife/analyses/[analysisId]/time-to-power — request validation", () => {
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
    const { POST } = await import("@/app/api/ife/analyses/[analysisId]/time-to-power/route");
    const request = new Request(`http://localhost/api/ife/analyses/analysis-1/time-to-power${query}`, {
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

  it("succeeds with no body at all (minSampleSize is optional)", async () => {
    const spy = vi.spyOn(ttpPipeline, "computeAndPersistTimeToPower").mockResolvedValueOnce({
      analysis: { id: "analysis-1" } as never,
      timeToPower: { id: "ttp-1" } as never,
      computeMs: 1,
    });
    try {
      const res = await callRoute("?tenant_id=t1");
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when minSampleSize is 0", async () => {
    const res = await callRoute("?tenant_id=t1", { minSampleSize: 0 });
    expect(res.status).toBe(400);
  });

  it("400s when minSampleSize is not an integer", async () => {
    const res = await callRoute("?tenant_id=t1", { minSampleSize: 2.5 });
    expect(res.status).toBe(400);
  });

  it("500s with a clear message when Supabase credentials are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callRoute("?tenant_id=t1", {});
    expect(res.status).toBe(500);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  });

  it("404s when the pipeline rejects with a 'not found' error", async () => {
    const spy = vi
      .spyOn(ttpPipeline, "computeAndPersistTimeToPower")
      .mockRejectedValueOnce(new Error("[TimeToPower] Analysis analysis-1 not found for tenant t1"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when the pipeline rejects with a precondition failure ('is not completed')", async () => {
    const spy = vi
      .spyOn(ttpPipeline, "computeAndPersistTimeToPower")
      .mockRejectedValueOnce(new Error("[TimeToPower] Analysis analysis-1 is not completed (status: running)"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
  });

  it("500s on an unrecognized pipeline error", async () => {
    const spy = vi
      .spyOn(ttpPipeline, "computeAndPersistTimeToPower")
      .mockRejectedValueOnce(new Error("boom"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 7. Performance benchmark ────────────────────────────────────────────────────

describe("computeTimeToPower — performance", () => {
  it("10k-sample percentile computation is well under 100 ms", () => {
    const samples = Array.from({ length: 10_000 }, () => Math.floor(Math.random() * 60));
    const codSamples = Array.from({ length: 10_000 }, (_, i) => ({
      queueDate: "2018-01-01",
      actualCod: `${2020 + (i % 8)}-0${(i % 9) + 1}-01`,
    }));

    const t0 = performance.now();
    const result = computeTimeToPower({
      anchorDate: "2026-01-15T00:00:00Z",
      activeQueueProjectsCount: 12,
      narrowExecutedIaDurationsMonths: samples,
      broadExecutedIaDurationsMonths: [],
      narrowCodDurationSamples: codSamples,
      broadCodDurationSamples: [],
    });
    const elapsed = performance.now() - t0;

    expect(result.monthsToStudyCompletion).not.toBeNull();
    expect(elapsed).toBeLessThan(100);
  });
});
