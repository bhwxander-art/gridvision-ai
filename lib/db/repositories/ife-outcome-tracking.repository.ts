/**
 * IFE outcome tracking repository — INFRA-020
 *
 * Covers ife_outcome_tracking only, as a dedicated repository class — per
 * lib/db/repositories/ife.repository.ts's own docstring ("ife_outcome_tracking
 * is a distinct table ... and belongs to its own future ticket with its own
 * repository") and the INFRA-020 architecture review (Blocking B3).
 * IfeRepository itself is not modified. Mirrors IfeScenarioRepository's
 * (INFRA-019) tenant-scoped CRUD pattern.
 *
 * Historical records are immutable per the approved spec: only create + read
 * methods exist here — no update, no delete.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbIfeOutcomeTracking, DbIfeOutcomeTrackingInsert } from "@/lib/db/types-ife";
import { toIfeOutcomeTracking } from "@/lib/outcome-tracking/mappers";
import { validateIfeOutcomeTrackingInsert } from "@/lib/outcome-tracking/validation";
import type { IfeOutcomeTracking } from "@/lib/outcome-tracking/types";

export class IfeOutcomeTrackingRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createOutcomeTracking(insert: DbIfeOutcomeTrackingInsert): Promise<IfeOutcomeTracking> {
    validateIfeOutcomeTrackingInsert(insert);

    const { data, error } = await this.client
      .from("ife_outcome_tracking")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[IfeOutcomeTrackingRepository.createOutcomeTracking] ${error.message}`);
    return toIfeOutcomeTracking(data as DbIfeOutcomeTracking);
  }

  /**
   * ife_outcome_tracking.analysis_id has no UNIQUE constraint (application-level
   * "one outcome per analysis" invariant only — accepted limitation, no migration
   * available to add one). `.order(...).limit(1)` before `.maybeSingle()` avoids a
   * "multiple rows returned" crash if that invariant is ever violated by a race,
   * returning the earliest record deterministically instead.
   */
  async getOutcomeTrackingByAnalysisId(
    tenantId: string,
    analysisId: string
  ): Promise<IfeOutcomeTracking | null> {
    const { data, error } = await this.client
      .from("ife_outcome_tracking")
      .select("*")
      .eq("analysis_id", analysisId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeOutcomeTrackingRepository.getOutcomeTrackingByAnalysisId] ${error.message}`);
    return data ? toIfeOutcomeTracking(data as DbIfeOutcomeTracking) : null;
  }
}
