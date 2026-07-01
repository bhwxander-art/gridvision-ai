/**
 * Upgrade Analysis repository-integrated pipeline — INFRA-013
 *
 * Operates on an EXISTING, already-completed ife_analyses record (the one
 * INFRA-012's Hosting Capacity pipeline created) rather than accepting a
 * fresh request — this is the "integration with the existing IFE workflow"
 * called for by the approved spec. All inputs (network model, POI bus,
 * requested capacity, project type, base-case injections, slack bus,
 * topology hash) are re-derived from that analysis and its input_snapshot
 * rather than re-supplied by the caller, eliminating any chance of
 * analyzing upgrades against a different base case than hosting capacity
 * was computed against.
 *
 * Topology-hash staleness: the model's CURRENT topology_hash is compared
 * against the value captured in the original analysis's input_snapshot; a
 * mismatch means the network has changed since hosting capacity was run,
 * and this pipeline fails fast rather than computing upgrades against
 * stale data (same principle as DCPF's expectedTopologyHash guard).
 *
 * This pipeline does not modify ife_analyses.status/error_message — that
 * field represents the overall (hosting-capacity) analysis lifecycle,
 * already finalized by INFRA-012; an upgrade-analysis-specific failure
 * simply propagates to the caller without touching the parent row.
 */

import "server-only";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { IfeAnalysis, IfeUpgradeResults } from "@/lib/db/types-ife";
import type { PtdfStorageAdapter } from "@/lib/ptdf/types";
import { getOrComputePtdf } from "@/lib/ptdf/ptdf-pipeline";
import type { LodfStorageAdapter } from "@/lib/lodf/types";
import { getOrComputeLodf } from "@/lib/lodf/lodf-pipeline";
import { computeDcPowerFlow } from "@/lib/dcpf/dcpf-engine";
import type { BusInjectionsMw } from "@/lib/dcpf/types";
import { computeUpgradeAnalysis } from "./upgrade-analysis-engine";
import type { UpgradeAnalysisOptions } from "./types";

export interface UpgradeAnalysisPipelineResult {
  analysis: IfeAnalysis;
  upgradeResults: IfeUpgradeResults;
  computeMs: number;
}

export async function computeAndPersistUpgradeAnalysis(
  tenantId: string,
  analysisId: string,
  repo: NetworkRepository,
  ifeRepo: IfeRepository,
  ptdfStorage: PtdfStorageAdapter,
  lodfStorage: LodfStorageAdapter,
  options: UpgradeAnalysisOptions = {}
): Promise<UpgradeAnalysisPipelineResult> {
  const t0 = performance.now();

  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    throw new Error(`[UpgradeAnalysis] Analysis ${analysisId} not found for tenant ${tenantId}`);
  }

  // Idempotency (mirrors the Hosting Capacity pipeline's check-first pattern): an analysis can
  // have at most one upgrade_results row — analysisId is already the natural dedup key, so no
  // separate idempotency_key field or schema change is needed. Return the existing row rather
  // than recomputing, before any other validation or computation.
  const existingUpgradeResults = await ifeRepo.getUpgradeResultsByAnalysisId(tenantId, analysisId);
  if (existingUpgradeResults) {
    return {
      analysis,
      upgradeResults: existingUpgradeResults,
      computeMs: Math.round(performance.now() - t0),
    };
  }

  if (analysis.status !== "completed") {
    throw new Error(
      `[UpgradeAnalysis] Analysis ${analysisId} is not completed (status: ${analysis.status}) ` +
        `— hosting capacity must finish successfully before upgrade analysis can run`
    );
  }

  const hostingCapacity = await ifeRepo.getHostingCapacityByAnalysisId(tenantId, analysisId);
  if (!hostingCapacity) {
    throw new Error(
      `[UpgradeAnalysis] No hosting capacity result found for analysis ${analysisId} ` +
        `— hosting capacity must be computed before upgrade analysis can run`
    );
  }

  const snapshot = analysis.inputSnapshot ?? {};
  const recordedTopologyHash =
    typeof snapshot.topologyHash === "string" || snapshot.topologyHash === null
      ? (snapshot.topologyHash as string | null)
      : null;
  const recordedSlackBusNumber =
    typeof snapshot.slackBusNumber === "number" ? snapshot.slackBusNumber : undefined;
  const recordedBaseCaseInjectionsMw =
    typeof snapshot.baseCaseInjectionsMw === "object" && snapshot.baseCaseInjectionsMw !== null
      ? (snapshot.baseCaseInjectionsMw as BusInjectionsMw)
      : undefined;
  if (recordedBaseCaseInjectionsMw === undefined) {
    throw new Error(
      `[UpgradeAnalysis] Analysis ${analysisId}'s input_snapshot is missing baseCaseInjectionsMw ` +
        `— cannot reconstruct the original base case`
    );
  }

  const model = await repo.getModel(tenantId, analysis.networkModelId);
  if (!model) {
    throw new Error(
      `[UpgradeAnalysis] Network model ${analysis.networkModelId} not found for tenant ${tenantId}`
    );
  }
  if (model.topologyHash !== recordedTopologyHash) {
    throw new Error(
      `[UpgradeAnalysis] Topology has changed since hosting capacity was computed for analysis ` +
        `${analysisId} (recorded topology_hash ${recordedTopologyHash ?? "null"}, current ` +
        `${model.topologyHash ?? "null"}). Re-run hosting capacity before analyzing upgrades.`
    );
  }

  const [buses, branches] = await Promise.all([
    repo.listBuses(tenantId, analysis.networkModelId),
    repo.listBranches(tenantId, analysis.networkModelId),
  ]);

  const poiBus = buses.find((b) => b.id === analysis.poiBusId);
  if (!poiBus) {
    throw new Error(
      `[UpgradeAnalysis] POI bus ${analysis.poiBusId} referenced by analysis ${analysisId} ` +
        `not found in the current model`
    );
  }

  const slackBusNumberOverride = options.slackBusNumber ?? recordedSlackBusNumber;

  const { ptdf } = await getOrComputePtdf(
    tenantId,
    analysis.networkModelId,
    repo,
    ptdfStorage,
    slackBusNumberOverride
  );
  const { lodf } = await getOrComputeLodf(
    tenantId,
    analysis.networkModelId,
    repo,
    ptdfStorage,
    lodfStorage,
    slackBusNumberOverride
  );

  const baseCase = computeDcPowerFlow(buses, branches, recordedBaseCaseInjectionsMw, {
    slackBusNumber: ptdf.slackBusNumber,
    modelId: analysis.networkModelId,
    topologyHash: model.topologyHash,
  });

  const result = computeUpgradeAnalysis(
    buses,
    branches,
    ptdf,
    lodf,
    baseCase,
    poiBus.busNumber,
    analysis.projectType,
    analysis.capacityMw,
    { ...options, slackBusNumber: slackBusNumberOverride }
  );

  const branchLookup = new Map(branches.map((b) => [b.branchNumber, b]));

  const upgradeResults = await ifeRepo.createUpgradeResults({
    analysis_id: analysisId,
    tenant_id: tenantId,
    // Cost/MILP fields are out of scope for this deterministic engine (see spec §1) — always NULL.
    cost_p10_m: null,
    cost_p50_m: null,
    cost_p90_m: null,
    project_share_p50_m: null,
    upgrades_required: result.upgradesRequired,
    milp_optimality_gap_pct: null,
    milp_solve_seconds: null,
    upgrade_details: result.upgrades.map((u) => {
      const branch = branchLookup.get(u.branchNumber);
      return {
        branch_id: branch?.id ?? "",
        branch_name: branch?.name ?? `Branch ${u.branchNumber}`,
        upgrade_type: u.upgradeType,
        capacity_increase_mw: u.capacityIncreaseMw,
        cost_p50_m: null,
      };
    }),
  });

  return { analysis, upgradeResults, computeMs: Math.round(performance.now() - t0) };
}
