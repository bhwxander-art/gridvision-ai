/**
 * LODF cache-aware pipeline — INFRA-010
 *
 * Orchestrates: DB model check → cache hit/miss → reuse/compute PTDF →
 * compute LODF → store → mark valid.
 *
 * Uses the network_models.lodf_valid flag as the cache validity signal,
 * mirroring lib/ptdf/ptdf-pipeline.ts. The DB trigger `refresh_topology_hash`
 * sets both ptdf_valid = FALSE and lodf_valid = FALSE whenever
 * network_branches is modified, so both caches invalidate together.
 *
 * PTDF reuse: delegates to getOrComputePtdf() rather than recomputing the
 * Cholesky factorisation — LODF only ever needs a cheap O(e²) pass over an
 * already-valid PTDF matrix. If PTDF itself is stale, this pipeline computes
 * it (and marks ptdf_valid) as a side effect, exactly as a direct PTDF
 * request would.
 *
 * Fault tolerance: lodf_valid is only marked true *after* the LODF matrix
 * has been durably stored; any failure (compute, store, or the flag update
 * itself) leaves lodf_valid at its prior value, so a subsequent call safely
 * retries a full recompute — idempotent by construction.
 */

import "server-only";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type { PtdfStorageAdapter } from "@/lib/ptdf/types";
import { getOrComputePtdf } from "@/lib/ptdf/ptdf-pipeline";
import type { LodfComputeResult, LodfStorageAdapter } from "./types";
import { computeLodf } from "./lodf-engine";

export async function getOrComputeLodf(
  tenantId: string,
  modelId: string,
  repo: NetworkRepository,
  ptdfStorage: PtdfStorageAdapter,
  lodfStorage: LodfStorageAdapter,
  slackBusNumberOverride?: number
): Promise<LodfComputeResult> {
  const t0 = performance.now();

  // 1. Load model — checks tenant isolation
  const model = await repo.getModel(tenantId, modelId);
  if (!model) {
    throw new Error(`[LODF] Model ${modelId} not found for tenant ${tenantId}`);
  }

  // 2. Cache hit: lodf_valid is true AND storage contains the matrix
  if (model.lodfValid) {
    const cached = await lodfStorage.load(tenantId, modelId);
    if (cached) {
      return {
        lodf: cached,
        fromCache: true,
        computeMs: Math.round(performance.now() - t0),
      };
    }
  }

  // 3. Cache miss — reuse (or compute) the PTDF matrix for this model
  const { ptdf } = await getOrComputePtdf(
    tenantId,
    modelId,
    repo,
    ptdfStorage,
    slackBusNumberOverride
  );

  // 4. Fetch topology and compute LODF from the PTDF matrix
  const [buses, branches] = await Promise.all([
    repo.listBuses(tenantId, modelId),
    repo.listBranches(tenantId, modelId),
  ]);

  const lodf = computeLodf(buses, branches, ptdf, {
    modelId,
    topologyHash: model.topologyHash,
  });

  // 5. Persist and mark valid
  await lodfStorage.store(tenantId, lodf);
  await repo.markLodfValid(tenantId, modelId, true);

  return {
    lodf,
    fromCache: false,
    computeMs: Math.round(performance.now() - t0),
  };
}
