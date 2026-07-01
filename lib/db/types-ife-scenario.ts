/**
 * Database row types for the ife_scenarios table (migration 018).
 */

import type { ProjectType } from "@/lib/db/types-queue";
import type { IfeAnalysisStatus } from "@/lib/db/types-ife";
import type { NetworkDeltaOp } from "@/lib/ife-scenario/types";

// ── ife_scenarios ─────────────────────────────────────────────────────────────

export interface DbIfeScenario {
  id: string;
  tenant_id: string;
  base_network_model_id: string;
  derived_network_model_id: string | null;
  name: string;
  description: string | null;
  poi_bus_number: number;
  iso_id: string;
  capacity_mw: number;
  project_type: ProjectType;
  target_cod: string | null;
  injection_overrides_mw: Record<string, number>;
  network_delta: NetworkDeltaOp[];
  network_delta_hash: string | null;
  status: IfeAnalysisStatus;
  error_message: string | null;
  result_analysis_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbIfeScenarioInsert
  extends Omit<
    DbIfeScenario,
    | "id"
    | "derived_network_model_id"
    | "description"
    | "injection_overrides_mw"
    | "network_delta"
    | "network_delta_hash"
    | "status"
    | "error_message"
    | "result_analysis_id"
    | "idempotency_key"
    | "created_at"
    | "updated_at"
  > {
  id?: string;
  derived_network_model_id?: string | null;
  description?: string | null;
  injection_overrides_mw?: Record<string, number>;
  network_delta?: NetworkDeltaOp[];
  network_delta_hash?: string | null;
  status?: IfeAnalysisStatus;
  error_message?: string | null;
  result_analysis_id?: string | null;
  idempotency_key?: string | null;
}

// ── Domain type (camelCase) ───────────────────────────────────────────────────

export interface IfeScenario {
  id: string;
  tenantId: string;
  baseNetworkModelId: string;
  derivedNetworkModelId: string | null;
  name: string;
  description: string | null;
  poiBusNumber: number;
  isoId: string;
  capacityMw: number;
  projectType: ProjectType;
  targetCod: string | null;
  injectionOverridesMw: Record<string, number>;
  networkDelta: NetworkDeltaOp[];
  networkDeltaHash: string | null;
  status: IfeAnalysisStatus;
  errorMessage: string | null;
  resultAnalysisId: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Mapper ────────────────────────────────────────────────────────────────────

export function toIfeScenario(row: DbIfeScenario): IfeScenario {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    baseNetworkModelId: row.base_network_model_id,
    derivedNetworkModelId: row.derived_network_model_id,
    name: row.name,
    description: row.description,
    poiBusNumber: Number(row.poi_bus_number),
    isoId: row.iso_id,
    capacityMw: Number(row.capacity_mw),
    projectType: row.project_type,
    targetCod: row.target_cod,
    injectionOverridesMw: row.injection_overrides_mw ?? {},
    networkDelta: row.network_delta ?? [],
    networkDeltaHash: row.network_delta_hash,
    status: row.status,
    errorMessage: row.error_message,
    resultAnalysisId: row.result_analysis_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export class IfeScenarioValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = "IfeScenarioValidationError";
  }
}

export function validateNetworkDeltaOp(op: NetworkDeltaOp, index: number): void {
  if (op == null || typeof op !== "object") {
    throw new IfeScenarioValidationError(
      `network_delta[${index}] must be an object`,
      "network_delta"
    );
  }
  if (typeof op.branchNumber !== "number" || !Number.isFinite(op.branchNumber)) {
    throw new IfeScenarioValidationError(
      `network_delta[${index}].branchNumber must be a finite number`,
      "network_delta"
    );
  }
  if (op.op === "set_branch_in_service") {
    if (typeof op.inService !== "boolean") {
      throw new IfeScenarioValidationError(
        `network_delta[${index}].inService must be a boolean`,
        "network_delta"
      );
    }
    return;
  }
  if (op.op === "set_branch_rating") {
    if (typeof op.rateAMw !== "number" || !Number.isFinite(op.rateAMw) || op.rateAMw <= 0) {
      throw new IfeScenarioValidationError(
        `network_delta[${index}].rateAMw must be a positive finite number`,
        "network_delta"
      );
    }
    for (const field of ["rateBMw", "rateCMw"] as const) {
      const value = op[field];
      if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new IfeScenarioValidationError(
          `network_delta[${index}].${field} must be a finite number or null`,
          "network_delta"
        );
      }
    }
    return;
  }
  throw new IfeScenarioValidationError(
    `network_delta[${index}].op must be 'set_branch_in_service' or 'set_branch_rating'`,
    "network_delta"
  );
}

export function validateIfeScenarioInsert(insert: DbIfeScenarioInsert): void {
  if (!insert.base_network_model_id) {
    throw new IfeScenarioValidationError(
      "base_network_model_id is required",
      "base_network_model_id"
    );
  }
  if (!insert.name || insert.name.trim().length === 0) {
    throw new IfeScenarioValidationError("name is required", "name");
  }
  if (!insert.iso_id) {
    throw new IfeScenarioValidationError("iso_id is required", "iso_id");
  }
  if (insert.capacity_mw <= 0) {
    throw new IfeScenarioValidationError(
      "capacity_mw must be positive",
      "capacity_mw"
    );
  }
  if (insert.capacity_mw > 50_000) {
    throw new IfeScenarioValidationError(
      "capacity_mw exceeds maximum supported value of 50,000 MW",
      "capacity_mw"
    );
  }
  if (
    insert.poi_bus_number == null ||
    !Number.isFinite(insert.poi_bus_number)
  ) {
    throw new IfeScenarioValidationError(
      "poi_bus_number must be a finite number",
      "poi_bus_number"
    );
  }
  (insert.network_delta ?? []).forEach(validateNetworkDeltaOp);
}
