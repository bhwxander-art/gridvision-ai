/**
 * ife_time_to_power insert validation — INFRA-015
 *
 * Kept in this feature module rather than lib/db/types-ife.ts (see
 * mappers.ts for why). Reuses the existing, unmodified IfeValidationError
 * class from types-ife.ts so API-layer error handling keeps using the same
 * instanceof check already established for Hosting Capacity / Upgrade
 * Analysis validation errors.
 */

import { IfeValidationError, type DbIfeTimeToPowerInsert } from "@/lib/db/types-ife";

export function validateIfeTimeToPowerInsert(insert: DbIfeTimeToPowerInsert): void {
  if (
    insert.cod_p25 != null &&
    insert.cod_p50 != null &&
    insert.cod_p25 > insert.cod_p50
  ) {
    throw new IfeValidationError("cod_p25 must be on or before cod_p50", "cod_p25");
  }
  if (
    insert.cod_p50 != null &&
    insert.cod_p75 != null &&
    insert.cod_p50 > insert.cod_p75
  ) {
    throw new IfeValidationError("cod_p50 must be on or before cod_p75", "cod_p50");
  }
  if (insert.months_to_study_completion != null && insert.months_to_study_completion < 0) {
    throw new IfeValidationError(
      "months_to_study_completion must be non-negative",
      "months_to_study_completion"
    );
  }
  if (insert.active_queue_projects_count != null && insert.active_queue_projects_count < 0) {
    throw new IfeValidationError(
      "active_queue_projects_count must be non-negative",
      "active_queue_projects_count"
    );
  }
  for (const [field, value] of [
    ["survival_12m", insert.survival_12m],
    ["survival_24m", insert.survival_24m],
    ["survival_36m", insert.survival_36m],
  ] as const) {
    if (value != null && (value < 0 || value > 1)) {
      throw new IfeValidationError(`${field} must be between 0 and 1`, field);
    }
  }
}
