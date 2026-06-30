/**
 * Time-Series Repository (INFRA-007)
 *
 * Append-only CRUD layer for the five TimescaleDB hypertables introduced
 * in INFRA-003 (migration 014):
 *   scada_readings · lmp_prices · generator_output
 *   weather_observations · ami_interval_data
 *
 * Design notes:
 *   - All writes are bulk-insert only (hypertables are append-only in our
 *     schema; rows are never updated).
 *   - Reads always include tenant_id so multi-tenant isolation is enforced
 *     even when the service-role key bypasses RLS.
 *   - Batch size capped at BATCH_SIZE rows to stay under PostgREST limits.
 *   - LMP hourly aggregates are read from the `lmp_hourly` continuous
 *     aggregate materialized view (much faster than scanning raw rows).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateScadaReading,
  validateLmpPrice,
  validateGeneratorOutput,
  validateAmiInterval,
  toScadaReading,
  toLmpPrice,
  TimeSeriesValidationError,
} from "@/lib/db/types-timeseries";
import type {
  DbScadaReading,
  DbScadaReadingInsert,
  DbLmpPrice,
  DbLmpPriceInsert,
  DbLmpHourly,
  DbGeneratorOutput,
  DbGeneratorOutputInsert,
  DbWeatherObservation,
  DbWeatherObservationInsert,
  DbAmiInterval,
  DbAmiIntervalInsert,
  ScadaReading,
  LmpPrice,
  MarketType,
  MeasurementType,
} from "@/lib/db/types-timeseries";

export { TimeSeriesValidationError };

const BATCH_SIZE = 500;

// ── Time-range helper ─────────────────────────────────────────────────────────

export interface TimeRange {
  from: string; // ISO 8601
  to: string;   // ISO 8601
}

// ── Repository ────────────────────────────────────────────────────────────────

export class TimeSeriesRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── scada_readings ──────────────────────────────────────────────────────────

  /**
   * Insert a batch of SCADA readings.
   * Returns the number of rows inserted (after validation).
   */
  async insertScadaBatch(rows: DbScadaReadingInsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    rows.forEach(validateScadaReading);

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error } = await this.client.from("scada_readings").insert(chunk);
      if (error) {
        throw new Error(
          `[TimeSeriesRepository.insertScadaBatch] chunk ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`
        );
      }
      inserted += chunk.length;
    }
    return inserted;
  }

  /**
   * Query SCADA readings for a bus within a time window.
   */
  async queryScadaByBus(
    tenantId: string,
    busId: string,
    range: TimeRange,
    measurementType?: MeasurementType
  ): Promise<ScadaReading[]> {
    let q = this.client
      .from("scada_readings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("bus_id", busId)
      .gte("ts", range.from)
      .lte("ts", range.to);

    if (measurementType) {
      q = q.eq("measurement_type", measurementType);
    }

    const { data, error } = await q.order("ts", { ascending: true });
    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryScadaByBus] ${error.message}`
      );
    }
    return (data as DbScadaReading[]).map(toScadaReading);
  }

  /**
   * Query SCADA readings for a branch within a time window.
   */
  async queryScadaByBranch(
    tenantId: string,
    branchId: string,
    range: TimeRange,
    measurementType?: MeasurementType
  ): Promise<ScadaReading[]> {
    let q = this.client
      .from("scada_readings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .gte("ts", range.from)
      .lte("ts", range.to);

    if (measurementType) {
      q = q.eq("measurement_type", measurementType);
    }

    const { data, error } = await q.order("ts", { ascending: true });
    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryScadaByBranch] ${error.message}`
      );
    }
    return (data as DbScadaReading[]).map(toScadaReading);
  }

  /**
   * Delete all SCADA readings for a tenant within a time window.
   * Used to replay/replace data for a given interval.
   */
  async deleteScadaRange(tenantId: string, range: TimeRange): Promise<void> {
    const { error } = await this.client
      .from("scada_readings")
      .delete()
      .eq("tenant_id", tenantId)
      .gte("ts", range.from)
      .lte("ts", range.to);

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.deleteScadaRange] ${error.message}`
      );
    }
  }

  // ── lmp_prices ──────────────────────────────────────────────────────────────

  /**
   * Insert a batch of LMP price rows.
   */
  async insertLmpBatch(rows: DbLmpPriceInsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    rows.forEach(validateLmpPrice);

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error } = await this.client.from("lmp_prices").insert(chunk);
      if (error) {
        throw new Error(
          `[TimeSeriesRepository.insertLmpBatch] chunk ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`
        );
      }
      inserted += chunk.length;
    }
    return inserted;
  }

  /**
   * Query raw LMP prices for a pricing node within a time window.
   */
  async queryLmpByPnode(
    tenantId: string,
    isoId: string,
    pnodeId: string,
    range: TimeRange,
    marketType?: MarketType
  ): Promise<LmpPrice[]> {
    let q = this.client
      .from("lmp_prices")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .eq("pnode_id", pnodeId)
      .gte("ts", range.from)
      .lte("ts", range.to);

    if (marketType) {
      q = q.eq("market_type", marketType);
    }

    const { data, error } = await q.order("ts", { ascending: true });
    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryLmpByPnode] ${error.message}`
      );
    }
    return (data as DbLmpPrice[]).map(toLmpPrice);
  }

  /**
   * Query hourly LMP aggregates from the continuous aggregate view.
   * Much faster than scanning raw 5-minute rows for historical analysis.
   */
  async queryLmpHourly(
    tenantId: string,
    isoId: string,
    pnodeId: string,
    range: TimeRange,
    marketType?: MarketType
  ): Promise<DbLmpHourly[]> {
    let q = this.client
      .from("lmp_hourly")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .eq("pnode_id", pnodeId)
      .gte("bucket", range.from)
      .lte("bucket", range.to);

    if (marketType) {
      q = q.eq("market_type", marketType);
    }

    const { data, error } = await q.order("bucket", { ascending: true });
    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryLmpHourly] ${error.message}`
      );
    }
    return data as DbLmpHourly[];
  }

  /**
   * Delete LMP prices for an ISO within a time window.
   * Used to replay a day's worth of data after corrections.
   */
  async deleteLmpRange(
    tenantId: string,
    isoId: string,
    range: TimeRange
  ): Promise<void> {
    const { error } = await this.client
      .from("lmp_prices")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .gte("ts", range.from)
      .lte("ts", range.to);

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.deleteLmpRange] ${error.message}`
      );
    }
  }

  // ── generator_output ────────────────────────────────────────────────────────

  /**
   * Insert a batch of generator output rows.
   */
  async insertGeneratorOutputBatch(
    rows: DbGeneratorOutputInsert[]
  ): Promise<number> {
    if (rows.length === 0) return 0;
    rows.forEach(validateGeneratorOutput);

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error } = await this.client
        .from("generator_output")
        .insert(chunk);
      if (error) {
        throw new Error(
          `[TimeSeriesRepository.insertGeneratorOutputBatch] chunk ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`
        );
      }
      inserted += chunk.length;
    }
    return inserted;
  }

  /**
   * Query generator output for a specific generator within a time window.
   */
  async queryGeneratorOutput(
    tenantId: string,
    isoId: string,
    generatorId: string,
    range: TimeRange
  ): Promise<DbGeneratorOutput[]> {
    const { data, error } = await this.client
      .from("generator_output")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .eq("generator_id", generatorId)
      .gte("ts", range.from)
      .lte("ts", range.to)
      .order("ts", { ascending: true });

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryGeneratorOutput] ${error.message}`
      );
    }
    return data as DbGeneratorOutput[];
  }

  /**
   * Query generator output by fuel type within a time window.
   * Useful for aggregate renewable vs. thermal generation analysis.
   */
  async queryGeneratorOutputByFuel(
    tenantId: string,
    isoId: string,
    fuelType: string,
    range: TimeRange
  ): Promise<DbGeneratorOutput[]> {
    const { data, error } = await this.client
      .from("generator_output")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .eq("fuel_type", fuelType)
      .gte("ts", range.from)
      .lte("ts", range.to)
      .order("ts", { ascending: true });

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryGeneratorOutputByFuel] ${error.message}`
      );
    }
    return data as DbGeneratorOutput[];
  }

  /**
   * Delete generator output for an ISO within a time window.
   */
  async deleteGeneratorOutputRange(
    tenantId: string,
    isoId: string,
    range: TimeRange
  ): Promise<void> {
    const { error } = await this.client
      .from("generator_output")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("iso_id", isoId)
      .gte("ts", range.from)
      .lte("ts", range.to);

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.deleteGeneratorOutputRange] ${error.message}`
      );
    }
  }

  // ── weather_observations ────────────────────────────────────────────────────

  /**
   * Insert a batch of weather observations.
   */
  async insertWeatherBatch(
    rows: DbWeatherObservationInsert[]
  ): Promise<number> {
    if (rows.length === 0) return 0;
    // Basic validation: ts and station_id are required
    for (const r of rows) {
      if (!r.ts) {
        throw new TimeSeriesValidationError("ts is required", "ts");
      }
      if (!r.station_id?.trim()) {
        throw new TimeSeriesValidationError(
          "station_id is required",
          "station_id"
        );
      }
      if (!isFinite(r.latitude) || !isFinite(r.longitude)) {
        throw new TimeSeriesValidationError(
          "latitude and longitude must be finite numbers",
          "latitude"
        );
      }
    }

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error } = await this.client
        .from("weather_observations")
        .insert(chunk);
      if (error) {
        throw new Error(
          `[TimeSeriesRepository.insertWeatherBatch] chunk ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`
        );
      }
      inserted += chunk.length;
    }
    return inserted;
  }

  /**
   * Query weather observations for a station within a time window.
   */
  async queryWeatherByStation(
    tenantId: string,
    stationId: string,
    range: TimeRange
  ): Promise<DbWeatherObservation[]> {
    const { data, error } = await this.client
      .from("weather_observations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("station_id", stationId)
      .gte("ts", range.from)
      .lte("ts", range.to)
      .order("ts", { ascending: true });

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryWeatherByStation] ${error.message}`
      );
    }
    return data as DbWeatherObservation[];
  }

  /**
   * Query the most recent weather observation for each station in a list.
   * Returns at most one row per station_id.
   */
  async latestWeatherByStations(
    tenantId: string,
    stationIds: string[]
  ): Promise<DbWeatherObservation[]> {
    if (stationIds.length === 0) return [];

    const { data, error } = await this.client
      .from("weather_observations")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("station_id", stationIds)
      .order("ts", { ascending: false });

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.latestWeatherByStations] ${error.message}`
      );
    }

    // Deduplicate: keep the newest row per station
    const seen = new Set<string>();
    const result: DbWeatherObservation[] = [];
    for (const row of data as DbWeatherObservation[]) {
      if (!seen.has(row.station_id)) {
        seen.add(row.station_id);
        result.push(row);
      }
    }
    return result;
  }

  /**
   * Delete weather observations for a tenant within a time window.
   */
  async deleteWeatherRange(tenantId: string, range: TimeRange): Promise<void> {
    const { error } = await this.client
      .from("weather_observations")
      .delete()
      .eq("tenant_id", tenantId)
      .gte("ts", range.from)
      .lte("ts", range.to);

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.deleteWeatherRange] ${error.message}`
      );
    }
  }

  // ── ami_interval_data ───────────────────────────────────────────────────────

  /**
   * Insert a batch of AMI interval rows.
   */
  async insertAmiBatch(rows: DbAmiIntervalInsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    rows.forEach(validateAmiInterval);

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error } = await this.client
        .from("ami_interval_data")
        .insert(chunk);
      if (error) {
        throw new Error(
          `[TimeSeriesRepository.insertAmiBatch] chunk ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`
        );
      }
      inserted += chunk.length;
    }
    return inserted;
  }

  /**
   * Query AMI data for a meter within a time window.
   */
  async queryAmiByMeter(
    tenantId: string,
    meterId: string,
    range: TimeRange
  ): Promise<DbAmiInterval[]> {
    const { data, error } = await this.client
      .from("ami_interval_data")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("meter_id", meterId)
      .gte("ts", range.from)
      .lte("ts", range.to)
      .order("ts", { ascending: true });

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryAmiByMeter] ${error.message}`
      );
    }
    return data as DbAmiInterval[];
  }

  /**
   * Query AMI data aggregated by feeder within a time window.
   * Returns all rows for the feeder (summing is left to the caller so
   * the caller can choose aggregation granularity).
   */
  async queryAmiByFeeder(
    tenantId: string,
    feederId: string,
    range: TimeRange
  ): Promise<DbAmiInterval[]> {
    const { data, error } = await this.client
      .from("ami_interval_data")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("feeder_id", feederId)
      .gte("ts", range.from)
      .lte("ts", range.to)
      .order("ts", { ascending: true });

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.queryAmiByFeeder] ${error.message}`
      );
    }
    return data as DbAmiInterval[];
  }

  /**
   * Delete AMI data for a tenant within a time window.
   */
  async deleteAmiRange(tenantId: string, range: TimeRange): Promise<void> {
    const { error } = await this.client
      .from("ami_interval_data")
      .delete()
      .eq("tenant_id", tenantId)
      .gte("ts", range.from)
      .lte("ts", range.to);

    if (error) {
      throw new Error(
        `[TimeSeriesRepository.deleteAmiRange] ${error.message}`
      );
    }
  }
}
