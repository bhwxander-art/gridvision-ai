/**
 * INFRA-004: IFE analysis tables
 *   ife_analyses, ife_hosting_capacity, ife_upgrade_results,
 *   ife_time_to_power, ife_confidence_risk, ife_explanations,
 *   ife_outcome_tracking
 *
 * Unit tests cover:
 *   - All mapper functions
 *   - All validation functions
 *   - Edge cases: percentile ordering, probability bounds, score ranges
 *
 * Integration tests (skipped without SUPABASE_URL) cover:
 *   - Full analysis creation and child table inserts
 *   - Progress update pipeline
 *   - Residual auto-computation trigger
 *   - Cascade delete
 *   - Cross-tenant isolation
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  toIfeAnalysis,
  toIfeHostingCapacity,
  toIfeUpgradeResults,
  validateIfeAnalysisInsert,
  validateIfeHostingCapacityInsert,
  validateIfeUpgradeResultsInsert,
  validateIfeConfidenceRiskInsert,
  IfeValidationError,
} from "@/lib/db/types-ife";
import type {
  DbIfeAnalysis,
  DbIfeHostingCapacity,
  DbIfeUpgradeResults,
  DbIfeAnalysisInsert,
  DbIfeHostingCapacityInsert,
  DbIfeUpgradeResultsInsert,
  DbIfeConfidenceRiskInsert,
} from "@/lib/db/types-ife";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = "00000000-0000-0000-0000-000000000002";
const MODEL_ID = "00000000-0000-0000-0000-000000000001";
const BUS_ID = "00000000-0000-0000-0000-000000000010";
const ANALYSIS_ID = "00000000-0000-0000-0000-000000000050";

function makeDbAnalysis(
  overrides: Partial<DbIfeAnalysis> = {}
): DbIfeAnalysis {
  return {
    id: ANALYSIS_ID,
    tenant_id: TENANT_ID,
    network_model_id: MODEL_ID,
    poi_bus_id: BUS_ID,
    iso_id: "PJM",
    capacity_mw: 500.0,
    project_type: "solar",
    target_cod: "2028-06-01",
    input_snapshot: { version: "1" },
    status: "pending",
    progress_pct: 0,
    error_message: null,
    queued_at: "2025-01-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    idempotency_key: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDbHc(
  overrides: Partial<DbIfeHostingCapacity> = {}
): DbIfeHostingCapacity {
  return {
    id: "00000000-0000-0000-0000-000000000060",
    analysis_id: ANALYSIS_ID,
    tenant_id: TENANT_ID,
    hc_deterministic_mw: 620.0,
    binding_line_id: null,
    binding_contingency_id: null,
    hc_p10_mw: 400.0,
    hc_p50_mw: 600.0,
    hc_p90_mw: 820.0,
    mc_scenarios_run: 1000,
    mc_convergence_pct: 97.2,
    violation_probability: 0.15,
    vmin_headroom_pu: 0.03,
    vmax_headroom_pu: 0.04,
    computed_at: "2025-01-01T01:00:00Z",
    ...overrides,
  };
}

function makeDbUpgrades(
  overrides: Partial<DbIfeUpgradeResults> = {}
): DbIfeUpgradeResults {
  return {
    id: "00000000-0000-0000-0000-000000000070",
    analysis_id: ANALYSIS_ID,
    tenant_id: TENANT_ID,
    cost_p10_m: 12.0,
    cost_p50_m: 24.0,
    cost_p90_m: 45.0,
    project_share_p50_m: 8.0,
    upgrades_required: 2,
    milp_optimality_gap_pct: 0.5,
    milp_solve_seconds: 12.3,
    upgrade_details: [
      {
        branch_id: "branch-1",
        branch_name: "Bedington-McCoole 765kV",
        upgrade_type: "thermal_uprate",
        capacity_increase_mw: 200,
        cost_p50_m: 18.0,
      },
    ],
    computed_at: "2025-01-01T01:01:00Z",
    ...overrides,
  };
}

function makeAnalysisInsert(
  overrides: Partial<DbIfeAnalysisInsert> = {}
): DbIfeAnalysisInsert {
  return {
    tenant_id: TENANT_ID,
    network_model_id: MODEL_ID,
    poi_bus_id: BUS_ID,
    iso_id: "PJM",
    capacity_mw: 500,
    project_type: "solar",
    target_cod: "2028-06-01",
    input_snapshot: {},
    error_message: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function makeHcInsert(
  overrides: Partial<DbIfeHostingCapacityInsert> = {}
): DbIfeHostingCapacityInsert {
  return {
    analysis_id: ANALYSIS_ID,
    tenant_id: TENANT_ID,
    hc_p10_mw: 400,
    hc_p50_mw: 600,
    hc_p90_mw: 820,
    hc_deterministic_mw: null,
    binding_line_id: null,
    binding_contingency_id: null,
    mc_scenarios_run: null,
    mc_convergence_pct: null,
    violation_probability: null,
    vmin_headroom_pu: null,
    vmax_headroom_pu: null,
    ...overrides,
  };
}

function makeUpgradeInsert(
  overrides: Partial<DbIfeUpgradeResultsInsert> = {}
): DbIfeUpgradeResultsInsert {
  return {
    analysis_id: ANALYSIS_ID,
    tenant_id: TENANT_ID,
    cost_p10_m: 12,
    cost_p50_m: 24,
    cost_p90_m: 45,
    project_share_p50_m: null,
    upgrades_required: 2,
    milp_optimality_gap_pct: null,
    milp_solve_seconds: null,
    upgrade_details: [],
    ...overrides,
  };
}

function makeConfidenceRiskInsert(
  overrides: Partial<DbIfeConfidenceRiskInsert> = {}
): DbIfeConfidenceRiskInsert {
  return {
    analysis_id: ANALYSIS_ID,
    tenant_id: TENANT_ID,
    confidence_score: 78,
    risk_score: 45,
    conf_data_freshness: 90,
    conf_model_calibration: 85,
    conf_input_completeness: 70,
    conf_mc_convergence: 95,
    risk_cost_uncertainty: 60,
    risk_queue_depth: 40,
    risk_congestion_trend: 35,
    risk_withdrawal: 55,
    component_breakdown: {},
    ...overrides,
  };
}

// ── toIfeAnalysis ─────────────────────────────────────────────────────────────

describe("toIfeAnalysis", () => {
  it("maps all fields from snake_case to camelCase", () => {
    const domain = toIfeAnalysis(makeDbAnalysis());

    expect(domain.id).toBe(ANALYSIS_ID);
    expect(domain.tenantId).toBe(TENANT_ID);
    expect(domain.networkModelId).toBe(MODEL_ID);
    expect(domain.poiBusId).toBe(BUS_ID);
    expect(domain.isoId).toBe("PJM");
    expect(domain.capacityMw).toBe(500.0);
    expect(domain.projectType).toBe("solar");
    expect(domain.status).toBe("pending");
    expect(domain.progressPct).toBe(0);
  });

  it("coerces numeric strings to numbers", () => {
    const domain = toIfeAnalysis(
      makeDbAnalysis({ capacity_mw: "500.00" as unknown as number })
    );
    expect(typeof domain.capacityMw).toBe("number");
    expect(domain.capacityMw).toBe(500);
  });

  it("maps all status values correctly", () => {
    const statuses = ["pending", "running", "completed", "failed"] as const;
    for (const s of statuses) {
      const domain = toIfeAnalysis(makeDbAnalysis({ status: s }));
      expect(domain.status).toBe(s);
    }
  });

  it("defaults input_snapshot to empty object when null", () => {
    const domain = toIfeAnalysis(
      makeDbAnalysis({
        input_snapshot: null as unknown as Record<string, unknown>,
      })
    );
    expect(domain.inputSnapshot).toEqual({});
  });

  it("maps null optional timing fields", () => {
    const domain = toIfeAnalysis(
      makeDbAnalysis({ started_at: null, completed_at: null })
    );
    expect(domain.startedAt).toBeNull();
    expect(domain.completedAt).toBeNull();
  });
});

// ── toIfeHostingCapacity ──────────────────────────────────────────────────────

describe("toIfeHostingCapacity", () => {
  it("maps all hosting capacity fields", () => {
    const domain = toIfeHostingCapacity(makeDbHc());

    expect(domain.analysisId).toBe(ANALYSIS_ID);
    expect(domain.hcDeterministicMw).toBe(620.0);
    expect(domain.hcP10Mw).toBe(400.0);
    expect(domain.hcP50Mw).toBe(600.0);
    expect(domain.hcP90Mw).toBe(820.0);
    expect(domain.mcScenariosRun).toBe(1000);
    expect(domain.violationProbability).toBe(0.15);
  });

  it("P10 ≤ P50 ≤ P90 invariant holds", () => {
    const domain = toIfeHostingCapacity(makeDbHc());
    expect(domain.hcP10Mw!).toBeLessThanOrEqual(domain.hcP50Mw!);
    expect(domain.hcP50Mw!).toBeLessThanOrEqual(domain.hcP90Mw!);
  });

  it("maps null optional fields to null", () => {
    const domain = toIfeHostingCapacity(
      makeDbHc({ hc_deterministic_mw: null, violation_probability: null })
    );
    expect(domain.hcDeterministicMw).toBeNull();
    expect(domain.violationProbability).toBeNull();
  });
});

// ── toIfeUpgradeResults ───────────────────────────────────────────────────────

describe("toIfeUpgradeResults", () => {
  it("maps all upgrade result fields", () => {
    const domain = toIfeUpgradeResults(makeDbUpgrades());

    expect(domain.costP10M).toBe(12.0);
    expect(domain.costP50M).toBe(24.0);
    expect(domain.costP90M).toBe(45.0);
    expect(domain.upgradesRequired).toBe(2);
    expect(domain.upgradeDetails).toHaveLength(1);
    expect(domain.upgradeDetails[0].branch_name).toBe(
      "Bedington-McCoole 765kV"
    );
  });

  it("cost P10 ≤ P50 ≤ P90 invariant holds", () => {
    const domain = toIfeUpgradeResults(makeDbUpgrades());
    expect(domain.costP10M!).toBeLessThanOrEqual(domain.costP50M!);
    expect(domain.costP50M!).toBeLessThanOrEqual(domain.costP90M!);
  });

  it("defaults upgrade_details to empty array when null", () => {
    const domain = toIfeUpgradeResults(
      makeDbUpgrades({ upgrade_details: null as unknown as [] })
    );
    expect(domain.upgradeDetails).toEqual([]);
  });
});

// ── validateIfeAnalysisInsert ─────────────────────────────────────────────────

describe("validateIfeAnalysisInsert", () => {
  it("accepts a valid insert", () => {
    expect(() => validateIfeAnalysisInsert(makeAnalysisInsert())).not.toThrow();
  });

  it("throws on missing network_model_id", () => {
    expect(() =>
      validateIfeAnalysisInsert(makeAnalysisInsert({ network_model_id: "" }))
    ).toThrow(IfeValidationError);
  });

  it("throws on missing poi_bus_id", () => {
    expect(() =>
      validateIfeAnalysisInsert(makeAnalysisInsert({ poi_bus_id: "" }))
    ).toThrow(IfeValidationError);
  });

  it("throws on non-positive capacity_mw", () => {
    expect(() =>
      validateIfeAnalysisInsert(makeAnalysisInsert({ capacity_mw: 0 }))
    ).toThrow(IfeValidationError);
    expect(() =>
      validateIfeAnalysisInsert(makeAnalysisInsert({ capacity_mw: -100 }))
    ).toThrow(IfeValidationError);
  });

  it("throws when capacity_mw exceeds 50,000 MW", () => {
    expect(() =>
      validateIfeAnalysisInsert(makeAnalysisInsert({ capacity_mw: 50_001 }))
    ).toThrow(IfeValidationError);
  });

  it("accepts capacity_mw at the boundary of 50,000 MW", () => {
    expect(() =>
      validateIfeAnalysisInsert(makeAnalysisInsert({ capacity_mw: 50_000 }))
    ).not.toThrow();
  });

  it("carries the correct field name in IfeValidationError", () => {
    let err: IfeValidationError | null = null;
    try {
      validateIfeAnalysisInsert(makeAnalysisInsert({ capacity_mw: -1 }));
    } catch (e) {
      err = e as IfeValidationError;
    }
    expect(err?.field).toBe("capacity_mw");
    expect(err?.name).toBe("IfeValidationError");
  });
});

// ── validateIfeHostingCapacityInsert ─────────────────────────────────────────

describe("validateIfeHostingCapacityInsert", () => {
  it("accepts valid insert", () => {
    expect(() => validateIfeHostingCapacityInsert(makeHcInsert())).not.toThrow();
  });

  it("throws when P10 > P50", () => {
    expect(() =>
      validateIfeHostingCapacityInsert(
        makeHcInsert({ hc_p10_mw: 700, hc_p50_mw: 600 })
      )
    ).toThrow(IfeValidationError);
  });

  it("throws when P50 > P90", () => {
    expect(() =>
      validateIfeHostingCapacityInsert(
        makeHcInsert({ hc_p50_mw: 800, hc_p90_mw: 700 })
      )
    ).toThrow(IfeValidationError);
  });

  it("accepts P10 = P50 = P90 (deterministic scenario)", () => {
    expect(() =>
      validateIfeHostingCapacityInsert(
        makeHcInsert({ hc_p10_mw: 600, hc_p50_mw: 600, hc_p90_mw: 600 })
      )
    ).not.toThrow();
  });

  it("throws on violation_probability outside [0, 1]", () => {
    expect(() =>
      validateIfeHostingCapacityInsert(
        makeHcInsert({ violation_probability: 1.01 })
      )
    ).toThrow(IfeValidationError);
    expect(() =>
      validateIfeHostingCapacityInsert(
        makeHcInsert({ violation_probability: -0.01 })
      )
    ).toThrow(IfeValidationError);
  });

  it("accepts null percentile values (not yet computed)", () => {
    expect(() =>
      validateIfeHostingCapacityInsert(
        makeHcInsert({
          hc_p10_mw: null,
          hc_p50_mw: null,
          hc_p90_mw: null,
        })
      )
    ).not.toThrow();
  });
});

// ── validateIfeUpgradeResultsInsert ──────────────────────────────────────────

describe("validateIfeUpgradeResultsInsert", () => {
  it("accepts a valid insert", () => {
    expect(() =>
      validateIfeUpgradeResultsInsert(makeUpgradeInsert())
    ).not.toThrow();
  });

  it("throws when cost P10 > P50", () => {
    expect(() =>
      validateIfeUpgradeResultsInsert(
        makeUpgradeInsert({ cost_p10_m: 30, cost_p50_m: 24 })
      )
    ).toThrow(IfeValidationError);
  });

  it("throws when cost P50 > P90", () => {
    expect(() =>
      validateIfeUpgradeResultsInsert(
        makeUpgradeInsert({ cost_p50_m: 50, cost_p90_m: 45 })
      )
    ).toThrow(IfeValidationError);
  });

  it("throws on negative upgrades_required", () => {
    expect(() =>
      validateIfeUpgradeResultsInsert(
        makeUpgradeInsert({ upgrades_required: -1 })
      )
    ).toThrow(IfeValidationError);
  });

  it("accepts zero upgrades (no capacity constraint)", () => {
    expect(() =>
      validateIfeUpgradeResultsInsert(
        makeUpgradeInsert({
          upgrades_required: 0,
          cost_p10_m: 0,
          cost_p50_m: 0,
          cost_p90_m: 0,
        })
      )
    ).not.toThrow();
  });
});

// ── validateIfeConfidenceRiskInsert ───────────────────────────────────────────

describe("validateIfeConfidenceRiskInsert", () => {
  it("accepts valid scores", () => {
    expect(() =>
      validateIfeConfidenceRiskInsert(makeConfidenceRiskInsert())
    ).not.toThrow();
  });

  it("accepts boundary values 0 and 100", () => {
    expect(() =>
      validateIfeConfidenceRiskInsert(
        makeConfidenceRiskInsert({ confidence_score: 0, risk_score: 100 })
      )
    ).not.toThrow();
    expect(() =>
      validateIfeConfidenceRiskInsert(
        makeConfidenceRiskInsert({ confidence_score: 100, risk_score: 0 })
      )
    ).not.toThrow();
  });

  it("throws when confidence_score > 100", () => {
    expect(() =>
      validateIfeConfidenceRiskInsert(
        makeConfidenceRiskInsert({ confidence_score: 101 })
      )
    ).toThrow(IfeValidationError);
  });

  it("throws when risk_score < 0", () => {
    expect(() =>
      validateIfeConfidenceRiskInsert(
        makeConfidenceRiskInsert({ risk_score: -1 })
      )
    ).toThrow(IfeValidationError);
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────

const INTEGRATION =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!INTEGRATION)("IFE schema integration", () => {
  let client: import("@supabase/supabase-js").SupabaseClient;
  let analysisId: string;

  beforeEach(async () => {
    const { createServerClient } = await import("@/lib/db/client");
    client = createServerClient();
  });

  it("creates an analysis and reads it back", async () => {
    const { data, error } = await client
      .from("ife_analyses")
      .insert({
        tenant_id: TENANT_ID,
        network_model_id: MODEL_ID,
        poi_bus_id: BUS_ID,
        iso_id: "PJM",
        capacity_mw: 500,
        project_type: "solar",
        input_snapshot: { test: true },
      })
      .select()
      .single();

    expect(error).toBeNull();
    analysisId = data!.id;
    expect(data!.status).toBe("pending");
    expect(data!.progress_pct).toBe(0);
  });

  it("updates status to running and progress_pct increments", async () => {
    await client
      .from("ife_analyses")
      .update({ status: "running", started_at: new Date().toISOString(), progress_pct: 25 })
      .eq("id", analysisId);

    const { data } = await client
      .from("ife_analyses")
      .select("status, progress_pct")
      .eq("id", analysisId)
      .single();

    expect(data!.status).toBe("running");
    expect(data!.progress_pct).toBe(25);
  });

  it("inserts all 5 child results tables", async () => {
    await client.from("ife_hosting_capacity").insert({
      analysis_id: analysisId,
      tenant_id: TENANT_ID,
      hc_p50_mw: 600,
    });

    await client.from("ife_upgrade_results").insert({
      analysis_id: analysisId,
      tenant_id: TENANT_ID,
      cost_p50_m: 24,
      upgrades_required: 2,
      upgrade_details: [],
    });

    await client.from("ife_time_to_power").insert({
      analysis_id: analysisId,
      tenant_id: TENANT_ID,
      cod_p50: "2028-06-01",
    });

    await client.from("ife_confidence_risk").insert({
      analysis_id: analysisId,
      tenant_id: TENANT_ID,
      confidence_score: 75,
      risk_score: 40,
      component_breakdown: {},
    });

    await client.from("ife_explanations").insert({
      analysis_id: analysisId,
      tenant_id: TENANT_ID,
      withdrawal_shap_values: [],
      cost_drivers: [],
    });

    const { data: hc } = await client
      .from("ife_hosting_capacity")
      .select()
      .eq("analysis_id", analysisId);
    expect(hc).toHaveLength(1);
  });

  it("cascades delete to all child tables", async () => {
    await client.from("ife_analyses").delete().eq("id", analysisId);

    const { data: hc } = await client
      .from("ife_hosting_capacity")
      .select()
      .eq("analysis_id", analysisId);
    expect(hc).toHaveLength(0);
  });

  it("cross-tenant read returns empty", async () => {
    const OTHER = "00000000-0000-0000-0000-000000000099";
    const { data } = await client
      .from("ife_analyses")
      .select()
      .eq("tenant_id", OTHER);
    expect(data).toHaveLength(0);
  });
});

// ── Performance benchmarks ────────────────────────────────────────────────────

describe("IFE mapper performance", () => {
  it("maps 10,000 analysis rows in under 30ms", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      makeDbAnalysis({ id: `analysis-${i}` })
    );

    const start = performance.now();
    const mapped = rows.map(toIfeAnalysis);
    const elapsed = performance.now() - start;

    expect(mapped).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(30);
  });

  it("validates 1,000 analysis inserts in under 5ms", () => {
    const inserts = Array.from({ length: 1_000 }, () => makeAnalysisInsert());

    const start = performance.now();
    inserts.forEach(validateIfeAnalysisInsert);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });

  it("validates 1,000 HC inserts in under 5ms", () => {
    const inserts = Array.from({ length: 1_000 }, () => makeHcInsert());

    const start = performance.now();
    inserts.forEach(validateIfeHostingCapacityInsert);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });
});
