import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbCapitalProject, DbCapitalProjectInsert } from "@/lib/db/types";
import type { UpgradeProject } from "@/lib/data/capital-projects";

// ── Row → domain mapper ───────────────────────────────────────────────────────

function toUpgradeProject(row: DbCapitalProject): UpgradeProject {
  return {
    id:                   row.id,
    substationId:         row.substation_id,
    projectName:          row.project_name,
    upgradeType:          row.upgrade_type,
    estimatedCostUSD:     Number(row.estimated_cost_usd),
    addedCapacityMW:      Number(row.added_capacity_mw),
    implementationMonths: Number(row.implementation_months),
    riskReduction:        Number(row.risk_reduction),
    priorityScore:        Number(row.priority_score),
  };
}

// ── Domain → row mapper ───────────────────────────────────────────────────────

function fromUpgradeProject(
  p: UpgradeProject,
  status: DbCapitalProject["status"] = "planned"
): DbCapitalProjectInsert {
  return {
    id:                   p.id,
    substation_id:        p.substationId,
    project_name:         p.projectName,
    upgrade_type:         p.upgradeType,
    estimated_cost_usd:   p.estimatedCostUSD,
    added_capacity_mw:    p.addedCapacityMW,
    implementation_months: p.implementationMonths,
    risk_reduction:       p.riskReduction,
    priority_score:       p.priorityScore,
    status,
    notes:                null,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class CapitalProjectRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findAll(tenantId?: string): Promise<UpgradeProject[]> {
    let q = this.client
      .from("capital_projects")
      .select("*")
      .neq("status", "cancelled")
      .order("priority_score", { ascending: false });

    if (tenantId) q = q.eq("tenant_id", tenantId);

    const { data, error } = await q;
    if (error) throw new Error(`[CapitalProjectRepository.findAll] ${error.message}`);
    return (data as DbCapitalProject[]).map(toUpgradeProject);
  }

  async findBySubstation(substationId: string, tenantId: string): Promise<UpgradeProject[]> {
    const { data, error } = await this.client
      .from("capital_projects")
      .select("*")
      .eq("substation_id", substationId)
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .order("priority_score", { ascending: false });

    if (error) throw new Error(`[CapitalProjectRepository.findBySubstation] ${error.message}`);
    return (data as DbCapitalProject[]).map(toUpgradeProject);
  }

  async findById(id: string, tenantId: string): Promise<UpgradeProject | null> {
    const { data, error } = await this.client
      .from("capital_projects")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`[CapitalProjectRepository.findById] ${error.message}`);
    if (!data) return null;
    return toUpgradeProject(data as DbCapitalProject);
  }

  async upsert(project: UpgradeProject, status: DbCapitalProject["status"] = "planned", tenantId: string): Promise<void> {
    const row = { ...fromUpgradeProject(project, status), tenant_id: tenantId };
    const { error } = await this.client
      .from("capital_projects")
      .upsert(row, { onConflict: "id" });

    if (error) throw new Error(`[CapitalProjectRepository.upsert] ${error.message}`);
  }

  async upsertMany(projects: UpgradeProject[], status: DbCapitalProject["status"] = "planned"): Promise<void> {
    if (projects.length === 0) return;
    const rows = projects.map((p) => fromUpgradeProject(p, status));

    const { error } = await this.client
      .from("capital_projects")
      .upsert(rows, { onConflict: "id" });

    if (error) throw new Error(`[CapitalProjectRepository.upsertMany] ${error.message}`);
  }

  async updateStatus(id: string, status: DbCapitalProject["status"], tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("capital_projects")
      .update({ status })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[CapitalProjectRepository.updateStatus] ${error.message}`);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("capital_projects")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[CapitalProjectRepository.delete] ${error.message}`);
  }

  async listManaged(tenantId: string): Promise<(UpgradeProject & { createdAt: string; updatedAt: string; status: string })[]> {
    const { data, error } = await this.client
      .from("capital_projects")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("priority_score", { ascending: false });

    if (error) throw new Error(`[CapitalProjectRepository.listManaged] ${error.message}`);
    return (data as (DbCapitalProject & { created_at: string; updated_at: string })[]).map((row) => ({
      ...toUpgradeProject(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
    }));
  }
}
