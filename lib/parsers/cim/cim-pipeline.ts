/**
 * CIM import pipeline — INFRA-008
 *
 * Converts a parsed CIM network into network_models / network_buses /
 * network_branches rows using the NetworkRepository.
 *
 * Call sequence:
 *  1. parseCimXml(xmlSource)
 *  2. createModel(...)
 *  3. createBusesBatch(...)   ← returns DB UUIDs
 *  4. createBranchesBatch(...)  ← references bus UUIDs
 */

import "server-only";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type {
  DbNetworkBusInsert,
  DbNetworkBranchInsert,
  IsoRegion,
} from "@/lib/db/types-network";
import { parseCimXml } from "./cim-parser";

// ── Public types ──────────────────────────────────────────────────────────────

export interface CimImportOptions {
  tenantId: string;
  iso: IsoRegion;
  modelName: string;
  modelDate: string; // "YYYY-MM-DD"
  version?: string;
  baseMva?: number;
  metadata?: Record<string, unknown>;
}

export interface CimImportResult {
  modelId: string;
  busCount: number;
  branchCount: number;
  generatorCount: number;
  shuntCount: number;
  warnings: string[];
  skippedBuses: number;
  skippedBranches: number;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function importCimToNetwork(
  xmlSource: string,
  options: CimImportOptions,
  repo: NetworkRepository
): Promise<CimImportResult> {
  const {
    tenantId,
    iso,
    modelName,
    modelDate,
    version = "1.0",
    baseMva = 100,
    metadata = {},
  } = options;

  // 1. Parse CIM XML (pure function — no I/O)
  const parsed = parseCimXml(xmlSource);

  // 2. Persist network model record
  const model = await repo.createModel({
    tenant_id: tenantId,
    iso,
    name: modelName,
    version,
    base_mva: baseMva > 0 ? baseMva : 100,
    model_date: modelDate,
    source: "CIM_XML",
    metadata: {
      ...metadata,
      cim_version: parsed.version,
      parse_warnings: parsed.warnings.length,
    },
  });

  // 3. Insert buses; capture returned rows with their DB-generated UUIDs
  const busInserts: DbNetworkBusInsert[] = parsed.buses.map(b => ({
    model_id: model.id,
    tenant_id: tenantId,
    bus_number: b.busNumber,
    name: b.name,
    base_kv: b.baseKv,
    bus_type: b.busType,
    latitude: null,
    longitude: null,
    zone: b.zone,
    area: null,
  }));

  const insertedBuses = await repo.createBusesBatch(busInserts);

  // 4. Map bus_number → DB UUID for branch wiring
  const busNumToDbId = new Map<number, string>();
  for (const bus of insertedBuses) {
    busNumToDbId.set(bus.busNumber, bus.id);
  }

  // 5. Build branch inserts — skip any branch whose endpoint UUID cannot be resolved
  const branchInserts: DbNetworkBranchInsert[] = [];
  let skippedBranches = 0;

  for (let i = 0; i < parsed.branches.length; i++) {
    const br = parsed.branches[i];
    const fromId = busNumToDbId.get(br.fromBusNumber);
    const toId = busNumToDbId.get(br.toBusNumber);

    if (!fromId || !toId) {
      skippedBranches++;
      continue;
    }

    branchInserts.push({
      model_id: model.id,
      tenant_id: tenantId,
      branch_number: i + 1,
      name: br.name,
      branch_type: br.branchType,
      from_bus_id: fromId,
      to_bus_id: toId,
      r_pu: br.rPu,
      x_pu: br.xPu,
      b_pu: br.bPu,
      rate_a_mw: br.rateAMw,
      tap_ratio: br.tapRatio,
      phase_shift_deg: br.phaseShiftDeg,
      in_service: true,
    });
  }

  await repo.createBranchesBatch(branchInserts);

  return {
    modelId: model.id,
    busCount: insertedBuses.length,
    branchCount: branchInserts.length,
    generatorCount: parsed.generators.length,
    shuntCount: parsed.shunts.length,
    warnings: parsed.warnings,
    skippedBuses: parsed.buses.length - insertedBuses.length,
    skippedBranches,
  };
}
