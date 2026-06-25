import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { TenantRepository } from "@/lib/db/repositories/tenant.repository";
import { getCurrentTenant, requireTenant } from "@/lib/auth/tenant";
import { requireSuperAdmin } from "@/lib/auth/rbac";
import { logAuditEvent } from "@/lib/db/audit";
import { handleDatabaseError, handleValidationError } from "@/lib/utils/safe-error";

export const dynamic = "force-dynamic";

// ── Validation ────────────────────────────────────────────────────────────────

const TenantCreateSchema = z.object({
  name:   z.string().min(2).max(100),
  slug:   z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  type:   z.enum(["utility", "developer", "consultant", "investor", "demo"]),
  plan:   z.enum(["trial", "professional", "enterprise"]).default("trial"),
  status: z.enum(["active", "suspended", "cancelled"]).default("active"),
});

// ── GET /api/tenants ──────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  // Require super admin
  if (!ctx?.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const repo    = new TenantRepository(getServerClient());
    const tenants = await repo.listTenants();

    // Enrich with user counts
    const enriched = await Promise.all(
      tenants.map(async (t) => ({
        ...t,
        userCount: await repo.getUserCount(t.id),
      }))
    );

    return NextResponse.json({ tenants: enriched, count: enriched.length });
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/tenants");
    return NextResponse.json(safe, { status: 500 });
  }
}

// ── POST /api/tenants ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  // Require super admin
  if (!ctx?.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = TenantCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      handleValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>),
      { status: 422 }
    );
  }

  try {
    const client = getServerClient();
    const repo = new TenantRepository(client);
    const tenant = await repo.createTenant(parsed.data);

    // Log audit event
    await logAuditEvent(client, {
      tenantId: ctx.tenantId, // Use current tenant ID for audit
      userId: ctx.userId,
      action: "tenant_create",
      resourceType: "tenant",
      resourceId: tenant.id,
      changes: { name: tenant.name, slug: tenant.slug, type: tenant.type },
    });

    return NextResponse.json({ tenant }, { status: 201 });
  } catch (err) {
    const safe = handleDatabaseError(err, "POST /api/tenants");
    return NextResponse.json(safe, { status: 500 });
  }
}
