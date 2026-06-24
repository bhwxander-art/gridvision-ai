import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbFeeder } from "@/lib/db/types";
import type { FeederCircuit } from "@/lib/types";

// ── Row → domain mapper (pure) ────────────────────────────────────────────────

function toFeeder(row: DbFeeder): FeederCircuit {
  return {
    id: row.id,
    substationId: row.substation_id,
    name: row.name,
    hostingCapacityMW: Number(row.hosting_capacity_mw),
    committedLoadMW: Number(row.committed_load_mw),
    queuedLoadMW: Number(row.queued_load_mw),
  };
}

// ── Domain → row mapper (for writes) ─────────────────────────────────────────

function fromFeeder(f: FeederCircuit): Omit<DbFeeder, "created_at" | "updated_at"> {
  return {
    id: f.id,
    substation_id: f.substationId,
    name: f.name,
    hosting_capacity_mw: f.hostingCapacityMW,
    committed_load_mw: f.committedLoadMW,
    queued_load_mw: f.queuedLoadMW,
  };
}

// ── Repository class ──────────────────────────────────────────────────────────

export class FeederRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** Returns all feeder circuits for a given substation, ordered by name. */
  async findBySubstationId(substationId: string): Promise<FeederCircuit[]> {
    const { data, error } = await this.client
      .from("feeders")
      .select("*")
      .eq("substation_id", substationId)
      .order("name");

    if (error) throw new Error(`[FeederRepository.findBySubstationId] ${error.message}`);
    return (data as DbFeeder[]).map(toFeeder);
  }

  /** Returns all feeder circuits across all substations. */
  async findAll(): Promise<FeederCircuit[]> {
    const { data, error } = await this.client
      .from("feeders")
      .select("*")
      .order("substation_id, name");

    if (error) throw new Error(`[FeederRepository.findAll] ${error.message}`);
    return (data as DbFeeder[]).map(toFeeder);
  }

  /** Upserts a feeder record by id. */
  async upsert(feeder: FeederCircuit): Promise<void> {
    const { error } = await this.client
      .from("feeders")
      .upsert(fromFeeder(feeder), { onConflict: "id" });

    if (error) throw new Error(`[FeederRepository.upsert] ${error.message}`);
  }

  /**
   * Updates committed and queued load on a feeder.
   * Called after interconnection study decisions or feeder rebalancing.
   */
  async updateLoad(
    id: string,
    committedLoadMW: number,
    queuedLoadMW: number
  ): Promise<void> {
    const { error } = await this.client
      .from("feeders")
      .update({ committed_load_mw: committedLoadMW, queued_load_mw: queuedLoadMW })
      .eq("id", id);

    if (error) throw new Error(`[FeederRepository.updateLoad] ${error.message}`);
  }

  /** Returns a single feeder by id, or null. */
  async findById(id: string): Promise<FeederCircuit | null> {
    const { data, error } = await this.client
      .from("feeders")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`[FeederRepository.findById] ${error.message}`);
    if (!data) return null;
    return toFeeder(data as DbFeeder);
  }

  /** Deletes a feeder by id. */
  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from("feeders")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`[FeederRepository.delete] ${error.message}`);
  }

  /** Returns all feeders with DB timestamps for the asset management UI. */
  async listManaged(): Promise<(FeederCircuit & { createdAt: string; updatedAt: string })[]> {
    const { data, error } = await this.client
      .from("feeders")
      .select("*")
      .order("substation_id, name");

    if (error) throw new Error(`[FeederRepository.listManaged] ${error.message}`);
    return (data as (DbFeeder & { created_at: string; updated_at: string })[]).map(
      (row) => ({
        ...toFeeder(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    );
  }
}
