/**
 * ife_explanations insert validation — INFRA-017
 *
 * Kept in this feature module rather than lib/db/types-ife.ts (see
 * mappers.ts for why). Reuses the existing, unmodified IfeValidationError
 * class from types-ife.ts, mirroring the DB's ife_exp_baseline_range /
 * ife_exp_predicted_range CHECK constraints with a friendlier app-level
 * error before the insert ever reaches the database.
 */

import { IfeValidationError, type DbIfeExplanationsInsert } from "@/lib/db/types-ife";

export function validateIfeExplanationsInsert(insert: DbIfeExplanationsInsert): void {
  if (
    insert.baseline_withdrawal_prob != null &&
    (insert.baseline_withdrawal_prob < 0 || insert.baseline_withdrawal_prob > 1)
  ) {
    throw new IfeValidationError(
      "baseline_withdrawal_prob must be between 0 and 1",
      "baseline_withdrawal_prob"
    );
  }
  if (
    insert.predicted_withdrawal_prob != null &&
    (insert.predicted_withdrawal_prob < 0 || insert.predicted_withdrawal_prob > 1)
  ) {
    throw new IfeValidationError(
      "predicted_withdrawal_prob must be between 0 and 1",
      "predicted_withdrawal_prob"
    );
  }
}
