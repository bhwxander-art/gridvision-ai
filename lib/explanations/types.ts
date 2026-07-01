/**
 * Explanations engine public types — INFRA-017
 *
 * Scope: a deterministic, template-based `assumptions` list only — see the
 * approved technical specification §2 for why baseline/predicted withdrawal
 * probability, withdrawal_shap_values, and cost_drivers all stay null/empty
 * (each requires a model or cost data that does not exist yet), and why
 * cox_model_version/cost_model_version stay null.
 *
 * No IfeExplanations domain (camelCase) type existed anywhere before this
 * ticket — unlike Time-to-Power/Confidence-Risk, whose domain types were
 * pre-declared in lib/db/types-ife.ts. Declared here rather than there, by
 * the same "don't grow the shared types file" convention established in
 * INFRA-015/016 — only the already-existing DbIfeExplanations/ShapValue row
 * types are reused from lib/db/types-ife.ts.
 */

import type { ShapValue } from "@/lib/db/types-ife";

export interface CostDriver {
  factor: string;
  impact_m: number;
  direction: string;
}

export interface IfeExplanations {
  id: string;
  analysisId: string;
  tenantId: string;
  baselineWithdrawalProb: number | null;
  predictedWithdrawalProb: number | null;
  withdrawalShapValues: ShapValue[];
  costDrivers: CostDriver[];
  assumptions: string[] | null;
  coxModelVersion: string | null;
  costModelVersion: string | null;
  computedAt: string;
}

export interface ExplanationsResult {
  baselineWithdrawalProb: number | null;
  predictedWithdrawalProb: number | null;
  withdrawalShapValues: ShapValue[];
  costDrivers: CostDriver[];
  /** Always emitted in a fixed, deterministic topic order — see explanations-engine.ts. */
  assumptions: string[];
  coxModelVersion: string | null;
  costModelVersion: string | null;
  computedAt: string;
}
