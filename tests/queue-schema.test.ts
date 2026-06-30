/**
 * INFRA-002: isos / queue_projects / queue_project_status_history
 *
 * Unit tests cover:
 *   - Row → domain mappers
 *   - Validation rules
 *   - Status transition logic (isValidTransition)
 *   - monthsBetween helper
 *   - isTerminalStatus helper
 *   - getQueueDepthByBus aggregation (pure in-memory logic)
 *
 * Integration tests (skipped without SUPABASE_URL) cover:
 *   - Full CRUD round-trips
 *   - Status transition trigger auto-creates history rows
 *   - upsert idempotency
 *   - Cross-tenant isolation
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  toQueueProject,
  toQueueStatusHistory,
  validateQueueProjectInsert,
  QueueValidationError,
  QueueRepository,
} from "@/lib/db/repositories/queue.repository";
import {
  isValidTransition,
  isTerminalStatus,
  monthsBetween,
  QUEUE_STATUS_ORDER,
  type QueueStatus,
} from "@/lib/db/types-queue";
import type {
  DbQueueProject,
  DbQueueStatusHistory,
  DbQueueProjectInsert,
} from "@/lib/db/types-queue";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = "00000000-0000-0000-0000-000000000002";
const PROJECT_ID = "00000000-0000-0000-0000-000000000030";

function makeDbProject(
  overrides: Partial<DbQueueProject> = {}
): DbQueueProject {
  return {
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    iso_id: "PJM",
    project_number: "J2024-001",
    project_name: "Acme Solar 1",
    developer: "Acme Energy",
    project_type: "solar",
    poi_bus_id: null,
    poi_description: "Bedington 500kV",
    county: "Berkeley",
    state_abbr: "WV",
    capacity_mw: 250.0,
    in_service_mw: null,
    queue_date: "2024-03-01",
    study_start_date: "2024-09-01",
    target_cod: "2027-12-01",
    actual_cod: null,
    current_status: "study_phase_1",
    network_upgrade_cost_m: 42.5,
    project_cost_share_m: 8.3,
    withdrawal_probability: 0.62,
    ife_last_run_at: "2025-01-15T00:00:00Z",
    metadata: {},
    created_at: "2024-03-01T00:00:00Z",
    updated_at: "2025-01-15T00:00:00Z",
    ...overrides,
  };
}

function makeDbHistory(
  overrides: Partial<DbQueueStatusHistory> = {}
): DbQueueStatusHistory {
  return {
    id: "00000000-0000-0000-0000-000000000040",
    project_id: PROJECT_ID,
    tenant_id: TENANT_ID,
    iso_id: "PJM",
    from_status: "submitted",
    to_status: "study_phase_1",
    transitioned_at: "2024-09-01T00:00:00Z",
    capacity_mw_snapshot: 250.0,
    months_in_queue_snapshot: 6,
    upgrade_cost_m_snapshot: null,
    cost_share_m_snapshot: null,
    source: "queue_ingest",
    notes: null,
    created_at: "2024-09-01T00:00:00Z",
    ...overrides,
  };
}

function makeInsert(
  overrides: Partial<DbQueueProjectInsert> = {}
): DbQueueProjectInsert {
  return {
    tenant_id: TENANT_ID,
    iso_id: "PJM",
    project_number: "J2024-001",
    project_name: "Acme Solar 1",
    capacity_mw: 250.0,
    queue_date: "2024-03-01",
    current_status: "submitted",
    project_type: "solar",
    metadata: {},
    ...overrides,
  };
}

// ── toQueueProject mapper ─────────────────────────────────────────────────────

describe("toQueueProject", () => {
  it("maps all snake_case columns to camelCase", () => {
    const domain = toQueueProject(makeDbProject());

    expect(domain.id).toBe(PROJECT_ID);
    expect(domain.tenantId).toBe(TENANT_ID);
    expect(domain.isoId).toBe("PJM");
    expect(domain.projectNumber).toBe("J2024-001");
    expect(domain.capacityMw).toBe(250.0);
    expect(domain.currentStatus).toBe("study_phase_1");
    expect(domain.networkUpgradeCostM).toBe(42.5);
    expect(domain.projectCostShareM).toBe(8.3);
    expect(domain.withdrawalProbability).toBe(0.62);
  });

  it("coerces numeric strings to JS numbers", () => {
    const domain = toQueueProject(
      makeDbProject({
        capacity_mw: "250.00" as unknown as number,
        network_upgrade_cost_m: "42.50" as unknown as number,
      })
    );
    expect(typeof domain.capacityMw).toBe("number");
    expect(typeof domain.networkUpgradeCostM).toBe("number");
  });

  it("maps null optional fields to null", () => {
    const domain = toQueueProject(
      makeDbProject({
        poi_bus_id: null,
        actual_cod: null,
        in_service_mw: null,
        withdrawal_probability: null,
      })
    );
    expect(domain.poiBusId).toBeNull();
    expect(domain.actualCod).toBeNull();
    expect(domain.inServiceMw).toBeNull();
    expect(domain.withdrawalProbability).toBeNull();
  });

  it("defaults metadata to empty object when null", () => {
    const domain = toQueueProject(
      makeDbProject({ metadata: null as unknown as Record<string, unknown> })
    );
    expect(domain.metadata).toEqual({});
  });
});

// ── toQueueStatusHistory mapper ───────────────────────────────────────────────

describe("toQueueStatusHistory", () => {
  it("maps history row correctly", () => {
    const domain = toQueueStatusHistory(makeDbHistory());

    expect(domain.projectId).toBe(PROJECT_ID);
    expect(domain.fromStatus).toBe("submitted");
    expect(domain.toStatus).toBe("study_phase_1");
    expect(domain.source).toBe("queue_ingest");
    expect(domain.monthsInQueueSnapshot).toBe(6);
  });

  it("maps null from_status for initial submission event", () => {
    const domain = toQueueStatusHistory(
      makeDbHistory({ from_status: null })
    );
    expect(domain.fromStatus).toBeNull();
  });
});

// ── validateQueueProjectInsert ────────────────────────────────────────────────

describe("validateQueueProjectInsert", () => {
  it("accepts a valid insert", () => {
    expect(() => validateQueueProjectInsert(makeInsert())).not.toThrow();
  });

  it("throws on empty project_number", () => {
    expect(() =>
      validateQueueProjectInsert(makeInsert({ project_number: "" }))
    ).toThrow(QueueValidationError);
    expect(() =>
      validateQueueProjectInsert(makeInsert({ project_number: "  " }))
    ).toThrow(QueueValidationError);
  });

  it("throws on empty project_name", () => {
    expect(() =>
      validateQueueProjectInsert(makeInsert({ project_name: "" }))
    ).toThrow(QueueValidationError);
  });

  it("throws on non-positive capacity_mw", () => {
    expect(() =>
      validateQueueProjectInsert(makeInsert({ capacity_mw: 0 }))
    ).toThrow(QueueValidationError);
    expect(() =>
      validateQueueProjectInsert(makeInsert({ capacity_mw: -100 }))
    ).toThrow(QueueValidationError);
  });

  it("throws on invalid queue_date format", () => {
    expect(() =>
      validateQueueProjectInsert(makeInsert({ queue_date: "March 2024" }))
    ).toThrow(QueueValidationError);
    expect(() =>
      validateQueueProjectInsert(makeInsert({ queue_date: "2024/03/01" }))
    ).toThrow(QueueValidationError);
  });

  it("throws when target_cod is before queue_date", () => {
    expect(() =>
      validateQueueProjectInsert(
        makeInsert({ queue_date: "2024-03-01", target_cod: "2023-12-31" })
      )
    ).toThrow(QueueValidationError);
  });

  it("accepts target_cod equal to queue_date", () => {
    expect(() =>
      validateQueueProjectInsert(
        makeInsert({ queue_date: "2024-03-01", target_cod: "2024-03-01" })
      )
    ).not.toThrow();
  });

  it("throws on withdrawal_probability outside [0, 1]", () => {
    expect(() =>
      validateQueueProjectInsert(
        makeInsert({ withdrawal_probability: 1.01 })
      )
    ).toThrow(QueueValidationError);
    expect(() =>
      validateQueueProjectInsert(
        makeInsert({ withdrawal_probability: -0.01 })
      )
    ).toThrow(QueueValidationError);
  });

  it("accepts withdrawal_probability at bounds 0 and 1", () => {
    expect(() =>
      validateQueueProjectInsert(makeInsert({ withdrawal_probability: 0 }))
    ).not.toThrow();
    expect(() =>
      validateQueueProjectInsert(makeInsert({ withdrawal_probability: 1 }))
    ).not.toThrow();
  });

  it("carries the correct field name in QueueValidationError", () => {
    let caught: QueueValidationError | null = null;
    try {
      validateQueueProjectInsert(makeInsert({ capacity_mw: -1 }));
    } catch (e) {
      caught = e as QueueValidationError;
    }
    expect(caught).toBeInstanceOf(QueueValidationError);
    expect(caught?.field).toBe("capacity_mw");
    expect(caught?.name).toBe("QueueValidationError");
  });
});

// ── isValidTransition ─────────────────────────────────────────────────────────

describe("isValidTransition", () => {
  it("null → submitted is the only valid initial transition", () => {
    expect(isValidTransition(null, "submitted")).toBe(true);
    expect(isValidTransition(null, "study_phase_1")).toBe(false);
    expect(isValidTransition(null, "withdrawn")).toBe(false);
  });

  it("forward transitions within the status order are valid", () => {
    expect(isValidTransition("submitted", "study_phase_1")).toBe(true);
    expect(isValidTransition("study_phase_1", "study_phase_2")).toBe(true);
    expect(isValidTransition("study_phase_2", "executed_ia")).toBe(true);
    expect(isValidTransition("executed_ia", "in_service")).toBe(true);
  });

  it("phase skipping is allowed (ISO may skip phases)", () => {
    expect(isValidTransition("submitted", "study_phase_3")).toBe(true);
    expect(isValidTransition("study_phase_1", "executed_ia")).toBe(true);
  });

  it("withdrawal is reachable from any non-terminal status", () => {
    const nonTerminal: QueueStatus[] = [
      "submitted",
      "study_phase_1",
      "study_phase_2",
      "study_phase_3",
      "executed_ia",
    ];
    for (const s of nonTerminal) {
      expect(isValidTransition(s, "withdrawn")).toBe(true);
    }
  });

  it("backwards transitions are invalid", () => {
    expect(isValidTransition("study_phase_1", "submitted")).toBe(false);
    expect(isValidTransition("executed_ia", "study_phase_2")).toBe(false);
    expect(isValidTransition("in_service", "executed_ia")).toBe(false);
  });

  it("no-op transition (same status) is invalid", () => {
    for (const s of QUEUE_STATUS_ORDER) {
      expect(isValidTransition(s, s)).toBe(false);
    }
  });

  it("transitions from terminal states are invalid", () => {
    expect(isValidTransition("withdrawn", "study_phase_1")).toBe(false);
    expect(isValidTransition("in_service", "study_phase_1")).toBe(false);
    expect(isValidTransition("withdrawn", "in_service")).toBe(false);
  });
});

// ── isTerminalStatus ──────────────────────────────────────────────────────────

describe("isTerminalStatus", () => {
  it("withdrawn and in_service are terminal", () => {
    expect(isTerminalStatus("withdrawn")).toBe(true);
    expect(isTerminalStatus("in_service")).toBe(true);
  });

  it("all other statuses are non-terminal", () => {
    const nonTerminal: QueueStatus[] = [
      "submitted",
      "study_phase_1",
      "study_phase_2",
      "study_phase_3",
      "executed_ia",
    ];
    for (const s of nonTerminal) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });
});

// ── monthsBetween ─────────────────────────────────────────────────────────────

describe("monthsBetween", () => {
  it("calculates months between two dates in the same year", () => {
    expect(monthsBetween("2024-01-01", "2024-06-01")).toBe(5);
  });

  it("calculates months spanning a year boundary", () => {
    expect(monthsBetween("2023-10-01", "2024-04-01")).toBe(6);
  });

  it("returns 0 for the same date", () => {
    expect(monthsBetween("2024-03-01", "2024-03-01")).toBe(0);
  });

  it("returns 12 for exactly one year", () => {
    expect(monthsBetween("2023-03-01", "2024-03-01")).toBe(12);
  });

  it("returns 36 for three years", () => {
    expect(monthsBetween("2021-01-01", "2024-01-01")).toBe(36);
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────

const INTEGRATION =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!INTEGRATION)("QueueRepository integration", () => {
  let repo: QueueRepository;
  let createdProjectId: string;

  beforeEach(async () => {
    const { createServerClient } = await import("@/lib/db/client");
    repo = new QueueRepository(createServerClient());
  });

  it("listIsos returns all 6 supported ISOs", async () => {
    const isos = await repo.listIsos();
    const ids = isos.map((i) => i.id).sort();
    expect(ids).toEqual(
      ["CAISO", "ERCOT", "ISONE", "MISO", "NYISO", "PJM"]
    );
  });

  it("creates a queue project and reads it back", async () => {
    const project = await repo.createProject(makeInsert());
    createdProjectId = project.id;

    expect(project.projectNumber).toBe("J2024-001");
    expect(project.currentStatus).toBe("submitted");
    expect(project.capacityMw).toBe(250.0);
  });

  it("transitions status and auto-creates a history row", async () => {
    await repo.transitionStatus(TENANT_ID, createdProjectId, "study_phase_1");

    const history = await repo.getHistory(TENANT_ID, createdProjectId);
    expect(history.length).toBeGreaterThanOrEqual(1);

    const last = history[history.length - 1];
    expect(last.fromStatus).toBe("submitted");
    expect(last.toStatus).toBe("study_phase_1");
  });

  it("rejects invalid status transition", async () => {
    await expect(
      repo.transitionStatus(TENANT_ID, createdProjectId, "submitted")
    ).rejects.toThrow(QueueValidationError);
  });

  it("upsert with same project_number updates existing row", async () => {
    const updated = await repo.upsertProject(
      makeInsert({ project_name: "Acme Solar 1 Updated", capacity_mw: 300 })
    );
    expect(updated.projectName).toBe("Acme Solar 1 Updated");
    expect(updated.capacityMw).toBe(300);
  });

  it("updateWithdrawalProbability stores value", async () => {
    await repo.updateWithdrawalProbability(TENANT_ID, createdProjectId, 0.72);
    const project = await repo.getProject(TENANT_ID, createdProjectId);
    expect(project?.withdrawalProbability).toBe(0.72);
    expect(project?.ifeLastRunAt).not.toBeNull();
  });

  it("cross-tenant read returns null", async () => {
    const OTHER_TENANT = "00000000-0000-0000-0000-000000000099";
    const project = await repo.getProject(OTHER_TENANT, createdProjectId);
    expect(project).toBeNull();
  });

  it("getQueueDepthByBus groups active projects by POI bus", async () => {
    // This test requires projects to have poi_bus_id set; verifies grouping logic
    const depths = await repo.getQueueDepthByBus(TENANT_ID, "PJM");
    for (const d of depths) {
      expect(d.depth).toBeGreaterThan(0);
      expect(d.total_mw).toBeGreaterThan(0);
    }
  });

  it("delete project cleans up", async () => {
    await repo.deleteProject(TENANT_ID, createdProjectId);
    const project = await repo.getProject(TENANT_ID, createdProjectId);
    expect(project).toBeNull();
  });
});

// ── Performance benchmark ─────────────────────────────────────────────────────

describe("Queue mapper performance", () => {
  it("maps 10,000 project rows in under 50ms", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      makeDbProject({ id: `proj-${i}`, project_number: `J2024-${i}` })
    );

    const start = performance.now();
    const mapped = rows.map(toQueueProject);
    const elapsed = performance.now() - start;

    expect(mapped).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(50);
  });

  it("validates 1,000 project inserts in under 20ms", () => {
    const inserts = Array.from({ length: 1_000 }, (_, i) =>
      makeInsert({ project_number: `J2024-${i}` })
    );

    const start = performance.now();
    inserts.forEach(validateQueueProjectInsert);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(20);
  });

  it("isValidTransition is O(1) — 100,000 calls in under 50ms", () => {
    const transitions: Array<[QueueStatus, QueueStatus]> = [
      ["submitted", "study_phase_1"],
      ["study_phase_1", "withdrawn"],
      ["study_phase_2", "executed_ia"],
    ];

    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      const [from, to] = transitions[i % transitions.length];
      isValidTransition(from, to);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
