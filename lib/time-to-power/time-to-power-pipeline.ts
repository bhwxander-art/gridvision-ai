/**
 * Time-to-Power repository-integrated pipeline — INFRA-015
 *
 * Operates on an EXISTING, already-completed ife_analyses record (same
 * pattern as Upgrade Analysis / INFRA-013): poi_bus_id, iso_id, project_type
 * and queued_at are all re-derived from that analysis rather than re-supplied
 * by the caller. Unlike Hosting Capacity / Upgrade Analysis, this pipeline
 * has NO dependency on NetworkRepository, PTDF, LODF, or DC power flow — it
 * only reads queue-domain data (QueueRepository, QueueAnalyticsRepository)
 * and the ife_analyses/ife_time_to_power tables (IfeRepository). There is no
 * topology-hash concept here, so no staleness class of error exists in this
 * pipeline.
 *
 * Idempotency: mirrors Upgrade Analysis's check-first pattern. An analysis
 * can have at most one ife_time_to_power row — analysisId is already the
 * natural dedup key, so no separate idempotency_key field or schema change
 * is needed.
 */

import "server-only";
import type { IfeRepository } from "@/lib/db/repositories/ife.repository";
import type { QueueRepository } from "@/lib/db/repositories/queue.repository";
import type { QueueAnalyticsRepository } from "@/lib/db/repositories/queue-analytics.repository";
import type { IfeAnalysis, IfeTimeToPower } from "@/lib/db/types-ife";
import { computeTimeToPower } from "./time-to-power-engine";
import type { TimeToPowerOptions } from "./types";

export interface TimeToPowerPipelineResult {
  analysis: IfeAnalysis;
  timeToPower: IfeTimeToPower;
  computeMs: number;
}

export async function computeAndPersistTimeToPower(
  tenantId: string,
  analysisId: string,
  ifeRepo: IfeRepository,
  queueRepo: QueueRepository,
  queueAnalyticsRepo: QueueAnalyticsRepository,
  options: TimeToPowerOptions = {}
): Promise<TimeToPowerPipelineResult> {
  const t0 = performance.now();

  const analysis = await ifeRepo.getAnalysis(tenantId, analysisId);
  if (!analysis) {
    throw new Error(`[TimeToPower] Analysis ${analysisId} not found for tenant ${tenantId}`);
  }

  const existingTimeToPower = await ifeRepo.getTimeToPowerByAnalysisId(tenantId, analysisId);
  if (existingTimeToPower) {
    return { analysis, timeToPower: existingTimeToPower, computeMs: Math.round(performance.now() - t0) };
  }

  if (analysis.status !== "completed") {
    throw new Error(
      `[TimeToPower] Analysis ${analysisId} is not completed (status: ${analysis.status}) ` +
        `— the analysis must finish successfully before time-to-power can be estimated`
    );
  }

  const [
    queueDepthByBus,
    narrowExecutedIaDurationsMonths,
    broadExecutedIaDurationsMonths,
    narrowCodDurationSamples,
    broadCodDurationSamples,
  ] = await Promise.all([
    queueRepo.getQueueDepthByBus(tenantId, analysis.isoId),
    queueAnalyticsRepo.getExecutedIaDurationSamples(tenantId, analysis.isoId, analysis.projectType),
    queueAnalyticsRepo.getExecutedIaDurationSamples(tenantId, analysis.isoId),
    queueAnalyticsRepo.getCodDurationSamples(tenantId, analysis.isoId, analysis.projectType),
    queueAnalyticsRepo.getCodDurationSamples(tenantId, analysis.isoId),
  ]);

  const activeQueueProjectsCount =
    queueDepthByBus.find((entry) => entry.poi_bus_id === analysis.poiBusId)?.depth ?? 0;

  const result = computeTimeToPower(
    {
      anchorDate: analysis.queuedAt,
      activeQueueProjectsCount,
      narrowExecutedIaDurationsMonths,
      broadExecutedIaDurationsMonths,
      narrowCodDurationSamples,
      broadCodDurationSamples,
    },
    options
  );

  const timeToPower = await ifeRepo.createTimeToPower({
    analysis_id: analysisId,
    tenant_id: tenantId,
    cod_p25: result.codP25,
    cod_p50: result.codP50,
    cod_p75: result.codP75,
    months_to_study_completion: result.monthsToStudyCompletion,
    active_queue_projects_count: result.activeQueueProjectsCount,
    // Cox PH survival model is out of scope for this deterministic engine (see spec §2) — always NULL.
    survival_12m: null,
    survival_24m: null,
    survival_36m: null,
  });

  return { analysis, timeToPower, computeMs: Math.round(performance.now() - t0) };
}
