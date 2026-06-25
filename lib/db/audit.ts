import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "user_login"
  | "user_logout"
  | "scenario_create"
  | "scenario_delete"
  | "scenario_update"
  | "project_create"
  | "project_update"
  | "project_delete"
  | "account_create"
  | "account_update"
  | "account_delete"
  | "user_invite"
  | "user_role_change"
  | "tenant_create"
  | "tenant_update"
  | "settings_update"
  | "data_export";

export type ResourceType =
  | "user"
  | "scenario"
  | "project"
  | "account"
  | "tenant"
  | "settings";

export interface AuditLogEntry {
  tenantId: string;
  userId?: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function logAuditEvent(
  client: SupabaseClient,
  entry: AuditLogEntry
): Promise<void> {
  const { error } = await client
    .from("audit_logs")
    .insert({
      tenant_id: entry.tenantId,
      user_id: entry.userId ?? null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      changes: entry.changes ?? null,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
    });

  if (error) {
    console.error("[audit] Failed to log event:", error);
    // Don't throw — audit logging failures should not break the application
  }
}

export async function getAuditLog(
  client: SupabaseClient,
  tenantId: string,
  limit = 50,
  offset = 0
): Promise<Array<AuditLogEntry & { id: string; createdAt: string; userName?: string }>> {
  const { data, error } = await client
    .from("audit_logs")
    .select(
      `
      id,
      tenant_id,
      user_id,
      action,
      resource_type,
      resource_id,
      changes,
      created_at,
      users:user_id(full_name)
      `
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`[audit] Failed to fetch audit log: ${error.message}`);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    changes: row.changes,
    createdAt: row.created_at,
    userName: row.users?.full_name,
  }));
}

export async function getAuditCount(
  client: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { count, error } = await client
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`[audit] Failed to get audit log count: ${error.message}`);
  }

  return count ?? 0;
}
