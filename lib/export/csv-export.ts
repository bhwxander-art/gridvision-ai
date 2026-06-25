import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExportOptions {
  includeAssets?: boolean;
  includeProjects?: boolean;
  includeAccounts?: boolean;
  includeScenarios?: boolean;
}

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function arrayToCSV(rows: Record<string, unknown>[], headers?: string[]): string {
  if (rows.length === 0) return "";

  const cols = headers ?? Object.keys(rows[0]);
  const csvHeaders = cols.map(escapeCSV).join(",");
  const csvRows = rows.map((row) =>
    cols.map((col) => escapeCSV(row[col])).join(",")
  );

  return [csvHeaders, ...csvRows].join("\n");
}

export async function exportSubstations(
  client: SupabaseClient,
  tenantId: string
): Promise<string> {
  const { data, error } = await client
    .from("substations")
    .select("id, name, region, voltage_kv, nameplate_mva, peak_load_mw, latitude, longitude")
    .eq("tenant_id", tenantId)
    .order("name");

  if (error) throw new Error(`Failed to export substations: ${error.message}`);

  return arrayToCSV(data ?? [], [
    "id",
    "name",
    "region",
    "voltage_kv",
    "nameplate_mva",
    "peak_load_mw",
    "latitude",
    "longitude",
  ]);
}

export async function exportCapitalProjects(
  client: SupabaseClient,
  tenantId: string
): Promise<string> {
  const { data, error } = await client
    .from("capital_projects")
    .select("id, project_name, upgrade_type, estimated_cost_usd, added_capacity_mw, status, priority_score")
    .eq("tenant_id", tenantId)
    .order("priority_score", { ascending: false });

  if (error) throw new Error(`Failed to export projects: ${error.message}`);

  return arrayToCSV(data ?? [], [
    "id",
    "project_name",
    "upgrade_type",
    "estimated_cost_usd",
    "added_capacity_mw",
    "status",
    "priority_score",
  ]);
}

export async function exportAccounts(
  client: SupabaseClient,
  tenantId: string
): Promise<string> {
  const { data, error } = await client
    .from("accounts")
    .select("id, name, type, status, annual_load_mw, estimated_revenue_usd, estimated_arr, deal_probability")
    .eq("tenant_id", tenantId)
    .order("name");

  if (error) throw new Error(`Failed to export accounts: ${error.message}`);

  return arrayToCSV(data ?? [], [
    "id",
    "name",
    "type",
    "status",
    "annual_load_mw",
    "estimated_revenue_usd",
    "estimated_arr",
    "deal_probability",
  ]);
}

export async function exportScenarios(
  client: SupabaseClient,
  tenantId: string
): Promise<string> {
  const { data, error } = await client
    .from("scenarios")
    .select("id, name, inputs, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to export scenarios: ${error.message}`);

  return arrayToCSV(
    (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      dataCenterLoadMW: row.inputs?.dataCenterLoadMW,
      evGrowthPct: row.inputs?.evGrowthPct,
      populationGrowthPct: row.inputs?.populationGrowthPct,
      commercialGrowthPct: row.inputs?.commercialGrowthPct,
      created_at: row.created_at,
    })),
    [
      "id",
      "name",
      "dataCenterLoadMW",
      "evGrowthPct",
      "populationGrowthPct",
      "commercialGrowthPct",
      "created_at",
    ]
  );
}

export async function createExportBundle(
  client: SupabaseClient,
  tenantId: string,
  options: ExportOptions = {}
): Promise<Record<string, string>> {
  const bundle: Record<string, string> = {};

  if (options.includeAssets ?? true) {
    bundle.substations = await exportSubstations(client, tenantId);
  }

  if (options.includeProjects ?? true) {
    bundle.projects = await exportCapitalProjects(client, tenantId);
  }

  if (options.includeAccounts ?? true) {
    bundle.accounts = await exportAccounts(client, tenantId);
  }

  if (options.includeScenarios ?? true) {
    bundle.scenarios = await exportScenarios(client, tenantId);
  }

  return bundle;
}
