/**
 * Network delta application — INFRA-019
 *
 * Pure functions only: no I/O, no electrical computation. These build the
 * DbNetworkBusInsert/DbNetworkBranchInsert rows for a cloned network_models
 * variant, and compute a deterministic hash of a delta for dedup.
 *
 * Bus UUID remapping (mandatory — INFRA-019 Phase 2 review, Blocking B1):
 * a cloned model gets brand-new bus UUIDs from createBusesBatch(). Cloned
 * branches MUST resolve from_bus_id/to_bus_id through the returned
 * bus_number -> new UUID mapping — reusing the base model's bus UUIDs would
 * silently point the derived model's branches at a foreign model's buses
 * (nothing in the schema's foreign keys would catch this; network_buses'
 * only uniqueness constraint is per-model on bus_number, not globally on
 * (model_id, id) pairing against branches). buildClonedBranchInserts below
 * is the only place branch inserts are constructed, and it always resolves
 * through busNumberToNewId — never through the base branch's own
 * fromBusId/toBusId directly.
 */

import "server-only";
import crypto from "crypto";
import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import type { DbNetworkBusInsert, DbNetworkBranchInsert } from "@/lib/db/types-network";
import type { NetworkDeltaOp } from "./types";
import { IfeScenarioValidationError } from "@/lib/db/types-ife-scenario";

// ── Clone (unmodified) buses ──────────────────────────────────────────────────

export function buildClonedBusInserts(
  buses: NetworkBus[],
  tenantId: string,
  modelId: string
): DbNetworkBusInsert[] {
  return buses.map((b) => ({
    model_id: modelId,
    tenant_id: tenantId,
    bus_number: b.busNumber,
    name: b.name,
    base_kv: b.baseKv,
    bus_type: b.busType,
    latitude: b.latitude,
    longitude: b.longitude,
    zone: b.zone,
    area: b.area,
    vmin_pu: b.vminPu,
    vmax_pu: b.vmaxPu,
  }));
}

// ── Clone branches with delta applied + mandatory bus UUID remapping ─────────

export function buildClonedBranchInserts(
  branches: NetworkBranch[],
  delta: NetworkDeltaOp[],
  tenantId: string,
  modelId: string,
  busNumberToNewId: Map<number, string>,
  baseBusIdToNumber: Map<string, number>
): DbNetworkBranchInsert[] {
  const byBranchNumber = new Map<number, NetworkBranch>(branches.map((b) => [b.branchNumber, b]));
  for (const op of delta) {
    if (!byBranchNumber.has(op.branchNumber)) {
      throw new IfeScenarioValidationError(
        `network_delta references branch_number ${op.branchNumber}, which does not exist in the base model`,
        "network_delta"
      );
    }
  }

  const inServiceOverrides = new Map<number, boolean>();
  // rateBMw/rateCMw are stored exactly as given (possibly `undefined`, meaning
  // "not specified — preserve the base branch's value") rather than defaulted
  // to null here. Defaulting to null at this point would indistinguishably
  // treat "caller omitted this field" the same as "caller explicitly cleared
  // this rating," silently wiping a rating the caller never asked to change.
  const ratingOverrides = new Map<number, { rateAMw: number; rateBMw: number | null | undefined; rateCMw: number | null | undefined }>();
  for (const op of delta) {
    if (op.op === "set_branch_in_service") {
      inServiceOverrides.set(op.branchNumber, op.inService);
    } else {
      ratingOverrides.set(op.branchNumber, {
        rateAMw: op.rateAMw,
        rateBMw: op.rateBMw,
        rateCMw: op.rateCMw,
      });
    }
  }

  return branches.map((branch) => {
    const fromBusNumber = baseBusIdToNumber.get(branch.fromBusId);
    const toBusNumber = baseBusIdToNumber.get(branch.toBusId);
    if (fromBusNumber === undefined || toBusNumber === undefined) {
      throw new Error(
        `[ife-scenario/network-delta] branch ${branch.branchNumber} references a bus not present in the loaded base bus set`
      );
    }
    const fromBusId = busNumberToNewId.get(fromBusNumber);
    const toBusId = busNumberToNewId.get(toBusNumber);
    if (!fromBusId || !toBusId) {
      throw new Error(
        `[ife-scenario/network-delta] no cloned bus id found for branch ${branch.branchNumber} (from bus_number ${fromBusNumber}, to bus_number ${toBusNumber})`
      );
    }

    const rating = ratingOverrides.get(branch.branchNumber);

    return {
      model_id: modelId,
      tenant_id: tenantId,
      branch_number: branch.branchNumber,
      name: branch.name,
      branch_type: branch.branchType,
      from_bus_id: fromBusId,
      to_bus_id: toBusId,
      r_pu: branch.rPu,
      x_pu: branch.xPu,
      b_pu: branch.bPu,
      rate_a_mw: rating ? rating.rateAMw : branch.rateAMw,
      rate_b_mw: rating ? (rating.rateBMw !== undefined ? rating.rateBMw : branch.rateBMw) : branch.rateBMw,
      rate_c_mw: rating ? (rating.rateCMw !== undefined ? rating.rateCMw : branch.rateCMw) : branch.rateCMw,
      tap_ratio: branch.tapRatio,
      phase_shift_deg: branch.phaseShiftDeg,
      in_service: inServiceOverrides.get(branch.branchNumber) ?? branch.inService,
    };
  });
}

// ── Canonicalization + hashing (dedup key) ───────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/** Stable array order (by branchNumber, then op) + stable key order within each op. */
export function canonicalizeNetworkDelta(delta: NetworkDeltaOp[]): NetworkDeltaOp[] {
  return [...delta].sort((a, b) => a.branchNumber - b.branchNumber || a.op.localeCompare(b.op));
}

/** Deterministic hash of a network delta, for dedup against ife_scenarios.network_delta_hash. Null when empty. */
export function hashNetworkDelta(delta: NetworkDeltaOp[]): string | null {
  if (delta.length === 0) return null;
  const canonical = canonicalizeNetworkDelta(delta);
  return crypto.createHash("sha256").update(stableStringify(canonical)).digest("hex");
}
