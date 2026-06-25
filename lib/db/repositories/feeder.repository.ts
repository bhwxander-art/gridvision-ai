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

  /** Returns all feeder circuits for a given substation (tenant-scoped). */
  async findBySubstationId(substationId: string, tenantId: string): Promise<FeederCircuit[]> {
    const { data, error } = await this.client
      .from("feeders")
      .select("*")
      .eq("substation_id", substationId)
      .eq("tenant_id", tenantId)
      .order("name");

    if (error) throw new Error(`[FeederRepository.findBySubstationId] ${error.message}`);
    return (data as DbFeeder[]).map(toFeeder);
  }

  /** Returns all feeder circuits for a specific tenant. */
  async findAll(tenantId: string): Promise<FeederCircuit[]> {
    const { data, error } = await this.client
      .from("feeders")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("substation_id, name");

    if (error) throw new Error(`[FeederRepository.findAll] ${error.message}`);
    return (data as DbFeeder[]).map(toFeeder);
  }

  /** Upserts a feeder record (tenant-scoped). */
  async upsert(feeder: FeederCircuit, tenantId: string): Promise<void> {
    const record = { ...fromFeeder(feeder), tenant_id: tenantId };
    const { error } = await this.client
      .from("feeders")
      .upsert(record, { onConflict: "id" });

    if (error) throw new Error(`[FeederRepository.upsert] ${error.message}`);
  }

  /** Updates committed and queued load (tenant-scoped). */
  async updateLoad(
    id: string,
    committedLoadMW: number,
    queuedLoadMW: number,
    tenantId: string
  ): Promise<void> {
    const { error } = await this.client
      .from("feeders")
      .update({ committed_load_mw: committedLoadMW, queued_load_mw: queuedLoadMW })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[FeederRepository.updateLoad] ${error.message}`);
  }

  /** Returns a single feeder by id (tenant-scoped). */
  async findById(id: string, tenantId: string): Promise<FeederCircuit | null> {
    const { data, error } = await this.client
      .from("feeders")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`[FeederRepository.findById] ${error.message}`);
    if (!data) return null;
    return toFeeder(data as DbFeeder);
  }

  /** Deletes a feeder by id (tenant-scoped). */
  async delete(id: string, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("feeders")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[FeederRepository.delete] ${error.message}`);
  }

  /** Returns all feeders with DB timestamps (tenant-scoped). */
  async listManaged(tenantId: string): Promise<(FeederCircuit & { createdAt: string; updatedAt: string })[]> {
    const { data, error } = await this.client
      .from("feeders")
      .select("*")
      .eq("tenant_id", tenantId)
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
