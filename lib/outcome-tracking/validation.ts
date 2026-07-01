/**
 * ife_outcome_tracking insert validation — INFRA-020
 *
 * Kept in this feature module rather than lib/db/types-ife.ts (see
 * mappers.ts for why). Reuses the existing, unmodified IfeValidationError
 * class from types-ife.ts rather than declaring a new one.
 *
 * Deliberately minimal: this is a pure persistence feature with no
 * calculation of its own, so there is nothing to validate beyond basic
 * numeric sanity on actual_cost_m — matching the "no calculations beyond
 * the existing database-generated residual fields" boundary in the
 * approved spec. cost_residual_m/cod_residual_months are excluded from
 * DbIfeOutcomeTrackingInsert entirely (the BEFORE INSERT trigger owns
 * them), so there is nothing to check for those here.
 */

import { IfeValidationError, type DbIfeOutcomeTrackingInsert } from "@/lib/db/types-ife";

export function validateIfeOutcomeTrackingInsert(insert: DbIfeOutcomeTrackingInsert): void {
  if (insert.actual_cost_m != null && !Number.isFinite(insert.actual_cost_m)) {
    throw new IfeValidationError("actual_cost_m must be a finite number", "actual_cost_m");
  }
}
