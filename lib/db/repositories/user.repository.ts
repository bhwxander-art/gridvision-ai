import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbUser, DbUserTenant, DbUserWithRole, UserRole } from "@/lib/db/types";
import { USER_ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from "@/lib/auth/roles";

// Re-export so existing callers that import from this module still work
export { USER_ROLES, ROLE_LABELS, ROLE_PERMISSIONS };

// ── Repository ────────────────────────────────────────────────────────────────

export class UserRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** Returns all users belonging to a tenant, with their role. */
  async listUsers(tenantId: string): Promise<DbUserWithRole[]> {
    const { data, error } = await this.client
      .from("user_tenants")
      .select("*, users(*)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`[UserRepository.listUsers] ${error.message}`);

    return (
      data as Array<DbUserTenant & { users: DbUser }>
    ).map((row) => ({
      ...row.users,
      role:      row.role,
      is_active: row.is_active,
      tenant_id: row.tenant_id,
    }));
  }

  /**
   * Upserts a user profile and assigns them to a tenant.
   * The user must already exist in auth.users; this creates the public profile
   * and the tenant membership.
   */
  async createUser(
    userId: string,
    email: string,
    fullName: string | null,
    tenantId: string,
    role: UserRole
  ): Promise<DbUserWithRole> {
    // 1. Upsert public user profile
    const { error: profileError } = await this.client.from("users").upsert(
      { id: userId, email, full_name: fullName, is_super_admin: false },
      { onConflict: "id" }
    );
    if (profileError)
      throw new Error(`[UserRepository.createUser] profile: ${profileError.message}`);

    // 2. Create tenant membership
    const { error: memberError } = await this.client.from("user_tenants").upsert(
      {
        user_id:   userId,
        tenant_id: tenantId,
        role,
        is_active: true,
      },
      { onConflict: "user_id,tenant_id" }
    );
    if (memberError)
      throw new Error(`[UserRepository.createUser] membership: ${memberError.message}`);

    const users = await this.listUsers(tenantId);
    const created = users.find((u) => u.id === userId);
    if (!created)
      throw new Error("[UserRepository.createUser] user not found after creation");
    return created;
  }

  /** Updates the role of a user within a specific tenant. */
  async updateRole(
    userId: string,
    tenantId: string,
    role: UserRole
  ): Promise<void> {
    const { error } = await this.client
      .from("user_tenants")
      .update({ role })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[UserRepository.updateRole] ${error.message}`);
  }

  /** Deactivates a user's access to a tenant (soft delete). */
  async deactivateUser(userId: string, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("user_tenants")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(`[UserRepository.deactivateUser] ${error.message}`);
  }

  /** Returns the tenants a given user belongs to, with their role in each. */
  async getUserTenants(
    userId: string
  ): Promise<Array<DbUserTenant & { tenant_slug: string; tenant_name: string }>> {
    const { data, error } = await this.client
      .from("user_tenants")
      .select("*, tenants(slug, name)")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) throw new Error(`[UserRepository.getUserTenants] ${error.message}`);

    return (
      data as Array<DbUserTenant & { tenants: { slug: string; name: string } }>
    ).map((row) => ({
      ...row,
      tenant_slug: row.tenants.slug,
      tenant_name: row.tenants.name,
    }));
  }

  /** Checks whether a user is a super admin. */
  async isSuperAdmin(userId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("users")
      .select("is_super_admin")
      .eq("id", userId)
      .maybeSingle();

    if (error) return false;
    return (data as DbUser | null)?.is_super_admin ?? false;
  }
}
