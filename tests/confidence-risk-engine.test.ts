/**
 * INFRA-016 — Confidence & Risk Scoring engine tests
 * (conf_model_calibration wiring — INFRA-022)
 *
 * Test plan:
 *  1. computeConfidenceRisk — bucket boundaries (data freshness, queue depth),
 *     renormalized weighted-average arithmetic, empty-set fallback to 50,
 *     custom weight overrides, componentBreakdown shape/reasons
 *  1b. computeConfidenceRisk — conf_model_calibration (INFRA-022): insufficient
 *     sample size, cost-only/COD-only/both usable, nominal-match scoring,
 *     large-deviation scoring, sample-size boundary, score bounds
 *  2. IfeRepository — ife_confidence_risk CRUD against a mocked
 *     SupabaseClient (reusing the pre-existing validateIfeConfidenceRiskInsert)
 *  2b. IfeCalibrationStatsRepository.getCoverageStats — all-NULL rows, mixed
 *     TRUE/FALSE/NULL rows, zero-row tenant, tenant scoping
 *  3. computeAndPersistConfidenceRisk pipeline — repository integration,
 *     idempotency, precondition rejections, calibration-repo wiring
 *  4. API route — request validation
 *  5. Performance benchmark
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  computeConfidenceRisk,
  type ConfidenceRiskInputs,
} from "@/lib/confidence-risk/confidence-risk-engine";
import {
  NEUTRAL_FALLBACK_SCORE,
  MIN_CALIBRATION_SAMPLE_SIZE,
  NOMINAL_COST_COVERAGE,
  NOMINAL_COD_COVERAGE,
} from "@/lib/confidence-risk/types";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { IfeCalibrationStatsRepository } from "@/lib/db/repositories/ife-calibration-stats.repository";
import * as crPipeline from "@/lib/confidence-risk/confidence-risk-pipeline";
import { computeAndPersistConfidenceRisk } from "@/lib/confidence-risk/confidence-risk-pipeline";
import type { IfeAnalysis, IfeConfidenceRisk, IfeHostingCapacity, IfeTimeToPower, IfeUpgradeResults } from "@/lib/db/types-ife";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type { NetworkModel } from "@/lib/db/types-network";

let _idCounter = 0;
function uid(): string {
  return `00000000-0000-0000-0000-${String(++_idCounter).padStart(12, "0")}`;
}

function baseInputs(overrides: Partial<ConfidenceRiskInputs> = {}): ConfidenceRiskInputs {
  return {
    networkModelDate: "2026-06-01",
    now: "2026-07-01T00:00:00Z",
    upgradeAnalysisRequired: false,
    upgradeResultsPresent: false,
    timeToPowerPresent: false,
    activeQueueProjectsCount: null,
    // No historical outcome-coverage data by default — every existing test in this
    // file relies on confModelCalibration staying null/unavailable unless a test
    // explicitly overrides these (INFRA-022).
    costCoverageRate: null,
    costSampleSize: 0,
    codCoverageRate: null,
    codSampleSize: 0,
    ...overrides,
  };
}

// ── 1. computeConfidenceRisk ────────────────────────────────────────────────────

describe("computeConfidenceRisk — data freshness buckets", () => {
  it.each([
    ["2026-06-25", 100], // 6 days
    ["2026-05-15", 80], // ~47 days
    ["2026-03-01", 60], // ~122 days
    ["2025-12-01", 40], // ~212 days
    ["2024-01-01", 20], // >365 days
  ])("model_date=%s -> confDataFreshness=%d", (modelDate, expected) => {
    const result = computeConfidenceRisk(baseInputs({ networkModelDate: modelDate }));
    expect(result.confDataFreshness).toBe(expected);
  });
});

describe("computeConfidenceRisk — queue depth buckets", () => {
  it.each([
    [0, 0],
    [2, 20],
    [5, 40],
    [10, 60],
    [20, 80],
    [21, 100],
  ])("activeQueueProjectsCount=%d -> riskQueueDepth=%d", (count, expected) => {
    const result = computeConfidenceRisk(
      baseInputs({ timeToPowerPresent: true, activeQueueProjectsCount: count })
    );
    expect(result.riskQueueDepth).toBe(expected);
  });

  it("is null when time-to-power has not been computed", () => {
    const result = computeConfidenceRisk(baseInputs({ timeToPowerPresent: false }));
    expect(result.riskQueueDepth).toBeNull();
    expect(result.componentBreakdown.risk.queueDepth.available).toBe(false);
    expect(result.componentBreakdown.risk.queueDepth.reason).toMatch(/time-to-power/);
  });
});

describe("computeConfidenceRisk — input completeness", () => {
  it("100% when upgrade not required and time-to-power is present (2 of 2 required stages done)", () => {
    const result = computeConfidenceRisk(
      baseInputs({ upgradeAnalysisRequired: false, timeToPowerPresent: true })
    );
    expect(result.confInputCompleteness).toBe(100);
  });

  it("~67% when upgrade required but not yet present, time-to-power present (2 of 3 stages)", () => {
    const result = computeConfidenceRisk(
      baseInputs({
        upgradeAnalysisRequired: true,
        upgradeResultsPresent: false,
        timeToPowerPresent: true,
      })
    );
    expect(result.confInputCompleteness).toBe(Math.round((100 * 2) / 3));
  });

  it("100% when upgrade required and both upgrade results and time-to-power are present", () => {
    const result = computeConfidenceRisk(
      baseInputs({
        upgradeAnalysisRequired: true,
        upgradeResultsPresent: true,
        timeToPowerPresent: true,
      })
    );
    expect(result.confInputCompleteness).toBe(100);
  });

  it("~33% when only hosting capacity is done (upgrade required, neither optional stage present)", () => {
    const result = computeConfidenceRisk(
      baseInputs({
        upgradeAnalysisRequired: true,
        upgradeResultsPresent: false,
        timeToPowerPresent: false,
      })
    );
    expect(result.confInputCompleteness).toBe(Math.round((100 * 1) / 3));
  });
});

describe("computeConfidenceRisk — composite scoring and componentBreakdown", () => {
  it("confidence_score is the equal-weight average of dataFreshness and inputCompleteness when those are the only available components", () => {
    const result = computeConfidenceRisk(
      baseInputs({ networkModelDate: "2026-06-25", upgradeAnalysisRequired: false, timeToPowerPresent: true })
    );
    // dataFreshness=100, inputCompleteness=100 -> average 100
    expect(result.confidenceScore).toBe(100);
    expect(result.componentBreakdown.confidence.modelCalibration.available).toBe(false);
    expect(result.componentBreakdown.confidence.mcConvergence.available).toBe(false);
  });

  it("risk_score equals risk_queue_depth alone when it is the only available risk component", () => {
    const result = computeConfidenceRisk(
      baseInputs({ timeToPowerPresent: true, activeQueueProjectsCount: 5 })
    );
    expect(result.riskScore).toBe(40);
    expect(result.componentBreakdown.risk.costUncertainty.available).toBe(false);
    expect(result.componentBreakdown.risk.congestionTrend.available).toBe(false);
    expect(result.componentBreakdown.risk.withdrawal.available).toBe(false);
  });

  it("falls back to the neutral score with an explicit fallback flag when no risk components are available", () => {
    const result = computeConfidenceRisk(baseInputs({ timeToPowerPresent: false }));
    expect(result.riskScore).toBe(NEUTRAL_FALLBACK_SCORE);
    expect(result.componentBreakdown.risk.fallback).toBe("no_components_available");
  });

  it("never sets a fallback flag on confidence, since dataFreshness/inputCompleteness are always available", () => {
    const result = computeConfidenceRisk(baseInputs());
    expect(result.componentBreakdown.confidence.fallback).toBeUndefined();
  });

  it("always keeps confidence_score and risk_score within [0, 100]", () => {
    for (const count of [0, 3, 7, 15, 50]) {
      const result = computeConfidenceRisk(
        baseInputs({ timeToPowerPresent: true, activeQueueProjectsCount: count })
      );
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(result.confidenceScore).toBeLessThanOrEqual(100);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    }
  });

  it("respects custom weight overrides", () => {
    const result = computeConfidenceRisk(
      baseInputs({ networkModelDate: "2024-01-01" /* freshness=20 */, timeToPowerPresent: true /* completeness=100 */ }),
      { confidenceWeights: { dataFreshness: 0, inputCompleteness: 100 } }
    );
    // With dataFreshness weight 0, only inputCompleteness (100) should determine the score.
    expect(result.confidenceScore).toBe(100);
  });
});

// ── 1b. computeConfidenceRisk — conf_model_calibration (INFRA-022) ────────────

describe("computeConfidenceRisk — conf_model_calibration", () => {
  it("is null when neither cost nor COD has sufficient sample size", () => {
    const result = computeConfidenceRisk(
      baseInputs({
        costCoverageRate: 0.8,
        costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE - 1,
        codCoverageRate: 0.5,
        codSampleSize: MIN_CALIBRATION_SAMPLE_SIZE - 1,
      })
    );
    expect(result.confModelCalibration).toBeNull();
    expect(result.componentBreakdown.confidence.modelCalibration.available).toBe(false);
    expect(result.componentBreakdown.confidence.modelCalibration.reason).toMatch(
      /historical outcome observations/
    );
  });

  it("is null when sample size data is entirely absent (rate null, size 0 — the zero-sample default)", () => {
    const result = computeConfidenceRisk(baseInputs());
    expect(result.confModelCalibration).toBeNull();
  });

  it("uses only the cost side when only cost has sufficient sample size", () => {
    const result = computeConfidenceRisk(
      baseInputs({
        costCoverageRate: NOMINAL_COST_COVERAGE,
        costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
        codCoverageRate: 0.5,
        codSampleSize: MIN_CALIBRATION_SAMPLE_SIZE - 1, // below threshold — excluded
      })
    );
    expect(result.confModelCalibration).toBe(100); // exact nominal match on the only usable side
  });

  it("uses only the COD side when only COD has sufficient sample size", () => {
    const result = computeConfidenceRisk(
      baseInputs({
        costCoverageRate: 0.8,
        costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE - 1, // below threshold — excluded
        codCoverageRate: NOMINAL_COD_COVERAGE,
        codSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
      })
    );
    expect(result.confModelCalibration).toBe(100);
  });

  it("combines both sides via weightedAverage when both are usable", () => {
    const result = computeConfidenceRisk(
      baseInputs({
        costCoverageRate: NOMINAL_COST_COVERAGE, // sub-score 100
        costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
        codCoverageRate: NOMINAL_COD_COVERAGE, // sub-score 100
        codSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
      })
    );
    expect(result.confModelCalibration).toBe(100);
  });

  it("scores lower the further the empirical coverage rate deviates from nominal", () => {
    const closeMatch = computeConfidenceRisk(
      baseInputs({
        costCoverageRate: NOMINAL_COST_COVERAGE - 0.05,
        costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
      })
    );
    const farMatch = computeConfidenceRisk(
      baseInputs({
        costCoverageRate: NOMINAL_COST_COVERAGE - 0.5,
        costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
      })
    );
    expect(closeMatch.confModelCalibration).not.toBeNull();
    expect(farMatch.confModelCalibration).not.toBeNull();
    expect(farMatch.confModelCalibration!).toBeLessThan(closeMatch.confModelCalibration!);
  });

  it("is usable exactly at the MIN_CALIBRATION_SAMPLE_SIZE boundary, not just above it", () => {
    const result = computeConfidenceRisk(
      baseInputs({
        costCoverageRate: NOMINAL_COST_COVERAGE,
        costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE, // exactly at the boundary
      })
    );
    expect(result.confModelCalibration).not.toBeNull();
  });

  it("never produces a score outside [0, 100] across a wide range of coverage rates", () => {
    for (const rate of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
      const result = computeConfidenceRisk(
        baseInputs({ costCoverageRate: rate, costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE })
      );
      expect(result.confModelCalibration).not.toBeNull();
      expect(result.confModelCalibration!).toBeGreaterThanOrEqual(0);
      expect(result.confModelCalibration!).toBeLessThanOrEqual(100);
    }
  });
});

// ── 2. IfeRepository — ife_confidence_risk ─────────────────────────────────────

describe("IfeRepository — ife_confidence_risk", () => {
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

  it("createConfidenceRisk validates and inserts", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    const row = await repo.createConfidenceRisk({
      analysis_id: "a1",
      tenant_id: "t1",
      confidence_score: 80,
      risk_score: 40,
      conf_data_freshness: 100,
      conf_model_calibration: null,
      conf_input_completeness: 100,
      conf_mc_convergence: null,
      risk_cost_uncertainty: null,
      risk_queue_depth: 40,
      risk_congestion_trend: null,
      risk_withdrawal: null,
      component_breakdown: { confidence: {}, risk: {} },
    });
    expect(row.analysisId).toBe("a1");
    expect(row.confidenceScore).toBe(80);
    expect(row.riskScore).toBe(40);
  });

  it("createConfidenceRisk rejects confidence_score outside [0, 100] via the pre-existing shared validator", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    await expect(
      repo.createConfidenceRisk({
        analysis_id: "a1",
        tenant_id: "t1",
        confidence_score: 150,
        risk_score: 40,
        conf_data_freshness: null,
        conf_model_calibration: null,
        conf_input_completeness: null,
        conf_mc_convergence: null,
        risk_cost_uncertainty: null,
        risk_queue_depth: null,
        risk_congestion_trend: null,
        risk_withdrawal: null,
        component_breakdown: {},
      })
    ).rejects.toThrow("confidence_score must be between 0 and 100");
  });

  it("getConfidenceRiskByAnalysisId returns null when no row exists", async () => {
    const { client } = makeMockSupabase();
    const repo = new IfeRepository(client);
    const row = await repo.getConfidenceRiskByAnalysisId("t1", "a1");
    expect(row).toBeNull();
  });
});

// ── 2b. IfeCalibrationStatsRepository.getCoverageStats (INFRA-022) ────────────

describe("IfeCalibrationStatsRepository.getCoverageStats", () => {
  function makeMockSupabase(rows: Array<{ within_cost_p10_p90: boolean | null; within_cod_p25_p75: boolean | null }>) {
    let capturedTenantId: string | undefined;
    const client = {
      from: () => ({
        select: () => ({
          eq: (_col: string, tenantId: string) => {
            capturedTenantId = tenantId;
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      }),
    };
    return { client: client as never, getCapturedTenantId: () => capturedTenantId };
  }

  it("returns null coverage rate and sampleSize 0 for a tenant with zero ife_outcome_tracking rows", async () => {
    const { client } = makeMockSupabase([]);
    const repo = new IfeCalibrationStatsRepository(client);
    const stats = await repo.getCoverageStats("t1");
    expect(stats).toEqual({
      costCoverageRate: null,
      costSampleSize: 0,
      codCoverageRate: null,
      codSampleSize: 0,
    });
  });

  it("returns null coverage rate and sampleSize 0 when every row's column is NULL", async () => {
    const { client } = makeMockSupabase([
      { within_cost_p10_p90: null, within_cod_p25_p75: null },
      { within_cost_p10_p90: null, within_cod_p25_p75: null },
    ]);
    const repo = new IfeCalibrationStatsRepository(client);
    const stats = await repo.getCoverageStats("t1");
    expect(stats.costCoverageRate).toBeNull();
    expect(stats.costSampleSize).toBe(0);
    expect(stats.codCoverageRate).toBeNull();
    expect(stats.codSampleSize).toBe(0);
  });

  it("excludes NULL rows from both numerator and denominator in mixed TRUE/FALSE/NULL data", async () => {
    // 3 true + 2 false + 5 null -> sampleSize 5, coverageRate 0.6 (NOT sampleSize 10, NOT rate 0.3)
    const { client } = makeMockSupabase([
      { within_cost_p10_p90: true, within_cod_p25_p75: null },
      { within_cost_p10_p90: true, within_cod_p25_p75: null },
      { within_cost_p10_p90: true, within_cod_p25_p75: null },
      { within_cost_p10_p90: false, within_cod_p25_p75: null },
      { within_cost_p10_p90: false, within_cod_p25_p75: null },
      { within_cost_p10_p90: null, within_cod_p25_p75: null },
      { within_cost_p10_p90: null, within_cod_p25_p75: null },
      { within_cost_p10_p90: null, within_cod_p25_p75: null },
      { within_cost_p10_p90: null, within_cod_p25_p75: null },
      { within_cost_p10_p90: null, within_cod_p25_p75: null },
    ]);
    const repo = new IfeCalibrationStatsRepository(client);
    const stats = await repo.getCoverageStats("t1");
    expect(stats.costSampleSize).toBe(5);
    expect(stats.costCoverageRate).toBeCloseTo(0.6);
  });

  it("computes cost and COD coverage independently from the same row set", async () => {
    const { client } = makeMockSupabase([
      { within_cost_p10_p90: true, within_cod_p25_p75: false },
      { within_cost_p10_p90: true, within_cod_p25_p75: false },
      { within_cost_p10_p90: false, within_cod_p25_p75: true },
      { within_cost_p10_p90: null, within_cod_p25_p75: true },
    ]);
    const repo = new IfeCalibrationStatsRepository(client);
    const stats = await repo.getCoverageStats("t1");
    expect(stats.costSampleSize).toBe(3);
    expect(stats.costCoverageRate).toBeCloseTo(2 / 3);
    expect(stats.codSampleSize).toBe(4);
    expect(stats.codCoverageRate).toBeCloseTo(2 / 4);
  });

  it("scopes the query by tenant_id", async () => {
    const { client, getCapturedTenantId } = makeMockSupabase([]);
    const repo = new IfeCalibrationStatsRepository(client);
    await repo.getCoverageStats("tenant-xyz");
    expect(getCapturedTenantId()).toBe("tenant-xyz");
  });
});

// ── 3. computeAndPersistConfidenceRisk pipeline ────────────────────────────────

describe("computeAndPersistConfidenceRisk — pipeline", () => {
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

  function makeModel(overrides: Partial<NetworkModel> = {}): NetworkModel {
    return {
      id: "model-1",
      tenantId: "tenant-1",
      iso: "PJM",
      name: "Test Model",
      version: "1.0",
      baseMva: 100,
      modelDate: "2026-06-01",
      source: "MANUAL",
      topologyHash: "hash-1",
      ptdfValid: true,
      lodfValid: true,
      busCount: 10,
      branchCount: 10,
      metadata: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  function makeMockIfeRepo(opts: {
    analysis: IfeAnalysis | null;
    hostingCapacity?: IfeHostingCapacity | null;
    upgradeResults?: IfeUpgradeResults | null;
    timeToPower?: IfeTimeToPower | null;
  }) {
    const store = new Map<string, IfeConfidenceRisk>();
    const repo = {
      getAnalysis: vi.fn(async () => opts.analysis),
      getConfidenceRiskByAnalysisId: vi.fn(async (_t: string, id: string) => store.get(id) ?? null),
      getHostingCapacityByAnalysisId: vi.fn(async () => opts.hostingCapacity ?? null),
      getUpgradeResultsByAnalysisId: vi.fn(async () => opts.upgradeResults ?? null),
      getTimeToPowerByAnalysisId: vi.fn(async () => opts.timeToPower ?? null),
      createConfidenceRisk: vi.fn(async (insert: Record<string, unknown>) => {
        const row = {
          id: `cr-${uid()}`,
          analysisId: insert.analysis_id,
          tenantId: insert.tenant_id,
          confidenceScore: insert.confidence_score,
          riskScore: insert.risk_score,
          confDataFreshness: insert.conf_data_freshness,
          confModelCalibration: insert.conf_model_calibration,
          confInputCompleteness: insert.conf_input_completeness,
          confMcConvergence: insert.conf_mc_convergence,
          riskCostUncertainty: insert.risk_cost_uncertainty,
          riskQueueDepth: insert.risk_queue_depth,
          riskCongestionTrend: insert.risk_congestion_trend,
          riskWithdrawal: insert.risk_withdrawal,
          componentBreakdown: insert.component_breakdown,
          computedAt: new Date().toISOString(),
        } as unknown as IfeConfidenceRisk;
        store.set(insert.analysis_id as string, row);
        return row;
      }),
    };
    return { repo: repo as unknown as IfeRepository, store };
  }

  function makeMockNetworkRepo(model: NetworkModel | null) {
    return { getModel: vi.fn(async () => model) } as unknown as NetworkRepository;
  }

  function makeMockCalibrationRepo(
    stats: Partial<{
      costCoverageRate: number | null;
      costSampleSize: number;
      codCoverageRate: number | null;
      codSampleSize: number;
    }> = {}
  ) {
    return {
      getCoverageStats: vi.fn(async () => ({
        costCoverageRate: null,
        costSampleSize: 0,
        codCoverageRate: null,
        codSampleSize: 0,
        ...stats,
      })),
    } as unknown as IfeCalibrationStatsRepository;
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

  it("computes and persists exactly one confidence_risk row (upgrade not required, time-to-power present)", async () => {
    const { repo: ifeRepo, store } = makeMockIfeRepo({
      analysis: makeAnalysis(),
      hostingCapacity: sufficientHc,
      timeToPower: {
        id: "ttp-1",
        analysisId: "analysis-1",
        tenantId: "tenant-1",
        codP25: null,
        codP50: null,
        codP75: null,
        monthsToStudyCompletion: null,
        activeQueueProjectsCount: 3,
        survival12m: null,
        survival24m: null,
        survival36m: null,
        computedAt: "2026-06-01T00:00:00Z",
      },
    });
    const networkRepo = makeMockNetworkRepo(makeModel());
    const calibrationRepo = makeMockCalibrationRepo();

    const { analysis, confidenceRisk } = await computeAndPersistConfidenceRisk(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      networkRepo,
      calibrationRepo
    );

    expect(analysis.id).toBe("analysis-1");
    expect(confidenceRisk.riskQueueDepth).toBe(40); // bucket for count=3
    expect(store.size).toBe(1);
  });

  it("throws when the analysis is not found", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: null });
    const networkRepo = makeMockNetworkRepo(makeModel());
    const calibrationRepo = makeMockCalibrationRepo();
    await expect(
      computeAndPersistConfidenceRisk("tenant-1", "analysis-1", ifeRepo, networkRepo, calibrationRepo)
    ).rejects.toThrow("not found");
  });

  it("throws when the analysis is not yet completed", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: makeAnalysis({ status: "running" }) });
    const networkRepo = makeMockNetworkRepo(makeModel());
    const calibrationRepo = makeMockCalibrationRepo();
    await expect(
      computeAndPersistConfidenceRisk("tenant-1", "analysis-1", ifeRepo, networkRepo, calibrationRepo)
    ).rejects.toThrow("is not completed");
  });

  it("throws when hosting capacity has not been computed (data-consistency invariant)", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: makeAnalysis(), hostingCapacity: null });
    const networkRepo = makeMockNetworkRepo(makeModel());
    const calibrationRepo = makeMockCalibrationRepo();
    await expect(
      computeAndPersistConfidenceRisk("tenant-1", "analysis-1", ifeRepo, networkRepo, calibrationRepo)
    ).rejects.toThrow("no usable hosting capacity result");
  });

  it("throws when the network model is not found", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: makeAnalysis(), hostingCapacity: sufficientHc });
    const networkRepo = makeMockNetworkRepo(null);
    const calibrationRepo = makeMockCalibrationRepo();
    await expect(
      computeAndPersistConfidenceRisk("tenant-1", "analysis-1", ifeRepo, networkRepo, calibrationRepo)
    ).rejects.toThrow("not found");
  });

  it("idempotency: a repeat call returns the existing row without recomputing", async () => {
    const { repo: ifeRepo } = makeMockIfeRepo({ analysis: makeAnalysis(), hostingCapacity: sufficientHc });
    const networkRepo = makeMockNetworkRepo(makeModel());
    const calibrationRepo = makeMockCalibrationRepo();

    const first = await computeAndPersistConfidenceRisk(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      networkRepo,
      calibrationRepo
    );
    const createSpy = ifeRepo.createConfidenceRisk as ReturnType<typeof vi.fn>;
    const callsAfterFirst = createSpy.mock.calls.length;

    const second = await computeAndPersistConfidenceRisk(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      networkRepo,
      calibrationRepo
    );

    expect(second.confidenceRisk.id).toBe(first.confidenceRisk.id);
    expect(createSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("wires coverage stats into the engine, producing a non-null conf_model_calibration when sufficient historical data exists", async () => {
    const { repo: ifeRepo, store } = makeMockIfeRepo({
      analysis: makeAnalysis(),
      hostingCapacity: sufficientHc,
    });
    const networkRepo = makeMockNetworkRepo(makeModel());
    const calibrationRepo = makeMockCalibrationRepo({
      costCoverageRate: NOMINAL_COST_COVERAGE,
      costSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
    });

    const { confidenceRisk } = await computeAndPersistConfidenceRisk(
      "tenant-1",
      "analysis-1",
      ifeRepo,
      networkRepo,
      calibrationRepo
    );

    expect(calibrationRepo.getCoverageStats).toHaveBeenCalledWith("tenant-1");
    expect(confidenceRisk.confModelCalibration).toBe(100); // exact nominal match -> perfect score
    expect(store.size).toBe(1);
  });
});

// ── 4. API route — request validation ─────────────────────────────────────────

describe("POST /api/ife/analyses/[analysisId]/confidence-risk — request validation", () => {
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
    const { POST } = await import("@/app/api/ife/analyses/[analysisId]/confidence-risk/route");
    const request = new Request(`http://localhost/api/ife/analyses/analysis-1/confidence-risk${query}`, {
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

  it("succeeds with no body at all (all weight overrides optional)", async () => {
    const spy = vi.spyOn(crPipeline, "computeAndPersistConfidenceRisk").mockResolvedValueOnce({
      analysis: { id: "analysis-1" } as never,
      confidenceRisk: { id: "cr-1" } as never,
      computeMs: 1,
    });
    try {
      const res = await callRoute("?tenant_id=t1");
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when confidenceWeights is an array", async () => {
    const res = await callRoute("?tenant_id=t1", { confidenceWeights: [1, 2] });
    expect(res.status).toBe(400);
  });

  it("400s when confidenceWeights has an unrecognized key", async () => {
    const res = await callRoute("?tenant_id=t1", { confidenceWeights: { bogus: 10 } });
    expect(res.status).toBe(400);
  });

  it("400s when a weight is negative", async () => {
    const res = await callRoute("?tenant_id=t1", { riskWeights: { queueDepth: -5 } });
    expect(res.status).toBe(400);
  });

  it("400s when a weight is not a number", async () => {
    const res = await callRoute("?tenant_id=t1", { riskWeights: { queueDepth: "high" } });
    expect(res.status).toBe(400);
  });

  it("accepts valid weight overrides", async () => {
    const spy = vi.spyOn(crPipeline, "computeAndPersistConfidenceRisk").mockResolvedValueOnce({
      analysis: { id: "analysis-1" } as never,
      confidenceRisk: { id: "cr-1" } as never,
      computeMs: 1,
    });
    try {
      const res = await callRoute("?tenant_id=t1", {
        confidenceWeights: { dataFreshness: 50, inputCompleteness: 50 },
      });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("500s with a clear message when Supabase credentials are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callRoute("?tenant_id=t1", {});
    expect(res.status).toBe(500);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  });

  it("404s when the pipeline rejects with a 'not found' error", async () => {
    const spy = vi
      .spyOn(crPipeline, "computeAndPersistConfidenceRisk")
      .mockRejectedValueOnce(new Error("[ConfidenceRisk] Analysis analysis-1 not found for tenant t1"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s when the pipeline rejects with a precondition failure ('is not completed')", async () => {
    const spy = vi
      .spyOn(crPipeline, "computeAndPersistConfidenceRisk")
      .mockRejectedValueOnce(new Error("[ConfidenceRisk] Analysis analysis-1 is not completed (status: running)"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
  });

  it("500s on an unrecognized pipeline error", async () => {
    const spy = vi
      .spyOn(crPipeline, "computeAndPersistConfidenceRisk")
      .mockRejectedValueOnce(new Error("boom"));
    try {
      const res = await callRoute("?tenant_id=t1", {});
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 5. Performance benchmark ────────────────────────────────────────────────────

describe("computeConfidenceRisk — performance", () => {
  it("10k calls complete well under 200 ms (pure arithmetic, no I/O)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      computeConfidenceRisk(
        baseInputs({ timeToPowerPresent: true, activeQueueProjectsCount: i % 25 })
      );
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
  });
});
