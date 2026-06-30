import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DbNetworkModel,
  DbNetworkModelInsert,
  DbNetworkBus,
  DbNetworkBusInsert,
  DbNetworkBranch,
  DbNetworkBranchInsert,
  NetworkModel,
  NetworkBus,
  NetworkBranch,
  IsoRegion,
} from "@/lib/db/types-network";

// ── Row → domain mappers ──────────────────────────────────────────────────────

export function toNetworkModel(row: DbNetworkModel): NetworkModel {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    iso: row.iso,
    name: row.name,
    version: row.version,
    baseMva: Number(row.base_mva),
    modelDate: row.model_date,
    source: row.source,
    topologyHash: row.topology_hash,
    ptdfValid: row.ptdf_valid,
    lodfValid: row.lodf_valid,
    busCount: row.bus_count,
    branchCount: row.branch_count,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toNetworkBus(row: DbNetworkBus): NetworkBus {
  return {
    id: row.id,
    modelId: row.model_id,
    tenantId: row.tenant_id,
    busNumber: Number(row.bus_number),
    name: row.name,
    baseKv: Number(row.base_kv),
    busType: row.bus_type,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    zone: row.zone,
    area: row.area,
    vminPu: Number(row.vmin_pu),
    vmaxPu: Number(row.vmax_pu),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toNetworkBranch(row: DbNetworkBranch): NetworkBranch {
  return {
    id: row.id,
    modelId: row.model_id,
    tenantId: row.tenant_id,
    branchNumber: Number(row.branch_number),
    name: row.name,
    branchType: row.branch_type,
    fromBusId: row.from_bus_id,
    toBusId: row.to_bus_id,
    rPu: Number(row.r_pu),
    xPu: Number(row.x_pu),
    bPu: Number(row.b_pu),
    rateAMw: Number(row.rate_a_mw),
    rateBMw: row.rate_b_mw != null ? Number(row.rate_b_mw) : null,
    rateCMw: row.rate_c_mw != null ? Number(row.rate_c_mw) : null,
    tapRatio: Number(row.tap_ratio),
    phaseShiftDeg: Number(row.phase_shift_deg),
    inService: row.in_service,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export class NetworkValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = "NetworkValidationError";
  }
}

export function validateNetworkModelInsert(
  insert: DbNetworkModelInsert
): void {
  if (!insert.name || insert.name.trim().length === 0) {
    throw new NetworkValidationError("name is required", "name");
  }
  if ((insert.base_mva ?? 100) <= 0) {
    throw new NetworkValidationError("base_mva must be positive", "base_mva");
  }
  if (!insert.model_date || !/^\d{4}-\d{2}-\d{2}$/.test(insert.model_date)) {
    throw new NetworkValidationError(
      "model_date must be in YYYY-MM-DD format",
      "model_date"
    );
  }
}

export function validateNetworkBusInsert(insert: DbNetworkBusInsert): void {
  if (insert.bus_number == null || insert.bus_number < 0) {
    throw new NetworkValidationError(
      "bus_number must be a non-negative integer",
      "bus_number"
    );
  }
  if (!insert.name || insert.name.trim().length === 0) {
    throw new NetworkValidationError("name is required", "name");
  }
  if (insert.base_kv <= 0) {
    throw new NetworkValidationError("base_kv must be positive", "base_kv");
  }
  const vmin = insert.vmin_pu ?? 0.95;
  const vmax = insert.vmax_pu ?? 1.05;
  if (vmin < 0.5 || vmin > 1.0) {
    throw new NetworkValidationError(
      "vmin_pu must be between 0.5 and 1.0",
      "vmin_pu"
    );
  }
  if (vmax < 1.0 || vmax > 1.5) {
    throw new NetworkValidationError(
      "vmax_pu must be between 1.0 and 1.5",
      "vmax_pu"
    );
  }
  if (vmax <= vmin) {
    throw new NetworkValidationError(
      "vmax_pu must be greater than vmin_pu",
      "vmax_pu"
    );
  }
}

export function validateNetworkBranchInsert(
  insert: DbNetworkBranchInsert
): void {
  if (insert.branch_number == null || insert.branch_number < 0) {
    throw new NetworkValidationError(
      "branch_number must be a non-negative integer",
      "branch_number"
    );
  }
  if (!insert.name || insert.name.trim().length === 0) {
    throw new NetworkValidationError("name is required", "name");
  }
  if (insert.from_bus_id === insert.to_bus_id) {
    throw new NetworkValidationError(
      "from_bus_id and to_bus_id must be different (no self-loops)",
      "to_bus_id"
    );
  }
  if (insert.x_pu === 0) {
    throw new NetworkValidationError(
      "x_pu must be non-zero (zero reactance creates a short circuit)",
      "x_pu"
    );
  }
  if (insert.rate_a_mw <= 0) {
    throw new NetworkValidationError(
      "rate_a_mw must be positive",
      "rate_a_mw"
    );
  }
  const tap = insert.tap_ratio ?? 1.0;
  if (tap <= 0) {
    throw new NetworkValidationError(
      "tap_ratio must be positive",
      "tap_ratio"
    );
  }
}

// ── Repository ────────────────────────────────────────────────────────────────

const NETWORK_BATCH_SIZE = 500; // stay under PostgREST default body-size limits

export class NetworkRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── network_models ──────────────────────────────────────────────────────────

  async listModels(tenantId: string): Promise<NetworkModel[]> {
    const { data, error } = await this.client
      .from("network_models")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("model_date", { ascending: false });

    if (error)
      throw new Error(`[NetworkRepository.listModels] ${error.message}`);
    return (data as DbNetworkModel[]).map(toNetworkModel);
  }

  async listModelsByIso(
    tenantId: string,
    iso: IsoRegion
  ): Promise<NetworkModel[]> {
    const { data, error } = await this.client
      .from("network_models")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("iso", iso)
      .order("model_date", { ascending: false });

    if (error)
      throw new Error(`[NetworkRepository.listModelsByIso] ${error.message}`);
    return (data as DbNetworkModel[]).map(toNetworkModel);
  }

  async getModel(
    tenantId: string,
    modelId: string
  ): Promise<NetworkModel | null> {
    const { data, error } = await this.client
      .from("network_models")
      .select("*")
      .eq("id", modelId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[NetworkRepository.getModel] ${error.message}`);
    return data ? toNetworkModel(data as DbNetworkModel) : null;
  }

  async createModel(insert: DbNetworkModelInsert): Promise<NetworkModel> {
    validateNetworkModelInsert(insert);

    const { data, error } = await this.client
      .from("network_models")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[NetworkRepository.createModel] ${error.message}`);
    return toNetworkModel(data as DbNetworkModel);
  }

  async markPtdfValid(
    tenantId: string,
    modelId: string,
    valid: boolean
  ): Promise<void> {
    const { error } = await this.client
      .from("network_models")
      .update({ ptdf_valid: valid })
      .eq("id", modelId)
      .eq("tenant_id", tenantId);

    if (error)
      throw new Error(`[NetworkRepository.markPtdfValid] ${error.message}`);
  }

  async markLodfValid(
    tenantId: string,
    modelId: string,
    valid: boolean
  ): Promise<void> {
    const { error } = await this.client
      .from("network_models")
      .update({ lodf_valid: valid })
      .eq("id", modelId)
      .eq("tenant_id", tenantId);

    if (error)
      throw new Error(`[NetworkRepository.markLodfValid] ${error.message}`);
  }

  async deleteModel(tenantId: string, modelId: string): Promise<void> {
    const { error } = await this.client
      .from("network_models")
      .delete()
      .eq("id", modelId)
      .eq("tenant_id", tenantId);

    if (error)
      throw new Error(`[NetworkRepository.deleteModel] ${error.message}`);
  }

  // ── network_buses ───────────────────────────────────────────────────────────

  async listBuses(
    tenantId: string,
    modelId: string
  ): Promise<NetworkBus[]> {
    const { data, error } = await this.client
      .from("network_buses")
      .select("*")
      .eq("model_id", modelId)
      .eq("tenant_id", tenantId)
      .order("bus_number", { ascending: true });

    if (error)
      throw new Error(`[NetworkRepository.listBuses] ${error.message}`);
    return (data as DbNetworkBus[]).map(toNetworkBus);
  }

  async getBus(
    tenantId: string,
    busId: string
  ): Promise<NetworkBus | null> {
    const { data, error } = await this.client
      .from("network_buses")
      .select("*")
      .eq("id", busId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[NetworkRepository.getBus] ${error.message}`);
    return data ? toNetworkBus(data as DbNetworkBus) : null;
  }

  async getBusByNumber(
    tenantId: string,
    modelId: string,
    busNumber: number
  ): Promise<NetworkBus | null> {
    const { data, error } = await this.client
      .from("network_buses")
      .select("*")
      .eq("model_id", modelId)
      .eq("tenant_id", tenantId)
      .eq("bus_number", busNumber)
      .maybeSingle();

    if (error)
      throw new Error(`[NetworkRepository.getBusByNumber] ${error.message}`);
    return data ? toNetworkBus(data as DbNetworkBus) : null;
  }

  async createBus(insert: DbNetworkBusInsert): Promise<NetworkBus> {
    validateNetworkBusInsert(insert);

    const { data, error } = await this.client
      .from("network_buses")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[NetworkRepository.createBus] ${error.message}`);
    return toNetworkBus(data as DbNetworkBus);
  }

  async createBusesBatch(
    inserts: DbNetworkBusInsert[]
  ): Promise<NetworkBus[]> {
    if (inserts.length === 0) return [];
    inserts.forEach(validateNetworkBusInsert);

    const results: NetworkBus[] = [];
    for (let i = 0; i < inserts.length; i += NETWORK_BATCH_SIZE) {
      const chunk = inserts.slice(i, i + NETWORK_BATCH_SIZE);
      const { data, error } = await this.client
        .from("network_buses")
        .insert(chunk)
        .select();

      if (error)
        throw new Error(
          `[NetworkRepository.createBusesBatch] chunk ${Math.floor(i / NETWORK_BATCH_SIZE) + 1}: ${error.message}`
        );
      results.push(...(data as DbNetworkBus[]).map(toNetworkBus));
    }
    return results;
  }

  async deleteBus(tenantId: string, busId: string): Promise<void> {
    const { error } = await this.client
      .from("network_buses")
      .delete()
      .eq("id", busId)
      .eq("tenant_id", tenantId);

    if (error)
      throw new Error(`[NetworkRepository.deleteBus] ${error.message}`);
  }

  // ── network_branches ────────────────────────────────────────────────────────

  async listBranches(
    tenantId: string,
    modelId: string,
    inServiceOnly = false
  ): Promise<NetworkBranch[]> {
    let query = this.client
      .from("network_branches")
      .select("*")
      .eq("model_id", modelId)
      .eq("tenant_id", tenantId)
      .order("branch_number", { ascending: true });

    if (inServiceOnly) {
      query = query.eq("in_service", true);
    }

    const { data, error } = await query;
    if (error)
      throw new Error(`[NetworkRepository.listBranches] ${error.message}`);
    return (data as DbNetworkBranch[]).map(toNetworkBranch);
  }

  async getBranch(
    tenantId: string,
    branchId: string
  ): Promise<NetworkBranch | null> {
    const { data, error } = await this.client
      .from("network_branches")
      .select("*")
      .eq("id", branchId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[NetworkRepository.getBranch] ${error.message}`);
    return data ? toNetworkBranch(data as DbNetworkBranch) : null;
  }

  async createBranch(insert: DbNetworkBranchInsert): Promise<NetworkBranch> {
    validateNetworkBranchInsert(insert);

    const { data, error } = await this.client
      .from("network_branches")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[NetworkRepository.createBranch] ${error.message}`);
    return toNetworkBranch(data as DbNetworkBranch);
  }

  async createBranchesBatch(
    inserts: DbNetworkBranchInsert[]
  ): Promise<NetworkBranch[]> {
    if (inserts.length === 0) return [];
    inserts.forEach(validateNetworkBranchInsert);

    const results: NetworkBranch[] = [];
    for (let i = 0; i < inserts.length; i += NETWORK_BATCH_SIZE) {
      const chunk = inserts.slice(i, i + NETWORK_BATCH_SIZE);
      const { data, error } = await this.client
        .from("network_branches")
        .insert(chunk)
        .select();

      if (error)
        throw new Error(
          `[NetworkRepository.createBranchesBatch] chunk ${Math.floor(i / NETWORK_BATCH_SIZE) + 1}: ${error.message}`
        );
      results.push(...(data as DbNetworkBranch[]).map(toNetworkBranch));
    }
    return results;
  }

  async tripBranch(
    tenantId: string,
    branchId: string
  ): Promise<NetworkBranch> {
    return this._setInService(tenantId, branchId, false);
  }

  async closeBranch(
    tenantId: string,
    branchId: string
  ): Promise<NetworkBranch> {
    return this._setInService(tenantId, branchId, true);
  }

  private async _setInService(
    tenantId: string,
    branchId: string,
    inService: boolean
  ): Promise<NetworkBranch> {
    const { data, error } = await this.client
      .from("network_branches")
      .update({ in_service: inService })
      .eq("id", branchId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error)
      throw new Error(`[NetworkRepository._setInService] ${error.message}`);
    return toNetworkBranch(data as DbNetworkBranch);
  }

  async deleteBranch(tenantId: string, branchId: string): Promise<void> {
    const { error } = await this.client
      .from("network_branches")
      .delete()
      .eq("id", branchId)
      .eq("tenant_id", tenantId);

    if (error)
      throw new Error(`[NetworkRepository.deleteBranch] ${error.message}`);
  }

  // ── Topology comparison ─────────────────────────────────────────────────────

  /**
   * Returns true when the model's current topology_hash differs from
   * `previousHash`. Callers use this to decide whether a full PTDF/LODF
   * recompute is needed. The old `computeTopologyDelta` was a stub that
   * always returned empty branch-ID arrays — this method is honest about
   * what it actually computes.
   */
  async hasTopologyChanged(
    tenantId: string,
    modelId: string,
    previousHash: string | null
  ): Promise<boolean> {
    const { data: model, error: modelErr } = await this.client
      .from("network_models")
      .select("topology_hash")
      .eq("id", modelId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (modelErr)
      throw new Error(
        `[NetworkRepository.hasTopologyChanged] ${modelErr.message}`
      );

    if (!model) return false; // model not found for this tenant
    return (model as DbNetworkModel).topology_hash !== previousHash;
  }
}
