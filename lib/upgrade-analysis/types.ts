/**
 * Upgrade Analysis engine public types — INFRA-013
 *
 * Scope: deterministic thermal uprate identification only. No cost model,
 * no MILP optimization, no probabilistic analysis — see the approved
 * INFRA-013 technical specification for the full scope rationale. Cost
 * fields on ife_upgrade_results (cost_p10/p50/p90_m, project_share_p50_m,
 * milp_optimality_gap_pct, milp_solve_seconds) and each UpgradeDetail's
 * cost_p50_m are always persisted as NULL by this engine.
 */

import type { CapacityDirection } from "@/lib/hosting-capacity/types";

export interface UpgradeCandidate {
  branchNumber: number;
  upgradeType: "thermal_uprate"; // the only type this deterministic engine can produce
  originalRateAMw: number;
  newRateAMw: number;
  originalEmergencyRatingMw: number | null; // whichever of rateBMw ?? rateCMw supplied it
  newEmergencyRatingMw: number | null;
  capacityIncreaseMw: number; // max(newRateAMw - originalRateAMw, newEmergency - originalEmergency, 0)
}

export interface UpgradeAnalysisOptions {
  slackBusNumber?: number;
  sensitivityEpsilon?: number;
  /** Multiplier applied to each computed minimum-required rating. Default 1.0 (exact minimum). */
  ratingMarginMultiplier?: number;
  /** Safety cap on iterations. Default: number of in-service branches (a proven upper bound). */
  maxIterations?: number;
  /** Absolute MW tolerance for the "capacity already sufficient" check. Default 1e-6. */
  toleranceMw?: number;
}

export interface UpgradeAnalysisResult {
  poiBusNumber: number;
  direction: CapacityDirection;
  requestedCapacityMw: number;
  hostingCapacityBeforeMw: number;
  hostingCapacityAfterMw: number;
  feasible: boolean;
  upgradesRequired: number;
  upgrades: UpgradeCandidate[]; // ordered = ranked, most-limiting first
  iterations: number;
  topologyHash: string | null;
  computedAt: string;
}

/** Thrown when the iterative loop exhausts maxIterations without reaching sufficient capacity. */
export class UpgradeAnalysisInfeasibleError extends Error {
  constructor(
    message: string,
    public readonly iterationsAttempted: number
  ) {
    super(message);
    this.name = "UpgradeAnalysisInfeasibleError";
  }
}
