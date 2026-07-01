/**
 * DC power flow engine public types — INFRA-011
 */

/** Net real-power injection per bus, in MW (positive = generation, negative = load). */
export type BusInjectionsMw = Map<number, number> | Record<number, number>;

export interface BusAngleResult {
  busNumber: number;
  thetaRad: number;
  thetaDeg: number;
}

export interface BranchFlowResult {
  branchNumber: number;
  fromBusNumber: number;
  toBusNumber: number;
  flowMw: number; // from -> to, matches lib/ptdf sign convention
}

export interface PowerBalanceCheck {
  totalGenerationMw: number; // sum of positive injections, including slack if it nets positive
  totalLoadMw: number;       // sum of |negative injections|, including slack if it nets negative
  slackInjectionMw: number;  // computed swing balance = -sum(supplied non-slack injections)
  maxMismatchMw: number;     // post-solve KCL residual — numerical sanity check, not a physical failure mode
  balanced: boolean;         // maxMismatchMw within tolerance
}

export interface DcPowerFlowResult {
  modelId: string;
  slackBusNumber: number;
  baseMva: number;
  busAngles: BusAngleResult[];
  branchFlows: BranchFlowResult[];
  powerBalance: PowerBalanceCheck;
  computedAt: string;
  topologyHash: string | null;
}

export interface DcPowerFlowOptions {
  slackBusNumber?: number;
  modelId?: string;
  topologyHash?: string | null;
  baseMva?: number;             // pu <-> MW conversion; defaults to 100
  mismatchToleranceMw?: number; // default: 1e-6 * max(1, total |injection| MW)
}

export interface DcPowerFlowComputeResult {
  flow: DcPowerFlowResult;
  computeMs: number;
}
