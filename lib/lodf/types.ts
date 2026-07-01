/**
 * LODF engine public types — INFRA-010
 */

export interface LodfMatrix {
  modelId: string;
  branchNumbers: number[];       // e in-service branch numbers — shared row AND column index
  data: Float64Array;            // row-major, shape [e × e]; data[l*e+k] = LODF of monitored branch l for outage of branch k
  size: number;                  // e = branchNumbers.length
  islandingBranches: number[];   // branch numbers whose outage disconnects the network (bridge branches)
  computedAt: string;            // ISO-8601 timestamp
  topologyHash: string | null;   // topology_hash snapshot when computed
}

export interface LodfComputeOptions {
  modelId?: string;
  topologyHash?: string | null;
  /** Numerical guard on the LODF denominator (1 − self-PTDF). Default 1e-8. */
  denominatorEpsilon?: number;
}

export interface LodfComputeResult {
  lodf: LodfMatrix;
  fromCache: boolean;
  computeMs: number;
}

export interface LodfStorageAdapter {
  load(tenantId: string, modelId: string): Promise<LodfMatrix | null>;
  store(tenantId: string, matrix: LodfMatrix): Promise<void>;
  invalidate(tenantId: string, modelId: string): Promise<void>;
}

export interface ContingencyBranchImpact {
  branchNumber: number;
  preContingencyFlowMw: number;
  lodf: number;
  postContingencyFlowMw: number;
}

export interface ContingencyImpactResult {
  outagedBranchNumber: number;
  isIslanding: boolean;
  impacts: ContingencyBranchImpact[];
}
