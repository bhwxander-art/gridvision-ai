/**
 * Hosting Capacity repository-integrated pipeline — INFRA-012
 *
 * Orchestrates: model/topology load → PTDF (cached, reused) → LODF (cached,
 * reused) → base-case DC power flow (reused) → computeHostingCapacity →
 * persist to ife_analyses / ife_hosting_capacity.
 *
 * Caching: PTDF and LODF are obtained via their existing cache-aware
 * pipelines (getOrComputePtdf / getOrComputeLodf) exactly as-is — no new
 * topology-keyed cache is introduced here, since (like DCPF) a hosting
 * capacity result depends on the caller-supplied base-case injections, not
 * topology alone. What IS cached/reused is the expensive Cholesky-based
 * PTDF/LODF computation itself.
 *
 * Topology-hash consistency: computeHostingCapacity() (the engine) itself
 * validates that the PTDF, LODF, and base-case DC power flow all agree on
 * both slack bus and topology_hash before combining them — this pipeline
 * simply ensures all three are computed against the *same* resolved slack
 * bus (ptdf.slackBusNumber) so that check passes for consistent inputs and
 * fails loudly for genuinely stale ones.
 *
 * Idempotency: a client-supplied idempotencyKey maps 1:1 to an ife_analyses
 * row (unique constraint already enforced by migration 015); a repeat
 * request with the same key returns the existing record's current state
 * rather than recomputing or creating a duplicate row.
 */

import "server-only";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { PtdfStorageAdapter } from "@/lib/ptdf/types";
import { getOrComputePtdf } from "@/lib/ptdf/ptdf-pipeline";
import type { LodfStorageAdapter } from "@/lib/lodf/types";
import { getOrComputeLodf } from "@/lib/lodf/lodf-pipeline";
import { computeDcPowerFlow } from "@/lib/dcpf/dcpf-engine";
import { computeHostingCapacity } from "./hosting-capacity-engine";
import type { HostingCapacityRequest } from "./types";
import type { IfeAnalysis, IfeHostingCapacity } from "@/lib/db/types-ife";

export interface HostingCapacityPipelineResult {
  analysis: IfeAnalysis;
  hostingCapacity: IfeHostingCapacity | null;
  computeMs: number;
}

export async function computeAndPersistHostingCapacity(
  tenantId: string,
  request: HostingCapacityRequest,
  repo: NetworkRepository,
  ifeRepo: IfeRepository,
  ptdfStorage: PtdfStorageAdapter,
  lodfStorage: LodfStorageAdapter,
  slackBusNumberOverride?: number
): Promise<HostingCapacityPipelineResult> {
  const t0 = performance.now();

  const model = await repo.getModel(tenantId, request.networkModelId);
  if (!model) {
    throw new Error(
      `[HostingCapacity] Model ${request.networkModelId} not found for tenant ${tenantId}`
    );
  }

  // ── Idempotency short-circuit ──────────────────────────────────────────────
  if (request.idempotencyKey) {
    const existing = await ifeRepo.getAnalysisByIdempotencyKey(tenantId, request.idempotencyKey);
    if (existing) {
      const hostingCapacity =
        existing.status === "completed"
          ? await ifeRepo.getHostingCapacityByAnalysisId(tenantId, existing.id)
          : null;
      return { analysis: existing, hostingCapacity, computeMs: Math.round(performance.now() - t0) };
    }
  }

  const [buses, branches] = await Promise.all([
    repo.listBuses(tenantId, request.networkModelId),
    repo.listBranches(tenantId, request.networkModelId),
  ]);

  const poiBus = buses.find((b) => b.busNumber === request.poiBusNumber);
  if (!poiBus) {
    throw new Error(
      `[HostingCapacity] POI bus number ${request.poiBusNumber} not found in model ${request.networkModelId}`
    );
  }

  const { ptdf } = await getOrComputePtdf(
    tenantId,
    request.networkModelId,
    repo,
    ptdfStorage,
    slackBusNumberOverride
  );
  const { lodf } = await getOrComputeLodf(
    tenantId,
    request.networkModelId,
    repo,
    ptdfStorage,
    lodfStorage,
    slackBusNumberOverride
  );

  const baseCase = computeDcPowerFlow(buses, branches, request.baseCaseInjectionsMw, {
    slackBusNumber: ptdf.slackBusNumber,
    modelId: request.networkModelId,
    topologyHash: model.topologyHash,
  });

  const analysis = await ifeRepo.createAnalysis({
    tenant_id: tenantId,
    network_model_id: request.networkModelId,
    poi_bus_id: poiBus.id,
    iso_id: request.isoId,
    capacity_mw: request.capacityMw,
    project_type: request.projectType,
    target_cod: request.targetCod ?? null,
    input_snapshot: {
      poiBusNumber: request.poiBusNumber,
      slackBusNumber: ptdf.slackBusNumber,
      topologyHash: ptdf.topologyHash,
      baseCaseInjectionsMw:
        request.baseCaseInjectionsMw instanceof Map
          ? Object.fromEntries(request.baseCaseInjectionsMw)
          : request.baseCaseInjectionsMw,
    },
    idempotency_key: request.idempotencyKey ?? null,
  });

  await ifeRepo.updateAnalysisStatus(tenantId, analysis.id, "running");

  try {
    const result = computeHostingCapacity(
      buses,
      branches,
      ptdf,
      lodf,
      baseCase,
      request.poiBusNumber,
      request.projectType
    );

    const branchNumToId = new Map(branches.map((b) => [b.branchNumber, b.id]));

    const hostingCapacity = await ifeRepo.createHostingCapacity({
      analysis_id: analysis.id,
      tenant_id: tenantId,
      hc_deterministic_mw: result.hcDeterministicMw,
      binding_line_id: result.binding ? (branchNumToId.get(result.binding.branchNumber) ?? null) : null,
      binding_contingency_id:
        result.binding?.outagedBranchNumber != null
          ? (branchNumToId.get(result.binding.outagedBranchNumber) ?? null)
          : null,
      // Monte Carlo and voltage-headroom fields are out of scope for INFRA-012 (see spec) — left NULL.
      hc_p10_mw: null,
      hc_p50_mw: null,
      hc_p90_mw: null,
      mc_scenarios_run: null,
      mc_convergence_pct: null,
      violation_probability: null,
      vmin_headroom_pu: null,
      vmax_headroom_pu: null,
    });

    const completedAnalysis = await ifeRepo.updateAnalysisStatus(tenantId, analysis.id, "completed");

    return {
      analysis: completedAnalysis,
      hostingCapacity,
      computeMs: Math.round(performance.now() - t0),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ifeRepo.updateAnalysisStatus(tenantId, analysis.id, "failed", { errorMessage: message });
    throw err;
  }
}
