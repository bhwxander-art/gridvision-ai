/**
 * IFE repository — INFRA-012 / INFRA-013 / INFRA-015 / INFRA-016 / INFRA-017
 *
 * Covers all six ife_analyses-scoped tables: ife_analyses (parent),
 * ife_hosting_capacity, ife_upgrade_results, ife_time_to_power,
 * ife_confidence_risk, and ife_explanations (children) — Hosting Capacity
 * (INFRA-012), Upgrade Analysis (INFRA-013), Time-to-Power (INFRA-015),
 * Confidence & Risk Scoring (INFRA-016), and Explanations (INFRA-017)
 * respectively. This was the full, originally-anticipated scope of this
 * repository (see its very first docstring, which named all of these as
 * "future tickets") — nothing further is expected to be added here.
 * ife_outcome_tracking is a distinct table (a feedback/validation loop, not
 * one of ife_analyses's child result tables in the schema's own hierarchy
 * comment) and belongs to its own future ticket with its own repository.
 *
 * The ife_time_to_power / ife_confidence_risk / ife_explanations
 * mappers live in their own feature modules (lib/time-to-power/mappers.ts,
 * lib/confidence-risk/mappers.ts, lib/explanations/mappers.ts) rather than
 * lib/db/types-ife.ts, by explicit instruction to keep that shared types
 * file from growing further — only their existing Db-row and domain type
 * declarations already present there are reused here. Their validators follow the same
 * rule EXCEPT validateIfeConfidenceRiskInsert, which was already declared
 * in types-ife.ts before INFRA-016 existed and is reused directly.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toIfeAnalysis,
  toIfeHostingCapacity,
  toIfeUpgradeResults,
  validateIfeAnalysisInsert,
  validateIfeConfidenceRiskInsert,
  validateIfeHostingCapacityInsert,
  validateIfeUpgradeResultsInsert,
  type DbIfeAnalysis,
  type DbIfeAnalysisInsert,
  type DbIfeConfidenceRisk,
  type DbIfeConfidenceRiskInsert,
  type DbIfeExplanations,
  type DbIfeExplanationsInsert,
  type DbIfeHostingCapacity,
  type DbIfeHostingCapacityInsert,
  type DbIfeTimeToPower,
  type DbIfeTimeToPowerInsert,
  type DbIfeUpgradeResults,
  type DbIfeUpgradeResultsInsert,
  type IfeAnalysis,
  type IfeAnalysisStatus,
  type IfeConfidenceRisk,
  type IfeHostingCapacity,
  type IfeTimeToPower,
  type IfeUpgradeResults,
} from "@/lib/db/types-ife";
import { toIfeTimeToPower } from "@/lib/time-to-power/mappers";
import { validateIfeTimeToPowerInsert } from "@/lib/time-to-power/validation";
import { toIfeConfidenceRisk } from "@/lib/confidence-risk/mappers";
import { toIfeExplanations } from "@/lib/explanations/mappers";
import { validateIfeExplanationsInsert } from "@/lib/explanations/validation";
import type { IfeExplanations } from "@/lib/explanations/types";

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

  // ── ife_confidence_risk ───────────────────────────────────────────────────────

  async createConfidenceRisk(insert: DbIfeConfidenceRiskInsert): Promise<IfeConfidenceRisk> {
    validateIfeConfidenceRiskInsert(insert);

    const { data, error } = await this.client
      .from("ife_confidence_risk")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[IfeRepository.createConfidenceRisk] ${error.message}`);
    return toIfeConfidenceRisk(data as DbIfeConfidenceRisk);
  }

  async getConfidenceRiskByAnalysisId(
    tenantId: string,
    analysisId: string
  ): Promise<IfeConfidenceRisk | null> {
    const { data, error } = await this.client
      .from("ife_confidence_risk")
      .select("*")
      .eq("analysis_id", analysisId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeRepository.getConfidenceRiskByAnalysisId] ${error.message}`);
    return data ? toIfeConfidenceRisk(data as DbIfeConfidenceRisk) : null;
  }

  // ── ife_explanations ──────────────────────────────────────────────────────────

  async createExplanations(insert: DbIfeExplanationsInsert): Promise<IfeExplanations> {
    validateIfeExplanationsInsert(insert);

    const { data, error } = await this.client
      .from("ife_explanations")
      .insert(insert)
      .select()
      .single();

    if (error)
      throw new Error(`[IfeRepository.createExplanations] ${error.message}`);
    return toIfeExplanations(data as DbIfeExplanations);
  }

  async getExplanationsByAnalysisId(
    tenantId: string,
    analysisId: string
  ): Promise<IfeExplanations | null> {
    const { data, error } = await this.client
      .from("ife_explanations")
      .select("*")
      .eq("analysis_id", analysisId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error)
      throw new Error(`[IfeRepository.getExplanationsByAnalysisId] ${error.message}`);
    return data ? toIfeExplanations(data as DbIfeExplanations) : null;
  }
}
