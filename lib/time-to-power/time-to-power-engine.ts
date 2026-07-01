/**
 * Time-to-Power engine — INFRA-015
 *
 * Pure computation only (no I/O): empirical nearest-rank percentile
 * estimation over historical queue durations. This is the one genuinely new
 * algorithm introduced by INFRA-015 (unlike INFRA-014, which added no
 * algorithm, and INFRA-012/013, which reuse PTDF/LODF closed-form algebra)
 * — see the approved technical specification §5 for the full rationale.
 *
 * Cohort fallback ladder (per metric, independently):
 *   1. narrow cohort (same iso_id + project_type) if it has >= minSampleSize
 *      samples after filtering out negative-duration data-quality outliers
 *   2. else the broad cohort (same iso_id, any project_type) under the same
 *      threshold
 *   3. else "insufficient_data" — the metric is left null rather than
 *      approximated from too few points or a fabricated default
 *
 * Only observed, completed outcomes are ever used as samples (rows already
 * filtered to to_status='executed_ia' / current_status='in_service' by the
 * repository layer) — no censored/in-progress data is mixed in, since doing
 * so without a proper survival model would silently bias the estimate.
 */

import { monthsBetween } from "@/lib/db/types-queue";
import {
  DEFAULT_MIN_SAMPLE_SIZE,
  type TimeToPowerCohort,
  type TimeToPowerOptions,
  type TimeToPowerResult,
} from "./types";
import type { CodDurationSample } from "@/lib/db/repositories/queue-analytics.repository";

/** Sorts ascending and returns the nearest-rank percentile (p in [0,1]). Monotonic in p by construction. */
export function nearestRankPercentile(samples: number[], p: number): number {
  if (samples.length === 0) {
    throw new Error("[nearestRankPercentile] samples must be non-empty");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

/** Filters out negative-duration data-quality outliers (e.g. bad backfilled dates). */
function cleanSamples(samples: number[]): number[] {
  return samples.filter((v) => Number.isFinite(v) && v >= 0);
}

function selectCohort(
  narrow: number[],
  broad: number[],
  minSampleSize: number
): { samples: number[]; cohort: TimeToPowerCohort } {
  const cleanNarrow = cleanSamples(narrow);
  if (cleanNarrow.length >= minSampleSize) return { samples: cleanNarrow, cohort: "project_type" };

  const cleanBroad = cleanSamples(broad);
  if (cleanBroad.length >= minSampleSize) return { samples: cleanBroad, cohort: "iso_wide" };

  return { samples: [], cohort: "insufficient_data" };
}

/** Adds a whole number of months to a "YYYY-MM-DD" date string, in UTC. */
function addMonths(dateOnly: string, months: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Math.round(months));
  return d.toISOString().slice(0, 10);
}

export interface TimeToPowerInputs {
  /** ISO date or timestamp; only the date portion is used. */
  anchorDate: string;
  activeQueueProjectsCount: number;
  narrowExecutedIaDurationsMonths: number[];
  broadExecutedIaDurationsMonths: number[];
  narrowCodDurationSamples: CodDurationSample[];
  broadCodDurationSamples: CodDurationSample[];
}

export function computeTimeToPower(
  inputs: TimeToPowerInputs,
  options: TimeToPowerOptions = {}
): TimeToPowerResult {
  const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
  const anchorDateOnly = inputs.anchorDate.slice(0, 10);

  // ── months_to_study_completion ────────────────────────────────────────────
  const studyCompletion = selectCohort(
    inputs.narrowExecutedIaDurationsMonths,
    inputs.broadExecutedIaDurationsMonths,
    minSampleSize
  );
  const monthsToStudyCompletion =
    studyCompletion.samples.length > 0 ? nearestRankPercentile(studyCompletion.samples, 0.5) : null;

  // ── cod_p25 / cod_p50 / cod_p75 ────────────────────────────────────────────
  const narrowCodDurations = inputs.narrowCodDurationSamples.map((s) =>
    monthsBetween(s.queueDate, s.actualCod)
  );
  const broadCodDurations = inputs.broadCodDurationSamples.map((s) =>
    monthsBetween(s.queueDate, s.actualCod)
  );
  const cod = selectCohort(narrowCodDurations, broadCodDurations, minSampleSize);

  const codP25 = cod.samples.length > 0 ? addMonths(anchorDateOnly, nearestRankPercentile(cod.samples, 0.25)) : null;
  const codP50 = cod.samples.length > 0 ? addMonths(anchorDateOnly, nearestRankPercentile(cod.samples, 0.5)) : null;
  const codP75 = cod.samples.length > 0 ? addMonths(anchorDateOnly, nearestRankPercentile(cod.samples, 0.75)) : null;

  return {
    activeQueueProjectsCount: inputs.activeQueueProjectsCount,
    monthsToStudyCompletion,
    codP25,
    codP50,
    codP75,
    studyCompletionCohort: studyCompletion.cohort,
    codCohort: cod.cohort,
    computedAt: new Date().toISOString(),
  };
}
