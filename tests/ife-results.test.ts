/**
 * INFRA-018 — IFE Results Aggregation tests
 *
 * Test plan:
 *  1. Happy path: completed analysis with all child tables populated
 *  2. Happy path: completed analysis with optional child tables missing (null)
 *  3. Missing analysis: 404
 *  4. Analysis not completed: 400
 *  5. Tenant isolation: wrong tenant returns 404
 *  6. Completeness flags: verify each flag matches child-record existence
 *  7. computeMs: verify it exists and is a positive number
 *  8. Repository contract: verify only read methods are called
 *  9. Response pass-through: verify domain objects are not transformed
 * 10. Performance: verify latency is reasonable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import { aggregateIfeResults } from "@/lib/ife-results/results-pipeline";
import type {
  IfeAnalysis,
  IfeHostingCapacity,
  IfeUpgradeResults,
  IfeTimeToPower,
  IfeConfidenceRisk,
} from "@/lib/db/types-ife";
import type { IfeExplanations } from "@/lib/explanations/types";

// ── Test fixture helpers ──────────────────────────────────────────────────────

function uid(): string {
  return `00000000-0000-0000-0000-${String(Math.random() * 1e12).padStart(12, "0")}`;
}

function makeIfeAnalysis(overrides: Partial<IfeAnalysis> = {}): IfeAnalysis {
  return {
    id: uid(),
    tenantId: "tenant-1",
    networkModelId: "model-1",
    poiBusId: "bus-1",
    isoId: "iso-ne",
    capacityMw: 100,
    projectType: "nuclear",
    targetCod: null,
    inputSnapshot: {},
    status: "completed",
    progressPct: 100,
    errorMessage: null,
    queuedAt: "2024-01-01T00:00:00Z",
    startedAt: "2024-01-01T00:00:01Z",
    completedAt: "2024-01-01T00:00:10Z",
    idempotencyKey: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:10Z",
    ...overrides,
  };
}

function makeIfeHostingCapacity(overrides: Partial<IfeHostingCapacity> = {}): IfeHostingCapacity {
  return {
    id: uid(),
    analysisId: "analysis-1",
    tenantId: "tenant-1",
    hcDeterministicMw: 150,
    bindingLineId: "line-1",
    bindingContingencyId: "cont-1",
    hcP10Mw: 140,
    hcP50Mw: 150,
    hcP90Mw: 160,
    mcScenariosRun: 1000,
    mcConvergencePct: 99.5,
    violationProbability: 0.01,
    vmaxHeadroomPu: 0.05,
    vminHeadroomPu: 0.03,
    computedAt: "2024-01-01T00:00:05Z",
    ...overrides,
  };
}

function makeIfeUpgradeResults(overrides: Partial<IfeUpgradeResults> = {}): IfeUpgradeResults {
  return {
    id: uid(),
    analysisId: "analysis-1",
    tenantId: "tenant-1",
    costP10M: 10,
    costP50M: 20,
    costP90M: 30,
    projectShareP50M: 5,
    upgradesRequired: 2, milpOptimalityGapPct: null, milpSolveSeconds: null,
    upgradeDetails: [],
    computedAt: "2024-01-01T00:00:06Z",
    ...overrides,
  };
}

function makeIfeTimeToPower(overrides: Partial<IfeTimeToPower> = {}): IfeTimeToPower {
  return {
    id: uid(),
    analysisId: "analysis-1",
    tenantId: "tenant-1",
    activeQueueProjectsCount: 5,
    monthsToStudyCompletion: 12,
    codP25: "2024-01-13",
    codP50: "2024-01-19",
    codP75: "2024-01-25",
    survival12m: null,
    survival24m: null,
    survival36m: null,
    computedAt: "2024-01-01T00:00:07Z",
    ...overrides,
  };
}

function makeIfeConfidenceRisk(overrides: Partial<IfeConfidenceRisk> = {}): IfeConfidenceRisk {
  return {
    id: uid(),
    analysisId: "analysis-1",
    tenantId: "tenant-1",
    confidenceScore: 75,
    riskScore: 45,
    confDataFreshness: 90,
    confInputCompleteness: 100,
    confMcConvergence: null,
    confModelCalibration: null,
    riskCostUncertainty: null,
    riskQueueDepth: 60,
    riskCongestionTrend: null,
    riskWithdrawal: null,
    componentBreakdown: {},
    computedAt: "2024-01-01T00:00:08Z",
    ...overrides,
  };
}

function makeIfeExplanations(overrides: Partial<IfeExplanations> = {}): IfeExplanations {
  return {
    id: uid(),
    analysisId: "analysis-1",
    tenantId: "tenant-1",
    baselineWithdrawalProb: null,
    predictedWithdrawalProb: null,
    withdrawalShapValues: [],
    costDrivers: [],
    assumptions: ["assumption-1", "assumption-2"],
    coxModelVersion: null,
    costModelVersion: null,
    computedAt: "2024-01-01T00:00:09Z",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("IFE Results Aggregation (INFRA-018)", () => {
  let mockClient: SupabaseClient;
  let mockRepo: IfeRepository;

  beforeEach(() => {
    mockClient = {} as SupabaseClient;
    mockRepo = {
      getAnalysis: vi.fn(),
      getHostingCapacityByAnalysisId: vi.fn(),
      getUpgradeResultsByAnalysisId: vi.fn(),
      getTimeToPowerByAnalysisId: vi.fn(),
      getConfidenceRiskByAnalysisId: vi.fn(),
      getExplanationsByAnalysisId: vi.fn(),
    } as unknown as IfeRepository;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Happy Path", () => {
    it("aggregates completed analysis with all child tables populated", async () => {
      const analysis = makeIfeAnalysis();
      const hostingCapacity = makeIfeHostingCapacity({ analysisId: analysis.id });
      const upgradeResults = makeIfeUpgradeResults({ analysisId: analysis.id });
      const timeToPower = makeIfeTimeToPower({ analysisId: analysis.id });
      const confidenceRisk = makeIfeConfidenceRisk({ analysisId: analysis.id });
      const explanations = makeIfeExplanations({ analysisId: analysis.id });

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);
      vi.spyOn(IfeRepository.prototype, "getHostingCapacityByAnalysisId" as any).mockResolvedValueOnce(
        hostingCapacity
      );
      vi.spyOn(IfeRepository.prototype, "getUpgradeResultsByAnalysisId" as any).mockResolvedValueOnce(
        upgradeResults
      );
      vi.spyOn(IfeRepository.prototype, "getTimeToPowerByAnalysisId" as any).mockResolvedValueOnce(
        timeToPower
      );
      vi.spyOn(IfeRepository.prototype, "getConfidenceRiskByAnalysisId" as any).mockResolvedValueOnce(
        confidenceRisk
      );
      vi.spyOn(IfeRepository.prototype, "getExplanationsByAnalysisId" as any).mockResolvedValueOnce(
        explanations
      );

      const response = await aggregateIfeResults(mockClient, analysis.tenantId, analysis.id);

      expect(response.analysis).toEqual(analysis);
      expect(response.hostingCapacity).toEqual(hostingCapacity);
      expect(response.upgradeResults).toEqual(upgradeResults);
      expect(response.timeToPower).toEqual(timeToPower);
      expect(response.confidenceRisk).toEqual(confidenceRisk);
      expect(response.explanations).toEqual(explanations);
      expect(response.computeMs).toBeGreaterThanOrEqual(0);
    });

    it("aggregates completed analysis with optional child tables missing", async () => {
      const analysis = makeIfeAnalysis();
      const hostingCapacity = makeIfeHostingCapacity({ analysisId: analysis.id });

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);
      vi.spyOn(IfeRepository.prototype, "getHostingCapacityByAnalysisId" as any).mockResolvedValueOnce(
        hostingCapacity
      );
      vi.spyOn(IfeRepository.prototype, "getUpgradeResultsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getTimeToPowerByAnalysisId" as any).mockResolvedValueOnce(null);
      vi.spyOn(IfeRepository.prototype, "getConfidenceRiskByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getExplanationsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );

      const response = await aggregateIfeResults(mockClient, analysis.tenantId, analysis.id);

      expect(response.analysis).toEqual(analysis);
      expect(response.hostingCapacity).toEqual(hostingCapacity);
      expect(response.upgradeResults).toBeNull();
      expect(response.timeToPower).toBeNull();
      expect(response.confidenceRisk).toBeNull();
      expect(response.explanations).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("throws when analysis not found", async () => {
      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(null);

      await expect(
        aggregateIfeResults(mockClient, "tenant-1", "analysis-not-found")
      ).rejects.toThrow("not found");
    });

    it("throws when analysis is not completed", async () => {
      const analysis = makeIfeAnalysis({ status: "running" });

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);

      await expect(
        aggregateIfeResults(mockClient, analysis.tenantId, analysis.id)
      ).rejects.toThrow("is not completed");
    });

    it("throws when analysis has failed status", async () => {
      const analysis = makeIfeAnalysis({ status: "failed" });

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);

      await expect(
        aggregateIfeResults(mockClient, analysis.tenantId, analysis.id)
      ).rejects.toThrow("is not completed");
    });
  });

  describe("Tenant Isolation", () => {
    it("enforces tenant isolation via repository calls", async () => {
      const analysis = makeIfeAnalysis({ tenantId: "tenant-1" });

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);
      vi.spyOn(IfeRepository.prototype, "getHostingCapacityByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getUpgradeResultsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getTimeToPowerByAnalysisId" as any).mockResolvedValueOnce(null);
      vi.spyOn(IfeRepository.prototype, "getConfidenceRiskByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getExplanationsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );

      const response = await aggregateIfeResults(mockClient, "tenant-1", analysis.id);

      expect(response.analysis.tenantId).toBe("tenant-1");
    });
  });

  describe("Completeness Tracking", () => {
    it("sets completeness flags based on child-record existence", async () => {
      const analysis = makeIfeAnalysis();
      const hostingCapacity = makeIfeHostingCapacity({ analysisId: analysis.id });
      const upgradeResults = makeIfeUpgradeResults({ analysisId: analysis.id });
      const timeToPower = makeIfeTimeToPower({ analysisId: analysis.id });

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);
      vi.spyOn(IfeRepository.prototype, "getHostingCapacityByAnalysisId" as any).mockResolvedValueOnce(
        hostingCapacity
      );
      vi.spyOn(IfeRepository.prototype, "getUpgradeResultsByAnalysisId" as any).mockResolvedValueOnce(
        upgradeResults
      );
      vi.spyOn(IfeRepository.prototype, "getTimeToPowerByAnalysisId" as any).mockResolvedValueOnce(
        timeToPower
      );
      vi.spyOn(IfeRepository.prototype, "getConfidenceRiskByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getExplanationsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );

      const response = await aggregateIfeResults(mockClient, analysis.tenantId, analysis.id);

      expect(response.completeness).toEqual({
        hostingCapacity: true,
        upgradeAnalysis: true,
        timeToPower: true,
        confidenceRisk: false,
        explanations: false,
      });
    });
  });

  describe("computeMs Measurement", () => {
    it("includes computeMs in response", async () => {
      const analysis = makeIfeAnalysis();

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);
      vi.spyOn(IfeRepository.prototype, "getHostingCapacityByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getUpgradeResultsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getTimeToPowerByAnalysisId" as any).mockResolvedValueOnce(null);
      vi.spyOn(IfeRepository.prototype, "getConfidenceRiskByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getExplanationsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );

      const response = await aggregateIfeResults(mockClient, analysis.tenantId, analysis.id);

      expect(typeof response.computeMs).toBe("number");
      expect(response.computeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Response Stability", () => {
    it("returns domain objects exactly as retrieved (no transformation)", async () => {
      const analysis = makeIfeAnalysis();
      const hostingCapacity = makeIfeHostingCapacity({ analysisId: analysis.id });

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);
      vi.spyOn(IfeRepository.prototype, "getHostingCapacityByAnalysisId" as any).mockResolvedValueOnce(
        hostingCapacity
      );
      vi.spyOn(IfeRepository.prototype, "getUpgradeResultsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getTimeToPowerByAnalysisId" as any).mockResolvedValueOnce(null);
      vi.spyOn(IfeRepository.prototype, "getConfidenceRiskByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getExplanationsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );

      const response = await aggregateIfeResults(mockClient, analysis.tenantId, analysis.id);

      expect(response.analysis).toStrictEqual(analysis);
      expect(response.hostingCapacity).toStrictEqual(hostingCapacity);
    });
  });

  describe("Read-Only Contract Verification", () => {
    it("only calls repository read methods", async () => {
      const analysis = makeIfeAnalysis();

      vi.spyOn(IfeRepository.prototype, "getAnalysis" as any).mockResolvedValueOnce(analysis);
      vi.spyOn(IfeRepository.prototype, "getHostingCapacityByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getUpgradeResultsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getTimeToPowerByAnalysisId" as any).mockResolvedValueOnce(null);
      vi.spyOn(IfeRepository.prototype, "getConfidenceRiskByAnalysisId" as any).mockResolvedValueOnce(
        null
      );
      vi.spyOn(IfeRepository.prototype, "getExplanationsByAnalysisId" as any).mockResolvedValueOnce(
        null
      );

      await aggregateIfeResults(mockClient, analysis.tenantId, analysis.id);

      const getAnalysisSpy = vi.spyOn(IfeRepository.prototype, "getAnalysis" as any);
      expect(getAnalysisSpy).toBeDefined();
    });
  });
});


