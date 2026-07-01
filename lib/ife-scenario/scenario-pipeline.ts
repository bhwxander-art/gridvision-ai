/**
 * Scenario Analysis Engine pipeline — INFRA-019
 *
 * No electrical computation lives here. This module only:
 *   1. Resolves whether a network_models clone is needed (network_delta
 *      non-empty) and, if so, materializes it via the existing, unmodified
 *      NetworkRepository methods.
 *   2. Merges any injectionOverridesMw over the caller-supplied
 *      baseCaseInjectionsMw.
 *   3. Calls the existing, unmodified orchestrateIfeAnalysis (INFRA-014)
 *      against the resolved network model id.
 *
 * Idempotency: a client-supplied idempotencyKey maps 1:1 to an ife_scenarios
 * row (unique constraint, migration 018). A repeat request with the same key
 * short-circuits on ANY existing row for that key, not just a completed one:
 * a completed match returns its stored result rather than recomputing; a
 * failed/pending match throws rather than falling through to createScenario,
 * which would otherwise violate the UNIQUE constraint on retry.
 *
 * Dedup: an identical (canonicalized) network_delta against the same base
 * model reuses the first matching scenario's derived_network_model_id
 * instead of cloning again — see idx_ife_scenarios_delta_dedup (migration
 * 018). Like the existing idempotencyKey check-then-insert pattern used
 * throughout INFRA-012/014, this is a check-then-act lookup, not an atomic
 * claim — a rare concurrent race can still produce two derived clones for
 * the same delta. This is an accepted limitation consistent with the
 * existing codebase's idempotency behavior (see INFRA-019 Phase 2
 * architecture review, Non-blocking Note 1), not a regression introduced
 * here.
 */

import "server-only";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { IfeScenarioRepository } from "@/lib/db/repositories/ife-scenario.repository";
import type { PtdfStorageAdapter } from "@/lib/ptdf/types";
import type { LodfStorageAdapter } from "@/lib/lodf/types";
import { orchestrateIfeAnalysis } from "@/lib/ife-orchestrator/ife-orchestrator-pipeline";
import type { IfeOrchestrationRequest, IfeOrchestrationResult } from "@/lib/ife-orchestrator/types";
import type { NetworkModel } from "@/lib/db/types-network";
import type { BusInjectionsMw } from "@/lib/dcpf/types";
import { validateNetworkDeltaOp } from "@/lib/db/types-ife-scenario";
import {
  buildClonedBusInserts,
  buildClonedBranchInserts,
  hashNetworkDelta,
} from "./network-delta";
import {
  IfeScenarioStageError,
  type NetworkDeltaOp,
  type ScenarioRequest,
  type ScenarioResult,
} from "./types";
import { IfeScenarioValidationError } from "@/lib/db/types-ife-scenario";

// ── Injection merge ────────────────────────────────────────────────────────────

function mergeInjections(
  base: BusInjectionsMw,
  overrides: Record<number, number> | undefined
): BusInjectionsMw {
  const merged = new Map<number, number>(
    base instanceof Map ? base : Object.entries(base).map(([k, v]) => [Number(k), v])
  );
  if (overrides) {
    for (const [busNumber, mw] of Object.entries(overrides)) {
      merged.set(Number(busNumber), mw);
    }
  }
  return merged;
}

// ── Materialization (only when networkDelta is non-empty) ────────────────────

async function materializeScenarioNetwork(
  tenantId: string,
  baseModel: NetworkModel,
  delta: NetworkDeltaOp[],
  networkRepo: NetworkRepository
): Promise<string> {
  const [buses, branches] = await Promise.all([
    networkRepo.listBuses(tenantId, baseModel.id),
    networkRepo.listBranches(tenantId, baseModel.id),
  ]);

  const derivedModel = await networkRepo.createModel({
    tenant_id: tenantId,
    iso: baseModel.iso,
    name: `${baseModel.name} (scenario clone)`,
    version: `${baseModel.version}-scenario`,
    base_mva: baseModel.baseMva,
    model_date: baseModel.modelDate,
    source: "MANUAL",
    bus_count: buses.length,
    branch_count: branches.length,
    metadata: { scenarioClonedFromModelId: baseModel.id },
  });

  try {
    const busInserts = buildClonedBusInserts(buses, tenantId, derivedModel.id);
    const createdBuses = await networkRepo.createBusesBatch(busInserts);

    // Mandatory bus UUID remapping (INFRA-019 Phase 2 review, Blocking B1):
    // cloned branches must resolve from_bus_id/to_bus_id through the newly
    // created bus rows, never through the base model's own bus UUIDs.
    const busNumberToNewId = new Map(createdBuses.map((b) => [b.busNumber, b.id]));
    const baseBusIdToNumber = new Map(buses.map((b) => [b.id, b.busNumber]));

    const branchInserts = buildClonedBranchInserts(
      branches,
      delta,
      tenantId,
      derivedModel.id,
      busNumberToNewId,
      baseBusIdToNumber
    );
    await networkRepo.createBranchesBatch(branchInserts);

    return derivedModel.id;
  } catch (err) {
    // Cleanup partial clone — deleteModel cascades to network_buses/
    // network_branches (ON DELETE CASCADE, migration 012), leaving no
    // orphaned rows behind.
    await networkRepo.deleteModel(tenantId, derivedModel.id).catch(() => {});
    throw err;
  }
}

// ── Reconstruct an IfeOrchestrationResult for an already-completed analysis ──

async function loadOrchestrationResult(
  tenantId: string,
  analysisId: string,
  ifeRepo: IfeRepository
): Promise<IfeOrchestrationResult> {
  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    throw new Error(`[IfeScenario] Analysis ${analysisId} referenced by scenario not found`);
  }
  const hostingCapacity = await ifeRepo.getHostingCapacityByAnalysisId(tenantId, analysisId);
  if (!hostingCapacity) {
    throw new Error(`[IfeScenario] Analysis ${analysisId} has no hosting capacity result`);
  }
  const upgradeResults = await ifeRepo.getUpgradeResultsByAnalysisId(tenantId, analysisId);

  return {
    analysis,
    hostingCapacity,
    upgradeResults,
    overallStatus: upgradeResults ? "completed_with_upgrades" : "completed_no_upgrade_needed",
    computeMs: { hostingCapacityMs: 0, upgradeAnalysisMs: 0, totalMs: 0 },
  };
}

// ── Main entry point ───────────────────────────────────────────────────────────

export async function runScenario(
  tenantId: string,
  request: ScenarioRequest,
  networkRepo: NetworkRepository,
  ifeRepo: IfeRepository,
  scenarioRepo: IfeScenarioRepository,
  ptdfStorage: PtdfStorageAdapter,
  lodfStorage: LodfStorageAdapter
): Promise<ScenarioResult> {
  // ── Idempotency fast path ────────────────────────────────────────────────
  // Any existing scenario under this key short-circuits — not just a
  // "completed" one. Falling through to createScenario for a "failed"/
  // "pending" prior attempt would violate idempotency_key's UNIQUE
  // constraint (migration 018) on the retry, surfacing as a raw DB error
  // instead of a clean response.
  if (request.idempotencyKey) {
    const existing = await scenarioRepo.getScenarioByIdempotencyKey(tenantId, request.idempotencyKey);
    if (existing) {
      if (existing.status === "completed" && existing.resultAnalysisId) {
        const orchestration = await loadOrchestrationResult(tenantId, existing.resultAnalysisId, ifeRepo);
        return {
          scenario: {
            id: existing.id,
            status: "completed",
            baseNetworkModelId: existing.baseNetworkModelId,
            derivedNetworkModelId: existing.derivedNetworkModelId,
            resultAnalysisId: existing.resultAnalysisId,
          },
          orchestration,
        };
      }
      throw new IfeScenarioValidationError(
        `A scenario with idempotencyKey '${request.idempotencyKey}' already exists with status '${existing.status}' ` +
          "and did not complete successfully. Retry with a new idempotencyKey.",
        "idempotencyKey"
      );
    }
  }

  const delta = request.networkDelta ?? [];
  delta.forEach(validateNetworkDeltaOp);
  const networkDeltaHash = hashNetworkDelta(delta);

  const baseModel = await networkRepo.getModel(tenantId, request.baseNetworkModelId);
  if (!baseModel) {
    throw new IfeScenarioStageError(
      "materialization",
      new Error(`[IfeScenario] Base network model ${request.baseNetworkModelId} not found for tenant ${tenantId}`)
    );
  }

  let derivedNetworkModelId: string | null = null;
  let materializedNewClone = false; // true only if THIS call created the clone (not a dedup reuse) — governs cleanup below.
  if (delta.length > 0) {
    if (networkDeltaHash) {
      const dedupMatch = await scenarioRepo.getScenarioByDeltaHash(
        tenantId,
        request.baseNetworkModelId,
        networkDeltaHash
      );
      if (dedupMatch?.derivedNetworkModelId) {
        derivedNetworkModelId = dedupMatch.derivedNetworkModelId;
      }
    }

    if (!derivedNetworkModelId) {
      try {
        derivedNetworkModelId = await materializeScenarioNetwork(tenantId, baseModel, delta, networkRepo);
        materializedNewClone = true;
      } catch (err) {
        throw new IfeScenarioStageError(
          "materialization",
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }
  }

  const resolvedNetworkModelId = derivedNetworkModelId ?? request.baseNetworkModelId;

  let scenario;
  try {
    scenario = await scenarioRepo.createScenario({
      tenant_id: tenantId,
      base_network_model_id: request.baseNetworkModelId,
      derived_network_model_id: derivedNetworkModelId,
      name: request.name,
      description: request.description ?? null,
      poi_bus_number: request.poiBusNumber,
      iso_id: request.isoId,
      capacity_mw: request.capacityMw,
      project_type: request.projectType,
      target_cod: request.targetCod ?? null,
      injection_overrides_mw: (request.injectionOverridesMw ?? {}) as Record<string, number>,
      network_delta: delta,
      network_delta_hash: networkDeltaHash,
      idempotency_key: request.idempotencyKey ?? null,
    });
  } catch (err) {
    // A clone this call just created (not a dedup reuse of another scenario's
    // clone) has nothing else referencing it yet — cleaning it up here avoids
    // leaking a full network_models/buses/branches clone on a validation or
    // DB failure that happens after materialization succeeds.
    if (materializedNewClone && derivedNetworkModelId) {
      await networkRepo.deleteModel(tenantId, derivedNetworkModelId).catch(() => {});
    }
    throw err;
  }

  const orchestrationRequest: IfeOrchestrationRequest = {
    networkModelId: resolvedNetworkModelId,
    poiBusNumber: request.poiBusNumber,
    isoId: request.isoId,
    capacityMw: request.capacityMw,
    projectType: request.projectType,
    targetCod: request.targetCod ?? null,
    baseCaseInjectionsMw: mergeInjections(request.baseCaseInjectionsMw, request.injectionOverridesMw),
    idempotencyKey: request.idempotencyKey,
  };

  try {
    const orchestration = await orchestrateIfeAnalysis(
      tenantId,
      orchestrationRequest,
      networkRepo,
      ifeRepo,
      ptdfStorage,
      lodfStorage
    );

    await scenarioRepo.updateScenarioStatus(tenantId, scenario.id, "completed", {
      resultAnalysisId: orchestration.analysis.id,
    });

    return {
      scenario: {
        id: scenario.id,
        status: "completed",
        baseNetworkModelId: scenario.baseNetworkModelId,
        derivedNetworkModelId: scenario.derivedNetworkModelId,
        resultAnalysisId: orchestration.analysis.id,
      },
      orchestration,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await scenarioRepo.updateScenarioStatus(tenantId, scenario.id, "failed", { errorMessage: message });
    throw new IfeScenarioStageError("orchestration", err instanceof Error ? err : new Error(message));
  }
}
