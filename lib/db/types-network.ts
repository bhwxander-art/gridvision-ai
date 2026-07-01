/**
 * Database row types for the grid network schema (migration 012).
 *
 * Column names mirror PostgreSQL (snake_case). Repositories map
 * these into camelCase domain types used by the application.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export type IsoRegion = "PJM" | "CAISO" | "ERCOT" | "MISO" | "NYISO" | "ISONE";

export type NetworkModelSource = "CIM_XML" | "PSSE_RAW" | "MATPOWER" | "MANUAL";

export type BusType = "PQ" | "PV" | "SLACK";

export type BranchType = "LINE" | "TRANSFORMER" | "PHASE_SHIFTER";

// ── network_models ────────────────────────────────────────────────────────────

export interface DbNetworkModel {
  id: string;
  tenant_id: string;
  iso: IsoRegion;
  name: string;
  version: string;
  base_mva: number;
  model_date: string;         // ISO date string "YYYY-MM-DD"
  source: NetworkModelSource;
  topology_hash: string | null;
  ptdf_valid: boolean;
  lodf_valid: boolean;
  bus_count: number;
  branch_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbNetworkModelInsert
  extends Omit<DbNetworkModel, "id" | "topology_hash" | "ptdf_valid" | "lodf_valid" | "bus_count" | "branch_count" | "created_at" | "updated_at"> {
  id?: string;
  topology_hash?: string | null;
  ptdf_valid?: boolean;
  lodf_valid?: boolean;
  bus_count?: number;
  branch_count?: number;
}

// ── network_buses ─────────────────────────────────────────────────────────────

export interface DbNetworkBus {
  id: string;
  model_id: string;
  tenant_id: string;
  bus_number: number;
  name: string;
  base_kv: number;
  bus_type: BusType;
  latitude: number | null;
  longitude: number | null;
  zone: string | null;
  area: string | null;
  vmin_pu: number;
  vmax_pu: number;
  created_at: string;
  updated_at: string;
}

export interface DbNetworkBusInsert
  extends Omit<DbNetworkBus, "id" | "created_at" | "updated_at" | "bus_type" | "vmin_pu" | "vmax_pu"> {
  id?: string;
  bus_type?: BusType;
  vmin_pu?: number;
  vmax_pu?: number;
}

// ── network_branches ──────────────────────────────────────────────────────────

export interface DbNetworkBranch {
  id: string;
  model_id: string;
  tenant_id: string;
  branch_number: number;
  name: string;
  branch_type: BranchType;
  from_bus_id: string;
  to_bus_id: string;
  r_pu: number;
  x_pu: number;
  b_pu: number;
  rate_a_mw: number;
  rate_b_mw: number | null;
  rate_c_mw: number | null;
  tap_ratio: number;
  phase_shift_deg: number;
  in_service: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbNetworkBranchInsert
  extends Omit<
    DbNetworkBranch,
    | "id"
    | "created_at"
    | "updated_at"
    | "branch_type"
    | "r_pu"
    | "b_pu"
    | "rate_b_mw"
    | "rate_c_mw"
    | "tap_ratio"
    | "phase_shift_deg"
    | "in_service"
  > {
  id?: string;
  branch_type?: BranchType;
  r_pu?: number;
  b_pu?: number;
  rate_b_mw?: number | null;
  rate_c_mw?: number | null;
  tap_ratio?: number;
  phase_shift_deg?: number;
  in_service?: boolean;
}

// ── Topology delta (for cache invalidation) ───────────────────────────────────

export interface TopologyDelta {
  addedBranchIds: string[];
  removedBranchIds: string[];
  modifiedBranchIds: string[];
  hasChanges: boolean;
}

// ── Domain types (camelCase) ──────────────────────────────────────────────────

export interface NetworkModel {
  id: string;
  tenantId: string;
  iso: IsoRegion;
  name: string;
  version: string;
  baseMva: number;
  modelDate: string;
  source: NetworkModelSource;
  topologyHash: string | null;
  ptdfValid: boolean;
  lodfValid: boolean;
  busCount: number;
  branchCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkBus {
  id: string;
  modelId: string;
  tenantId: string;
  busNumber: number;
  name: string;
  baseKv: number;
  busType: BusType;
  latitude: number | null;
  longitude: number | null;
  zone: string | null;
  area: string | null;
  vminPu: number;
  vmaxPu: number;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkBranch {
  id: string;
  modelId: string;
  tenantId: string;
  branchNumber: number;
  name: string;
  branchType: BranchType;
  fromBusId: string;
  toBusId: string;
  rPu: number;
  xPu: number;
  bPu: number;
  rateAMw: number;
  rateBMw: number | null;
  rateCMw: number | null;
  tapRatio: number;
  phaseShiftDeg: number;
  inService: boolean;
  createdAt: string;
  updatedAt: string;
}
