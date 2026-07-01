/**
 * ife_time_to_power row -> domain mapper — INFRA-015
 *
 * Kept in this feature module rather than lib/db/types-ife.ts by explicit
 * instruction: types-ife.ts already declares DbIfeTimeToPower/IfeTimeToPower
 * (written when the shared types file was originally authored) and is not to
 * grow further — only the mapper/validation *functions* live here.
 */

import type { DbIfeTimeToPower, IfeTimeToPower } from "@/lib/db/types-ife";

export function toIfeTimeToPower(row: DbIfeTimeToPower): IfeTimeToPower {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    tenantId: row.tenant_id,
    codP25: row.cod_p25,
    codP50: row.cod_p50,
    codP75: row.cod_p75,
    monthsToStudyCompletion: row.months_to_study_completion,
    activeQueueProjectsCount: row.active_queue_projects_count,
    survival12m: row.survival_12m != null ? Number(row.survival_12m) : null,
    survival24m: row.survival_24m != null ? Number(row.survival_24m) : null,
    survival36m: row.survival_36m != null ? Number(row.survival_36m) : null,
    computedAt: row.computed_at,
  };
}
