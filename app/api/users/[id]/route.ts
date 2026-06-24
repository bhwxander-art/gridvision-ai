import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { UserRepository, USER_ROLES } from "@/lib/db/repositories/user.repository";
import { getCurrentTenant } from "@/lib/auth/tenant";
import type { UserRole } from "@/lib/db/types";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  role:      z.enum(USER_ROLES as unknown as [string, ...string[]]).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ctx.isSuperAdmin && ctx.role !== "utility_executive") {
    return NextResponse.json({ error: "Forbidden — insufficient role" }, { status: 403 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id: userId } = await params;

  try {
    const body   = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const repo = new UserRepository(getServerClient());
    const { role, is_active } = parsed.data;

    if (role !== undefined) {
      await repo.updateRole(userId, ctx.tenantId, role as UserRole);
    }
    if (is_active === false) {
      await repo.deactivateUser(userId, ctx.tenantId);
    }

    const users   = await repo.listUsers(ctx.tenantId);
    const updated = users.find((u) => u.id === userId);
    return NextResponse.json({ user: updated ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
