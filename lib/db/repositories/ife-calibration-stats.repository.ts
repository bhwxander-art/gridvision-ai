/**
 * IFE calibration stats repository — INFRA-022
 *
 * A single, read-only, tenant-scoped aggregate query over ife_outcome_tracking's
 * within_cost_p10_p90/within_cod_p25_p75 coverage flags (INFRA-021). This is a
 * new, dedicated repository rather than an extension of IfeRepository —
 * IfeRepository's own docstring (lib/db/repositories/ife.repository.ts) still
 * explicitly disclaims ife_outcome_tracking ("belongs to its own future ticket
 * with its own repository") — and rather than an extension of
 * IfeOutcomeTrackingRepository/IfeOutcomeAnalyticsRepository, both of which are
 * narrowly and deliberately scoped to their own, different responsibilities
 * (create+read-only immutable persistence, and a two-column guarded UPDATE,
 * respectively).
 *
 * No new schema: the query reads only pre-existing columns, and the existing
 * SELECT RLS policy on ife_outcome_tracking (migration 015) already covers it.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoverageStats } from "@/lib/confidence-risk/types";

interface CoverageRow {
  within_cost_p10_p90: boolean | null;
  within_cod_p25_p75: boolean | null;
}

/**
 * sampleSize = count(non-null values); coverageRate = trueCount / sampleSize.
 * NULL values contribute to neither the numerator nor the denominator. When
 * sampleSize is 0, coverageRate is null — never 0 — since 0 is only a
 * meaningful coverage rate when there was at least one observation to rate.
 */
function aggregate(values: Array<boolean | null>): { coverageRate: number | null; sampleSize: number } {
  const nonNull = values.filter((v): v is boolean => v !== null);
  const sampleSize = nonNull.length;
  if (sampleSize === 0) return { coverageRate: null, sampleSize: 0 };
  const trueCount = nonNull.filter((v) => v === true).length;
  return { coverageRate: trueCount / sampleSize, sampleSize };
}

export class IfeCalibrationStatsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getCoverageStats(tenantId: string): Promise<CoverageStats> {
    const { data, error } = await this.client
      .from("ife_outcome_tracking")
      .select("within_cost_p10_p90, within_cod_p25_p75")
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[IfeCalibrationStatsRepository.getCoverageStats] ${error.message}`);

    const rows = (data ?? []) as CoverageRow[];
    const cost = aggregate(rows.map((r) => r.within_cost_p10_p90));
    const cod = aggregate(rows.map((r) => r.within_cod_p25_p75));

    return {
      costCoverageRate: cost.coverageRate,
      costSampleSize: cost.sampleSize,
      codCoverageRate: cod.coverageRate,
      codSampleSize: cod.sampleSize,
    };
  }
}
