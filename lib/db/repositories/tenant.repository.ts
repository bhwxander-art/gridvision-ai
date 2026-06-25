import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DbTenant,
  DbTenantInsert,
  TenantPlan,
  TenantStatus,
} from "@/lib/db/types";

// ── Well-known IDs ────────────────────────────────────────────────────────────

export const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000000";

// ── Row → domain mapper ───────────────────────────────────────────────────────

export function toTenant(row: DbTenant): DbTenant {
  return row; // schema matches domain directly
}

// ── Repository ────────────────────────────────────────────────────────────────

export class TenantRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listTenants(): Promise<DbTenant[]> {
    const { data, error } = await this.client
      .from("tenants")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`[TenantRepository.listTenants] ${error.message}`);
    return (data as DbTenant[]).map(toTenant);
  }

  async getTenant(id: string): Promise<DbTenant | null> {
    const { data, error } = await this.client
      .from("tenants")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`[TenantRepository.getTenant] ${error.message}`);
    return data ? toTenant(data as DbTenant) : null;
  }

  async getTenantBySlug(slug: string): Promise<DbTenant | null> {
    const { data, error } = await this.client
      .from("tenants")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (error) throw new Error(`[TenantRepository.getTenantBySlug] ${error.message}`);
    return data ? toTenant(data as DbTenant) : null;
  }

  async createTenant(insert: DbTenantInsert): Promise<DbTenant> {
    const { data, error } = await this.client
      .from("tenants")
      .insert({ ...insert, settings: insert.settings ?? {} })
      .select()
      .single();

    if (error) throw new Error(`[TenantRepository.createTenant] ${error.message}`);
    return toTenant(data as DbTenant);
  }

  async updateTenant(
    id: string,
    patch: Partial<Pick<DbTenant, "name" | "plan" | "status" | "settings">>
  ): Promise<DbTenant> {
    const { data, error } = await this.client
      .from("tenants")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`[TenantRepository.updateTenant] ${error.message}`);
    return toTenant(data as DbTenant);
  }

  async updateStatus(id: string, status: TenantStatus): Promise<void> {
    const { error } = await this.client
      .from("tenants")
      .update({ status })
      .eq("id", id);

    if (error) throw new Error(`[TenantRepository.updateStatus] ${error.message}`);
  }

  async updatePlan(id: string, plan: TenantPlan): Promise<void> {
    const { error } = await this.client
      .from("tenants")
      .update({ plan })
      .eq("id", id);

    if (error) throw new Error(`[TenantRepository.updatePlan] ${error.message}`);
  }

  /** Count users belonging to a tenant. */
  async getUserCount(tenantId: string): Promise<number> {
    const { count, error } = await this.client
      .from("user_tenants")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    if (error) throw new Error(`[TenantRepository.getUserCount] ${error.message}`);
    return count ?? 0;
  }
}
