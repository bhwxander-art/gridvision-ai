/**
 * Outcome Tracking repository-integrated pipeline — INFRA-020
 *
 * Pure persistence/read feature: no prediction, no model execution, no
 * recalibration, no orchestration, no electrical calculation, and no
 * modification of any prior analysis result. The only derived values
 * (cost_residual_m, cod_residual_months) are produced by the existing
 * BEFORE INSERT database trigger (migration 015) — this pipeline computes
 * nothing itself.
 *
 * Idempotency: analysisId is the natural idempotency key (no
 * idempotency_key column exists on ife_outcome_tracking, and none is added —
 * see the approved INFRA-020 architecture review, resolved finding B1).
 * POST is fully resource-idempotent: if an outcome record already exists for
 * the analysis, it is returned unchanged, never an error. This is a
 * check-then-insert, not an atomic claim — analysis_id has no UNIQUE
 * constraint, so a genuine concurrent race could still produce two rows.
 * Accepted as a known limitation (see IfeOutcomeTrackingRepository's
 * docstring), consistent with every other idempotency check in this
 * codebase, not something this pipeline can make an absolute guarantee of.
 *
 * Tenant isolation: getAnalysis(tenantId, analysisId) is reused unmodified
 * from IfeRepository, which already collapses "doesn't exist" and "exists
 * under a different tenant" into the same null/not-found outcome — this
 * pipeline does not (and must not) distinguish them (resolved finding B2).
 */

import "server-only";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { IfeOutcomeTrackingRepository } from "@/lib/db/repositories/ife-outcome-tracking.repository";
import type { IfeAnalysis } from "@/lib/db/types-ife";
import type { IfeOutcomeTracking, OutcomeTrackingRequest } from "./types";

export interface OutcomeTrackingPipelineResult {
  analysis: IfeAnalysis;
  outcomeTracking: IfeOutcomeTracking;
  computeMs: number;
}

export async function computeAndPersistOutcomeTracking(
  tenantId: string,
  analysisId: string,
  ifeRepo: IfeRepository,
  outcomeRepo: IfeOutcomeTrackingRepository,
  request: OutcomeTrackingRequest
): Promise<OutcomeTrackingPipelineResult> {
  const t0 = performance.now();

  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    // Deliberately does not interpolate tenantId — this message must be byte-identical
    // whether analysisId truly doesn't exist or exists under a different tenant (resolved
    // finding B2), matching the GET route's equivalent fixed message exactly.
    throw new Error(`[OutcomeTracking] Analysis ${analysisId} not found`);
  }

  // Resource-idempotent fast path — checked before the completed-status check, since an
  // existing record could only have been created for an analysis that was completed at
  // the time, and re-validating that now would be redundant.
  const existing = await outcomeRepo.getOutcomeTrackingByAnalysisId(tenantId, analysisId);
  if (existing) {
    return { analysis, outcomeTracking: existing, computeMs: Math.round(performance.now() - t0) };
  }

  if (analysis.status !== "completed") {
    throw new Error(
      `[OutcomeTracking] Analysis ${analysisId} is not completed (status: ${analysis.status}) ` +
        `— outcomes can only be recorded for a completed analysis`
    );
  }

  const outcomeTracking = await outcomeRepo.createOutcomeTracking({
    analysis_id: analysisId,
    tenant_id: tenantId,
    queue_project_id: request.queueProjectId ?? null,
    actual_cost_m: request.actualCostM ?? null,
    actual_cod: request.actualCod ?? null,
    actual_feasible: request.actualFeasible ?? null,
    actual_withdrawn: request.actualWithdrawn ?? null,
    outcome_observed_at: request.outcomeObservedAt ?? null,
    // Deferred to a future analytics milestone per the approved spec — no computation
    // exists for these under INFRA-020, so they are always persisted as null.
    within_cost_p10_p90: null,
    within_cod_p25_p75: null,
    notes: request.notes ?? null,
  });

  return { analysis, outcomeTracking, computeMs: Math.round(performance.now() - t0) };
}
