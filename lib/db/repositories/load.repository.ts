import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface IsoLoadRecord {
  id: string;
  timestamp: string;
  actual_load_mw: number;
  forecast_load_mw: number;
  created_at: string;
}

export interface LoadSnapshot {
  currentLoadMW: number;
  forecastLoadMW: number;
  timestamp: string;
}

export class LoadRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Get the most recent load reading from iso_load_history
   */
  async getCurrent(): Promise<LoadSnapshot | null> {
    const { data, error } = await this.client
      .from("iso_load_history")
      .select("timestamp, actual_load_mw, forecast_load_mw")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`[LoadRepository.getCurrent] ${error.message}`);
    if (!data) return null;

    return {
      currentLoadMW: Number(data.actual_load_mw),
      forecastLoadMW: Number(data.forecast_load_mw),
      timestamp: data.timestamp,
    };
  }

  /**
   * Get the last N hours of load history
   */
  async getHistory(hours: number = 24): Promise<LoadSnapshot[]> {
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);

    const { data, error } = await this.client
      .from("iso_load_history")
      .select("timestamp, actual_load_mw, forecast_load_mw")
      .gte("timestamp", from.toISOString())
      .order("timestamp", { ascending: true });

    if (error) throw new Error(`[LoadRepository.getHistory] ${error.message}`);
    if (!data) return [];

    return data.map((row: any) => ({
      currentLoadMW: Number(row.actual_load_mw),
      forecastLoadMW: Number(row.forecast_load_mw),
      timestamp: row.timestamp,
    }));
  }

  /**
   * Upsert a load reading
   */
  async upsert(
    timestamp: string,
    actualLoadMW: number,
    forecastLoadMW: number
  ): Promise<void> {
    const { error } = await this.client
      .from("iso_load_history")
      .upsert(
        {
          timestamp,
          actual_load_mw: actualLoadMW,
          forecast_load_mw: forecastLoadMW,
        },
        { onConflict: "timestamp" }
      );

    if (error) throw new Error(`[LoadRepository.upsert] ${error.message}`);
  }

  /**
   * Get total record count in the table
   */
  async getCount(): Promise<number> {
    const { count, error } = await this.client
      .from("iso_load_history")
      .select("*", { count: "exact", head: true });

    if (error) throw new Error(`[LoadRepository.getCount] ${error.message}`);
    return count ?? 0;
  }
}
