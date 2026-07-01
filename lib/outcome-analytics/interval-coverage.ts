/**
 * Interval coverage comparisons — INFRA-021
 *
 * Pure functions only: no I/O, no modeling, no probability estimation. Each
 * function returns null whenever any of its three inputs is unavailable —
 * "not yet computable" is a legitimate, distinct outcome from both true and
 * false, and must never be conflated with either.
 *
 * Date fields (actualCod, codP25, codP75) are compared as plain strings.
 * This is valid without any date-parsing dependency because ife_time_to_power
 * and ife_outcome_tracking's DATE columns both round-trip through the
 * existing mappers as unmodified "YYYY-MM-DD" strings (lib/time-to-power/
 * mappers.ts, lib/outcome-tracking/mappers.ts) — a format that sorts
 * correctly under plain lexical (>=, <=) comparison.
 */

/** Inclusive bounds: actualCostM in [costP10M, costP90M]. */
export function computeWithinCostP10P90(
  actualCostM: number | null,
  costP10M: number | null,
  costP90M: number | null
): boolean | null {
  if (actualCostM == null || costP10M == null || costP90M == null) return null;
  return actualCostM >= costP10M && actualCostM <= costP90M;
}

/** Inclusive bounds: actualCod in [codP25, codP75]. */
export function computeWithinCodP25P75(
  actualCod: string | null,
  codP25: string | null,
  codP75: string | null
): boolean | null {
  if (actualCod == null || codP25 == null || codP75 == null) return null;
  return actualCod >= codP25 && actualCod <= codP75;
}
