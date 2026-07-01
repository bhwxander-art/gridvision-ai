/**
 * IFE repository — INFRA-012 / INFRA-013
 *
 * Scoped to the three tables the Hosting Capacity (INFRA-012) and Upgrade
 * Analysis (INFRA-013) engines need: ife_analyses (parent), ife_hosting_
 * capacity (child), and ife_upgrade_results (child). The remaining three
 * child tables (ife_time_to_power, ife_confidence_risk, ife_explanations)
 * belong to their own future tickets and are intentionally not touched here.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toIfeAnalysis,
  toIfeHostingCapacity,
  toIfeUpgradeResults,
  validateIfeAnalysisInsert,
  validateIfeHostingCapacityInsert,
  validateIfeUpgradeResultsInsert,
  type DbIfeAnalysis,
  type DbIfeAnalysisInsert,
  type DbIfeHostingCapacity,
  type DbIfeHostingCapacityInsert,
  type DbIfeUpgradeResults,
  type DbIfeUpgradeResultsInsert,
  type IfeAnalysis,
  type IfeAnalysisStatus,
  type IfeHostingCapacity,
  type IfeUpgradeResults,
} from "@/lib/db/types-ife";

export class IfeRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── ife_analyses ─────────────────────────────────────────────────────────────

  async createAnalysis(insert: DbIfeAnalysisInsert): Promise<IfeAnalysis> {
    validateIfeAnalysisInsert(insert);

    const { data, error } = await this.client
      .from("ife_analyses")
      .insert(insert)
      .select()
      .single();

    if (error) throw new Error(`[IfeRepository.createAnalysis] ${error.message}`);
    return toIfeAnalysis(data as DbIfeAnalysis);
  }

  async getAnalysis(tenantId: string, analysisId: string): Promise<IfeAnalysis | null> {
    const { data, error } = await this.client
      .from("ife_analyses")
      .select("*")
      .eq("id", analysisId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`[IfeRepository.getAnalysis] ${error.message}`);
    return data ? toIfeAnalysis(data as DbIfeAnalysis) : null;
  }

  async getAnalysisByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<IfeAnalysis | null> {
    const { data, error } = await this.client
      .from("ife_analyses")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeRepository.getAnalysisByIdempotencyKey] ${error.message}`);
    return data ? toIfeAnalysis(data as DbIfeAnalysis) : null;
  }

  async updateAnalysisStatus(
    tenantId: string,
    analysisId: string,
    status: IfeAnalysisStatus,
    opts: { errorMessage?: string | null } = {}
  ): Promise<IfeAnalysis> {
    const update: Record<string, unknown> = { status };
    if (opts.errorMessage !== undefined) update.error_message = opts.errorMessage;

    const now = new Date().toISOString();
    if (status === "running") update.started_at = now;
    if (status === "completed" || status === "failed") update.completed_at = now;

    const { data, error } = await this.client
      .from("ife_analyses")
      .update(update)
      .eq("id", analysisId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error)
      throw new Error(`[IfeRepository.updateAnalysisStatus] ${error.message}`);
    return toIfeAnalysis(data as DbIfeAnalysis);
  }

  // ── ife_hosting_capacity ─────────────────────────────────────────────────────

  async createHostingCapacity(
    insert: DbIfeHostingCapacityInsert
  ): Promise<IfeHostingCapacity> {
    validateIfeHostingCapacityInsert(insert);

    const { data, error } = await this.client
      .from("ife_hosting_capacity")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[IfeRepository.createHostingCapacity] ${error.message}`);
    return toIfeHostingCapacity(data as DbIfeHostingCapacity);
  }

  async getHostingCapacityByAnalysisId(
    tenantId: string,
    analysisId: string
  ): Promise<IfeHostingCapacity | null> {
    const { data, error } = await this.client
      .from("ife_hosting_capacity")
      .select("*")
      .eq("analysis_id", analysisId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeRepository.getHostingCapacityByAnalysisId] ${error.message}`);
    return data ? toIfeHostingCapacity(data as DbIfeHostingCapacity) : null;
  }

  // ── ife_upgrade_results ──────────────────────────────────────────────────────

  async createUpgradeResults(
    insert: DbIfeUpgradeResultsInsert
  ): Promise<IfeUpgradeResults> {
    validateIfeUpgradeResultsInsert(insert);

    const { data, error } = await this.client
      .from("ife_upgrade_results")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[IfeRepository.createUpgradeResults] ${error.message}`);
    return toIfeUpgradeResults(data as DbIfeUpgradeResults);
  }

  async getUpgradeResultsByAnalysisId(
    tenantId: string,
    analysisId: string
  ): Promise<IfeUpgradeResults | null> {
    const { data, error } = await this.client
      .from("ife_upgrade_results")
      .select("*")
      .eq("analysis_id", analysisId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeRepository.getUpgradeResultsByAnalysisId] ${error.message}`);
    return data ? toIfeUpgradeResults(data as DbIfeUpgradeResults) : null;
  }
}
