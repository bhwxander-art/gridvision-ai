/**
 * Full IFE Analysis Orchestrator public types — INFRA-014
 *
 * Scope: pure orchestration only. No new electrical computation exists here
 * — every number in the response was already computed by
 * computeAndPersistHostingCapacity (INFRA-012) or computeAndPersistUpgradeAnalysis
 * (INFRA-013). There is deliberately no "engine" module for this ticket: an
 * engine implies pure computation to be pure about, and this ticket performs
 * none — see the approved technical specification for the full rationale.
 */

import type { ProjectType } from "@/lib/db/types-queue";
import type { BusInjectionsMw } from "@/lib/dcpf/types";
import type { UpgradeAnalysisOptions } from "@/lib/upgrade-analysis/types";
import type { IfeAnalysis, IfeHostingCapacity, IfeUpgradeResults } from "@/lib/db/types-ife";

export interface IfeOrchestrationRequest {
  networkModelId: string;
  poiBusNumber: number;
  isoId: string;
  capacityMw: number;
  projectType: ProjectType;
  targetCod?: string | null;
  baseCaseInjectionsMw: BusInjectionsMw;
  idempotencyKey?: string;
  /** Forwarded verbatim to computeAndPersistHostingCapacity's slackBusNumberOverride param. */
  hostingCapacityOptions?: { slackBusNumber?: number };
  /** Forwarded verbatim to computeAndPersistUpgradeAnalysis — the existing INFRA-013 type, reused as-is. */
  upgradeAnalysisOptions?: UpgradeAnalysisOptions;
}

export type IfeOrchestrationOverallStatus = "completed_no_upgrade_needed" | "completed_with_upgrades";

/**
 * H2: split compute timing — each stage measured independently rather than a
 * single aggregate number, so callers can see where time was actually spent
 * (and so a fast-path/idempotent hit is visibly near-zero on both stages).
 */
export interface IfeOrchestrationComputeMs {
  hostingCapacityMs: number;
  /** 0 when the upgrade-analysis stage was never entered (capacity already sufficient). */
  upgradeAnalysisMs: number;
  totalMs: number;
}

export interface IfeOrchestrationResult {
  analysis: IfeAnalysis;
  hostingCapacity: IfeHostingCapacity;
  upgradeResults: IfeUpgradeResults | null;
  overallStatus: IfeOrchestrationOverallStatus;
  computeMs: IfeOrchestrationComputeMs;
}

export type IfeOrchestrationStage = "hosting_capacity" | "upgrade_analysis";

/**
 * Wraps a stage failure while preserving the original error's type via the
 * standard Error.cause mechanism, so API-layer status-code mapping can keep
 * reusing the exact instanceof/message checks already established in the
 * Hosting Capacity and Upgrade Analysis routes — just unwrapping `cause`
 * once first. No new error taxonomy is introduced.
 */
export class IfeOrchestrationStageError extends Error {
  constructor(
    public readonly stage: IfeOrchestrationStage,
    cause: Error
  ) {
    super(`[IfeOrchestration] Failed at stage '${stage}': ${cause.message}`, { cause });
    this.name = "IfeOrchestrationStageError";
  }
}
