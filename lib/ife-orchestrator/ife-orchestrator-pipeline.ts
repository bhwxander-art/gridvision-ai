/**
 * Full IFE Analysis Orchestrator pipeline — INFRA-014
 *
 * Sequences two existing, unmodified pipelines:
 *   1. computeAndPersistHostingCapacity (INFRA-012) — always run first.
 *   2. computeAndPersistUpgradeAnalysis (INFRA-013) — run only if hosting
 *      capacity was insufficient for the requested capacity.
 *
 * Neither PTDF, LODF, DCPF, Hosting Capacity, nor Upgrade Analysis is
 * modified or reimplemented here — this file contains no electrical
 * computation of any kind. It owns nothing new at the repository/storage
 * level either: it constructs the same NetworkRepository / IfeRepository /
 * PtdfStorageAdapter / LodfStorageAdapter instances the caller already
 * builds for the two standalone endpoints, and passes them straight through.
 *
 * H1 — orchestrator-level idempotency fast path:
 * Before touching NetworkRepository, PTDF/LODF storage, or either underlying
 * pipeline at all, check whether a prior run under the same idempotencyKey
 * already fully completed (hosting capacity done AND either sufficient on
 * its own, or an upgrade_results row already exists). If so, return the
 * complete combined result immediately using only IfeRepository reads —
 * no network reload, no PTDF/LODF/DCPF recomputation, no re-entering either
 * pipeline. This does not change Hosting Capacity's or Upgrade Analysis's
 * own idempotency behavior (both retain their existing, independent
 * idempotency checks) — it is a pure orchestration-level optimization on
 * top of them.
 *
 * H2 — split compute timing: hostingCapacityMs and upgradeAnalysisMs are
 * measured independently around each stage; totalMs is their sum (or just
 * hostingCapacityMs when the upgrade-analysis stage was never entered).
 */

import "server-only";
import type { NetworkRepository } from "@/lib/db/repositories/network.repository";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { PtdfStorageAdapter } from "@/lib/ptdf/types";
import type { LodfStorageAdapter } from "@/lib/lodf/types";
import { computeAndPersistHostingCapacity } from "@/lib/hosting-capacity/hosting-capacity-pipeline";
import { computeAndPersistUpgradeAnalysis } from "@/lib/upgrade-analysis/upgrade-analysis-pipeline";
import type { HostingCapacityRequest } from "@/lib/hosting-capacity/types";
import {
  IfeOrchestrationStageError,
  type IfeOrchestrationRequest,
  type IfeOrchestrationResult,
} from "./types";

// Mirrors (does not import — Upgrade Analysis is not modified to export it) the same default
// sufficiency tolerance Upgrade Analysis itself uses, so the H1 fast-path pre-check agrees with
// what a full run would have decided. Only used for this pre-check; a real (non-fast-path) run
// always defers the actual decision to the real pipelines.
const DEFAULT_SUFFICIENCY_TOLERANCE_MW = 1e-6;

export async function orchestrateIfeAnalysis(
  tenantId: string,
  request: IfeOrchestrationRequest,
  repo: NetworkRepository,
  ifeRepo: IfeRepository,
  ptdfStorage: PtdfStorageAdapter,
  lodfStorage: LodfStorageAdapter
): Promise<IfeOrchestrationResult> {
  const tStart = performance.now();

  // ── H1: orchestrator-level idempotency fast path ──────────────────────────
  if (request.idempotencyKey) {
    const existingAnalysis = await ifeRepo.getAnalysisByIdempotencyKey(tenantId, request.idempotencyKey);
    if (existingAnalysis && existingAnalysis.status === "completed") {
      const existingHc = await ifeRepo.getHostingCapacityByAnalysisId(tenantId, existingAnalysis.id);
      if (existingHc && existingHc.hcDeterministicMw !== null) {
        const tolerance = request.upgradeAnalysisOptions?.toleranceMw ?? DEFAULT_SUFFICIENCY_TOLERANCE_MW;
        const sufficientAlready =
          existingHc.hcDeterministicMw >= existingAnalysis.capacityMw - tolerance;

        if (sufficientAlready) {
          return {
            analysis: existingAnalysis,
            hostingCapacity: existingHc,
            upgradeResults: null,
            overallStatus: "completed_no_upgrade_needed",
            computeMs: {
              hostingCapacityMs: 0,
              upgradeAnalysisMs: 0,
              totalMs: Math.round(performance.now() - tStart),
            },
          };
        }

        const existingUpgrade = await ifeRepo.getUpgradeResultsByAnalysisId(tenantId, existingAnalysis.id);
        if (existingUpgrade) {
          return {
            analysis: existingAnalysis,
            hostingCapacity: existingHc,
            upgradeResults: existingUpgrade,
            overallStatus: "completed_with_upgrades",
            computeMs: {
              hostingCapacityMs: 0,
              upgradeAnalysisMs: 0,
              totalMs: Math.round(performance.now() - tStart),
            },
          };
        }
        // Hosting capacity done but insufficient, and no upgrade result yet — genuinely needs
        // upgrade analysis to run. Fall through to the normal flow below.
      }
      // Hosting capacity result missing despite a 'completed' analysis — a data-consistency edge
      // case, not expected in normal operation. Fall through and let the underlying pipelines'
      // own validation handle it.
    }
    // No existing analysis for this key, or not yet completed — fall through to the normal flow.
  }

  // ── Normal flow ────────────────────────────────────────────────────────────
  const hostingCapacityRequest: HostingCapacityRequest = {
    networkModelId: request.networkModelId,
    poiBusNumber: request.poiBusNumber,
    isoId: request.isoId,
    capacityMw: request.capacityMw,
    projectType: request.projectType,
    targetCod: request.targetCod,
    baseCaseInjectionsMw: request.baseCaseInjectionsMw,
    idempotencyKey: request.idempotencyKey,
  };

  const hcStart = performance.now();
  let hcResult;
  try {
    hcResult = await computeAndPersistHostingCapacity(
      tenantId,
      hostingCapacityRequest,
      repo,
      ifeRepo,
      ptdfStorage,
      lodfStorage,
      request.hostingCapacityOptions?.slackBusNumber
    );
  } catch (err) {
    throw new IfeOrchestrationStageError("hosting_capacity", err instanceof Error ? err : new Error(String(err)));
  }
  const hostingCapacityMs = Math.round(performance.now() - hcStart);

  if (!hcResult.hostingCapacity) {
    // Only reachable via the underlying pipeline's own idempotency branch returning a
    // previously non-completed analysis (e.g. a permanently failed prior attempt under the
    // same idempotencyKey) — computeAndPersistHostingCapacity always throws on a fresh failure,
    // it never silently returns a null result from a new computation.
    throw new IfeOrchestrationStageError(
      "hosting_capacity",
      new Error(
        `[IfeOrchestration] Analysis ${hcResult.analysis.id} did not complete successfully ` +
          `(status: ${hcResult.analysis.status}) — no hosting capacity result is available`
      )
    );
  }

  if (hcResult.hostingCapacity.hcDeterministicMw === null) {
    // hc_deterministic_mw is a nullable column at the schema level, but the deterministic
    // Hosting Capacity engine always populates it — a null here indicates a data-consistency
    // defect, not a valid state to proceed past.
    throw new IfeOrchestrationStageError(
      "hosting_capacity",
      new Error(
        `[IfeOrchestration] Analysis ${hcResult.analysis.id} has a hosting capacity result with ` +
          `no hc_deterministic_mw value — cannot determine whether an upgrade is needed`
      )
    );
  }

  const tolerance = request.upgradeAnalysisOptions?.toleranceMw ?? DEFAULT_SUFFICIENCY_TOLERANCE_MW;
  if (hcResult.hostingCapacity.hcDeterministicMw >= hcResult.analysis.capacityMw - tolerance) {
    return {
      analysis: hcResult.analysis,
      hostingCapacity: hcResult.hostingCapacity,
      upgradeResults: null,
      overallStatus: "completed_no_upgrade_needed",
      computeMs: {
        hostingCapacityMs,
        upgradeAnalysisMs: 0,
        totalMs: Math.round(performance.now() - tStart),
      },
    };
  }

  const uaStart = performance.now();
  let uaResult;
  try {
    uaResult = await computeAndPersistUpgradeAnalysis(
      tenantId,
      hcResult.analysis.id,
      repo,
      ifeRepo,
      ptdfStorage,
      lodfStorage,
      request.upgradeAnalysisOptions
    );
  } catch (err) {
    throw new IfeOrchestrationStageError("upgrade_analysis", err instanceof Error ? err : new Error(String(err)));
  }
  const upgradeAnalysisMs = Math.round(performance.now() - uaStart);

  return {
    analysis: uaResult.analysis,
    hostingCapacity: hcResult.hostingCapacity,
    upgradeResults: uaResult.upgradeResults,
    overallStatus: "completed_with_upgrades",
    computeMs: {
      hostingCapacityMs,
      upgradeAnalysisMs,
      totalMs: Math.round(performance.now() - tStart),
    },
  };
}
