/**
 * IFE Results Aggregation pipeline — INFRA-018
 *
 * Pure aggregation only. Reads existing persisted results and assembles them
 * into a single response. Zero computation, zero writes, zero pipeline invocation.
 *
 * Responsibilities:
 * 1. Validate tenantId
 * 2. Load analysis via repository read-only method
 * 3. If analysis missing → null (caller decides 404)
 * 4. If analysis.status !== "completed" → throw (caller decides 400)
 * 5. Read all five child tables via repository read-only methods
 * 6. Assemble response with completeness flags and computeMs
 * 7. Return (no side effects, no writes)
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { IfeResultsAggregationResponse, IfeCompleteness } from "./types";

/**
 * Aggregates all completed IFE results for a given analysis.
 *
 * @param client Supabase client (used to create IfeRepository)
 * @param tenantId Tenant UUID (required for all repository calls)
 * @param analysisId Analysis UUID (required to identify the analysis)
 * @returns Complete aggregated response with all child results and metadata
 * @throws Error if analysis not found or not completed
 */
export async function aggregateIfeResults(
  client: SupabaseClient,
  tenantId: string,
  analysisId: string
): Promise<IfeResultsAggregationResponse> {
  const startTime = performance.now();

  const ifeRepo = new IfeRepository(client);

  // Load analysis — read-only repository method
  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    throw new Error(
      `[aggregateIfeResults] Analysis '${analysisId}' not found for tenant '${tenantId}'`
    );
  }

  // Validate status — analysis must be completed
  if (analysis.status !== "completed") {
    throw new Error(
      `[aggregateIfeResults] Analysis '${analysisId}' is not completed (status: ${analysis.status})`
    );
  }

  // Load all five child results in parallel — all read-only repository methods
  const [hostingCapacity, upgradeResults, timeToPower, confidenceRisk, explanations] =
    await Promise.all([
      ifeRepo.getHostingCapacityByAnalysisId(tenantId, analysisId),
      ifeRepo.getUpgradeResultsByAnalysisId(tenantId, analysisId),
      ifeRepo.getTimeToPowerByAnalysisId(tenantId, analysisId),
      ifeRepo.getConfidenceRiskByAnalysisId(tenantId, analysisId),
      ifeRepo.getExplanationsByAnalysisId(tenantId, analysisId),
    ]);

  // Compute completeness based on child-record existence only
  const completeness: IfeCompleteness = {
    hostingCapacity: hostingCapacity !== null,
    upgradeAnalysis: upgradeResults !== null,
    timeToPower: timeToPower !== null,
    confidenceRisk: confidenceRisk !== null,
    explanations: explanations !== null,
  };

  // Measure wall-clock elapsed time through the aggregation pipeline
  const endTime = performance.now();
  const computeMs = Math.round(endTime - startTime);

  // Assemble response — return all domain objects exactly as retrieved
  const response: IfeResultsAggregationResponse = {
    analysis,
    hostingCapacity,
    upgradeResults,
    timeToPower,
    confidenceRisk,
    explanations,
    completeness,
    computeMs,
  };

  return response;
}
