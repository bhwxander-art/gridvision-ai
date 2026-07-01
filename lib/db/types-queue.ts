/**
 * Database row types for the ISO/queue schema (migration 013).
 */

export type QueueStatus =
  | "submitted"
  | "study_phase_1"
  | "study_phase_2"
  | "study_phase_3"
  | "executed_ia"
  | "withdrawn"
  | "in_service";

export type ProjectType =
  | "solar"
  | "wind_onshore"
  | "wind_offshore"
  | "battery_storage"
  | "solar_plus_storage"
  | "nuclear"
  | "natural_gas"
  | "hydro"
  | "geothermal"
  | "other_generation"
  | "load";

// ── isos ──────────────────────────────────────────────────────────────────────

export interface DbIso {
  id: string;       // "PJM"
  full_name: string;
  region: string;
  timezone: string;
  ferc_id: string | null;
  queue_url: string | null;
  created_at: string;
  updated_at: string;
}

// ── queue_projects ─────────────────────────────────────────────────────────────

export interface DbQueueProject {
  id: string;
  tenant_id: string;
  iso_id: string;
  project_number: string;
  project_name: string;
  developer: string | null;
  project_type: ProjectType;
  poi_bus_id: string | null;
  poi_description: string | null;
  county: string | null;
  state_abbr: string | null;
  capacity_mw: number;
  in_service_mw: number | null;
  queue_date: string;         // "YYYY-MM-DD"
  study_start_date: string | null;
  target_cod: string | null;
  actual_cod: string | null;
  current_status: QueueStatus;
  network_upgrade_cost_m: number | null;
  project_cost_share_m: number | null;
  withdrawal_probability: number | null;
  ife_last_run_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbQueueProjectInsert
  extends Omit<
    DbQueueProject,
    | "id"
    | "created_at"
    | "updated_at"
    | "developer"
    | "project_type"
    | "poi_bus_id"
    | "poi_description"
    | "county"
    | "state_abbr"
    | "in_service_mw"
    | "study_start_date"
    | "target_cod"
    | "actual_cod"
    | "network_upgrade_cost_m"
    | "project_cost_share_m"
    | "withdrawal_probability"
    | "ife_last_run_at"
    | "metadata"
  > {
  id?: string;
  developer?: string | null;
  project_type?: ProjectType;
  poi_bus_id?: string | null;
  poi_description?: string | null;
  county?: string | null;
  state_abbr?: string | null;
  in_service_mw?: number | null;
  study_start_date?: string | null;
  target_cod?: string | null;
  actual_cod?: string | null;
  network_upgrade_cost_m?: number | null;
  project_cost_share_m?: number | null;
  withdrawal_probability?: number | null;
  ife_last_run_at?: string | null;
  metadata?: Record<string, unknown>;
}

// ── queue_project_status_history ──────────────────────────────────────────────

export interface DbQueueStatusHistory {
  id: string;
  project_id: string;
  tenant_id: string;
  iso_id: string;
  from_status: QueueStatus | null;
  to_status: QueueStatus;
  transitioned_at: string;
  capacity_mw_snapshot: number | null;
  months_in_queue_snapshot: number | null;
  upgrade_cost_m_snapshot: number | null;
  cost_share_m_snapshot: number | null;
  source: string;
  notes: string | null;
  created_at: string;
}

export interface DbQueueStatusHistoryInsert
  extends Omit<
    DbQueueStatusHistory,
    | "id"
    | "created_at"
    | "from_status"
    | "capacity_mw_snapshot"
    | "months_in_queue_snapshot"
    | "upgrade_cost_m_snapshot"
    | "cost_share_m_snapshot"
    | "source"
    | "notes"
  > {
  id?: string;
  from_status?: QueueStatus | null;
  capacity_mw_snapshot?: number | null;
  months_in_queue_snapshot?: number | null;
  upgrade_cost_m_snapshot?: number | null;
  cost_share_m_snapshot?: number | null;
  source?: string;
  notes?: string | null;
}

// ── Domain types (camelCase) ──────────────────────────────────────────────────

export interface QueueProject {
  id: string;
  tenantId: string;
  isoId: string;
  projectNumber: string;
  projectName: string;
  developer: string | null;
  projectType: ProjectType;
  poiBusId: string | null;
  poiDescription: string | null;
  county: string | null;
  stateAbbr: string | null;
  capacityMw: number;
  inServiceMw: number | null;
  queueDate: string;
  studyStartDate: string | null;
  targetCod: string | null;
  actualCod: string | null;
  currentStatus: QueueStatus;
  networkUpgradeCostM: number | null;
  projectCostShareM: number | null;
  withdrawalProbability: number | null;
  ifeLastRunAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QueueStatusHistory {
  id: string;
  projectId: string;
  tenantId: string;
  isoId: string;
  fromStatus: QueueStatus | null;
  toStatus: QueueStatus;
  transitionedAt: string;
  capacityMwSnapshot: number | null;
  monthsInQueueSnapshot: number | null;
  upgradeCostMSnapshot: number | null;
  costShareMSnapshot: number | null;
  source: string;
  notes: string | null;
  createdAt: string;
}

// Ordered list of status transitions for the Cox PH model feature vector
export const QUEUE_STATUS_ORDER: QueueStatus[] = [
  "submitted",
  "study_phase_1",
  "study_phase_2",
  "study_phase_3",
  "executed_ia",
  "withdrawn",
  "in_service",
];

/** Returns true if `status` is a terminal state (no further transitions expected) */
export function isTerminalStatus(status: QueueStatus): boolean {
  return status === "withdrawn" || status === "in_service";
}

/** Returns months elapsed between two ISO date strings */
export function monthsBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  );
}

/** Returns true if this status transition is valid */
export function isValidTransition(
  from: QueueStatus | null,
  to: QueueStatus
): boolean {
  if (from === null) return to === "submitted";  // first event
  if (from === to) return false;                 // no-op
  if (isTerminalStatus(from)) return false;      // terminal states cannot transition

  // withdrawn is reachable from any non-terminal state
  if (to === "withdrawn") return true;

  const fromIdx = QUEUE_STATUS_ORDER.indexOf(from);
  const toIdx = QUEUE_STATUS_ORDER.indexOf(to);

  // Allow forward progression and allow jumping phases (ISO sometimes skips)
  // but not backwards (cannot un-execute an IA)
  return toIdx > fromIdx;
}
