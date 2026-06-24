import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { TenantRepository } from "@/lib/db/repositories/tenant.repository";
import { getCurrentTenant } from "@/lib/auth/tenant";

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
  if (!ctx?.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden — Super Admin only" }, { status: 403 });
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST /api/tenants ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();
  if (!ctx?.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden — Super Admin only" }, { status: 403 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body   = await req.json();
    const parsed = TenantCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const repo   = new TenantRepository(getServerClient());
    const tenant = await repo.createTenant(parsed.data);
    return NextResponse.json({ tenant }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
