/**
 * DC power flow solver — INFRA-011
 *
 * Solves the standard DC power-flow linear system for one or more bus
 * injection scenarios on the same network topology:
 *
 *   B_reduced · θ = P_reduced        (θ, P in the non-slack reduced-bus space)
 *   F_l = b_l · (θ_from − θ_to)      (per branch, θ_slack ≡ 0)
 *
 * This reuses the exact same building blocks as the INFRA-009 PTDF engine —
 * buildBasis() for B_reduced/susceptances/adjacency, minimumDegreeOrder()
 * for fill-in-reducing AMD ordering, and the dense Cholesky factor/solve —
 * rather than re-deriving any of that machinery. The only difference from
 * PTDF's computePtdf() is the right-hand side: PTDF solves nred unit-vector
 * RHS columns to build a sensitivity matrix, whereas DC power flow solves a
 * single dense RHS (the actual requested injection pattern) to get an actual
 * operating point (angles + flows).
 *
 * Batch-aware by design: computeDcPowerFlowBatch() factorises B_reduced once
 * and reuses that factorisation (forward/backward substitution only) across
 * every injection scenario in the batch — the same caching principle PTDF
 * applies internally across its nred column solves. computeDcPowerFlow() is
 * a thin single-scenario convenience wrapper around the batch form.
 */

import type { NetworkBus, NetworkBranch } from "@/lib/db/types-network";
import { buildBasis } from "@/lib/ptdf/b-matrix";
import { minimumDegreeOrder } from "@/lib/ptdf/ordering";
import {
  choleskyFactor,
  choleskyForwardSolve,
  choleskyBackwardSolve,
} from "@/lib/ptdf/dense-cholesky";
import type { LodfMatrix, ContingencyImpactResult } from "@/lib/lodf/types";
import { contingencyImpact } from "@/lib/lodf/lodf-engine";
import type {
  BusInjectionsMw,
  DcPowerFlowResult,
  DcPowerFlowOptions,
  BranchFlowResult,
  BusAngleResult,
} from "./types";

const DEFAULT_BASE_MVA = 100;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Solve DC power flow for a single injection scenario.
 * Pure function — no I/O, synchronous.
 */
export function computeDcPowerFlow(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  injectionsMw: BusInjectionsMw,
  options: DcPowerFlowOptions = {}
): DcPowerFlowResult {
  return computeDcPowerFlowBatch(buses, branches, [injectionsMw], options)[0];
}

/**
 * Solve DC power flow for multiple injection scenarios against the same
 * topology, factorising B_reduced exactly once and reusing it across every
 * scenario (cache-aware: avoids the O(nred³) factorisation cost per solve).
 */
export function computeDcPowerFlowBatch(
  buses: NetworkBus[],
  branches: NetworkBranch[],
  injectionSets: BusInjectionsMw[],
  options: DcPowerFlowOptions = {}
): DcPowerFlowResult[] {
  if (injectionSets.length === 0) return [];

  if (buses.length < 2) {
    throw new Error("[DCPF] Model must have at least 2 buses");
  }

  const baseMva = options.baseMva ?? DEFAULT_BASE_MVA;
  if (!(baseMva > 0)) {
    throw new Error("[DCPF] baseMva must be positive");
  }

  if (options.mismatchToleranceMw !== undefined && options.mismatchToleranceMw < 0) {
    throw new Error("[DCPF] mismatchToleranceMw must be non-negative");
  }

  // Resolve slack bus — identical convention to lib/ptdf/ptdf-engine.ts
  let slackBusNumber = options.slackBusNumber;
  if (slackBusNumber == null) {
    const slackBus = buses.find((b) => b.busType === "SLACK");
    slackBusNumber = slackBus?.busNumber ?? buses[0].busNumber;
  }

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
      "[DCPF] No in-service branches with non-zero reactance — cannot solve power flow"
    );
  }
  if (nred === 0) {
    throw new Error("[DCPF] Only the slack bus is present — no reduced system to solve");
  }

  const busNumToRedIdx = new Map<number, number>();
  for (let i = 0; i < nonSlackBusNumbers.length; i++) {
    busNumToRedIdx.set(nonSlackBusNumbers[i], i);
  }

  // ── AMD reordering + Cholesky factorisation (shared across all scenarios) ──
  const { perm, iperm } = minimumDegreeOrder(nred, adjList);

  const Bperm = new Float64Array(nred * nred);
  for (let i = 0; i < nred; i++) {
    const row = perm[i];
    for (let j = 0; j < nred; j++) {
      Bperm[i * nred + j] = Bred[row * nred + perm[j]];
    }
  }
  const chol = choleskyFactor(Bperm, nred);

  const branchFromBusNum = new Array<number>(e);
  const branchToBusNum = new Array<number>(e);
  {
    const busIdToNum = new Map<string, number>();
    for (const b of buses) busIdToNum.set(b.id, b.busNumber);
    const branchByNumber = new Map<number, NetworkBranch>();
    for (const br of branches) branchByNumber.set(br.branchNumber, br);
    for (let l = 0; l < e; l++) {
      const br = branchByNumber.get(branchNumbers[l])!;
      branchFromBusNum[l] = busIdToNum.get(br.fromBusId)!;
      branchToBusNum[l] = busIdToNum.get(br.toBusId)!;
    }
  }

  const computedAt = new Date().toISOString();
  const results: DcPowerFlowResult[] = [];

  for (const injectionsMw of injectionSets) {
    results.push(
      solveOneScenario({
        injectionsMw,
        busNumToRedIdx,
        slackBusNumber,
        baseMva,
        nred,
        e,
        perm,
        iperm,
        chol,
        susceptances,
        fromRedIdx,
        toRedIdx,
        branchNumbers,
        branchFromBusNum,
        branchToBusNum,
        nonSlackBusNumbers,
        modelId: options.modelId ?? "",
        topologyHash: options.topologyHash ?? null,
        mismatchToleranceMw: options.mismatchToleranceMw,
        computedAt,
      })
    );
  }

  return results;
}

/** Look up a bus angle (degrees) by bus number. NaN if not present. */
export function dcBusAngleLookup(result: DcPowerFlowResult, busNumber: number): number {
  const found = result.busAngles.find((a) => a.busNumber === busNumber);
  return found ? found.thetaDeg : NaN;
}

/** Look up a branch flow (MW, from→to convention) by branch number. NaN if not present. */
export function dcBranchFlowLookup(result: DcPowerFlowResult, branchNumber: number): number {
  const found = result.branchFlows.find((f) => f.branchNumber === branchNumber);
  return found ? found.flowMw : NaN;
}

/**
 * Integrates a solved base case with the INFRA-010 LODF engine: applies a
 * branch outage to the base-case flows this engine just computed, reusing
 * contingencyImpact() directly rather than re-deriving any LODF logic here.
 */
export function applyLodfContingency(
  flow: DcPowerFlowResult,
  lodf: LodfMatrix,
  outagedBranchNumber: number
): ContingencyImpactResult {
  const baseFlowsMw = new Map<number, number>();
  for (const f of flow.branchFlows) baseFlowsMw.set(f.branchNumber, f.flowMw);
  return contingencyImpact(lodf, baseFlowsMw, outagedBranchNumber);
}

// ── Internal: single-scenario solve using a pre-computed factorisation ───────

interface ScenarioContext {
  injectionsMw: BusInjectionsMw;
  busNumToRedIdx: Map<number, number>;
  slackBusNumber: number;
  baseMva: number;
  nred: number;
  e: number;
  perm: Int32Array;
  iperm: Int32Array;
  chol: ReturnType<typeof choleskyFactor>;
  susceptances: Float64Array;
  fromRedIdx: Int32Array;
  toRedIdx: Int32Array;
  branchNumbers: number[];
  branchFromBusNum: number[];
  branchToBusNum: number[];
  nonSlackBusNumbers: number[];
  modelId: string;
  topologyHash: string | null;
  mismatchToleranceMw?: number;
  computedAt: string;
}

function solveOneScenario(ctx: ScenarioContext): DcPowerFlowResult {
  const {
    injectionsMw,
    busNumToRedIdx,
    slackBusNumber,
    baseMva,
    nred,
    e,
    perm,
    iperm,
    chol,
    susceptances,
    fromRedIdx,
    toRedIdx,
    branchNumbers,
    branchFromBusNum,
    branchToBusNum,
    nonSlackBusNumbers,
  } = ctx;

  // ── Build & validate the reduced (per-unit) injection vector ──────────────
  const Ppu = new Float64Array(nred);
  const entries: [number, number][] =
    injectionsMw instanceof Map
      ? Array.from(injectionsMw.entries())
      : Object.entries(injectionsMw).map(([k, v]) => [Number(k), v] as [number, number]);

  for (const [busNumber, mw] of entries) {
    if (!Number.isFinite(mw)) {
      throw new Error(`[DCPF] injection for bus ${busNumber} must be a finite number (got ${mw})`);
    }
    if (busNumber === slackBusNumber) {
      throw new Error(
        `[DCPF] injections must not include the slack bus (bus ${slackBusNumber}) — its value is computed as the swing balance, not supplied`
      );
    }
    const redIdx = busNumToRedIdx.get(busNumber);
    if (redIdx === undefined) {
      throw new Error(`[DCPF] injection specified for unknown bus number ${busNumber}`);
    }
    Ppu[redIdx] = mw / baseMva;
  }

  // ── Solve B_reduced · θ = P (single dense RHS, reusing the shared factor) ──
  const rhsPerm = new Float64Array(nred);
  for (let i = 0; i < nred; i++) rhsPerm[i] = Ppu[perm[i]];

  const y = choleskyForwardSolve(chol.L, nred, rhsPerm, 0);
  const xperm = choleskyBackwardSolve(chol.L, nred, y);

  const theta = new Float64Array(nred);
  for (let i = 0; i < nred; i++) theta[perm[i]] = xperm[i];

  // ── Branch flows (pu -> MW) ────────────────────────────────────────────────
  const branchFlows: BranchFlowResult[] = new Array(e);
  const flowPu = new Float64Array(e);
  for (let l = 0; l < e; l++) {
    const fr = fromRedIdx[l];
    const tr = toRedIdx[l];
    const tf = fr >= 0 ? theta[fr] : 0.0;
    const tt = tr >= 0 ? theta[tr] : 0.0;
    const f = susceptances[l] * (tf - tt);
    flowPu[l] = f;
    branchFlows[l] = {
      branchNumber: branchNumbers[l],
      fromBusNumber: branchFromBusNum[l],
      toBusNumber: branchToBusNum[l],
      flowMw: f * baseMva,
    };
  }

  // ── Bus angles (slack included, θ = 0) ────────────────────────────────────
  const busAngles: BusAngleResult[] = [{ busNumber: slackBusNumber, thetaRad: 0, thetaDeg: 0 }];
  for (let i = 0; i < nred; i++) {
    const rad = theta[i];
    busAngles.push({
      busNumber: nonSlackBusNumbers[i],
      thetaRad: rad,
      thetaDeg: (rad * 180) / Math.PI,
    });
  }

  // ── Power balance: KCL residual + generation/load/slack summary ──────────
  const netInjectionComputedPu = new Float64Array(nred);
  for (let l = 0; l < e; l++) {
    const fr = fromRedIdx[l];
    const tr = toRedIdx[l];
    if (fr >= 0) netInjectionComputedPu[fr] += flowPu[l];
    if (tr >= 0) netInjectionComputedPu[tr] -= flowPu[l];
  }
  let maxMismatchPu = 0;
  for (let i = 0; i < nred; i++) {
    const err = Math.abs(netInjectionComputedPu[i] - Ppu[i]);
    if (err > maxMismatchPu) maxMismatchPu = err;
  }
  const maxMismatchMw = maxMismatchPu * baseMva;

  let totalGenerationMw = 0;
  let totalLoadMw = 0;
  let totalSuppliedMw = 0;
  for (let i = 0; i < nred; i++) {
    const mw = Ppu[i] * baseMva;
    totalSuppliedMw += mw;
    if (mw > 0) totalGenerationMw += mw;
    else totalLoadMw += -mw;
  }
  const slackInjectionMw = -totalSuppliedMw;
  if (slackInjectionMw > 0) totalGenerationMw += slackInjectionMw;
  else totalLoadMw += -slackInjectionMw;

  const tolerance =
    ctx.mismatchToleranceMw ?? 1e-6 * Math.max(1, totalGenerationMw + totalLoadMw);
  const balanced = maxMismatchMw <= tolerance;

  if (!balanced) {
    throw new Error(
      `[DCPF] Power balance violated after solve: max KCL mismatch ${maxMismatchMw.toExponential(4)} MW ` +
        `exceeds tolerance ${tolerance.toExponential(4)} MW. This indicates a solver defect, not a physical condition.`
    );
  }

  return {
    modelId: ctx.modelId,
    slackBusNumber,
    baseMva,
    busAngles,
    branchFlows,
    powerBalance: {
      totalGenerationMw,
      totalLoadMw,
      slackInjectionMw,
      maxMismatchMw,
      balanced,
    },
    computedAt: ctx.computedAt,
    topologyHash: ctx.topologyHash,
  };
}
