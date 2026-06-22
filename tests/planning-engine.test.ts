import { describe, it, expect } from "vitest";
import {
  assessSubstationCapacity,
  forecastTransformerOverload,
  analyzeDataCenterImpact,
  type SubstationPlan,
  type TransformerAsset,
  type FeederCircuit,
  type DataCenterInterconnection,
} from "../lib/planning-engine";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSubstation(overrides: Partial<SubstationPlan> = {}): SubstationPlan {
  return {
    id: "ss-test",
    name: "Test Substation",
    region: "Test Region",
    voltageKV: 115,
    nameplateMVA: 200,
    peakLoadMW: 100,
    // n1CapacityMW equals nameplateMVA so N-1 headroom tracks 1:1 with headroomMW.
    // This isolates utilization-based severity thresholds in most tests.
    n1CapacityMW: 200,
    annualGrowthPct: 3,
    transformers: [],
    feeders: [],
    latitude: 42.0,
    longitude: -71.0,
    ...overrides,
  };
}

function makeTransformer(overrides: Partial<TransformerAsset> = {}): TransformerAsset {
  return {
    id: "tx-test",
    substationId: "ss-test",
    name: "T1 100 MVA",
    ratedMVA: 100,
    peakLoadMVA: 60,
    loadFactor: 0.85,
    ageYears: 15,
    n1Compliant: true,
    ...overrides,
  };
}

function makeFeeder(overrides: Partial<FeederCircuit> = {}): FeederCircuit {
  return {
    id: "fd-test",
    substationId: "ss-test",
    name: "Feeder 1",
    hostingCapacityMW: 40,
    committedLoadMW: 10,
    queuedLoadMW: 5,
    ...overrides,
  };
}

function makeProject(overrides: Partial<DataCenterInterconnection> = {}): DataCenterInterconnection {
  return {
    id: "dc-test",
    projectName: "Test DC",
    developer: "Acme",
    requestedMW: 50,
    loadFactor: 0.85,
    targetCOD: "2027-Q2",
    status: "study",
    affectedSubstationId: "ss-test",
    affectedFeederId: "fd-test",
    rampMonths: 12,
    ...overrides,
  };
}

// ── assessSubstationCapacity ──────────────────────────────────────────────────

describe("assessSubstationCapacity", () => {
  it("returns normal severity and zero CAPEX when load is well within limits", () => {
    // 100 MW / 200 MVA = 50% utilization — normal
    const result = assessSubstationCapacity(makeSubstation(), 5);

    expect(result.severity).toBe("normal");
    expect(result.estimatedCapexM).toBe(0);
    expect(result.utilizationPct).toBe(50);
  });

  it("returns watch severity when utilization is between 75% and 85%", () => {
    // 160 MW / 200 MVA = 80% utilization — watch
    const ss = makeSubstation({ peakLoadMW: 160 });
    const result = assessSubstationCapacity(ss, 5);

    expect(result.severity).toBe("watch");
    expect(result.utilizationPct).toBe(80);
  });

  it("returns constrained severity when utilization is between 85% and 95%", () => {
    // 180 MW / 200 MVA = 90% utilization — constrained
    const ss = makeSubstation({ peakLoadMW: 180 });
    const result = assessSubstationCapacity(ss, 5);

    expect(result.severity).toBe("constrained");
    expect(result.utilizationPct).toBe(90);
  });

  it("returns critical severity when utilization reaches 95%", () => {
    // 190 MW / 200 MVA = 95% utilization — critical
    const ss = makeSubstation({ peakLoadMW: 190 });
    const result = assessSubstationCapacity(ss, 5);

    expect(result.severity).toBe("critical");
    expect(result.utilizationPct).toBe(95);
  });

  it("returns critical severity when N-1 headroom drops to zero even below 95% utilization", () => {
    // 160 MW load, n1CapacityMW = 160 → n1HeadroomMW = 0 → critical
    const ss = makeSubstation({ peakLoadMW: 160, n1CapacityMW: 160 });
    const result = assessSubstationCapacity(ss, 5);

    expect(result.severity).toBe("critical");
    expect(result.n1HeadroomMW).toBe(0);
    expect(result.utilizationPct).toBe(80); // well under 95%
  });

  it("returns yearsToConstraint as null when annualGrowthPct is zero", () => {
    const ss = makeSubstation({ annualGrowthPct: 0 });
    const result = assessSubstationCapacity(ss, 5);

    expect(result.yearsToConstraint).toBeNull();
  });

  it("returns yearsToConstraint as 0 when already over nameplate capacity", () => {
    // Load exceeds nameplate — headroomMW < 0
    const ss = makeSubstation({ peakLoadMW: 210, nameplateMVA: 200 });
    const result = assessSubstationCapacity(ss, 5);

    expect(result.yearsToConstraint).toBe(0);
    expect(result.headroomMW).toBe(-10);
  });

  it("additionalLoadMW shifts utilization and can change severity", () => {
    // Base: 100/200 = 50% (normal). Adding 100 MW → 200/200 = 100% (critical)
    const base = assessSubstationCapacity(makeSubstation(), 5, 0);
    const stressed = assessSubstationCapacity(makeSubstation(), 5, 100);

    expect(base.severity).toBe("normal");
    expect(stressed.severity).toBe("critical");
    expect(stressed.utilizationPct).toBe(100);
  });
});

// ── forecastTransformerOverload ───────────────────────────────────────────────

describe("forecastTransformerOverload", () => {
  it("returns normal risk when forecast loading stays well below rated capacity", () => {
    // 60 MVA load, 3% growth, 0 DC load → forecast = 61.8 → 61.8% loading
    const result = forecastTransformerOverload(makeTransformer(), 3, 0);

    expect(result.overloadRisk).toBe("normal");
    expect(result.loadingPct).toBe(60);
    expect(result.forecastLoadingPct).toBeCloseTo(61.8, 1);
  });

  it("returns critical risk when forecast loading meets or exceeds 100% of rated", () => {
    // 95 MVA load on 100 MVA transformer, 10% growth, 10 MW DC → exceeds 100%
    const tx = makeTransformer({ ratedMVA: 100, peakLoadMVA: 95 });
    const result = forecastTransformerOverload(tx, 10, 10);

    // forecastPeakMVA = 95 * 1.1 + 10 * 0.85 = 104.5 + 8.5 = 113
    expect(result.overloadRisk).toBe("critical");
    expect(result.forecastLoadingPct).toBeGreaterThanOrEqual(100);
    expect(result.thermalMarginMVA).toBeLessThan(0);
  });
});

// ── analyzeDataCenterImpact ───────────────────────────────────────────────────

describe("analyzeDataCenterImpact", () => {
  it("sets constraintFlag when the project exhausts feeder headroom", () => {
    // hostingCapacity 40, committed 10, queued 5, netLoad = 50 * 0.85 = 42.5
    // headroomAfter = 40 - 10 - 5 - 42.5 = -17.5 → constraint
    const project = makeProject({ requestedMW: 50, loadFactor: 0.85 });
    const ss = makeSubstation();
    const feeder = makeFeeder({ hostingCapacityMW: 40, committedLoadMW: 10, queuedLoadMW: 5 });

    const result = analyzeDataCenterImpact(project, ss, feeder);

    expect(result.constraintFlag).toBe(true);
    expect(result.feederHeadroomAfterMW).toBeLessThan(0);
    expect(result.netLoadMW).toBeCloseTo(42.5, 5);
  });
});
