/**
 * IFE scenario repository — INFRA-019
 *
 * Covers ife_scenarios only. Follows the exact tenant-scoped CRUD pattern
 * established by IfeRepository (lib/db/repositories/ife.repository.ts) and
 * NetworkRepository (lib/db/repositories/network.repository.ts).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toIfeScenario,
  validateIfeScenarioInsert,
  type DbIfeScenario,
  type DbIfeScenarioInsert,
  type IfeScenario,
} from "@/lib/db/types-ife-scenario";
import type { IfeAnalysisStatus } from "@/lib/db/types-ife";

export class IfeScenarioRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createScenario(insert: DbIfeScenarioInsert): Promise<IfeScenario> {
    validateIfeScenarioInsert(insert);

    const { data, error } = await this.client
      .from("ife_scenarios")
      .insert(insert)
      .select()
      .single();

    if (error) throw new Error(`[IfeScenarioRepository.createScenario] ${error.message}`);
    return toIfeScenario(data as DbIfeScenario);
  }

  async getScenario(tenantId: string, scenarioId: string): Promise<IfeScenario | null> {
    const { data, error } = await this.client
      .from("ife_scenarios")
      .select("*")
      .eq("id", scenarioId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`[IfeScenarioRepository.getScenario] ${error.message}`);
    return data ? toIfeScenario(data as DbIfeScenario) : null;
  }

  async getScenarioByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<IfeScenario | null> {
    const { data, error } = await this.client
      .from("ife_scenarios")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeScenarioRepository.getScenarioByIdempotencyKey] ${error.message}`);
    return data ? toIfeScenario(data as DbIfeScenario) : null;
  }

  /**
   * Dedup lookup: an identical (canonicalized) delta against the same base
   * model. idx_ife_scenarios_delta_dedup is deliberately NOT unique (distinct
   * scenarios may share a delta), so more than one row can match — `.limit(1)`
   * before `.maybeSingle()` returns the earliest match instead of throwing.
   */
  async getScenarioByDeltaHash(
    tenantId: string,
    baseNetworkModelId: string,
    networkDeltaHash: string
  ): Promise<IfeScenario | null> {
    const { data, error } = await this.client
      .from("ife_scenarios")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("base_network_model_id", baseNetworkModelId)
      .eq("network_delta_hash", networkDeltaHash)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeScenarioRepository.getScenarioByDeltaHash] ${error.message}`);
    return data ? toIfeScenario(data as DbIfeScenario) : null;
  }

  async updateScenarioStatus(
    tenantId: string,
    scenarioId: string,
    status: IfeAnalysisStatus,
    opts: {
      errorMessage?: string | null;
      derivedNetworkModelId?: string | null;
      resultAnalysisId?: string | null;
    } = {}
  ): Promise<IfeScenario> {
    const update: Record<string, unknown> = { status };
    if (opts.errorMessage !== undefined) update.error_message = opts.errorMessage;
    if (opts.derivedNetworkModelId !== undefined) update.derived_network_model_id = opts.derivedNetworkModelId;
    if (opts.resultAnalysisId !== undefined) update.result_analysis_id = opts.resultAnalysisId;

    const { data, error } = await this.client
      .from("ife_scenarios")
      .update(update)
      .eq("id", scenarioId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error)
      throw new Error(`[IfeScenarioRepository.updateScenarioStatus] ${error.message}`);
    return toIfeScenario(data as DbIfeScenario);
  }
}
