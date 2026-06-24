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

  /**
   * Returns all capital projects ordered by priority_score descending.
   * Excludes cancelled projects.
   */
  async findAll(): Promise<UpgradeProject[]> {
    const { data, error } = await this.client
      .from("capital_projects")
      .select("*")
      .neq("status", "cancelled")
      .order("priority_score", { ascending: false });

    if (error) throw new Error(`[CapitalProjectRepository.findAll] ${error.message}`);
    return (data as DbCapitalProject[]).map(toUpgradeProject);
  }

  /**
   * Returns all projects associated with a specific substation.
   */
  async findBySubstation(substationId: string): Promise<UpgradeProject[]> {
    const { data, error } = await this.client
      .from("capital_projects")
      .select("*")
      .eq("substation_id", substationId)
      .neq("status", "cancelled")
      .order("priority_score", { ascending: false });

    if (error)
      throw new Error(`[CapitalProjectRepository.findBySubstation] ${error.message}`);
    return (data as DbCapitalProject[]).map(toUpgradeProject);
  }

  /**
   * Returns a single project by id, or null if not found.
   */
  async findById(id: string): Promise<UpgradeProject | null> {
    const { data, error } = await this.client
      .from("capital_projects")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`[CapitalProjectRepository.findById] ${error.message}`);
    if (!data) return null;
    return toUpgradeProject(data as DbCapitalProject);
  }

  /**
   * Upserts a capital project record.
   * Pass status to override the default "planned" value.
   */
  async upsert(
    project: UpgradeProject,
    status: DbCapitalProject["status"] = "planned"
  ): Promise<void> {
    const { error } = await this.client
      .from("capital_projects")
      .upsert(fromUpgradeProject(project, status), { onConflict: "id" });

    if (error) throw new Error(`[CapitalProjectRepository.upsert] ${error.message}`);
  }

  /**
   * Batch-upserts multiple projects.  Used by seed scripts and migrations.
   */
  async upsertMany(
    projects: UpgradeProject[],
    status: DbCapitalProject["status"] = "planned"
  ): Promise<void> {
    if (projects.length === 0) return;
    const rows = projects.map((p) => fromUpgradeProject(p, status));

    const { error } = await this.client
      .from("capital_projects")
      .upsert(rows, { onConflict: "id" });

    if (error) throw new Error(`[CapitalProjectRepository.upsertMany] ${error.message}`);
  }

  /**
   * Updates the status of a project (e.g. approved → in-progress).
   */
  async updateStatus(
    id: string,
    status: DbCapitalProject["status"]
  ): Promise<void> {
    const { error } = await this.client
      .from("capital_projects")
      .update({ status })
      .eq("id", id);

    if (error)
      throw new Error(`[CapitalProjectRepository.updateStatus] ${error.message}`);
  }

  /** Deletes a capital project by id. */
  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from("capital_projects")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`[CapitalProjectRepository.delete] ${error.message}`);
  }

  /** Returns all projects with DB timestamps and status for the asset management UI. */
  async listManaged(): Promise<
    (UpgradeProject & { status: DbCapitalProject["status"]; createdAt: string; updatedAt: string })[]
  > {
    const { data, error } = await this.client
      .from("capital_projects")
      .select("*")
      .order("priority_score", { ascending: false });

    if (error) throw new Error(`[CapitalProjectRepository.listManaged] ${error.message}`);
    return (data as DbCapitalProject[]).map((row) => ({
      ...toUpgradeProject(row),
      status:    row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
