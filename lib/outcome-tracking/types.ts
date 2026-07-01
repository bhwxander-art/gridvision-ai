/**
 * Outcome Tracking domain types — INFRA-020
 *
 * No domain (camelCase) type for ife_outcome_tracking existed anywhere before
 * this ticket — only the Db-row types (DbIfeOutcomeTracking/Insert) were
 * pre-declared in lib/db/types-ife.ts from migration 015. This module holds
 * the domain type fresh, mirroring the placement convention established by
 * Time-to-Power/Confidence-Risk/Explanations (INFRA-015/016/017): new
 * mappers/validators for a child table live in their own feature module,
 * not by growing types-ife.ts further.
 *
 * INFRA-020 is a pure persistence/read feature — nothing here is computed.
 * within_cost_p10_p90 / within_cod_p25_p75 are always persisted as null
 * (deferred to a future analytics milestone, per the approved spec); the
 * only derived values (cost_residual_m, cod_residual_months) come from the
 * existing BEFORE INSERT database trigger (migration 015).
 */

export interface IfeOutcomeTracking {
  id: string;
  analysisId: string;
  tenantId: string;
  queueProjectId: string | null;
  actualCostM: number | null;
  actualCod: string | null;
  actualFeasible: boolean | null;
  actualWithdrawn: boolean | null;
  outcomeObservedAt: string | null;
  costResidualM: number | null;
  codResidualMonths: number | null;
  withinCostP10P90: boolean | null;
  withinCodP25P75: boolean | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST request body. Every field is optional since not all outcome data may
 * be known yet at submission time — but this is a one-shot submission, not
 * an incremental one: POST is resource-idempotent (analysisId is the key),
 * so only the FIRST successful POST for a given analysis is ever persisted;
 * every later POST to that same analysisId returns that first record
 * unchanged, regardless of what fields the later call supplies. There is no
 * update path (historical records are immutable, per the approved spec) —
 * callers must submit every currently-known field together on the first call.
 */
export interface OutcomeTrackingRequest {
  queueProjectId?: string | null;
  actualCostM?: number | null;
  actualCod?: string | null;
  actualFeasible?: boolean | null;
  actualWithdrawn?: boolean | null;
  outcomeObservedAt?: string | null;
  notes?: string | null;
}
