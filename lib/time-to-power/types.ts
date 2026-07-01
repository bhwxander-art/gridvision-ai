/**
 * Time-to-Power engine public types — INFRA-015
 *
 * Scope: deterministic, empirically-derived time-to-power estimates only
 * (the fields populated in ife_time_to_power — see supabase/migrations/
 * 015_ife_schema.sql). survival_12m/24m/36m (the Cox proportional-hazards
 * model output) are explicitly out of scope and are persisted as NULL —
 * computing them requires trained survival-model infrastructure that does
 * not exist yet (tracked, per queue_project_status_history's own docstring,
 * as future work against that table).
 */

export const DEFAULT_MIN_SAMPLE_SIZE = 5;

export type TimeToPowerCohort = "project_type" | "iso_wide" | "insufficient_data";

export interface TimeToPowerOptions {
  /** Minimum historical sample count required to report a percentile. Default 5. */
  minSampleSize?: number;
}

export interface TimeToPowerResult {
  activeQueueProjectsCount: number;
  monthsToStudyCompletion: number | null;
  codP25: string | null; // "YYYY-MM-DD"
  codP50: string | null;
  codP75: string | null;
  /** Which cohort actually satisfied minSampleSize for each metric — not persisted (no schema column), reported for observability/testing only. */
  studyCompletionCohort: TimeToPowerCohort;
  codCohort: TimeToPowerCohort;
  computedAt: string;
}
