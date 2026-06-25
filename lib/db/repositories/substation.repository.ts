import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DbSubstation,
  DbTransformer,
  DbFeeder,
  DbSubstationWithRelations,
} from "@/lib/db/types";
import type { SubstationPlan, FeederCircuit } from "@/lib/types";
import type { TransformerAsset } from "@/lib/planning-engine";

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

function toSubstationPlan(row: DbSubstationWithRelations): SubstationPlan {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    voltageKV: Number(row.voltage_kv),
    nameplateMVA: Number(row.nameplate_mva),
    peakLoadMW: Number(row.peak_load_mw),
    n1CapacityMW: Number(row.n1_capacity_mw),
    annualGrowthPct: Number(row.annual_growth_pct),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    transformers: (row.transformers ?? []).map(toTransformer),
    feeders: (row.feeders ?? []).map(toFeeder),
  };
}

function fromSubstationPlan(ss: SubstationPlan): Omit<DbSubstation, "created_at" | "updated_at"> {
  return {
    id: ss.id,
    name: ss.name,
    region: ss.region,
    voltage_kv: ss.voltageKV,
    nameplate_mva: ss.nameplateMVA,
    peak_load_mw: ss.peakLoadMW,
    n1_capacity_mw: ss.n1CapacityMW,
    annual_growth_pct: ss.annualGrowthPct,
    latitude: ss.latitude,
    longitude: ss.longitude,
  };
}

export class SubstationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listManaged(tenantId: string): Promise<(SubstationPlan & { createdAt: string; updatedAt: string })[]> {
    const { data, error } = await this.client
      .from("substations")
      .select("*, transformers(*), feeders(*)")
      .eq("tenant_id", tenantId)
      .order("name");

    if (error) throw new Error(`[SubstationRepository.listManaged] ${error.message}`);
    return (data as (DbSubstationWithRelations & { created_at: string; updated_at: string })[]).map(
      (row) => ({
        ...toSubstationPlan(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    );
  }

  async findById(id: string, tenantId: string): Promise<SubstationPlan | null> {
    const { data, error } = await this.client
      .from("substations")
      .select("*, transformers(*), feeders(*)")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`[SubstationRepository.findById] ${error.message}`);
    if (!data) return null;
    return toSubstationPlan(data as DbSubstationWithRelations);
  }

  async findAll(tenantId: string): Promise<SubstationPlan[]> {
    const { data, error } = await this.client
      .from("substations")
      .select("*, transformers(*), feeders(*)")
      .eq("tenant_id", tenantId)
      .order("name");

    if (error) throw new Error(`[SubstationRepository.findAll] ${error.message}`);
    return (data as DbSubstationWithRelations[]).map(toSubstationPlan);
  }

  async upsert(ss: SubstationPlan, tenantId: string): Promise<void> {
    const row = { ...fromSubstationPlan(ss), tenant_id: tenantId };
    const { error } = await this.client
      .from("substations")
      .upsert(row, { onConflict: "id" });

    if (error) throw new Error(`[SubstationRepository.upsert] ${error.message}`);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("substations")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[SubstationRepository.delete] ${error.message}`);
  }
}
