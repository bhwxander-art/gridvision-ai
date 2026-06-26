import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbIsoLoadForecast, DbIsoLoadForecastInsert } from "@/lib/db/types";
import type { ForecastPoint } from "@/lib/forecasting/model";

export interface IsoForecastRecord {
  id: string;
  forecastFor: string;
  predictedLoadMW: number;
  confidenceLowMW: number;
  confidenceHighMW: number;
  modelType: string;
  modelVersion: string;
  generatedAt: string;
}

// Map DB row → domain record
function toRecord(row: DbIsoLoadForecast): IsoForecastRecord {
  return {
    id: row.id,
    forecastFor: row.forecast_for,
    predictedLoadMW: row.predicted_load_mw,
    confidenceLowMW: row.confidence_low_mw,
    confidenceHighMW: row.confidence_high_mw,
    modelType: row.model_type,
    modelVersion: row.model_version,
    generatedAt: row.generated_at,
  };
}

export class IsoForecastRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Upsert a batch of forecast points (idempotent by forecast_for + model_version)
   */
  async saveBatch(points: ForecastPoint[]): Promise<void> {
    if (points.length === 0) return;

    const rows: DbIsoLoadForecastInsert[] = points.map((p) => ({
      forecast_for: p.forecastFor.toISOString(),
      predicted_load_mw: p.predictedLoadMW,
      confidence_low_mw: p.confidenceLowMW,
      confidence_high_mw: p.confidenceHighMW,
      model_type: p.modelType,
      model_version: p.modelVersion,
    }));

    const { error } = await this.client
      .from("iso_load_forecasts")
      .upsert(rows, { onConflict: "forecast_for,model_version" });

    if (error) {
      throw new Error(`[IsoForecastRepository.saveBatch] ${error.message}`);
    }
  }

  /**
   * Get forecasts for the next N hours from now
   */
  async getUpcoming(hours = 24): Promise<IsoForecastRecord[]> {
    const now = new Date().toISOString();
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.client
      .from("iso_load_forecasts")
      .select("*")
      .gte("forecast_for", now)
      .lte("forecast_for", until)
      .order("forecast_for", { ascending: true });

    if (error) {
      throw new Error(`[IsoForecastRepository.getUpcoming] ${error.message}`);
    }

    return (data ?? []).map((row) => toRecord(row as DbIsoLoadForecast));
  }

  /**
   * Get forecasts generated in the last N days
   */
  async getRecentHistory(days = 7): Promise<IsoForecastRecord[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.client
      .from("iso_load_forecasts")
      .select("*")
      .gte("generated_at", since)
      .order("forecast_for", { ascending: true });

    if (error) {
      throw new Error(`[IsoForecastRepository.getRecentHistory] ${error.message}`);
    }

    return (data ?? []).map((row) => toRecord(row as DbIsoLoadForecast));
  }

  /**
   * Count total stored forecast points
   */
  async getCount(): Promise<number> {
    const { count, error } = await this.client
      .from("iso_load_forecasts")
      .select("*", { count: "exact", head: true });

    if (error) {
      throw new Error(`[IsoForecastRepository.getCount] ${error.message}`);
    }

    return count ?? 0;
  }

  /**
   * Get past forecasts joined with actuals for accuracy calculation.
   * Returns records where forecast_for < now AND iso_load_history has actual for same timestamp.
   * Uses ±1 minute tolerance for timestamp matching.
   */
  async getCompletedForecasts(
    days = 30
  ): Promise<Array<{ forecastFor: string; predictedLoadMW: number; actualLoadMW: number }>> {
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    // 1. Query forecasts that are in the past
    const { data: forecastData, error: forecastError } = await this.client
      .from("iso_load_forecasts")
      .select("forecast_for, predicted_load_mw")
      .gte("forecast_for", since)
      .lt("forecast_for", nowIso)
      .order("forecast_for", { ascending: true });

    if (forecastError) {
      throw new Error(
        `[IsoForecastRepository.getCompletedForecasts] forecasts: ${forecastError.message}`
      );
    }

    if (!forecastData || forecastData.length === 0) return [];

    // 2. Query actual load history for same time range
    const { data: actualData, error: actualError } = await this.client
      .from("iso_load_history")
      .select("timestamp, actual_load_mw")
      .gte("timestamp", since)
      .lt("timestamp", nowIso)
      .order("timestamp", { ascending: true });

    if (actualError) {
      throw new Error(
        `[IsoForecastRepository.getCompletedForecasts] actuals: ${actualError.message}`
      );
    }

    if (!actualData || actualData.length === 0) return [];

    // 3. Join in JavaScript with ±1 minute tolerance
    const TOLERANCE_MS = 60 * 1000; // 1 minute

    const actuals = actualData as Array<{ timestamp: string; actual_load_mw: number }>;
    const forecasts = forecastData as Array<{ forecast_for: string; predicted_load_mw: number }>;

    const results: Array<{ forecastFor: string; predictedLoadMW: number; actualLoadMW: number }> =
      [];

    for (const forecast of forecasts) {
      const forecastMs = new Date(forecast.forecast_for).getTime();
      const match = actuals.find(
        (a) => Math.abs(new Date(a.timestamp).getTime() - forecastMs) <= TOLERANCE_MS
      );
      if (match) {
        results.push({
          forecastFor: forecast.forecast_for,
          predictedLoadMW: forecast.predicted_load_mw,
          actualLoadMW: match.actual_load_mw,
        });
      }
    }

    return results;
  }
}
