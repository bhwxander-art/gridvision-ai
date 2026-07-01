/**
 * IFE outcome analytics repository — INFRA-021
 *
 * The approved architectural exception (INFRA-021 Phase 2 review, sign-off
 * A1): this is the first repository in the codebase to issue an UPDATE
 * against ife_outcome_tracking. IfeOutcomeTrackingRepository (INFRA-020)
 * remains untouched and still owns every field it created that row with —
 * this repository only ever writes within_cost_p10_p90/within_cod_p25_p75,
 * columns Outcome Tracking itself never populates or reasons about.
 *
 * Every write here is a NULL -> computed-value transition, never an
 * overwrite, enforced at the database level via a per-column
 * `.is(column, null)` guard — but that guard alone is not sufficient: it
 * must also be scoped to the *specific row* the caller read and reasoned
 * about, not merely "some row for this analysis." ife_outcome_tracking.
 * analysis_id has no UNIQUE constraint (IfeOutcomeTrackingRepository's own
 * docstring documents this as an accepted, un-migrated limitation — a race
 * could produce two rows for one analysis with different actual values).
 * Scoping only by (analysis_id, tenant_id) would let a write computed from
 * one row's actual_cost_m/actual_cod land on a *different* row that was
 * never compared against its own values — a real cross-row correctness bug,
 * not a benign duplicate-write. Scoping by the row's own `id` (its primary
 * key, always known to the caller since it came from a prior read) closes
 * this: the guarded UPDATE can only ever affect the exact row it was
 * computed for, regardless of how many rows share that analysis_id.
 *
 * Side effect: ife_outcome_tracking's unconditional `trg_ife_ot_updated_at`
 * trigger (migration 015) fires on any UPDATE, so `updated_at` advances when
 * analytics are computed, even though no Outcome-Tracking-owned field
 * changes. `trg_ife_compute_residuals` does NOT fire — it is scoped to
 * `UPDATE OF actual_cost_m, actual_cod` only (migration 015), neither of
 * which this repository ever touches.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutcomeAnalyticsPatch } from "@/lib/outcome-analytics/types";

export class IfeOutcomeAnalyticsRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * `outcomeId` is the specific ife_outcome_tracking row's own primary key
   * (IfeOutcomeTracking.id) — not analysisId — so the guarded UPDATE can
   * only ever affect that exact row, never a sibling duplicate row for the
   * same analysis. Writes only the field(s) present in `patch`; absent
   * fields are left completely untouched.
   */
  async updateOutcomeAnalytics(
    tenantId: string,
    outcomeId: string,
    patch: OutcomeAnalyticsPatch
  ): Promise<void> {
    if (patch.withinCostP10P90 !== undefined) {
      const { error } = await this.client
        .from("ife_outcome_tracking")
        .update({ within_cost_p10_p90: patch.withinCostP10P90 })
        .eq("id", outcomeId)
        .eq("tenant_id", tenantId)
        .is("within_cost_p10_p90", null);

      if (error)
        throw new Error(`[IfeOutcomeAnalyticsRepository.updateOutcomeAnalytics] ${error.message}`);
    }

    if (patch.withinCodP25P75 !== undefined) {
      const { error } = await this.client
        .from("ife_outcome_tracking")
        .update({ within_cod_p25_p75: patch.withinCodP25P75 })
        .eq("id", outcomeId)
        .eq("tenant_id", tenantId)
        .is("within_cod_p25_p75", null);

      if (error)
        throw new Error(`[IfeOutcomeAnalyticsRepository.updateOutcomeAnalytics] ${error.message}`);
    }
  }
}
