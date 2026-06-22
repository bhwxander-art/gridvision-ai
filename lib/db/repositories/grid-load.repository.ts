import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbGridLoadReading, DbGridLoadInsert } from "@/lib/db/types";
import type { GridLoad } from "@/lib/types";

// ── Row → domain mapper (pure) ────────────────────────────────────────────────

function toGridLoad(row: DbGridLoadReading): GridLoad {
  return {
    source: row.source,
    currentLoadMW: Number(row.load_mw),
    timestamp: row.recorded_at,
  };
}

// ── Repository class ──────────────────────────────────────────────────────────

export class GridLoadRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Appends a new load reading to the history table.
   * Silently skips duplicate (territory + source + interval + timestamp) rows.
   */
  async insertReading(reading: DbGridLoadInsert): Promise<void> {
    const { error } = await this.client
      .from("grid_load_history")
      .upsert(reading, {
        onConflict: "territory_id,source,interval_min,recorded_at",
        ignoreDuplicates: true,
      });

    if (error) throw new Error(`[GridLoadRepository.insertReading] ${error.message}`);
  }

  /**
   * Returns the most recent load reading for the given territory.
   * Returns null when the history table is empty.
   */
  async getLatest(
    territoryId = "eastern-ma"
  ): Promise<GridLoad | null> {
    const { data, error } = await this.client
      .from("grid_load_history")
      .select("*")
      .eq("territory_id", territoryId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`[GridLoadRepository.getLatest] ${error.message}`);
    if (!data) return null;
    return toGridLoad(data as DbGridLoadReading);
  }

  /**
   * Returns the most recent N readings for the given territory,
   * sorted newest-first.  Useful for sparklines and trend calculations.
   */
  async getHistory(
    territoryId = "eastern-ma",
    limit = 96                           // 96 hourly readings = 4 days
  ): Promise<GridLoad[]> {
    const { data, error } = await this.client
      .from("grid_load_history")
      .select("*")
      .eq("territory_id", territoryId)
      .order("recorded_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`[GridLoadRepository.getHistory] ${error.message}`);
    return (data as DbGridLoadReading[]).map(toGridLoad);
  }

  /**
   * Returns readings in a time window (inclusive on both ends).
   */
  async getRange(
    territoryId: string,
    from: Date,
    to: Date
  ): Promise<GridLoad[]> {
    const { data, error } = await this.client
      .from("grid_load_history")
      .select("*")
      .eq("territory_id", territoryId)
      .gte("recorded_at", from.toISOString())
      .lte("recorded_at", to.toISOString())
      .order("recorded_at", { ascending: true });

    if (error) throw new Error(`[GridLoadRepository.getRange] ${error.message}`);
    return (data as DbGridLoadReading[]).map(toGridLoad);
  }
}
