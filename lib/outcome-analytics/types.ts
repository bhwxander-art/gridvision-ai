/**
 * Outcome Analytics types — INFRA-021
 *
 * IfeOutcomeTracking itself is reused directly from lib/outcome-tracking/types.ts
 * everywhere it's needed (pipeline, repository, route) rather than redeclared
 * here — per the approved architecture review, avoiding a second, potentially
 * drifting copy of that type (the exact failure mode the INFRA-020 review
 * caught with a duplicate IfeScenarioValidationError).
 *
 * OutcomeAnalyticsPatch is the only genuinely new shape this ticket
 * introduces: a partial update payload so the repository only ever writes
 * the field(s) that were newly resolved, never re-sending an already-
 * populated value.
 */

export interface OutcomeAnalyticsPatch {
  withinCostP10P90?: boolean;
  withinCodP25P75?: boolean;
}
