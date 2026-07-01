/**
 * Scenario Analysis Engine public types — INFRA-019
 *
 * The Scenario Engine performs no electrical computation of its own. It only
 * decides whether a network_models clone is needed (network_delta non-empty)
 * and, if so, materializes it via the existing, unmodified NetworkRepository
 * methods (createModel/createBusesBatch/createBranchesBatch) before calling
 * the existing, unmodified orchestrateIfeAnalysis (INFRA-014) against the
 * resolved model id. See the approved INFRA-019 technical specification for
 * the full architectural rationale.
 */

import type { ProjectType } from "@/lib/db/types-queue";
import type { BusInjectionsMw } from "@/lib/dcpf/types";

// ── Network delta operations ─────────────────────────────────────────────────

export interface SetBranchInServiceOp {
  op: "set_branch_in_service";
  branchNumber: number;
  inService: boolean;
}

export interface SetBranchRatingOp {
  op: "set_branch_rating";
  branchNumber: number;
  rateAMw: number;
  rateBMw?: number | null;
  rateCMw?: number | null;
}

export type NetworkDeltaOp = SetBranchInServiceOp | SetBranchRatingOp;

// ── Request / result types ────────────────────────────────────────────────────

export interface ScenarioRequest {
  baseNetworkModelId: string;
  name: string;
  description?: string | null;
  poiBusNumber: number;
  isoId: string;
  capacityMw: number;
  projectType: ProjectType;
  targetCod?: string | null;
  /** Full base-case injection map, exactly as required by IfeOrchestrationRequest. */
  baseCaseInjectionsMw: BusInjectionsMw;
  /** bus_number -> MW override, merged over baseCaseInjectionsMw before orchestration. */
  injectionOverridesMw?: Record<number, number>;
  networkDelta?: NetworkDeltaOp[];
  idempotencyKey?: string;
}

export interface ScenarioResult {
  scenario: {
    id: string;
    status: "completed";
    baseNetworkModelId: string;
    derivedNetworkModelId: string | null;
    resultAnalysisId: string;
  };
  orchestration: import("@/lib/ife-orchestrator/types").IfeOrchestrationResult;
}

export type ScenarioStage = "materialization" | "orchestration";

/**
 * Wraps a stage failure while preserving the original error via the standard
 * Error.cause mechanism — mirrors IfeOrchestrationStageError (INFRA-014) so
 * API-layer status-code mapping can reuse the same instanceof/message-based
 * approach after unwrapping `cause` once.
 */
export class IfeScenarioStageError extends Error {
  constructor(
    public readonly stage: ScenarioStage,
    cause: Error
  ) {
    super(`[IfeScenario] Failed at stage '${stage}': ${cause.message}`, { cause });
    this.name = "IfeScenarioStageError";
  }
}

/** Re-exported for convenience at call sites that build injection overrides. */
export type { BusInjectionsMw };
