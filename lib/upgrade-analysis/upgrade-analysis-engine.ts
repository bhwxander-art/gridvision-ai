/**
 * Upgrade Analysis engine — INFRA-013
 *
 * When the requested capacity at a POI exceeds the deterministic hosting
 * capacity (INFRA-012), this engine finds the minimum set of branch thermal
 * uprates that would allow the network to accommodate it — reusing
 * computeHostingCapacity() as the re-evaluation oracle in a bounded
 * iterative loop, and reusing ptdfLookup()/lodfLookup() (already-public
 * reads on the same cached Φ/Λ matrices) to size each upgrade. No new
 * linear solve, no cost model, no MILP — see the approved INFRA-013
 * technical specification for the full scope rationale.
 *
 * Algorithm (see spec §4 for the full derivation and termination proof):
 *   1. computeHostingCapacity() identifies the single tightest (branch,
 *      contingency) constraint remaining — this doubles as the ranking
 *      signal, since each iteration resolves the current global minimum.
 *   2. For the binding branch L, compute the rating L needs to clear EVERY
 *      one of its own constraints (N-0 and every non-islanding N-1) at the
 *      target capacity — not just the single pair that happened to surface
 *      network-wide. This guarantees L never rebinds in a later iteration.
 *   3. Raise L's working-copy rating(s) accordingly and re-evaluate.
 *   4. Repeat until hcDeterministicMw >= capacityMw, or fail after
 *      maxIterations (a proven upper bound: at most one branch is retired
 *      from consideration per iteration, so at most `e` iterations are ever
 *      needed).
 *
 * Uprating never changes branch reactance/topology, so Φ (PTDF), Λ (LODF),
 * and islanding classification are provably unaffected across iterations —
 * only branches[].rateAMw/rateBMw/rateCMw are mutated, on a local working
 * copy that never touches the caller's original array.
 */

import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import type { ProjectType } from "@/lib/db/types-queue";
import type { PtdfMatrix } from "@/lib/ptdf/types";
import { ptdfLookup } from "@/lib/ptdf/ptdf-engine";
import type { LodfMatrix } from "@/lib/lodf/types";
import { lodfLookup } from "@/lib/lodf/lodf-engine";
import type { DcPowerFlowResult } from "@/lib/dcpf/types";
import { computeHostingCapacity } from "@/lib/hosting-capacity/hosting-capacity-engine";
import { directionForProjectType } from "@/lib/hosting-capacity/types";
import {
  UpgradeAnalysisInfeasibleError,
  type UpgradeAnalysisOptions,
  type UpgradeAnalysisResult,
  type UpgradeCandidate,
} from "./types";

const DEFAULT_TOLERANCE_MW = 1e-6;
const DEFAULT_MARGIN_MULTIPLIER = 1.0;

export function computeUpgradeAnalysis(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  ptdf: PtdfMatrix,
  lodf: LodfMatrix,
  baseCase: DcPowerFlowResult,
  poiBusNumber: number,
  projectType: ProjectType,
  capacityMw: number,
  options: UpgradeAnalysisOptions = {}
): UpgradeAnalysisResult {
  if (!(capacityMw > 0)) {
    throw new Error("[UpgradeAnalysis] capacityMw must be positive");
  }

  const direction = directionForProjectType(projectType);
  const sign = direction === "injection" ? 1 : -1;
  const tolerance = options.toleranceMw ?? DEFAULT_TOLERANCE_MW;
  const marginMultiplier = options.ratingMarginMultiplier ?? DEFAULT_MARGIN_MULTIPLIER;

  const hcOptions = {
    slackBusNumber: options.slackBusNumber,
    sensitivityEpsilon: options.sensitivityEpsilon,
  };

  // Working copy — ratings mutated locally, the caller's array is never touched.
  const workingBranches: NetworkBranch[] = branches.map((b) => ({ ...b }));
  const workingByNumber = new Map<number, NetworkBranch>();
  for (const b of workingBranches) workingByNumber.set(b.branchNumber, b);

  const inServiceCount = branches.filter((b) => b.inService).length;
  const maxIterations = options.maxIterations ?? Math.max(1, inServiceCount);

  const baseCaseFlowsMw = new Map<number, number>();
  for (const f of baseCase.branchFlows) baseCaseFlowsMw.set(f.branchNumber, f.flowMw);

  let hc = computeHostingCapacity(
    buses, workingBranches, ptdf, lodf, baseCase, poiBusNumber, projectType, hcOptions
  );
  const hostingCapacityBeforeMw = hc.hcDeterministicMw;

  const upgrades: UpgradeCandidate[] = [];
  const upgradedBranchNumbers = new Set<number>();
  let iterations = 0;

  while (hc.hcDeterministicMw < capacityMw - tolerance) {
    iterations++;
    if (iterations > maxIterations) {
      throw new UpgradeAnalysisInfeasibleError(
        `[UpgradeAnalysis] Could not reach the requested capacity of ${capacityMw.toFixed(2)} MW ` +
          `within ${maxIterations} iterations (reached ${hc.hcDeterministicMw.toFixed(2)} MW)`,
        iterations - 1
      );
    }

    if (!hc.binding) {
      throw new Error(
        `[UpgradeAnalysis] No binding constraint reported but capacity ` +
          `(${hc.hcDeterministicMw.toFixed(2)} MW) is still below the requested ` +
          `${capacityMw.toFixed(2)} MW — internal inconsistency`
      );
    }

    const branchNumber = hc.binding.branchNumber;
    if (upgradedBranchNumbers.has(branchNumber)) {
      // Should be unreachable given the full-relief guarantee below; guarded defensively.
      throw new Error(
        `[UpgradeAnalysis] Branch ${branchNumber} was already upgraded but is binding again ` +
          `— relief calculation defect`
      );
    }

    const workingBranch = workingByNumber.get(branchNumber);
    if (!workingBranch) {
      throw new Error(
        `[UpgradeAnalysis] Branch ${branchNumber} present in the binding constraint but missing ` +
          `from the branch list`
      );
    }

    upgrades.push(
      sizeUprate(
        workingBranch,
        branchNumber,
        poiBusNumber,
        sign,
        capacityMw,
        ptdf,
        lodf,
        baseCaseFlowsMw,
        marginMultiplier
      )
    );
    upgradedBranchNumbers.add(branchNumber);

    hc = computeHostingCapacity(
      buses, workingBranches, ptdf, lodf, baseCase, poiBusNumber, projectType, hcOptions
    );
  }

  return {
    poiBusNumber,
    direction,
    requestedCapacityMw: capacityMw,
    hostingCapacityBeforeMw,
    hostingCapacityAfterMw: hc.hcDeterministicMw,
    feasible: true,
    upgradesRequired: upgrades.length,
    upgrades,
    iterations,
    topologyHash: ptdf.topologyHash,
    computedAt: new Date().toISOString(),
  };
}

// ── Internal: size and apply a single branch's uprate (mutates workingBranch) ─

function sizeUprate(
  workingBranch: NetworkBranch,
  branchNumber: number,
  poiBusNumber: number,
  sign: number,
  capacityMw: number,
  ptdf: PtdfMatrix,
  lodf: LodfMatrix,
  baseCaseFlowsMw: Map<number, number>,
  marginMultiplier: number
): UpgradeCandidate {
  const signedDeltaP = sign * capacityMw;
  const phiLPoi = ptdfLookup(ptdf, branchNumber, poiBusNumber);
  const fLBase = baseCaseFlowsMw.get(branchNumber) ?? 0;

  // N-0 requirement
  const requiredNormalRatingMw = Math.abs(fLBase + phiLPoi * signedDeltaP);

  // N-1 requirement: max |flow| over every non-islanding outage k != branchNumber
  let requiredEmergencyRatingMw = 0;
  for (const k of lodf.branchNumbers) {
    if (k === branchNumber) continue;
    if (lodf.islandingBranches.includes(k)) continue;
    const lambdaLK = lodfLookup(lodf, branchNumber, k);
    if (!Number.isFinite(lambdaLK)) continue;
    const phiKPoi = ptdfLookup(ptdf, k, poiBusNumber);
    const fKBase = baseCaseFlowsMw.get(k) ?? 0;
    const otdf = phiLPoi + lambdaLK * phiKPoi;
    const flowUnderOutage = fLBase + lambdaLK * fKBase + otdf * signedDeltaP;
    const absFlow = Math.abs(flowUnderOutage);
    if (absFlow > requiredEmergencyRatingMw) requiredEmergencyRatingMw = absFlow;
  }

  const originalRateAMw = workingBranch.rateAMw;
  const hasDistinctEmergencyRating = workingBranch.rateBMw != null || workingBranch.rateCMw != null;
  const originalEmergencyRatingMw = hasDistinctEmergencyRating
    ? (workingBranch.rateBMw ?? workingBranch.rateCMw)!
    : null;

  let newRateAMw: number;
  let newEmergencyRatingMw: number | null;

  if (hasDistinctEmergencyRating) {
    // rateAMw relieves N-0 only; rateBMw/rateCMw relieves N-1 only — independent.
    newRateAMw = Math.max(originalRateAMw, requiredNormalRatingMw * marginMultiplier);
    const newEmergency = Math.max(originalEmergencyRatingMw!, requiredEmergencyRatingMw * marginMultiplier);
    workingBranch.rateAMw = newRateAMw;
    if (workingBranch.rateBMw != null) workingBranch.rateBMw = newEmergency;
    else workingBranch.rateCMw = newEmergency;
    newEmergencyRatingMw = newEmergency;
  } else {
    // No distinct emergency rating: rateAMw serves both roles via computeHostingCapacity's own
    // `rateBMw ?? rateCMw ?? rateAMw` fallback — it must satisfy the LARGER of both requirements.
    const combinedRequiredMw =
      Math.max(requiredNormalRatingMw, requiredEmergencyRatingMw) * marginMultiplier;
    newRateAMw = Math.max(originalRateAMw, combinedRequiredMw);
    workingBranch.rateAMw = newRateAMw;
    newEmergencyRatingMw = null;
  }

  const capacityIncreaseMw = Math.max(
    newRateAMw - originalRateAMw,
    originalEmergencyRatingMw != null && newEmergencyRatingMw != null
      ? newEmergencyRatingMw - originalEmergencyRatingMw
      : 0,
    0
  );

  return {
    branchNumber,
    upgradeType: "thermal_uprate",
    originalRateAMw,
    newRateAMw,
    originalEmergencyRatingMw,
    newEmergencyRatingMw,
    capacityIncreaseMw,
  };
}
