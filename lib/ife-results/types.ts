/**
 * IFE Results Aggregation types — INFRA-018
 *
 * Scope: pure aggregation only. This ticket introduces zero new electrical
 * computation. Every domain object in the response was already computed and
 * persisted by Hosting Capacity (INFRA-012), Upgrade Analysis (INFRA-013),
 * Time-to-Power (INFRA-015), Confidence & Risk (INFRA-016), and Explanations
 * (INFRA-017). This module only packages them into a single response.
 *
 * No new response type modifications to IfeAnalysisComplete — that type remains
 * unchanged. This new type exists solely to add completeness tracking and
 * computeMs measurement for the aggregation endpoint.
 */

import type {
  IfeAnalysis,
  IfeHostingCapacity,
  IfeUpgradeResults,
  IfeTimeToPower,
  IfeConfidenceRisk,
} from "@/lib/db/types-ife";
import type { IfeExplanations } from "@/lib/explanations/types";

/**
 * Completeness tracking for aggregated results.
 *
 * Each field is determined purely by child-record existence:
 * hostingCapacity = (hostingCapacity !== null)
 * upgradeAnalysis = (upgradeResults !== null)
 * timeToPower = (timeToPower !== null)
 * confidenceRisk = (confidenceRisk !== null)
 * explanations = (explanations !== null)
 *
 * Do not inspect internal nullable fields — many are legitimately null
 * by design (e.g., probabilistic fields, cost estimates).
 */
export interface IfeCompleteness {
  hostingCapacity: boolean;
  upgradeAnalysis: boolean;
  timeToPower: boolean;
  confidenceRisk: boolean;
  explanations: boolean;
}

/**
 * IFE Results Aggregation Response — INFRA-018
 *
 * Assembles every completed IFE result into one deterministic response.
 * All domain objects are returned exactly as retrieved from the repository.
 * Only two computed fields are introduced:
 * - completeness: null-check booleans for each child table
 * - computeMs: wall-clock elapsed time including database reads
 *
 * This is a pure aggregation layer with zero computation or transformation.
 */
export interface IfeResultsAggregationResponse {
  analysis: IfeAnalysis;
  hostingCapacity: IfeHostingCapacity | null;
  upgradeResults: IfeUpgradeResults | null;
  timeToPower: IfeTimeToPower | null;
  confidenceRisk: IfeConfidenceRisk | null;
  explanations: IfeExplanations | null;
  completeness: IfeCompleteness;
  computeMs: number;
}
