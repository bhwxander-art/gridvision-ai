/**
 * INFRA-001: network_models / network_buses / network_branches
 *
 * Unit tests cover:
 *   - Row → domain mappers
 *   - All validation rules enforced by the repository layer
 *   - Topology delta detection logic
 *
 * Integration tests (skipped without SUPABASE_URL) cover:
 *   - Full CRUD round-trips
 *   - Denormalised bus_count / branch_count maintenance
 *   - topology_hash + ptdf_valid invalidation trigger
 *   - RLS: cross-tenant reads return null
 *   - Cascade deletes
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  toNetworkModel,
  toNetworkBus,
  toNetworkBranch,
  validateNetworkModelInsert,
  validateNetworkBusInsert,
  validateNetworkBranchInsert,
  NetworkValidationError,
  NetworkRepository,
} from "@/lib/db/repositories/network.repository";
import type {
  DbNetworkModel,
  DbNetworkBus,
  DbNetworkBranch,
  DbNetworkModelInsert,
  DbNetworkBusInsert,
  DbNetworkBranchInsert,
} from "@/lib/db/types-network";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MODEL_ID = "00000000-0000-0000-0000-000000000001";
const TENANT_ID = "00000000-0000-0000-0000-000000000002";
const BUS_A_ID = "00000000-0000-0000-0000-000000000010";
const BUS_B_ID = "00000000-0000-0000-0000-000000000011";

function makeDbModel(overrides: Partial<DbNetworkModel> = {}): DbNetworkModel {
  return {
    id: MODEL_ID,
    tenant_id: TENANT_ID,
    iso: "PJM",
    name: "PJM Summer 2025 Peak",
    version: "1.0",
    base_mva: 100.0,
    model_date: "2025-06-15",
    source: "CIM_XML",
    topology_hash: null,
    ptdf_valid: false,
    lodf_valid: false,
    bus_count: 0,
    branch_count: 0,
    metadata: {},
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDbBus(overrides: Partial<DbNetworkBus> = {}): DbNetworkBus {
  return {
    id: BUS_A_ID,
    model_id: MODEL_ID,
    tenant_id: TENANT_ID,
    bus_number: 1,
    name: "BUS-1",
    base_kv: 115.0,
    bus_type: "PQ",
    latitude: 40.0,
    longitude: -75.0,
    zone: "ZONE_A",
    area: null,
    vmin_pu: 0.95,
    vmax_pu: 1.05,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDbBranch(
  overrides: Partial<DbNetworkBranch> = {}
): DbNetworkBranch {
  return {
    id: "00000000-0000-0000-0000-000000000020",
    model_id: MODEL_ID,
    tenant_id: TENANT_ID,
    branch_number: 1,
    name: "LINE-1-2",
    branch_type: "LINE",
    from_bus_id: BUS_A_ID,
    to_bus_id: BUS_B_ID,
    r_pu: 0.01938,
    x_pu: 0.05917,
    b_pu: 0.02640,
    rate_a_mw: 400.0,
    rate_b_mw: 430.0,
    rate_c_mw: 500.0,
    tap_ratio: 1.0,
    phase_shift_deg: 0.0,
    in_service: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeModelInsert(
  overrides: Partial<DbNetworkModelInsert> = {}
): DbNetworkModelInsert {
  return {
    tenant_id: TENANT_ID,
    iso: "PJM",
    name: "Test Model",
    version: "1.0",
    base_mva: 100,
    model_date: "2025-06-15",
    source: "MANUAL",
    metadata: {},
    ...overrides,
  };
}

function makeBusInsert(
  overrides: Partial<DbNetworkBusInsert> = {}
): DbNetworkBusInsert {
  return {
    model_id: MODEL_ID,
    tenant_id: TENANT_ID,
    bus_number: 1,
    name: "BUS-1",
    base_kv: 115.0,
    bus_type: "PQ",
    latitude: null,
    longitude: null,
    zone: null,
    area: null,
    ...overrides,
  };
}

function makeBranchInsert(
  overrides: Partial<DbNetworkBranchInsert> = {}
): DbNetworkBranchInsert {
  return {
    model_id: MODEL_ID,
    tenant_id: TENANT_ID,
    branch_number: 1,
    name: "LINE-1-2",
    branch_type: "LINE",
    from_bus_id: BUS_A_ID,
    to_bus_id: BUS_B_ID,
    r_pu: 0.01938,
    x_pu: 0.05917,
    b_pu: 0.026,
    rate_a_mw: 400,
    tap_ratio: 1.0,
    phase_shift_deg: 0.0,
    in_service: true,
    ...overrides,
  };
}

// ── Mapper tests ──────────────────────────────────────────────────────────────

describe("toNetworkModel", () => {
  it("maps snake_case columns to camelCase domain fields", () => {
    const row = makeDbModel({
      topology_hash: "abc123",
      ptdf_valid: true,
      bus_count: 14,
      branch_count: 20,
    });
    const domain = toNetworkModel(row);

    expect(domain.id).toBe(MODEL_ID);
    expect(domain.tenantId).toBe(TENANT_ID);
    expect(domain.iso).toBe("PJM");
    expect(domain.baseMva).toBe(100.0);
    expect(domain.modelDate).toBe("2025-06-15");
    expect(domain.topologyHash).toBe("abc123");
    expect(domain.ptdfValid).toBe(true);
    expect(domain.busCount).toBe(14);
    expect(domain.branchCount).toBe(20);
  });

  it("coerces numeric strings from Postgres to JS numbers", () => {
    // Supabase returns NUMERIC columns as strings in some drivers
    const row = makeDbModel({ base_mva: "100.00" as unknown as number });
    const domain = toNetworkModel(row);
    expect(typeof domain.baseMva).toBe("number");
    expect(domain.baseMva).toBe(100.0);
  });

  it("preserves null topology_hash", () => {
    const domain = toNetworkModel(makeDbModel({ topology_hash: null }));
    expect(domain.topologyHash).toBeNull();
  });

  it("defaults metadata to empty object when null", () => {
    const domain = toNetworkModel(
      makeDbModel({ metadata: null as unknown as Record<string, unknown> })
    );
    expect(domain.metadata).toEqual({});
  });
});

describe("toNetworkBus", () => {
  it("maps all bus fields correctly", () => {
    const row = makeDbBus();
    const domain = toNetworkBus(row);

    expect(domain.busNumber).toBe(1);
    expect(domain.baseKv).toBe(115.0);
    expect(domain.busType).toBe("PQ");
    expect(domain.latitude).toBe(40.0);
    expect(domain.longitude).toBe(-75.0);
    expect(domain.vminPu).toBe(0.95);
    expect(domain.vmaxPu).toBe(1.05);
  });

  it("maps null latitude and longitude to null", () => {
    const row = makeDbBus({ latitude: null, longitude: null });
    const domain = toNetworkBus(row);
    expect(domain.latitude).toBeNull();
    expect(domain.longitude).toBeNull();
  });

  it("coerces bus_number from Postgres to JS number", () => {
    const row = makeDbBus({ bus_number: "42" as unknown as number });
    const domain = toNetworkBus(row);
    expect(typeof domain.busNumber).toBe("number");
    expect(domain.busNumber).toBe(42);
  });
});

describe("toNetworkBranch", () => {
  it("maps all branch fields correctly", () => {
    const row = makeDbBranch();
    const domain = toNetworkBranch(row);

    expect(domain.branchNumber).toBe(1);
    expect(domain.branchType).toBe("LINE");
    expect(domain.fromBusId).toBe(BUS_A_ID);
    expect(domain.toBusId).toBe(BUS_B_ID);
    expect(domain.rPu).toBeCloseTo(0.01938);
    expect(domain.xPu).toBeCloseTo(0.05917);
    expect(domain.bPu).toBeCloseTo(0.0264);
    expect(domain.rateAMw).toBe(400.0);
    expect(domain.tapRatio).toBe(1.0);
    expect(domain.inService).toBe(true);
  });

  it("maps null rate_b_mw and rate_c_mw to null", () => {
    const row = makeDbBranch({ rate_b_mw: null, rate_c_mw: null });
    const domain = toNetworkBranch(row);
    expect(domain.rateBMw).toBeNull();
    expect(domain.rateCMw).toBeNull();
  });

  it("maps in_service=false correctly", () => {
    const row = makeDbBranch({ in_service: false });
    const domain = toNetworkBranch(row);
    expect(domain.inService).toBe(false);
  });
});

// ── validateNetworkModelInsert ────────────────────────────────────────────────

describe("validateNetworkModelInsert", () => {
  it("accepts a valid insert", () => {
    expect(() => validateNetworkModelInsert(makeModelInsert())).not.toThrow();
  });

  it("throws on empty name", () => {
    expect(() =>
      validateNetworkModelInsert(makeModelInsert({ name: "" }))
    ).toThrow(NetworkValidationError);
    expect(() =>
      validateNetworkModelInsert(makeModelInsert({ name: "   " }))
    ).toThrow(NetworkValidationError);
  });

  it("throws on non-positive base_mva", () => {
    expect(() =>
      validateNetworkModelInsert(makeModelInsert({ base_mva: 0 }))
    ).toThrow(NetworkValidationError);
    expect(() =>
      validateNetworkModelInsert(makeModelInsert({ base_mva: -100 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws on badly formatted model_date", () => {
    expect(() =>
      validateNetworkModelInsert(makeModelInsert({ model_date: "2025/06/15" }))
    ).toThrow(NetworkValidationError);
    expect(() =>
      validateNetworkModelInsert(makeModelInsert({ model_date: "June 2025" }))
    ).toThrow(NetworkValidationError);
  });

  it("accepts valid model_date in YYYY-MM-DD format", () => {
    expect(() =>
      validateNetworkModelInsert(makeModelInsert({ model_date: "2030-12-31" }))
    ).not.toThrow();
  });
});

// ── validateNetworkBusInsert ──────────────────────────────────────────────────

describe("validateNetworkBusInsert", () => {
  it("accepts a valid insert", () => {
    expect(() => validateNetworkBusInsert(makeBusInsert())).not.toThrow();
  });

  it("throws on negative bus_number", () => {
    expect(() =>
      validateNetworkBusInsert(makeBusInsert({ bus_number: -1 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws on empty name", () => {
    expect(() =>
      validateNetworkBusInsert(makeBusInsert({ name: "" }))
    ).toThrow(NetworkValidationError);
  });

  it("throws on non-positive base_kv", () => {
    expect(() =>
      validateNetworkBusInsert(makeBusInsert({ base_kv: 0 }))
    ).toThrow(NetworkValidationError);
    expect(() =>
      validateNetworkBusInsert(makeBusInsert({ base_kv: -115 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws when vmin_pu is below 0.5", () => {
    expect(() =>
      validateNetworkBusInsert(makeBusInsert({ vmin_pu: 0.4 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws when vmin_pu exceeds 1.0", () => {
    expect(() =>
      validateNetworkBusInsert(makeBusInsert({ vmin_pu: 1.1 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws when vmax_pu is below 1.0", () => {
    expect(() =>
      validateNetworkBusInsert(makeBusInsert({ vmax_pu: 0.99 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws when vmax_pu exceeds 1.5", () => {
    expect(() =>
      validateNetworkBusInsert(makeBusInsert({ vmax_pu: 1.6 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws when vmax_pu <= vmin_pu", () => {
    expect(() =>
      validateNetworkBusInsert(
        makeBusInsert({ vmin_pu: 0.98, vmax_pu: 0.97 })
      )
    ).toThrow(NetworkValidationError);

    // Equal values
    expect(() =>
      validateNetworkBusInsert(
        makeBusInsert({ vmin_pu: 1.0, vmax_pu: 1.0 })
      )
    ).toThrow(NetworkValidationError);
  });
});

// ── validateNetworkBranchInsert ───────────────────────────────────────────────

describe("validateNetworkBranchInsert", () => {
  it("accepts a valid insert", () => {
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert())
    ).not.toThrow();
  });

  it("throws on negative branch_number", () => {
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ branch_number: -1 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws on empty name", () => {
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ name: "" }))
    ).toThrow(NetworkValidationError);
  });

  it("throws when from_bus_id equals to_bus_id (self-loop)", () => {
    expect(() =>
      validateNetworkBranchInsert(
        makeBranchInsert({ from_bus_id: BUS_A_ID, to_bus_id: BUS_A_ID })
      )
    ).toThrow(NetworkValidationError);
  });

  it("throws when x_pu is zero", () => {
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ x_pu: 0 }))
    ).toThrow(NetworkValidationError);
  });

  it("accepts negative x_pu (capacitive line sections)", () => {
    // Some shunt compensation branches have negative net reactance
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ x_pu: -0.001 }))
    ).not.toThrow();
  });

  it("throws on non-positive rate_a_mw", () => {
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ rate_a_mw: 0 }))
    ).toThrow(NetworkValidationError);
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ rate_a_mw: -100 }))
    ).toThrow(NetworkValidationError);
  });

  it("throws on non-positive tap_ratio", () => {
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ tap_ratio: 0 }))
    ).toThrow(NetworkValidationError);
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ tap_ratio: -1 }))
    ).toThrow(NetworkValidationError);
  });

  it("accepts tap_ratio > 1 (regulating transformers)", () => {
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ tap_ratio: 1.05 }))
    ).not.toThrow();
  });

  it("accepts zero r_pu (superconducting or simplified models)", () => {
    expect(() =>
      validateNetworkBranchInsert(makeBranchInsert({ r_pu: 0 }))
    ).not.toThrow();
  });
});

// ── NetworkValidationError ────────────────────────────────────────────────────

describe("NetworkValidationError", () => {
  it("carries the field name that caused the error", () => {
    let caught: NetworkValidationError | null = null;
    try {
      validateNetworkBusInsert(makeBusInsert({ base_kv: -1 }));
    } catch (err) {
      caught = err as NetworkValidationError;
    }
    expect(caught).toBeInstanceOf(NetworkValidationError);
    expect(caught?.field).toBe("base_kv");
    expect(caught?.name).toBe("NetworkValidationError");
  });
});

// ── hasTopologyChanged (unit) ─────────────────────────────────────────────────

describe("NetworkRepository.hasTopologyChanged (unit)", () => {
  function makeClientStub(hash: string | null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: hash !== undefined ? { topology_hash: hash } : null,
                  error: null,
                }),
            }),
          }),
        }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
  }

  it("returns false when hash matches", async () => {
    const repo = new NetworkRepository(makeClientStub("abc123"));
    const result = await repo.hasTopologyChanged(TENANT_ID, MODEL_ID, "abc123");
    expect(result).toBe(false);
  });

  it("returns true when hash differs", async () => {
    const repo = new NetworkRepository(makeClientStub("abc123"));
    const result = await repo.hasTopologyChanged(TENANT_ID, MODEL_ID, "old_hash");
    expect(result).toBe(true);
  });

  it("returns false when model not found (null data)", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const repo = new NetworkRepository(client);
    const result = await repo.hasTopologyChanged(TENANT_ID, MODEL_ID, null);
    expect(result).toBe(false);
  });

  it("returns true when previousHash is null and model has a hash", async () => {
    const repo = new NetworkRepository(makeClientStub("some_hash"));
    const result = await repo.hasTopologyChanged(TENANT_ID, MODEL_ID, null);
    expect(result).toBe(true);
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────
// These tests run against a live Supabase instance.
// Skipped automatically when NEXT_PUBLIC_SUPABASE_URL is not set.

const INTEGRATION =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!INTEGRATION)("NetworkRepository integration", () => {
  let repo: NetworkRepository;
  let createdModelId: string;
  let createdBusAId: string;
  let createdBusBId: string;

  // Import createServerClient lazily to avoid import errors in unit-test runs
  beforeEach(async () => {
    const { createServerClient } = await import("@/lib/db/client");
    const client = createServerClient();
    repo = new NetworkRepository(client);
  });

  it("creates a network model and reads it back", async () => {
    const model = await repo.createModel({
      tenant_id: TENANT_ID,
      iso: "PJM",
      name: "Integration Test Model",
      version: "1.0",
      base_mva: 100,
      model_date: "2025-06-15",
      source: "MANUAL",
      metadata: { test: true },
    });

    createdModelId = model.id;
    expect(model.iso).toBe("PJM");
    expect(model.busCount).toBe(0);
    expect(model.branchCount).toBe(0);
    expect(model.ptdfValid).toBe(false);
  });

  it("creates buses and the model bus_count increments", async () => {
    const busA = await repo.createBus({
      model_id: createdModelId,
      tenant_id: TENANT_ID,
      bus_number: 1,
      name: "BUS-1",
      base_kv: 115.0,
    });
    createdBusAId = busA.id;

    const busB = await repo.createBus({
      model_id: createdModelId,
      tenant_id: TENANT_ID,
      bus_number: 2,
      name: "BUS-2",
      base_kv: 115.0,
    });
    createdBusBId = busB.id;

    const model = await repo.getModel(TENANT_ID, createdModelId);
    expect(model?.busCount).toBe(2);
  });

  it("creates a branch and the topology_hash is set, ptdf_valid=false", async () => {
    await repo.createBranch({
      model_id: createdModelId,
      tenant_id: TENANT_ID,
      branch_number: 1,
      name: "LINE-1-2",
      branch_type: "LINE",
      from_bus_id: createdBusAId,
      to_bus_id: createdBusBId,
      x_pu: 0.05917,
      rate_a_mw: 400,
    });

    const model = await repo.getModel(TENANT_ID, createdModelId);
    expect(model?.branchCount).toBe(1);
    expect(model?.topologyHash).not.toBeNull();
    expect(model?.ptdfValid).toBe(false);
  });

  it("marking ptdf_valid=true persists", async () => {
    await repo.markPtdfValid(TENANT_ID, createdModelId, true);
    const model = await repo.getModel(TENANT_ID, createdModelId);
    expect(model?.ptdfValid).toBe(true);
  });

  it("markPtdfValid with wrong tenant_id is a no-op (tenant isolation)", async () => {
    const OTHER_TENANT = "00000000-0000-0000-0000-000000000099";
    // Ensure ptdf_valid is true first
    await repo.markPtdfValid(TENANT_ID, createdModelId, true);
    // Cross-tenant call should silently match 0 rows, not update the model
    await repo.markPtdfValid(OTHER_TENANT, createdModelId, false);
    const model = await repo.getModel(TENANT_ID, createdModelId);
    expect(model?.ptdfValid).toBe(true); // unchanged
  });

  it("tripping a branch invalidates ptdf_valid", async () => {
    const branches = await repo.listBranches(
      TENANT_ID,
      createdModelId,
      true
    );
    expect(branches).toHaveLength(1);

    await repo.tripBranch(TENANT_ID, branches[0].id);

    const model = await repo.getModel(TENANT_ID, createdModelId);
    expect(model?.ptdfValid).toBe(false);
  });

  it("listBranches with inServiceOnly=true excludes tripped branches", async () => {
    const all = await repo.listBranches(TENANT_ID, createdModelId, false);
    const inService = await repo.listBranches(TENANT_ID, createdModelId, true);

    expect(all.length).toBeGreaterThan(inService.length);
    expect(inService.every((b) => b.inService)).toBe(true);
  });

  it("cross-tenant read returns null (RLS enforcement)", async () => {
    const OTHER_TENANT = "00000000-0000-0000-0000-000000000099";
    const model = await repo.getModel(OTHER_TENANT, createdModelId);
    expect(model).toBeNull();
  });

  it("duplicate bus_number for same model is rejected", async () => {
    await expect(
      repo.createBus({
        model_id: createdModelId,
        tenant_id: TENANT_ID,
        bus_number: 1, // duplicate
        name: "BUS-1-DUP",
        base_kv: 115.0,
      })
    ).rejects.toThrow();
  });

  it("self-loop branch is rejected by validation", async () => {
    await expect(
      repo.createBranch({
        model_id: createdModelId,
        tenant_id: TENANT_ID,
        branch_number: 99,
        name: "SELF-LOOP",
        branch_type: "LINE",
        from_bus_id: createdBusAId,
        to_bus_id: createdBusAId,
        x_pu: 0.01,
        rate_a_mw: 100,
      })
    ).rejects.toThrow(NetworkValidationError);
  });

  it("hasTopologyChanged returns true when hash has changed", async () => {
    const changed = await repo.hasTopologyChanged(TENANT_ID, createdModelId, "stale_hash_abc");
    expect(changed).toBe(true);
  });

  it("hasTopologyChanged returns false when hash matches current", async () => {
    const model = await repo.getModel(TENANT_ID, createdModelId);
    const currentHash = model?.topologyHash ?? null;
    const changed = await repo.hasTopologyChanged(TENANT_ID, createdModelId, currentHash);
    expect(changed).toBe(false);
  });

  it("hasTopologyChanged returns false for wrong tenant (tenant isolation)", async () => {
    const OTHER_TENANT = "00000000-0000-0000-0000-000000000099";
    // Cross-tenant call: model not found → returns false (not throws)
    const changed = await repo.hasTopologyChanged(OTHER_TENANT, createdModelId, null);
    expect(changed).toBe(false);
  });

  it("getBusByNumber returns null for wrong tenant (tenant isolation)", async () => {
    const OTHER_TENANT = "00000000-0000-0000-0000-000000000099";
    const bus = await repo.getBusByNumber(OTHER_TENANT, createdModelId, 1);
    expect(bus).toBeNull();
  });

  it("createBusesBatch chunks large inserts without error", async () => {
    const largeBatch = Array.from({ length: 600 }, (_, i) => ({
      model_id: createdModelId,
      tenant_id: TENANT_ID,
      bus_number: 1000 + i,
      name: `BATCH-BUS-${i}`,
      base_kv: 115.0,
    }));
    const buses = await repo.createBusesBatch(largeBatch);
    expect(buses).toHaveLength(600);
    // Clean up
    await Promise.all(buses.map((b) => repo.deleteBus(TENANT_ID, b.id)));
  });

  it("delete model cascades to buses and branches", async () => {
    await repo.deleteModel(TENANT_ID, createdModelId);
    const buses = await repo.listBuses(TENANT_ID, createdModelId);
    expect(buses).toHaveLength(0);
  });
});

// ── Performance benchmark ─────────────────────────────────────────────────────

describe("Mapper performance", () => {
  it("maps 10,000 bus rows in under 50ms", () => {
    const rows: DbNetworkBus[] = Array.from({ length: 10_000 }, (_, i) =>
      makeDbBus({ bus_number: i + 1, id: `bus-${i}` })
    );

    const start = performance.now();
    const mapped = rows.map(toNetworkBus);
    const elapsed = performance.now() - start;

    expect(mapped).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(50);
  });

  it("maps 10,000 branch rows in under 50ms", () => {
    const rows: DbNetworkBranch[] = Array.from({ length: 10_000 }, (_, i) =>
      makeDbBranch({
        branch_number: i + 1,
        id: `branch-${i}`,
        to_bus_id: `bus-${i + 2}`,
      })
    );

    const start = performance.now();
    const mapped = rows.map(toNetworkBranch);
    const elapsed = performance.now() - start;

    expect(mapped).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(50);
  });

  it("validates 1,000 branch inserts in under 10ms", () => {
    const inserts = Array.from({ length: 1_000 }, (_, i) =>
      makeBranchInsert({
        branch_number: i + 1,
        to_bus_id: `bus-${i + 100}`,
      })
    );

    const start = performance.now();
    inserts.forEach(validateNetworkBranchInsert);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });
});
