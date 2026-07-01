/**
 * Hosting Capacity engine — INFRA-012
 *
 * Computes deterministic thermal hosting capacity at a point of
 * interconnection (POI) bus using the standard OTDF (Outage Transfer
 * Distribution Factor) identity — pure algebra on the already-computed
 * PTDF matrix (Φ, INFRA-009) and LODF matrix (Λ, INFRA-010), plus one
 * already-solved base-case DC power flow (INFRA-011). No new linear solve
 * is performed here.
 *
 * For monitored branch l, the sensitivity of its flow to a unit injection
 * at bus `poi` is:
 *
 *   S(l, poi, N-0)      = Φ[l, poi]
 *   S(l, poi, outage k) = Φ[l, poi] + Λ[l, k] · Φ[k, poi]      (OTDF)
 *
 * and the pre-increment flow is:
 *
 *   F(l, N-0)      = F_l^base
 *   F(l, outage k) = F_l^base + Λ[l, k] · F_k^base   (= contingencyImpact()'s
 *                                                        postContingencyFlowMw,
 *                                                        reused directly)
 *
 * For a requested direction (injection: sign=+1, withdrawal: sign=-1), each
 * (branch, contingency) pair yields a closed-form bound on |ΔP| before that
 * pair's rating is violated; the minimum over all pairs (including N-0) is
 * the deterministic hosting capacity, clamped at zero.
 *
 * Scope: thermal-only. Monte Carlo and voltage-headroom outputs are handled
 * by lib/hosting-capacity/hosting-capacity-pipeline.ts, which persists them
 * as NULL — this engine does not compute them at all.
 */

import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import type { ProjectType } from "@/lib/db/types-queue";
import type { PtdfMatrix } from "@/lib/ptdf/types";
import { ptdfLookup } from "@/lib/ptdf/ptdf-engine";
import type { LodfMatrix } from "@/lib/lodf/types";
import { contingencyImpact } from "@/lib/lodf/lodf-engine";
import type { DcPowerFlowResult } from "@/lib/dcpf/types";
import {
  directionForProjectType,
  BaseCaseViolationError,
  type HostingCapacityOptions,
  type HostingCapacityResult,
  type BindingConstraint,
} from "./types";

const DEFAULT_SENSITIVITY_EPSILON = 1e-6;

export function computeHostingCapacity(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  ptdf: PtdfMatrix,
  lodf: LodfMatrix,
  baseCase: DcPowerFlowResult,
  poiBusNumber: number,
  projectType: ProjectType,
  options: HostingCapacityOptions = {}
): HostingCapacityResult {
  // ── Cross-input consistency validation ────────────────────────────────────
  if (ptdf.slackBusNumber !== baseCase.slackBusNumber) {
    throw new Error(
      `[HostingCapacity] PTDF slack bus (${ptdf.slackBusNumber}) does not match the ` +
        `base-case DC power flow slack bus (${baseCase.slackBusNumber}) — recompute ` +
        `both against a consistent slack bus before calling computeHostingCapacity`
    );
  }
  if (ptdf.topologyHash !== lodf.topologyHash || ptdf.topologyHash !== baseCase.topologyHash) {
    throw new Error(
      `[HostingCapacity] Topology hash mismatch between PTDF (${ptdf.topologyHash}), ` +
        `LODF (${lodf.topologyHash}), and base-case DC power flow (${baseCase.topologyHash}) ` +
        `— one of the cached matrices is stale relative to the others`
    );
  }

  // ── POI bus validation ─────────────────────────────────────────────────────
  const poiBus = buses.find((b) => b.busNumber === poiBusNumber);
  if (!poiBus) {
    throw new Error(`[HostingCapacity] POI bus number ${poiBusNumber} not found in model`);
  }
  if (poiBusNumber === baseCase.slackBusNumber) {
    throw new Error(
      `[HostingCapacity] POI bus cannot be the slack bus (bus ${baseCase.slackBusNumber}) ` +
        `— PTDF sensitivity to slack-bus injection is always zero, making hosting capacity ` +
        `unbounded/undefined`
    );
  }
  if (!ptdf.busNumbers.includes(poiBusNumber)) {
    throw new Error(
      `[HostingCapacity] POI bus number ${poiBusNumber} not present in the PTDF matrix's ` +
        `non-slack bus set`
    );
  }

  const direction = directionForProjectType(projectType);
  const sign = direction === "injection" ? 1 : -1;
  const epsilon = options.sensitivityEpsilon ?? DEFAULT_SENSITIVITY_EPSILON;

  const branchByNumber = new Map<number, NetworkBranch>();
  for (const br of branches) branchByNumber.set(br.branchNumber, br);

  function getBranch(bn: number): NetworkBranch {
    const br = branchByNumber.get(bn);
    if (!br) {
      throw new Error(
        `[HostingCapacity] Branch ${bn} present in PTDF/LODF matrix but missing from branch list`
      );
    }
    return br;
  }
  function normalRatingMw(bn: number): number {
    return getBranch(bn).rateAMw;
  }
  function emergencyRatingMw(bn: number): number {
    const br = getBranch(bn);
    return br.rateBMw ?? br.rateCMw ?? br.rateAMw;
  }

  const baseCaseFlowsMw = new Map<number, number>();
  for (const f of baseCase.branchFlows) baseCaseFlowsMw.set(f.branchNumber, f.flowMw);

  // ── Pass 1: reject a base case that already violates a normal rating (FR4) ─
  for (const f of baseCase.branchFlows) {
    const rating = normalRatingMw(f.branchNumber);
    if (Math.abs(f.flowMw) > rating) {
      throw new BaseCaseViolationError(
        `[HostingCapacity] Base case already violates the thermal rating on branch ` +
          `${f.branchNumber}: |${f.flowMw.toFixed(2)}| MW exceeds rating ${rating.toFixed(2)} MW`,
        f.branchNumber,
        f.flowMw,
        rating
      );
    }
  }

  // ── Pass 2 & 3: minimize |ΔP| bound over N-0 and every non-islanding N-1 ────
  let bestBound = Infinity;
  let bestConstraint: BindingConstraint | null = null;

  function considerBound(
    branchNumber: number,
    outagedBranchNumber: number | null,
    flowMw: number,
    sensitivity: number,
    ratingMw: number
  ): void {
    if (Math.abs(sensitivity) < epsilon) return; // no meaningful constraint from this pair

    // |flowMw + signedSensitivity * X| <= ratingMw, solved for the max X >= 0.
    const signedSensitivity = sign * sensitivity;
    const bound =
      signedSensitivity > 0
        ? (ratingMw - flowMw) / signedSensitivity
        : (ratingMw + flowMw) / -signedSensitivity;

    if (bound < bestBound) {
      bestBound = bound;
      bestConstraint = {
        branchNumber,
        outagedBranchNumber,
        ratingMw,
        preConstraintFlowMw: flowMw,
        sensitivityMwPerMw: sensitivity,
      };
    }
  }

  // N-0
  for (const f of baseCase.branchFlows) {
    const s = ptdfLookup(ptdf, f.branchNumber, poiBusNumber);
    considerBound(f.branchNumber, null, f.flowMw, s, normalRatingMw(f.branchNumber));
  }

  // N-1 via OTDF, reusing contingencyImpact() for both Λ[l,k] and F(l,outage k)
  let contingenciesScreened = 0;
  const islandingContingenciesExcluded: number[] = [];

  for (const k of lodf.branchNumbers) {
    if (lodf.islandingBranches.includes(k)) {
      islandingContingenciesExcluded.push(k);
      continue;
    }

    const impact = contingencyImpact(lodf, baseCaseFlowsMw, k);
    const phiKPoi = ptdfLookup(ptdf, k, poiBusNumber);

    for (const imp of impact.impacts) {
      if (imp.branchNumber === k) continue; // the outaged branch itself carries no flow
      const phiLPoi = ptdfLookup(ptdf, imp.branchNumber, poiBusNumber);
      const otdf = phiLPoi + imp.lodf * phiKPoi;
      considerBound(
        imp.branchNumber,
        k,
        imp.postContingencyFlowMw,
        otdf,
        emergencyRatingMw(imp.branchNumber)
      );
    }
    contingenciesScreened++;
  }

  const hcDeterministicMw = bestBound === Infinity ? 0 : Math.max(0, bestBound);

  return {
    poiBusNumber,
    direction,
    hcDeterministicMw,
    binding: bestBound === Infinity ? null : bestConstraint,
    contingenciesScreened,
    islandingContingenciesExcluded,
    baseCaseFlowsMw,
    topologyHash: ptdf.topologyHash,
    computedAt: new Date().toISOString(),
  };
}
