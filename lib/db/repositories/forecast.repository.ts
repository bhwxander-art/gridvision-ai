import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbForecastRun, DbForecastRunInsert } from "@/lib/db/types";
import type { ForecastInputs, ForecastResult } from "@/lib/forecast";

// ── Typed forecast run record ─────────────────────────────────────────────────

export interface ForecastRunRecord {
  id: number;
  territoryId: string;
  runAt: string;
  horizonYears: 3 | 5 | 10;
  inputs: ForecastInputs;
  result: ForecastResult;
  modelVersion: string;
  source: string;
}

// ── Row → domain mapper (pure) ────────────────────────────────────────────────

function toForecastRun(row: DbForecastRun): ForecastRunRecord {
  return {
    id: row.id,
    territoryId: row.territory_id,
    runAt: row.run_at,
    horizonYears: row.horizon_years,
    inputs: row.inputs as unknown as ForecastInputs,
    result: row.result as unknown as ForecastResult,
    modelVersion: row.model_version,
    source: row.source,
  };
}

// ── Repository class ──────────────────────────────────────────────────────────

export class ForecastRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Persists a forecast run to the audit log.
   * The insert is fire-and-forget from the planner's perspective —
   * the run result is returned immediately and logged asynchronously.
   */
  async saveRun(
    run: Omit<ForecastRunRecord, "id">
  ): Promise<void> {
    const insert: DbForecastRunInsert = {
      territory_id: run.territoryId,
      run_at: run.runAt,
      horizon_years: run.horizonYears,
      inputs: run.inputs as unknown as Record<string, unknown>,
      result: run.result as unknown as Record<string, unknown>,
      model_version: run.modelVersion,
      source: run.source,
    };

    const { error } = await this.client
      .from("forecast_runs")
      .insert(insert);

    if (error) throw new Error(`[ForecastRepository.saveRun] ${error.message}`);
  }

  /**
   * Returns the most recent forecast run for a territory.
   * Returns null when no runs exist yet.
   */
  async getLatest(
    territoryId = "eastern-ma"
  ): Promise<ForecastRunRecord | null> {
    const { data, error } = await this.client
      .from("forecast_runs")
      .select("*")
      .eq("territory_id", territoryId)
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`[ForecastRepository.getLatest] ${error.message}`);
    if (!data) return null;
    return toForecastRun(data as DbForecastRun);
  }

  /**
   * Returns the N most recent forecast runs for a territory.
   * Useful for building a run-history view for planners.
   */
  async listRuns(
    territoryId = "eastern-ma",
    limit = 20
  ): Promise<ForecastRunRecord[]> {
    const { data, error } = await this.client
      .from("forecast_runs")
      .select("*")
      .eq("territory_id", territoryId)
      .order("run_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`[ForecastRepository.listRuns] ${error.message}`);
    return (data as DbForecastRun[]).map(toForecastRun);
  }

  /**
   * Counts total forecast runs for a territory.
   * Used by the planning dashboard to show run frequency.
   */
  async countRuns(territoryId = "eastern-ma"): Promise<number> {
    const { count, error } = await this.client
      .from("forecast_runs")
      .select("id", { count: "exact", head: true })
      .eq("territory_id", territoryId);

    if (error) throw new Error(`[ForecastRepository.countRuns] ${error.message}`);
    return count ?? 0;
  }
}
