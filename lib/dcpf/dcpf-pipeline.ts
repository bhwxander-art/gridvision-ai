/**
 * DC power flow repository-integrated pipeline — INFRA-011
 *
 * Unlike the INFRA-009/010 PTDF/LODF pipelines, a DC power-flow *result* is
 * not a function of topology alone — it also depends on the caller-supplied
 * bus injection pattern, which legitimately changes on every call (a new
 * dispatch scenario, a new hour of SCADA/AMI data, a what-if study, etc).
 * There is therefore no `dc_power_flow_valid`-style DB flag or Supabase
 * Storage cache to hit here — this module intentionally has no dcpf-storage
 * counterpart. Storing a solved operating point keyed only by modelId would
 * silently serve stale results for a different injection pattern, which is
 * worse than recomputing.
 *
 * What "cache-aware" means for this module instead:
 *   1. Batch reuse: computeDcPowerFlowForModelBatch() factorises B_reduced
 *      exactly once (via lib/dcpf/dcpf-engine.ts's computeDcPowerFlowBatch)
 *      and solves every injection scenario in the batch against that single
 *      factorisation — the same reuse principle PTDF/LODF apply internally.
 *   2. Topology-staleness protection: callers preparing a batch of injection
 *      scenarios against a topology snapshot (e.g. topologyHash read earlier
 *      in a longer-running study) can pass `expectedTopologyHash`; if the
 *      model's topology has since changed underneath them, this pipeline
 *      fails fast rather than silently solving against a mismatched network.
 *
 * Repository integration: loads the model (tenant + existence check) and
 * topology via NetworkRepository exactly like the PTDF/LODF pipelines —
 * no duplicated query logic.
 */

import "server-only";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { computeDcPowerFlowBatch } from "./dcpf-engine";
import type {
  BusInjectionsMw,
  DcPowerFlowOptions,
  DcPowerFlowResult,
} from "./types";

export interface DcPowerFlowPipelineOptions
  extends Omit<DcPowerFlowOptions, "modelId" | "topologyHash"> {
  /** If provided, throws when it no longer matches the model's current topology_hash. */
  expectedTopologyHash?: string | null;
}

export interface DcPowerFlowBatchResult {
  flows: DcPowerFlowResult[];
  computeMs: number;
}

export async function computeDcPowerFlowForModelBatch(
  tenantId: string,
  modelId: string,
  repo: NetworkRepository,
  injectionSets: BusInjectionsMw[],
  options: DcPowerFlowPipelineOptions = {}
): Promise<DcPowerFlowBatchResult> {
  const t0 = performance.now();

  const model = await repo.getModel(tenantId, modelId);
  if (!model) {
    throw new Error(`[DCPF] Model ${modelId} not found for tenant ${tenantId}`);
  }

  if (
    options.expectedTopologyHash !== undefined &&
    options.expectedTopologyHash !== model.topologyHash
  ) {
    throw new Error(
      `[DCPF] Topology has changed since injections were prepared for model ${modelId} ` +
        `(expected topology_hash ${options.expectedTopologyHash ?? "null"}, ` +
        `current ${model.topologyHash ?? "null"}). Refresh the injection scenario before solving.`
    );
  }

  if (injectionSets.length === 0) {
    return { flows: [], computeMs: Math.round(performance.now() - t0) };
  }

  const [buses, branches] = await Promise.all([
    repo.listBuses(tenantId, modelId),
    repo.listBranches(tenantId, modelId),
  ]);

  const flows = computeDcPowerFlowBatch(buses, branches, injectionSets, {
    slackBusNumber: options.slackBusNumber,
    baseMva: options.baseMva ?? model.baseMva,
    mismatchToleranceMw: options.mismatchToleranceMw,
    modelId,
    topologyHash: model.topologyHash,
  });

  return { flows, computeMs: Math.round(performance.now() - t0) };
}

export async function computeDcPowerFlowForModel(
  tenantId: string,
  modelId: string,
  repo: NetworkRepository,
  injectionsMw: BusInjectionsMw,
  options: DcPowerFlowPipelineOptions = {}
): Promise<{ flow: DcPowerFlowResult; computeMs: number }> {
  const { flows, computeMs } = await computeDcPowerFlowForModelBatch(
    tenantId,
    modelId,
    repo,
    [injectionsMw],
    options
  );
  return { flow: flows[0], computeMs };
}
