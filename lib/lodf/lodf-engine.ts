/**
 * LODF computation engine — INFRA-010
 *
 * Computes the DC Line Outage Distribution Factor matrix Λ ∈ ℝ^{e×e},
 * built directly on top of the PTDF matrix Φ produced by the INFRA-009
 * PTDF engine — no additional Cholesky factorisation or linear solves.
 *
 * Standard closed-form DC LODF formulation:
 *
 *   For a candidate outage of branch k (from-bus i_k, to-bus j_k):
 *
 *     LODF[l, k] = (Φ[l, i_k] − Φ[l, j_k]) / (1 − (Φ[k, i_k] − Φ[k, j_k]))   for l ≠ k
 *     LODF[k, k] = −1
 *
 *   where Φ[·, slack] ≡ 0 (the slack column is implicit — injecting power at
 *   the reference bus does not shift any flow, by definition of the PTDF
 *   sign convention used in lib/ptdf/ptdf-engine.ts).
 *
 * Physical meaning: post-contingency flow on branch l after branch k trips
 *   F_l' = F_l + LODF[l,k] · F_k
 *
 * Islanding: the denominator (1 − Φ[k,i_k] + Φ[k,j_k]) is exactly zero iff
 * branch k is a graph bridge (its removal disconnects the network into two
 * islands) — a well-known DC power-flow identity. This is detected two ways:
 *   1. Exact topological bridge-finding (Tarjan's algorithm, O(n+e), multi-
 *      edge safe) run once up front — the authoritative islanding set.
 *   2. A numerical guard on the denominator magnitude, in case floating-point
 *      error leaves a true bridge's computed denominator merely "very small"
 *      rather than exactly zero, or vice versa for pathological impedance
 *      ratios — defence in depth, never trusted alone.
 * Any branch flagged by either check is excluded from division; its column
 * is filled with NaN (except the diagonal, which is always −1) rather than
 * an unstable near-infinite value.
 */

import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import type { PtdfMatrix } from "@/lib/ptdf/types";
import type {
  LodfMatrix,
  LodfComputeOptions,
  ContingencyImpactResult,
} from "./types";

const DEFAULT_DENOM_EPSILON = 1e-8;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the full LODF matrix for a network snapshot, reusing an
 * already-computed PTDF matrix for the same topology.
 * Pure function — no I/O, synchronous.
 *
 * @param buses     All buses in the model (from NetworkRepository.listBuses)
 * @param branches  All branches in the model (from NetworkRepository.listBranches)
 * @param ptdf      PTDF matrix computed via computePtdf() for the same buses/branches
 * @param options   Optional modelId, topologyHash, denominatorEpsilon override
 */
export function computeLodf(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  ptdf: PtdfMatrix,
  options: LodfComputeOptions = {}
): LodfMatrix {
  const e = ptdf.rows;
  const nred = ptdf.cols;
  const branchNumbers = ptdf.branchNumbers;
  const ptdfData = ptdf.data;
  const epsilon = options.denominatorEpsilon ?? DEFAULT_DENOM_EPSILON;

  if (e === 0) {
    throw new Error("[LODF] PTDF matrix has no branch rows — cannot compute LODF");
  }

  // busId -> busNumber (for from/to resolution)
  const busIdToNum = new Map<string, number>();
  for (const b of buses) busIdToNum.set(b.id, b.busNumber);

  // busNumber -> PTDF column index (absent = slack bus, implicit 0 column)
  const busNumToCol = new Map<number, number>();
  for (let i = 0; i < ptdf.busNumbers.length; i++) {
    busNumToCol.set(ptdf.busNumbers[i], i);
  }

  // branchNumber -> NetworkBranch, for from/to bus lookup
  const branchByNumber = new Map<number, NetworkBranch>();
  for (const br of branches) branchByNumber.set(br.branchNumber, br);

  // Precompute each row's PTDF column indices for its own from/to buses.
  // Shared between the "k" (outaged) and "l" (monitored) axes since both
  // range over the same in-service branch set in the same order.
  const colI = new Int32Array(e);
  const colJ = new Int32Array(e);
  for (let idx = 0; idx < e; idx++) {
    const br = branchByNumber.get(branchNumbers[idx]);
    if (!br) {
      throw new Error(
        `[LODF] Branch ${branchNumbers[idx]} present in PTDF matrix but missing from branch list`
      );
    }
    const iNum = busIdToNum.get(br.fromBusId);
    const jNum = busIdToNum.get(br.toBusId);
    if (iNum === undefined || jNum === undefined) {
      throw new Error(
        `[LODF] Branch ${br.branchNumber} references bus UUID not in model`
      );
    }
    colI[idx] = busNumToCol.get(iNum) ?? -1;
    colJ[idx] = busNumToCol.get(jNum) ?? -1;
  }

  const ptdfCell = (row: number, col: number): number =>
    col >= 0 ? ptdfData[row * nred + col] : 0.0;

  // Authoritative islanding set via exact bridge-finding on the same
  // in-service, non-zero-reactance branch subset the PTDF/LODF operate on.
  const topoBridges = findBridges(buses, branches);

  const lodfData = new Float64Array(e * e);
  const islandingSet = new Set<number>();

  for (let k = 0; k < e; k++) {
    const ci = colI[k];
    const cj = colJ[k];
    const denom = 1.0 - (ptdfCell(k, ci) - ptdfCell(k, cj));

    const isBridge = topoBridges.has(branchNumbers[k]);
    const isSingular = Math.abs(denom) < epsilon;

    if (isBridge || isSingular) {
      islandingSet.add(branchNumbers[k]);
      for (let l = 0; l < e; l++) {
        lodfData[l * e + k] = l === k ? -1.0 : NaN;
      }
      continue;
    }

    for (let l = 0; l < e; l++) {
      if (l === k) {
        lodfData[l * e + k] = -1.0;
        continue;
      }
      const numerator = ptdfCell(l, ci) - ptdfCell(l, cj);
      lodfData[l * e + k] = numerator / denom;
    }
  }

  return {
    modelId: options.modelId ?? ptdf.modelId,
    branchNumbers: [...branchNumbers],
    data: lodfData,
    size: e,
    islandingBranches: branchNumbers.filter((bn) => islandingSet.has(bn)),
    computedAt: new Date().toISOString(),
    topologyHash: options.topologyHash ?? ptdf.topologyHash,
  };
}

/**
 * Look up a single LODF entry (rowIdx, colIdx are 0-based indices into
 * matrix.branchNumbers, shared by both axes).
 */
export function lodfGet(matrix: LodfMatrix, monitoredIdx: number, outagedIdx: number): number {
  return matrix.data[monitoredIdx * matrix.size + outagedIdx];
}

/**
 * Look up LODF by branch number: effect on `monitoredBranchNumber` of
 * outaging `outagedBranchNumber`. Returns NaN if either branch is not
 * present in the matrix.
 */
export function lodfLookup(
  matrix: LodfMatrix,
  monitoredBranchNumber: number,
  outagedBranchNumber: number
): number {
  const l = matrix.branchNumbers.indexOf(monitoredBranchNumber);
  const k = matrix.branchNumbers.indexOf(outagedBranchNumber);
  if (l < 0 || k < 0) return NaN;
  return matrix.data[l * matrix.size + k];
}

/**
 * Whether the given outaged branch number was flagged as an islanding
 * outage in a previously computed LODF matrix (O(1) lookup — precomputed).
 */
export function isIslandingOutageInMatrix(matrix: LodfMatrix, outagedBranchNumber: number): boolean {
  return matrix.islandingBranches.includes(outagedBranchNumber);
}

/**
 * Direct topological check: would outaging `branchNumber` disconnect the
 * network into two or more islands? Pure graph reachability (BFS) over the
 * in-service, non-zero-reactance branch set, independent of any PTDF/LODF
 * matrix — safe to call standalone, e.g. before committing to a full LODF
 * recompute for contingency screening.
 */
export function isIslandingOutage(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  branchNumber: number
): boolean {
  const branch = branches.find((br) => br.branchNumber === branchNumber);
  if (!branch || !branch.inService || Math.abs(branch.xPu) <= 1e-12) {
    return false; // branch not part of the DC model — outaging it changes nothing
  }

  const adj = new Map<string, Set<string>>();
  for (const b of buses) adj.set(b.id, new Set());
  for (const br of branches) {
    if (!br.inService || Math.abs(br.xPu) <= 1e-12) continue;
    if (br.branchNumber === branchNumber) continue; // simulate this branch's outage
    adj.get(br.fromBusId)?.add(br.toBusId);
    adj.get(br.toBusId)?.add(br.fromBusId);
  }

  const start = branch.fromBusId;
  const target = branch.toBusId;
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    if (cur === target) return false;
    for (const nxt of adj.get(cur) ?? []) {
      if (!visited.has(nxt)) {
        visited.add(nxt);
        queue.push(nxt);
      }
    }
  }
  return !visited.has(target);
}

/**
 * Compute post-contingency flows for every monitored branch given the
 * outage of `outagedBranchNumber` and a set of pre-contingency (base case)
 * branch flows in MW.
 *
 * Islanding outages, or any monitored branch with an undefined (NaN) LODF
 * cell, report `postContingencyFlowMw = NaN` rather than a misleading
 * finite value — callers (Hosting Capacity / IFE) must handle NaN as
 * "undefined without a re-dispatch / island power-balance study".
 */
export function contingencyImpact(
  matrix: LodfMatrix,
  baseFlowsMw: Map<number, number> | Record<number, number>,
  outagedBranchNumber: number
): ContingencyImpactResult {
  const k = matrix.branchNumbers.indexOf(outagedBranchNumber);
  if (k < 0) {
    throw new Error(`[LODF] Branch ${outagedBranchNumber} not found in LODF matrix`);
  }

  const getFlow = (bn: number): number =>
    baseFlowsMw instanceof Map ? (baseFlowsMw.get(bn) ?? 0) : (baseFlowsMw[bn] ?? 0);

  const isIslanding = matrix.islandingBranches.includes(outagedBranchNumber);
  const Fk = getFlow(outagedBranchNumber);
  const size = matrix.size;

  const impacts = matrix.branchNumbers.map((bn, l) => {
    const preFlow = getFlow(bn);
    if (bn === outagedBranchNumber) {
      return { branchNumber: bn, preContingencyFlowMw: preFlow, lodf: -1, postContingencyFlowMw: 0 };
    }
    const lodfVal = matrix.data[l * size + k];
    const postFlow =
      isIslanding || !Number.isFinite(lodfVal) ? NaN : preFlow + lodfVal * Fk;
    return { branchNumber: bn, preContingencyFlowMw: preFlow, lodf: lodfVal, postContingencyFlowMw: postFlow };
  });

  return { outagedBranchNumber, isIslanding, impacts };
}

// ── Internal: multi-edge-safe bridge finding (Tarjan) ─────────────────────────

/**
 * Returns the set of branch numbers (among in-service, non-zero-reactance
 * branches) whose removal disconnects the graph — i.e. bridges.
 * Iterative DFS (no recursion depth limit on large networks).
 *
 * Multi-edge safe: tracks the *edge id* used to enter each node (not just
 * the parent bus), so a parallel branch between the same two buses is
 * correctly treated as an alternate path rather than a false "back to
 * parent" skip that would misclassify both parallel branches as bridges.
 */
function findBridges(buses: NetworkBus[], branches: NetworkBranch[]): Set<number> {
  const adj = new Map<string, { to: string; edgeId: number }[]>();
  for (const b of buses) adj.set(b.id, []);

  for (const br of branches) {
    if (!br.inService || Math.abs(br.xPu) <= 1e-12) continue;
    adj.get(br.fromBusId)?.push({ to: br.toBusId, edgeId: br.branchNumber });
    adj.get(br.toBusId)?.push({ to: br.fromBusId, edgeId: br.branchNumber });
  }

  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const bridges = new Set<number>();
  let timer = 0;

  interface Frame {
    busId: string;
    parentEdgeId: number;
    idx: number;
  }

  for (const startBus of buses) {
    if (disc.has(startBus.id)) continue;

    const stack: Frame[] = [{ busId: startBus.id, parentEdgeId: -1, idx: 0 }];
    disc.set(startBus.id, timer);
    low.set(startBus.id, timer);
    timer++;

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adj.get(frame.busId) ?? [];

      if (frame.idx < neighbors.length) {
        const { to, edgeId } = neighbors[frame.idx];
        frame.idx++;

        if (edgeId === frame.parentEdgeId) continue; // skip only the exact parent edge

        if (!disc.has(to)) {
          disc.set(to, timer);
          low.set(to, timer);
          timer++;
          stack.push({ busId: to, parentEdgeId: edgeId, idx: 0 });
        } else {
          low.set(frame.busId, Math.min(low.get(frame.busId)!, disc.get(to)!));
        }
      } else {
        stack.pop();
        if (stack.length > 0) {
          const parent = stack[stack.length - 1];
          low.set(parent.busId, Math.min(low.get(parent.busId)!, low.get(frame.busId)!));
          if (low.get(frame.busId)! > disc.get(parent.busId)!) {
            bridges.add(frame.parentEdgeId);
          }
        }
      }
    }
  }

  return bridges;
}
