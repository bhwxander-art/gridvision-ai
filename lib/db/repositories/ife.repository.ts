/**
 * IFE repository — INFRA-012 / INFRA-013 / INFRA-015
 *
 * Scoped to the four tables the Hosting Capacity (INFRA-012), Upgrade
 * Analysis (INFRA-013), and Time-to-Power (INFRA-015) engines need:
 * ife_analyses (parent), ife_hosting_capacity (child), ife_upgrade_results
 * (child), and ife_time_to_power (child). The remaining two child tables
 * (ife_confidence_risk, ife_explanations) belong to their own future
 * tickets and are intentionally not touched here.
 *
 * The ife_time_to_power mapper/validator live in lib/time-to-power/
 * (mappers.ts / validation.ts) rather than lib/db/types-ife.ts, by explicit
 * instruction to keep that shared types file from growing further — only
 * its DbIfeTimeToPower/DbIfeTimeToPowerInsert/IfeTimeToPower type
 * declarations (already present there) are reused here.
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
  type DbIfeTimeToPower,
  type DbIfeTimeToPowerInsert,
  type DbIfeUpgradeResults,
  type DbIfeUpgradeResultsInsert,
  type IfeAnalysis,
  type IfeAnalysisStatus,
  type IfeHostingCapacity,
  type IfeTimeToPower,
  type IfeUpgradeResults,
} from "@/lib/db/types-ife";
import { toIfeTimeToPower } from "@/lib/time-to-power/mappers";
import { validateIfeTimeToPowerInsert } from "@/lib/time-to-power/validation";

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

  // ── ife_time_to_power ─────────────────────────────────────────────────────────

  async createTimeToPower(insert: DbIfeTimeToPowerInsert): Promise<IfeTimeToPower> {
    validateIfeTimeToPowerInsert(insert);

    const { data, error } = await this.client
      .from("ife_time_to_power")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[IfeRepository.createTimeToPower] ${error.message}`);
    return toIfeTimeToPower(data as DbIfeTimeToPower);
  }

  async getTimeToPowerByAnalysisId(
    tenantId: string,
    analysisId: string
  ): Promise<IfeTimeToPower | null> {
    const { data, error } = await this.client
      .from("ife_time_to_power")
      .select("*")
      .eq("analysis_id", analysisId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeRepository.getTimeToPowerByAnalysisId] ${error.message}`);
    return data ? toIfeTimeToPower(data as DbIfeTimeToPower) : null;
  }
}
