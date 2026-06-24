import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getServerClient } from "@/lib/db/client";
import { TenantRepository, DEMO_TENANT_ID } from "@/lib/db/repositories/tenant.repository";
import { UserRepository } from "@/lib/db/repositories/user.repository";
import type { UserRole } from "@/lib/db/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TenantContext {
  tenantId:     string;
  tenantSlug:   string;
  tenantName:   string;
  tenantType:   string;
  userId:       string;
  userEmail:    string;
  role:         UserRole;
  isSuperAdmin: boolean;
}

// ── Session-aware Supabase client (anon key, reads user session) ──────────────

async function createSessionClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {}, // read-only context
      },
    }
  );
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Resolves the current tenant from the authenticated user's session.
 * Returns null when:
 *  - Auth env vars are not configured (dev / demo mode)
 *  - No active session exists
 *  - User has no tenant memberships
 *
 * Falls back to the "GridVision Demo" tenant for admin keys.
 */
export async function getCurrentTenant(): Promise<TenantContext | null> {
  const hasAuth =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!hasAuth) return demoTenantContext();

  try {
    const sessionClient = await createSessionClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) return null;

    const serviceClient = getServerClient();
    const userRepo  = new UserRepository(serviceClient);
    const tenantRepo = new TenantRepository(serviceClient);

    // Check super admin status
    const isSuperAdmin = await userRepo.isSuperAdmin(user.id);

    // Get all tenant memberships for this user
    const memberships = await userRepo.getUserTenants(user.id);

    if (memberships.length === 0) {
      if (isSuperAdmin) {
        // Super admins without a specific membership default to demo tenant
        return demoTenantContext(user.id, user.email ?? "", true);
      }
      return null;
    }

    // Use the first active membership (or let the user switch later)
    const first     = memberships[0];
    const tenant    = await tenantRepo.getTenant(first.tenant_id);
    if (!tenant) return null;

    return {
      tenantId:     tenant.id,
      tenantSlug:   tenant.slug,
      tenantName:   tenant.name,
      tenantType:   tenant.type,
      userId:       user.id,
      userEmail:    user.email ?? "",
      role:         first.role,
      isSuperAdmin,
    };
  } catch {
    return demoTenantContext();
  }
}

/**
 * Like getCurrentTenant() but throws a 401-style error when there is no
 * authenticated tenant context.  Use in API routes that require isolation.
 */
export async function requireTenant(): Promise<TenantContext> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    throw new Error("UNAUTHORIZED: No active tenant context. Please sign in.");
  }
  return ctx;
}

/**
 * Returns true when the current user has access to the given tenantId.
 * Super admins have access to all tenants.
 */
export async function validateTenantAccess(tenantId: string): Promise<boolean> {
  const ctx = await getCurrentTenant();
  if (!ctx) return false;
  if (ctx.isSuperAdmin) return true;
  return ctx.tenantId === tenantId;
}

// ── Demo / fallback context ───────────────────────────────────────────────────

function demoTenantContext(
  userId   = "00000000-0000-0000-0000-000000000000",
  email    = "demo@gridvision.ai",
  isSuperAdmin = false
): TenantContext {
  return {
    tenantId:     DEMO_TENANT_ID,
    tenantSlug:   "gridvision-demo",
    tenantName:   "GridVision Demo",
    tenantType:   "demo",
    userId,
    userEmail:    email,
    role:         isSuperAdmin ? "super_admin" : "utility_executive",
    isSuperAdmin,
  };
}
