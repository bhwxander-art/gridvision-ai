/**
 * Outcome Analytics pipeline — INFRA-021
 *
 * Pure deterministic interval-coverage computation: no modeling, no
 * probability estimation, no electrical calculation. Reads four already-
 * existing tables through already-existing, unmodified repository methods;
 * writes only through the new, narrowly-scoped IfeOutcomeAnalyticsRepository
 * (the approved architectural exception — see that repository's docstring).
 *
 * Safe to call at any time relative to Upgrade Analysis / Time-to-Power
 * completing: if their results don't exist yet, the corresponding analytics
 * field resolves to null and no write is issued for it; called again later
 * once they exist, the still-null field is filled in. An already-resolved
 * field is never recomputed or re-sent — enforced both here (only unresolved
 * fields are included in the patch) and, independently, at the database
 * level by the repository's per-column `IS NULL` guard.
 */

import "server-only";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { IfeOutcomeTrackingRepository } from "@/lib/db/repositories/ife-outcome-tracking.repository";
import type { IfeOutcomeAnalyticsRepository } from "@/lib/db/repositories/ife-outcome-analytics.repository";
import type { IfeAnalysis } from "@/lib/db/types-ife";
import type { IfeOutcomeTracking } from "@/lib/outcome-tracking/types";
import type { OutcomeAnalyticsPatch } from "./types";
import { computeWithinCostP10P90, computeWithinCodP25P75 } from "./interval-coverage";

export interface OutcomeAnalyticsPipelineResult {
  analysis: IfeAnalysis;
  outcomeTracking: IfeOutcomeTracking;
  computeMs: number;
}

export async function computeAndPersistOutcomeAnalytics(
  tenantId: string,
  analysisId: string,
  ifeRepo: IfeRepository,
  outcomeRepo: IfeOutcomeTrackingRepository,
  analyticsRepo: IfeOutcomeAnalyticsRepository
): Promise<OutcomeAnalyticsPipelineResult> {
  const t0 = performance.now();

  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    // Deliberately does not interpolate tenantId — must be byte-identical for a
    // wrong-tenant analysisId and a truly-nonexistent one (same convention as
    // INFRA-020's outcome-tracking-pipeline.ts).
    throw new Error(`[OutcomeAnalytics] Analysis ${analysisId} not found`);
  }

  let outcome = await outcomeRepo.getOutcomeTrackingByAnalysisId(tenantId, analysisId);
  if (!outcome) {
    throw new Error(`[OutcomeAnalytics] No outcome record exists yet for analysis ${analysisId}`);
  }

  const needsCost = outcome.withinCostP10P90 === null;
  const needsCod = outcome.withinCodP25P75 === null;

  if (!needsCost && !needsCod) {
    // Both already settled — nothing left to compute, nothing to write.
    return { analysis, outcomeTracking: outcome, computeMs: Math.round(performance.now() - t0) };
  }

  const [upgradeResults, timeToPower] = await Promise.all([
    needsCost ? ifeRepo.getUpgradeResultsByAnalysisId(tenantId, analysisId) : Promise.resolve(null),
    needsCod ? ifeRepo.getTimeToPowerByAnalysisId(tenantId, analysisId) : Promise.resolve(null),
  ]);

  const patch: OutcomeAnalyticsPatch = {};

  if (needsCost) {
    const computed = computeWithinCostP10P90(
      outcome.actualCostM,
      upgradeResults?.costP10M ?? null,
      upgradeResults?.costP90M ?? null
    );
    if (computed !== null) patch.withinCostP10P90 = computed;
  }

  if (needsCod) {
    const computed = computeWithinCodP25P75(
      outcome.actualCod,
      timeToPower?.codP25 ?? null,
      timeToPower?.codP75 ?? null
    );
    if (computed !== null) patch.withinCodP25P75 = computed;
  }

  if (Object.keys(patch).length > 0) {
    // Scoped by outcome.id (the row's own primary key), not analysisId — analysis_id has
    // no UNIQUE constraint (an accepted, documented limitation on this table), so scoping
    // by analysisId alone could let a value computed from THIS row's actual_cost_m/actual_cod
    // land on a different, sibling row sharing the same analysis_id. See the repository's
    // docstring for the full rationale.
    await analyticsRepo.updateOutcomeAnalytics(tenantId, outcome.id, patch);
    // Re-fetch rather than locally merge the patch — reflects the DB-guarded write exactly
    // as committed, including the (benign) case where a concurrent request's guarded UPDATE
    // won instead of this one. Still keyed by analysisId (getOutcomeTrackingByAnalysisId is
    // the only read method IfeOutcomeTrackingRepository exposes), but this correctly returns
    // the same row just written to: it selects deterministically by created_at ascending,
    // which the write above never modifies, so "earliest row" cannot change between the two
    // reads even if a duplicate-row race exists.
    outcome = (await outcomeRepo.getOutcomeTrackingByAnalysisId(tenantId, analysisId)) ?? outcome;
  }

  return { analysis, outcomeTracking: outcome, computeMs: Math.round(performance.now() - t0) };
}
