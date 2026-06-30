import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DbIso,
  DbQueueProject,
  DbQueueProjectInsert,
  DbQueueStatusHistory,
  DbQueueStatusHistoryInsert,
  QueueProject,
  QueueStatusHistory,
  QueueStatus,
  ProjectType,
} from "@/lib/db/types-queue";
import { isValidTransition, monthsBetween } from "@/lib/db/types-queue";

// ── Row → domain mappers ──────────────────────────────────────────────────────

export function toQueueProject(row: DbQueueProject): QueueProject {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    isoId: row.iso_id,
    projectNumber: row.project_number,
    projectName: row.project_name,
    developer: row.developer,
    projectType: row.project_type,
    poiBusId: row.poi_bus_id,
    poiDescription: row.poi_description,
    county: row.county,
    stateAbbr: row.state_abbr,
    capacityMw: Number(row.capacity_mw),
    inServiceMw: row.in_service_mw != null ? Number(row.in_service_mw) : null,
    queueDate: row.queue_date,
    studyStartDate: row.study_start_date,
    targetCod: row.target_cod,
    actualCod: row.actual_cod,
    currentStatus: row.current_status,
    networkUpgradeCostM:
      row.network_upgrade_cost_m != null
        ? Number(row.network_upgrade_cost_m)
        : null,
    projectCostShareM:
      row.project_cost_share_m != null
        ? Number(row.project_cost_share_m)
        : null,
    withdrawalProbability:
      row.withdrawal_probability != null
        ? Number(row.withdrawal_probability)
        : null,
    ifeLastRunAt: row.ife_last_run_at,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toQueueStatusHistory(row: DbQueueStatusHistory): QueueStatusHistory {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    isoId: row.iso_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    transitionedAt: row.transitioned_at,
    capacityMwSnapshot:
      row.capacity_mw_snapshot != null
        ? Number(row.capacity_mw_snapshot)
        : null,
    monthsInQueueSnapshot: row.months_in_queue_snapshot,
    upgradeCostMSnapshot:
      row.upgrade_cost_m_snapshot != null
        ? Number(row.upgrade_cost_m_snapshot)
        : null,
    costShareMSnapshot:
      row.cost_share_m_snapshot != null
        ? Number(row.cost_share_m_snapshot)
        : null,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export class QueueValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = "QueueValidationError";
  }
}

export function validateQueueProjectInsert(
  insert: DbQueueProjectInsert
): void {
  if (!insert.project_number || insert.project_number.trim().length === 0) {
    throw new QueueValidationError(
      "project_number is required",
      "project_number"
    );
  }
  if (!insert.project_name || insert.project_name.trim().length === 0) {
    throw new QueueValidationError(
      "project_name is required",
      "project_name"
    );
  }
  if (insert.capacity_mw <= 0) {
    throw new QueueValidationError(
      "capacity_mw must be positive",
      "capacity_mw"
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(insert.queue_date)) {
    throw new QueueValidationError(
      "queue_date must be in YYYY-MM-DD format",
      "queue_date"
    );
  }
  if (
    insert.target_cod &&
    insert.target_cod < insert.queue_date
  ) {
    throw new QueueValidationError(
      "target_cod must be on or after queue_date",
      "target_cod"
    );
  }
  if (
    insert.withdrawal_probability != null &&
    (insert.withdrawal_probability < 0 ||
      insert.withdrawal_probability > 1)
  ) {
    throw new QueueValidationError(
      "withdrawal_probability must be between 0 and 1",
      "withdrawal_probability"
    );
  }
}

// ── Repository ────────────────────────────────────────────────────────────────

export class QueueRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── isos ────────────────────────────────────────────────────────────────────

  async listIsos(): Promise<DbIso[]> {
    const { data, error } = await this.client
      .from("isos")
      .select("*")
      .order("id");

    if (error)
      throw new Error(`[QueueRepository.listIsos] ${error.message}`);
    return data as DbIso[];
  }

  async getIso(isoId: string): Promise<DbIso | null> {
    const { data, error } = await this.client
      .from("isos")
      .select("*")
      .eq("id", isoId)
      .maybeSingle();

    if (error)
      throw new Error(`[QueueRepository.getIso] ${error.message}`);
    return data as DbIso | null;
  }

  // ── queue_projects ──────────────────────────────────────────────────────────

  async listProjects(
    tenantId: string,
    opts: {
      isoId?: string;
      status?: QueueStatus;
      projectType?: ProjectType;
      poiBusId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<QueueProject[]> {
    let query = this.client
      .from("queue_projects")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("queue_date", { ascending: false });

    if (opts.isoId)       query = query.eq("iso_id", opts.isoId);
    if (opts.status)      query = query.eq("current_status", opts.status);
    if (opts.projectType) query = query.eq("project_type", opts.projectType);
    if (opts.poiBusId)    query = query.eq("poi_bus_id", opts.poiBusId);
    if (opts.limit)       query = query.limit(opts.limit);
    if (opts.offset)      query = query.range(opts.offset, (opts.offset ?? 0) + (opts.limit ?? 100) - 1);

    const { data, error } = await query;
    if (error)
      throw new Error(`[QueueRepository.listProjects] ${error.message}`);
    return (data as DbQueueProject[]).map(toQueueProject);
  }

  async getProject(
    tenantId: string,
    projectId: string
  ): Promise<QueueProject | null> {
    const { data, error } = await this.client
      .from("queue_projects")
      .select("*")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[QueueRepository.getProject] ${error.message}`);
    return data ? toQueueProject(data as DbQueueProject) : null;
  }

  async getProjectByNumber(
    tenantId: string,
    isoId: string,
    projectNumber: string
  ): Promise<QueueProject | null> {
    const { data, error } = await this.client
      .from("queue_projects")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .eq("project_number", projectNumber)
      .maybeSingle();

    if (error)
      throw new Error(
        `[QueueRepository.getProjectByNumber] ${error.message}`
      );
    return data ? toQueueProject(data as DbQueueProject) : null;
  }

  async createProject(
    insert: DbQueueProjectInsert
  ): Promise<QueueProject> {
    validateQueueProjectInsert(insert);

    const { data, error } = await this.client
      .from("queue_projects")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[QueueRepository.createProject] ${error.message}`);
    return toQueueProject(data as DbQueueProject);
  }

  /**
   * Upsert by (tenant_id, iso_id, project_number).
   * Updates all mutable fields; preserves withdrawal_probability set by IFE.
   */
  async upsertProject(
    insert: DbQueueProjectInsert
  ): Promise<QueueProject> {
    validateQueueProjectInsert(insert);

    const { data, error } = await this.client
      .from("queue_projects")
      .upsert(insert, {
        onConflict: "tenant_id,iso_id,project_number",
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error)
      throw new Error(`[QueueRepository.upsertProject] ${error.message}`);
    return toQueueProject(data as DbQueueProject);
  }

  /**
   * Transitions a project to a new status.
   * Validates the transition is legal before writing.
   * The database trigger will automatically insert a history row.
   */
  async transitionStatus(
    tenantId: string,
    projectId: string,
    toStatus: QueueStatus
  ): Promise<QueueProject> {
    const current = await this.getProject(tenantId, projectId);
    if (!current) {
      throw new Error(
        `[QueueRepository.transitionStatus] Project ${projectId} not found`
      );
    }

    if (!isValidTransition(current.currentStatus, toStatus)) {
      throw new QueueValidationError(
        `Invalid status transition: ${current.currentStatus} → ${toStatus}`,
        "current_status"
      );
    }

    const { data, error } = await this.client
      .from("queue_projects")
      .update({ current_status: toStatus })
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error)
      throw new Error(
        `[QueueRepository.transitionStatus] ${error.message}`
      );
    return toQueueProject(data as DbQueueProject);
  }

  async updateWithdrawalProbability(
    tenantId: string,
    projectId: string,
    probability: number
  ): Promise<void> {
    if (probability < 0 || probability > 1) {
      throw new QueueValidationError(
        "probability must be between 0 and 1",
        "withdrawal_probability"
      );
    }

    const { error } = await this.client
      .from("queue_projects")
      .update({
        withdrawal_probability: probability,
        ife_last_run_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("tenant_id", tenantId);

    if (error)
      throw new Error(
        `[QueueRepository.updateWithdrawalProbability] ${error.message}`
      );
  }

  async deleteProject(tenantId: string, projectId: string): Promise<void> {
    const { error } = await this.client
      .from("queue_projects")
      .delete()
      .eq("id", projectId)
      .eq("tenant_id", tenantId);

    if (error)
      throw new Error(`[QueueRepository.deleteProject] ${error.message}`);
  }

  // ── queue_project_status_history ─────────────────────────────────────────────

  async getHistory(
    tenantId: string,
    projectId: string
  ): Promise<QueueStatusHistory[]> {
    const { data, error } = await this.client
      .from("queue_project_status_history")
      .select("*")
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .order("transitioned_at", { ascending: true });

    if (error)
      throw new Error(`[QueueRepository.getHistory] ${error.message}`);
    return (data as DbQueueStatusHistory[]).map(toQueueStatusHistory);
  }

  /**
   * Returns all withdrawal events for a given tenant, ISO, and date range.
   * Used by the Cox PH model training pipeline.
   */
  async getWithdrawalEvents(
    tenantId: string,
    isoId: string,
    fromDate: string,
    toDate: string
  ): Promise<QueueStatusHistory[]> {
    const { data, error } = await this.client
      .from("queue_project_status_history")
      .select("*, queue_projects!inner(iso_id)")
      .eq("tenant_id", tenantId)
      .eq("to_status", "withdrawn")
      .gte("transitioned_at", fromDate)
      .lte("transitioned_at", toDate)
      .eq("iso_id", isoId)
      .order("transitioned_at", { ascending: true });

    if (error)
      throw new Error(
        `[QueueRepository.getWithdrawalEvents] ${error.message}`
      );
    return (data as DbQueueStatusHistory[]).map(toQueueStatusHistory);
  }

  /**
   * Returns the count of active (non-terminal) queue projects per POI bus.
   * Used by IFE to compute queue_depth_upstream.
   */
  async getQueueDepthByBus(
    tenantId: string,
    isoId: string
  ): Promise<Array<{ poi_bus_id: string; depth: number; total_mw: number }>> {
    const { data, error } = await this.client
      .from("queue_projects")
      .select("poi_bus_id, capacity_mw")
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .not("current_status", "in", "('withdrawn','in_service')")
      .not("poi_bus_id", "is", null);

    if (error)
      throw new Error(
        `[QueueRepository.getQueueDepthByBus] ${error.message}`
      );

    const rows = data as Array<{ poi_bus_id: string; capacity_mw: number }>;
    const map = new Map<string, { depth: number; total_mw: number }>();

    for (const row of rows) {
      const existing = map.get(row.poi_bus_id) ?? { depth: 0, total_mw: 0 };
      map.set(row.poi_bus_id, {
        depth: existing.depth + 1,
        total_mw: existing.total_mw + Number(row.capacity_mw),
      });
    }

    return Array.from(map.entries()).map(([poi_bus_id, v]) => ({
      poi_bus_id,
      ...v,
    }));
  }
}
