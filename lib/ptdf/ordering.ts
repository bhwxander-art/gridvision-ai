/**
 * Approximate Minimum Degree (AMD) ordering — INFRA-009
 *
 * Greedy minimum-degree elimination ordering that minimises fill-in during
 * Cholesky factorisation.  At each step the vertex with the fewest remaining
 * neighbours is eliminated; its neighbours are connected to each other
 * (fill-in update), and the process repeats.
 *
 * This is the "quotient-graph" simplification of the full AMD algorithm
 * described in Amestoy, Davis & Duff (1996).  It is O(n²) in the worst
 * case but practical for power-system graphs (low average degree ≈ 3-5).
 *
 * Reference:
 *   Amestoy, P. R., Davis, T. A., & Duff, I. S. (1996). An Approximate
 *   Minimum Degree Ordering Algorithm. SIAM J. Matrix Anal. Appl., 17(4).
 *
 * Returns:
 *   perm  — Int32Array of length n: perm[new_idx] = old_idx
 *   iperm — Int32Array of length n: iperm[old_idx] = new_idx  (inverse)
 */

export interface AmdOrdering {
  perm: Int32Array;
  iperm: Int32Array;
}

export function minimumDegreeOrder(
  n: number,
  adjList: Set<number>[]
): AmdOrdering {
  // For trivial cases, return the identity ordering
  if (n <= 1) {
    const perm = new Int32Array(n);
    const iperm = new Int32Array(n);
    if (n === 1) { perm[0] = 0; iperm[0] = 0; }
    return { perm, iperm };
  }

  // Working copies of adjacency sets that we can mutate
  const workAdj: Set<number>[] = adjList.map((s) => new Set(s));
  const eliminated = new Uint8Array(n);
  const perm = new Int32Array(n);
  const iperm = new Int32Array(n);

  for (let step = 0; step < n; step++) {
    // Select the uneliminated vertex with minimum degree
    let minDeg = n + 1;
    let minV = -1;
    for (let v = 0; v < n; v++) {
      if (!eliminated[v] && workAdj[v].size < minDeg) {
        minDeg = workAdj[v].size;
        minV = v;
      }
    }

    perm[step] = minV;
    iperm[minV] = step;
    eliminated[minV] = 1;

    // Gather uneliminated neighbours
    const nbrs: number[] = [];
    for (const u of workAdj[minV]) {
      if (!eliminated[u]) nbrs.push(u);
    }

    // Fill-in: connect all remaining neighbours to each other
    for (const u of nbrs) {
      workAdj[u].delete(minV);
      for (const w of nbrs) {
        if (w !== u) workAdj[u].add(w);
      }
    }
  }

  return { perm, iperm };
}
