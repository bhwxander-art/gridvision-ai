import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbTransformer } from "@/lib/db/types";
import type { TransformerAsset } from "@/lib/planning-engine";

// ── Row → domain mapper (pure) ────────────────────────────────────────────────

function toTransformer(row: DbTransformer): TransformerAsset {
  return {
    id: row.id,
    substationId: row.substation_id,
    name: row.name,
    ratedMVA: Number(row.rated_mva),
    peakLoadMVA: Number(row.peak_load_mva),
    loadFactor: Number(row.load_factor),
    ageYears: row.age_years,
    n1Compliant: row.n1_compliant,
  };
}

// ── Domain → row mapper (for writes) ─────────────────────────────────────────

function fromTransformer(tx: TransformerAsset): Omit<DbTransformer, "created_at" | "updated_at"> {
  return {
    id: tx.id,
    substation_id: tx.substationId,
    name: tx.name,
    rated_mva: tx.ratedMVA,
    peak_load_mva: tx.peakLoadMVA,
    load_factor: tx.loadFactor,
    age_years: tx.ageYears,
    n1_compliant: tx.n1Compliant,
  };
}

// ── Repository class ──────────────────────────────────────────────────────────

export class TransformerRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** Returns all transformers for a given substation (tenant-scoped). */
  async findBySubstationId(substationId: string, tenantId: string): Promise<TransformerAsset[]> {
    const { data, error } = await this.client
      .from("transformers")
      .select("*")
      .eq("substation_id", substationId)
      .eq("tenant_id", tenantId)
      .order("name");

    if (error) throw new Error(`[TransformerRepository.findBySubstationId] ${error.message}`);
    return (data as DbTransformer[]).map(toTransformer);
  }

  /** Returns every transformer for a specific tenant. */
  async findAll(tenantId: string): Promise<TransformerAsset[]> {
    const { data, error } = await this.client
      .from("transformers")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("substation_id, name");

    if (error) throw new Error(`[TransformerRepository.findAll] ${error.message}`);
    return (data as DbTransformer[]).map(toTransformer);
  }

  /** Upserts a transformer record (tenant-scoped). */
  async upsert(tx: TransformerAsset, tenantId: string): Promise<void> {
    const record = { ...fromTransformer(tx), tenant_id: tenantId };
    const { error } = await this.client
      .from("transformers")
      .upsert(record, { onConflict: "id" });

    if (error) throw new Error(`[TransformerRepository.upsert] ${error.message}`);
  }

  /** Updates peak load (tenant-scoped). */
  async updatePeakLoad(id: string, peakLoadMVA: number, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("transformers")
      .update({ peak_load_mva: peakLoadMVA })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[TransformerRepository.updatePeakLoad] ${error.message}`);
  }

  /** Returns a single transformer by id (tenant-scoped). */
  async findById(id: string, tenantId: string): Promise<TransformerAsset | null> {
    const { data, error } = await this.client
      .from("transformers")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`[TransformerRepository.findById] ${error.message}`);
    if (!data) return null;
    return toTransformer(data as DbTransformer);
  }

  /** Deletes a transformer by id (tenant-scoped). */
  async delete(id: string, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("transformers")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[TransformerRepository.delete] ${error.message}`);
  }

  /** Returns all transformers with DB timestamps (tenant-scoped). */
  async listManaged(tenantId: string): Promise<(TransformerAsset & { createdAt: string; updatedAt: string })[]> {
    const { data, error } = await this.client
      .from("transformers")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("substation_id, name");

    if (error) throw new Error(`[TransformerRepository.listManaged] ${error.message}`);
    return (data as (DbTransformer & { created_at: string; updated_at: string })[]).map(
      (row) => ({
        ...toTransformer(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    );
  }
}
