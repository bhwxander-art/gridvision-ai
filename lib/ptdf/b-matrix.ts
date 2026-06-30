/**
 * DC susceptance matrix builder — INFRA-009
 *
 * Constructs:
 *   B_reduced — (n-1)×(n-1) symmetric positive-definite matrix (slack row/col removed)
 *   Adjacency lists in reduced-bus space (for AMD ordering)
 *   Per-branch susceptances and reduced from/to indices (for PTDF evaluation)
 */

import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";

export interface BasisData {
  n: number;                      // total buses
  e: number;                      // in-service branches with x_pu ≠ 0
  nred: number;                   // n - 1 (size of reduced system)
  slackIdx: number;               // 0-based original index of slack bus
  busIdToOrigIdx: Map<string, number>;
  origIdxToRedIdx: Int32Array;    // n entries; -1 for slack, 0..nred-1 for others
  nonSlackBusNumbers: number[];   // nred bus numbers in the order of reduced indices
  branchNumbers: number[];        // e in-service branch numbers
  Bred: Float64Array;             // nred×nred B_reduced, row-major
  susceptances: Float64Array;     // e DC susceptances: b_l = 1/x_l
  fromRedIdx: Int32Array;         // e; reduced from-bus idx (-1 if slack)
  toRedIdx: Int32Array;           // e; reduced to-bus idx (-1 if slack)
  adjList: Set<number>[];         // nred adjacency sets in reduced space
}

export function buildBasis(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  slackBusNumber: number
): BasisData {
  const n = buses.length;

  // Map UUID → original index; bus_number → original index
  const busIdToOrigIdx = new Map<string, number>();
  const busNumToOrigIdx = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    busIdToOrigIdx.set(buses[i].id, i);
    busNumToOrigIdx.set(buses[i].busNumber, i);
  }

  const slackOrigIdx = busNumToOrigIdx.get(slackBusNumber);
  if (slackOrigIdx === undefined) {
    throw new Error(
      `[PTDF] Slack bus number ${slackBusNumber} not found in bus list`
    );
  }

  // Map original index → reduced index (skip slack)
  const origIdxToRedIdx = new Int32Array(n).fill(-1);
  const nonSlackBusNumbers: number[] = [];
  let redIdx = 0;
  for (let i = 0; i < n; i++) {
    if (i === slackOrigIdx) continue;
    origIdxToRedIdx[i] = redIdx++;
    nonSlackBusNumbers.push(buses[i].busNumber);
  }
  const nred = n - 1;

  // Filter in-service branches with non-zero reactance
  const inService = branches.filter(
    (br) => br.inService && Math.abs(br.xPu) > 1e-12
  );
  const e = inService.length;

  const susceptances = new Float64Array(e);
  const fromOrigArr = new Int32Array(e);
  const toOrigArr = new Int32Array(e);
  const branchNumbers: number[] = [];

  for (let k = 0; k < e; k++) {
    const br = inService[k];
    const fi = busIdToOrigIdx.get(br.fromBusId);
    const ti = busIdToOrigIdx.get(br.toBusId);
    if (fi === undefined || ti === undefined) {
      throw new Error(
        `[PTDF] Branch ${br.branchNumber} references bus UUID not in model`
      );
    }
    susceptances[k] = 1.0 / br.xPu;
    fromOrigArr[k] = fi;
    toOrigArr[k] = ti;
    branchNumbers.push(br.branchNumber);
  }

  // Build B_reduced directly (skip slack row/col)
  const Bred = new Float64Array(nred * nred);
  const adjList: Set<number>[] = Array.from({ length: nred }, () => new Set());

  for (let k = 0; k < e; k++) {
    const fi = fromOrigArr[k];
    const ti = toOrigArr[k];
    const fr = origIdxToRedIdx[fi]; // -1 if slack
    const tr = origIdxToRedIdx[ti]; // -1 if slack
    const b = susceptances[k];

    // Diagonal contributions always apply
    if (fr >= 0) Bred[fr * nred + fr] += b;
    if (tr >= 0) Bred[tr * nred + tr] += b;

    // Off-diagonal only when both buses are in reduced space
    if (fr >= 0 && tr >= 0) {
      Bred[fr * nred + tr] -= b;
      Bred[tr * nred + fr] -= b;
      adjList[fr].add(tr);
      adjList[tr].add(fr);
    }
  }

  // Reduced indices for branches (used during PTDF evaluation)
  const fromRedIdx = new Int32Array(e);
  const toRedIdx = new Int32Array(e);
  for (let k = 0; k < e; k++) {
    fromRedIdx[k] = origIdxToRedIdx[fromOrigArr[k]];
    toRedIdx[k] = origIdxToRedIdx[toOrigArr[k]];
  }

  return {
    n,
    e,
    nred,
    slackIdx: slackOrigIdx,
    busIdToOrigIdx,
    origIdxToRedIdx,
    nonSlackBusNumbers,
    branchNumbers,
    Bred,
    susceptances,
    fromRedIdx,
    toRedIdx,
    adjList,
  };
}
