/**
 * EIA Generator Inventory Repository (INFRA-006)
 *
 * All queries are scoped to tenant_id for multi-tenant isolation.
 * Upserts are idempotent via the UNIQUE constraint on
 * (tenant_id, plant_id, generator_id, data_year).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DbEiaGenerator,
  DbEiaGeneratorInsert,
  EiaGenerator,
  CapacitySummaryByFuel,
  GeneratorFuelType,
} from "@/lib/db/types-eia-generators";
import {
  toEiaGenerator,
  validateEiaGeneratorInsert,
  GENERATOR_FUEL_TYPES,
} from "@/lib/db/types-eia-generators";

const BATCH_SIZE = 500; // stay under PostgREST default body-size limit

export { EiaGeneratorValidationError } from "@/lib/db/types-eia-generators";

export class EiaGeneratorRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── Bulk write ──────────────────────────────────────────────────────────────

  /**
   * Upsert a batch of generator rows.  Existing rows (same plant/generator/year)
   * are updated in place; new rows are inserted.  Returns total rows processed.
   */
  async upsertBatch(inserts: DbEiaGeneratorInsert[]): Promise<number> {
    if (inserts.length === 0) return 0;

    inserts.forEach(validateEiaGeneratorInsert);

    let upserted = 0;
    for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
      const chunk = inserts.slice(i, i + BATCH_SIZE);
      const { error } = await this.client
        .from("eia_generators")
        .upsert(chunk, {
          onConflict: "tenant_id,plant_id,generator_id,data_year",
          ignoreDuplicates: false,
        });

      if (error) {
        throw new Error(
          `[EiaGeneratorRepository.upsertBatch] chunk ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`
        );
      }
      upserted += chunk.length;
    }
    return upserted;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  /**
   * List all generators for a balancing authority in a given data year.
   * Ordered by plant_name, generator_id.
   */
  async listByBalancingAuthority(
    tenantId: string,
    baCode: string,
    dataYear: number,
    filters?: {
      fuelType?: GeneratorFuelType;
      operationalStatus?: string;
    }
  ): Promise<EiaGenerator[]> {
    let query = this.client
      .from("eia_generators")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("balancing_authority", baCode)
      .eq("data_year", dataYear)
      .order("plant_name", { ascending: true })
      .order("generator_id", { ascending: true });

    if (filters?.fuelType) {
      query = query.eq("fuel_type", filters.fuelType);
    }
    if (filters?.operationalStatus) {
      query = query.eq("operational_status", filters.operationalStatus);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(
        `[EiaGeneratorRepository.listByBalancingAuthority] ${error.message}`
      );
    }
    return (data as DbEiaGenerator[]).map(toEiaGenerator);
  }

  /**
   * List all generators for a US state in a given data year.
   */
  async listByState(
    tenantId: string,
    stateAbbr: string,
    dataYear: number
  ): Promise<EiaGenerator[]> {
    const { data, error } = await this.client
      .from("eia_generators")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("state_abbr", stateAbbr.toUpperCase())
      .eq("data_year", dataYear)
      .order("plant_name", { ascending: true });

    if (error) {
      throw new Error(
        `[EiaGeneratorRepository.listByState] ${error.message}`
      );
    }
    return (data as DbEiaGenerator[]).map(toEiaGenerator);
  }

  /**
   * Return the most recent data_year available for a balancing authority.
   * Returns null if no data has been loaded for this BA.
   */
  async latestDataYear(
    tenantId: string,
    baCode: string
  ): Promise<number | null> {
    const { data, error } = await this.client
      .from("eia_generators")
      .select("data_year")
      .eq("tenant_id", tenantId)
      .eq("balancing_authority", baCode)
      .order("data_year", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(
        `[EiaGeneratorRepository.latestDataYear] ${error.message}`
      );
    }
    return data ? Number((data as Pick<DbEiaGenerator, "data_year">).data_year) : null;
  }

  /**
   * Compute installed and operating MW by fuel type for a balancing authority.
   * Aggregates using JavaScript (Supabase JS doesn't expose GROUP BY directly).
   * Filters to the specified data year and sums summer_mw (capacity that counts
   * toward summer peak adequacy studies).
   */
  async getCapacitySummary(
    tenantId: string,
    baCode: string,
    dataYear: number
  ): Promise<CapacitySummaryByFuel> {
    const { data, error } = await this.client
      .from("eia_generators")
      .select("fuel_type, operational_status, summer_mw")
      .eq("tenant_id", tenantId)
      .eq("balancing_authority", baCode)
      .eq("data_year", dataYear);

    if (error) {
      throw new Error(
        `[EiaGeneratorRepository.getCapacitySummary] ${error.message}`
      );
    }

    const rows = data as Pick<
      DbEiaGenerator,
      "fuel_type" | "operational_status" | "summer_mw"
    >[];

    const byFuelType: Partial<Record<GeneratorFuelType, number>> = {};
    let totalMw = 0;
    let operatingMw = 0;
    let generatorCount = 0;
    let operatingCount = 0;

    for (const row of rows) {
      const mw = row.summer_mw != null ? Number(row.summer_mw) : 0;
      const fuel = row.fuel_type as GeneratorFuelType;
      const isOperating = row.operational_status === "operating";

      generatorCount++;
      totalMw += mw;
      byFuelType[fuel] = (byFuelType[fuel] ?? 0) + mw;

      if (isOperating) {
        operatingMw += mw;
        operatingCount++;
      }
    }

    return {
      balancingAuthority: baCode,
      dataYear,
      totalMw: Math.round(totalMw * 100) / 100,
      operatingMw: Math.round(operatingMw * 100) / 100,
      byFuelType,
      generatorCount,
      operatingCount,
    };
  }

  /**
   * Return generators scheduled to retire within `horizonYears` from now.
   * Only includes currently operating generators that have a retirement_year.
   * `dataYear` must match the annual snapshot to query (avoids duplicate rows
   * when multiple years are loaded).
   * Ordered by retirement_year, retirement_month.
   */
  async getRetirementSchedule(
    tenantId: string,
    baCode: string,
    dataYear: number,
    horizonYears: number
  ): Promise<EiaGenerator[]> {
    const currentYear = new Date().getFullYear();
    const endYear = currentYear + horizonYears;

    const { data, error } = await this.client
      .from("eia_generators")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("balancing_authority", baCode)
      .eq("data_year", dataYear)
      .eq("operational_status", "operating")
      .gte("retirement_year", currentYear)
      .lte("retirement_year", endYear)
      .order("retirement_year", { ascending: true })
      .order("retirement_month", { ascending: true });

    if (error) {
      throw new Error(
        `[EiaGeneratorRepository.getRetirementSchedule] ${error.message}`
      );
    }
    return (data as DbEiaGenerator[]).map(toEiaGenerator);
  }

  /**
   * Return distinct balancing authority codes that have been loaded for
   * this tenant in the given data year.
   */
  async listBalancingAuthorities(
    tenantId: string,
    dataYear: number
  ): Promise<string[]> {
    const { data, error } = await this.client
      .from("eia_generators")
      .select("balancing_authority")
      .eq("tenant_id", tenantId)
      .eq("data_year", dataYear)
      .not("balancing_authority", "is", null)
      .order("balancing_authority", { ascending: true });

    if (error) {
      throw new Error(
        `[EiaGeneratorRepository.listBalancingAuthorities] ${error.message}`
      );
    }

    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of data as Pick<DbEiaGenerator, "balancing_authority">[]) {
      if (row.balancing_authority && !seen.has(row.balancing_authority)) {
        seen.add(row.balancing_authority);
        result.push(row.balancing_authority);
      }
    }
    return result;
  }

  /**
   * Delete all generator rows for a given data year.
   * Used to force a full reload of an annual snapshot.
   */
  async deleteByYear(tenantId: string, dataYear: number): Promise<void> {
    const { error } = await this.client
      .from("eia_generators")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("data_year", dataYear);

    if (error) {
      throw new Error(
        `[EiaGeneratorRepository.deleteByYear] ${error.message}`
      );
    }
  }
}

// Re-export GENERATOR_FUEL_TYPES for use in tests / UI
export { GENERATOR_FUEL_TYPES };
