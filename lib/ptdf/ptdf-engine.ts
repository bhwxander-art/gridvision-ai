/**
 * PTDF computation engine — INFRA-009
 *
 * Computes the DC Power Transfer Distribution Factor matrix Φ ∈ ℝ^{e×(n-1)}.
 *
 * Algorithm:
 *   1. Build B_reduced from branch susceptances (b = 1/x)
 *   2. Apply AMD reordering to minimise Cholesky fill-in
 *   3. Factorise permuted B_reduced = L · Lᵀ  (cached across column solves)
 *   4. For each non-slack bus k: solve B_reduced · θ_k = e_k
 *   5. PTDF[l, k] = b_l · (θ_k[from_l] − θ_k[to_l])
 *
 * Sign convention: PTDF[l, k] > 0 means unit injection at bus k increases
 * flow in the from→to direction of branch l.
 *
 * Caching note: matrix factorisation is reused across all nred column solves
 * within a single call — O(nred²) per solve after O(nred³) upfront cost.
 */

import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import type { PtdfMatrix, PtdfComputeOptions } from "./types";
import { buildBasis } from "./b-matrix";
import { minimumDegreeOrder } from "./ordering";
import {
  choleskyFactor,
  choleskyForwardSolve,
  choleskyBackwardSolve,
} from "./dense-cholesky";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the full PTDF matrix for a network snapshot.
 * Pure function — no I/O, synchronous.
 *
 * @param buses     All buses in the model (from NetworkRepository.listBuses)
 * @param branches  All branches in the model (from NetworkRepository.listBranches)
 * @param options   Optional slack bus override, modelId, topologyHash
 */
export function computePtdf(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  options: PtdfComputeOptions = {}
): PtdfMatrix {
  if (buses.length < 2) {
    throw new Error("[PTDF] Model must have at least 2 buses");
  }

  // Resolve slack bus
  let slackBusNumber = options.slackBusNumber;
  if (slackBusNumber == null) {
    const slackBus = buses.find((b) => b.busType === "SLACK");
    slackBusNumber = slackBus?.busNumber ?? buses[0].busNumber;
  }

  // Build basis: B_reduced, susceptances, adjacency
  const basis = buildBasis(buses, branches, slackBusNumber);
  const {
    e,
    nred,
    Bred,
    susceptances,
    fromRedIdx,
    toRedIdx,
    branchNumbers,
    nonSlackBusNumbers,
    adjList,
  } = basis;

  if (e === 0) {
    throw new Error(
      "[PTDF] No in-service branches with non-zero reactance — cannot compute PTDF"
    );
  }

  if (nred === 0) {
    throw new Error("[PTDF] Only the slack bus is present — no reduced system");
  }

  // ── Step 1: AMD reordering ─────────────────────────────────────────────────
  const { perm, iperm } = minimumDegreeOrder(nred, adjList);

  // ── Step 2: Permute B_reduced ──────────────────────────────────────────────
  // Bperm[i,j] = Bred[perm[i], perm[j]]
  const Bperm = new Float64Array(nred * nred);
  for (let i = 0; i < nred; i++) {
    const row = perm[i];
    for (let j = 0; j < nred; j++) {
      Bperm[i * nred + j] = Bred[row * nred + perm[j]];
    }
  }

  // ── Step 3: Cache Cholesky factorisation ───────────────────────────────────
  const chol = choleskyFactor(Bperm, nred);

  // ── Step 4 & 5: Column solves → PTDF ──────────────────────────────────────
  const ptdfData = new Float64Array(e * nred);
  const rhs = new Float64Array(nred);
  const theta = new Float64Array(nred);

  for (let k = 0; k < nred; k++) {
    // Build permuted unit vector e_k:
    // rhs_perm[i] = 1 if perm[i] == k, i.e. at position iperm[k]
    rhs.fill(0.0);
    rhs[iperm[k]] = 1.0;

    // Solve Bperm · x_perm = rhs_perm, exploiting unit-vector sparsity
    const pivotPos = iperm[k]; // first non-zero position in rhs
    const y = choleskyForwardSolve(chol.L, nred, rhs, pivotPos);
    const xperm = choleskyBackwardSolve(chol.L, nred, y);

    // Un-permute: theta[perm[i]] = xperm[i]
    theta.fill(0.0);
    for (let i = 0; i < nred; i++) {
      theta[perm[i]] = xperm[i];
    }

    // PTDF[l, k] = b_l · (θ_from − θ_to), slack bus has θ = 0
    const colOff = k; // PTDF is row-major: data[l * nred + k]
    for (let l = 0; l < e; l++) {
      const fr = fromRedIdx[l]; // -1 → slack → θ = 0
      const tr = toRedIdx[l];   // -1 → slack → θ = 0
      const tf = fr >= 0 ? theta[fr] : 0.0;
      const tt = tr >= 0 ? theta[tr] : 0.0;
      ptdfData[l * nred + colOff] = susceptances[l] * (tf - tt);
    }
  }

  return {
    modelId: options.modelId ?? "",
    slackBusNumber,
    busNumbers: nonSlackBusNumbers,
    branchNumbers,
    data: ptdfData,
    rows: e,
    cols: nred,
    computedAt: new Date().toISOString(),
    topologyHash: options.topologyHash ?? null,
  };
}

/**
 * Look up a single PTDF entry (branchIdx, busIdx are 0-based row/col indices).
 */
export function ptdfGet(matrix: PtdfMatrix, branchIdx: number, busIdx: number): number {
  return matrix.data[branchIdx * matrix.cols + busIdx];
}

/**
 * Look up PTDF by branch number and non-slack bus number.
 * Returns NaN if the branch or bus is not found in the matrix.
 */
export function ptdfLookup(
  matrix: PtdfMatrix,
  branchNumber: number,
  busNumber: number
): number {
  const l = matrix.branchNumbers.indexOf(branchNumber);
  const k = matrix.busNumbers.indexOf(busNumber);
  if (l < 0 || k < 0) return NaN;
  return matrix.data[l * matrix.cols + k];
}
