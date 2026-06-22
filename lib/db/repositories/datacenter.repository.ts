import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbDataCenter } from "@/lib/db/types";
import type { DataCenterInterconnection } from "@/lib/types";

// ── Row → domain mapper (pure) ────────────────────────────────────────────────

function toDataCenter(row: DbDataCenter): DataCenterInterconnection {
  return {
    id: row.id,
    projectName: row.project_name,
    developer: row.developer ?? "",
    requestedMW: Number(row.requested_mw),
    loadFactor: Number(row.load_factor),
    targetCOD: row.target_cod,
    status: row.status,
    affectedSubstationId: row.affected_substation_id ?? "",
    affectedFeederId: row.affected_feeder_id ?? "",
    rampMonths: row.ramp_months,
  };
}

// ── Domain → row mapper (for writes) ─────────────────────────────────────────

function fromDataCenter(
  dc: DataCenterInterconnection
): Omit<DbDataCenter, "created_at" | "updated_at"> {
  return {
    id: dc.id,
    project_name: dc.projectName,
    developer: dc.developer || null,
    requested_mw: dc.requestedMW,
    load_factor: dc.loadFactor,
    target_cod: dc.targetCOD,
    status: dc.status,
    affected_substation_id: dc.affectedSubstationId || null,
    affected_feeder_id: dc.affectedFeederId || null,
    ramp_months: dc.rampMonths,
  };
}

// ── Repository class ──────────────────────────────────────────────────────────

export class DataCenterRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Returns all data-center interconnection projects.
   * Active queue: study → ia-executed → construction → energized.
   */
  async findAll(): Promise<DataCenterInterconnection[]> {
    const { data, error } = await this.client
      .from("data_center_queue")
      .select("*")
      .order("target_cod");

    if (error) throw new Error(`[DataCenterRepository.findAll] ${error.message}`);
    return (data as DbDataCenter[]).map(toDataCenter);
  }

  /** Returns a single project by id, or null if not found. */
  async findById(id: string): Promise<DataCenterInterconnection | null> {
    const { data, error } = await this.client
      .from("data_center_queue")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`[DataCenterRepository.findById] ${error.message}`);
    if (!data) return null;
    return toDataCenter(data as DbDataCenter);
  }

  /** Returns all projects affecting a specific substation. */
  async findBySubstationId(substationId: string): Promise<DataCenterInterconnection[]> {
    const { data, error } = await this.client
      .from("data_center_queue")
      .select("*")
      .eq("affected_substation_id", substationId)
      .order("target_cod");

    if (error) throw new Error(`[DataCenterRepository.findBySubstationId] ${error.message}`);
    return (data as DbDataCenter[]).map(toDataCenter);
  }

  /** Upserts a project record by id. */
  async upsert(dc: DataCenterInterconnection): Promise<void> {
    const { error } = await this.client
      .from("data_center_queue")
      .upsert(fromDataCenter(dc), { onConflict: "id" });

    if (error) throw new Error(`[DataCenterRepository.upsert] ${error.message}`);
  }

  /**
   * Advances a project to the next study/build status.
   * Emits an error if the new status is not a valid enum value.
   */
  async updateStatus(
    id: string,
    status: DataCenterInterconnection["status"]
  ): Promise<void> {
    const { error } = await this.client
      .from("data_center_queue")
      .update({ status })
      .eq("id", id);

    if (error) throw new Error(`[DataCenterRepository.updateStatus] ${error.message}`);
  }
}
