/**
 * Queue analytics repository — INFRA-015
 *
 * Read-only historical duration queries used by the Time-to-Power engine.
 * Deliberately separate from QueueRepository: QueueRepository owns
 * queue-domain CRUD (projects, status transitions, history rows);
 * this repository owns statistical/analytics reads over the same tables
 * for downstream percentile estimation. Nothing here writes any data.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectType } from "@/lib/db/types-queue";

export interface CodDurationSample {
  queueDate: string;
  actualCod: string;
}

export class QueueAnalyticsRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Months-in-queue-to-executed_ia durations, read directly from the
   * months_in_queue_snapshot column already captured by the
   * record_queue_status_change() trigger at transition time (migration 013)
   * — no duration is recomputed here.
   */
  async getExecutedIaDurationSamples(
    tenantId: string,
    isoId: string,
    projectType?: ProjectType
  ): Promise<number[]> {
    let query = this.client
      .from("queue_project_status_history")
      .select("months_in_queue_snapshot, queue_projects!inner(project_type)")
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .eq("to_status", "executed_ia")
      .not("months_in_queue_snapshot", "is", null);

    if (projectType) {
      query = query.eq("queue_projects.project_type", projectType);
    }

    const { data, error } = await query;
    if (error)
      throw new Error(`[QueueAnalyticsRepository.getExecutedIaDurationSamples] ${error.message}`);

    return (data as Array<{ months_in_queue_snapshot: number | null }>)
      .map((row) => row.months_in_queue_snapshot)
      .filter((v): v is number => v != null);
  }

  /**
   * Raw (queue_date, actual_cod) pairs for completed (in_service) projects.
   * Duration computation is left to the caller (the pure engine reuses the
   * existing monthsBetween() helper) — this method only fetches data.
   */
  async getCodDurationSamples(
    tenantId: string,
    isoId: string,
    projectType?: ProjectType
  ): Promise<CodDurationSample[]> {
    let query = this.client
      .from("queue_projects")
      .select("queue_date, actual_cod")
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .eq("current_status", "in_service")
      .not("actual_cod", "is", null);

    if (projectType) {
      query = query.eq("project_type", projectType);
    }

    const { data, error } = await query;
    if (error)
      throw new Error(`[QueueAnalyticsRepository.getCodDurationSamples] ${error.message}`);

    return (data as Array<{ queue_date: string; actual_cod: string }>).map((row) => ({
      queueDate: row.queue_date,
      actualCod: row.actual_cod,
    }));
  }
}
