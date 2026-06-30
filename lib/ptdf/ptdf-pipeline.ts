/**
 * PTDF cache-aware pipeline — INFRA-009
 *
 * Orchestrates: DB model check → cache hit/miss → compute → store → mark valid.
 * Uses the network_models.ptdf_valid flag as the cache validity signal.
 * The DB trigger `refresh_topology_hash` sets ptdf_valid = FALSE whenever
 * network_branches is modified.
 */

import "server-only";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type { PtdfComputeResult, PtdfStorageAdapter } from "./types";
import { computePtdf } from "./ptdf-engine";

export async function getOrComputePtdf(
  tenantId: string,
  modelId: string,
  repo: NetworkRepository,
  storage: PtdfStorageAdapter,
  slackBusNumberOverride?: number
): Promise<PtdfComputeResult> {
  const t0 = performance.now();

  // 1. Load model — checks tenant isolation
  const model = await repo.getModel(tenantId, modelId);
  if (!model) {
    throw new Error(`[PTDF] Model ${modelId} not found for tenant ${tenantId}`);
  }

  // 2. Cache hit: ptdf_valid is true AND storage contains the matrix
  if (model.ptdfValid) {
    const cached = await storage.load(tenantId, modelId);
    if (cached) {
      return {
        ptdf: cached,
        fromCache: true,
        computeMs: Math.round(performance.now() - t0),
      };
    }
  }

  // 3. Cache miss — fetch topology and compute
  const [buses, branches] = await Promise.all([
    repo.listBuses(tenantId, modelId),
    repo.listBranches(tenantId, modelId),
  ]);

  const ptdf = computePtdf(buses, branches, {
    modelId,
    slackBusNumber: slackBusNumberOverride,
    topologyHash: model.topologyHash,
  });

  // 4. Persist and mark valid
  await storage.store(tenantId, ptdf);
  await repo.markPtdfValid(tenantId, modelId, true);

  return {
    ptdf,
    fromCache: false,
    computeMs: Math.round(performance.now() - t0),
  };
}
