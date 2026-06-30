/**
 * PTDF engine public types — INFRA-009
 */

export interface PtdfMatrix {
  modelId: string;
  slackBusNumber: number;
  busNumbers: number[];        // n-1 non-slack bus numbers (PTDF column headers), input order
  branchNumbers: number[];     // e in-service branch numbers (PTDF row headers)
  data: Float64Array;          // row-major, shape [rows × cols]
  rows: number;                // = branchNumbers.length = e
  cols: number;                // = busNumbers.length = n-1
  computedAt: string;          // ISO-8601 timestamp
  topologyHash: string | null; // topology_hash snapshot when computed
}

export interface PtdfComputeOptions {
  slackBusNumber?: number;  // overrides bus with busType='SLACK'; falls back to first bus
  modelId?: string;
  topologyHash?: string | null;
}

export interface PtdfComputeResult {
  ptdf: PtdfMatrix;
  fromCache: boolean;
  computeMs: number;
}

export interface PtdfStorageAdapter {
  load(tenantId: string, modelId: string): Promise<PtdfMatrix | null>;
  store(tenantId: string, matrix: PtdfMatrix): Promise<void>;
  invalidate(tenantId: string, modelId: string): Promise<void>;
}
