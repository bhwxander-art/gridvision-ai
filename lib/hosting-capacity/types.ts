/**
 * Hosting Capacity engine public types — INFRA-012
 *
 * Scope: deterministic, closed-form thermal hosting capacity only (the
 * "Section 1" result in ife_hosting_capacity — see supabase/migrations/
 * 015_ife_schema.sql). Monte Carlo (hc_p10/p50/p90, mc_scenarios_run,
 * mc_convergence_pct, violation_probability) and voltage headroom
 * (vmin/vmax_headroom_pu) are explicitly out of scope and are persisted as
 * NULL — computing them requires stochastic scenario infrastructure and an
 * AC power-flow engine, neither of which exists yet.
 */

import type { ProjectType } from "@/lib/db/types-queue";
import type { BusInjectionsMw } from "@/lib/dcpf/types";

/** "load" project type withdraws power at the POI; every other type injects. */
export type CapacityDirection = "injection" | "withdrawal";

export function directionForProjectType(projectType: ProjectType): CapacityDirection {
  return projectType === "load" ? "withdrawal" : "injection";
}

export interface HostingCapacityOptions {
  slackBusNumber?: number;
  baseMva?: number;
  /** Minimum |sensitivity| to consider a branch constrained by POI injection. Default 1e-6. */
  sensitivityEpsilon?: number;
}

export interface BindingConstraint {
  branchNumber: number; // the monitored branch that binds
  outagedBranchNumber: number | null; // null = base case (N-0) is binding
  ratingMw: number; // the rating that was binding (normal or emergency)
  preConstraintFlowMw: number; // flow before any POI increment
  sensitivityMwPerMw: number; // OTDF (or plain PTDF for N-0) at the POI
}

export interface HostingCapacityResult {
  poiBusNumber: number;
  direction: CapacityDirection;
  hcDeterministicMw: number; // >= 0, clamped
  binding: BindingConstraint | null; // null only if no finite bound was found
  contingenciesScreened: number;
  islandingContingenciesExcluded: number[];
  baseCaseFlowsMw: Map<number, number>;
  topologyHash: string | null;
  computedAt: string;
}

/** Thrown when the supplied base case already violates a thermal rating — an input problem, not a valid zero-capacity answer. */
export class BaseCaseViolationError extends Error {
  constructor(
    message: string,
    public readonly branchNumber: number,
    public readonly flowMw: number,
    public readonly ratingMw: number
  ) {
    super(message);
    this.name = "BaseCaseViolationError";
  }
}

export interface HostingCapacityRequest {
  networkModelId: string;
  poiBusNumber: number;
  isoId: string;
  capacityMw: number;
  projectType: ProjectType;
  targetCod?: string | null;
  baseCaseInjectionsMw: BusInjectionsMw;
  idempotencyKey?: string;
}
