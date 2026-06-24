import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { UserRepository, USER_ROLES } from "@/lib/db/repositories/user.repository";
import { getCurrentTenant } from "@/lib/auth/tenant";

export const dynamic = "force-dynamic";

const UserInviteSchema = z.object({
  userId:   z.string().uuid(),
  email:    z.string().email(),
  fullName: z.string().max(120).nullable().optional(),
  role:     z.enum(USER_ROLES as unknown as [string, ...string[]]).default("read_only"),
});

// ── GET /api/users ────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ users: [], count: 0, source: "no-db" });
  }

  try {
    const repo  = new UserRepository(getServerClient());
    const tenantId = ctx.isSuperAdmin
      ? (new URL("", "http://localhost").searchParams.get("tenantId") ?? ctx.tenantId)
      : ctx.tenantId;
    const users = await repo.listUsers(tenantId);
    return NextResponse.json({ users, count: users.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST /api/users ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only super_admin or utility_executive can invite users
  if (!ctx.isSuperAdmin && ctx.role !== "utility_executive") {
    return NextResponse.json({ error: "Forbidden — insufficient role" }, { status: 403 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body   = await req.json();
    const parsed = UserInviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { userId, email, fullName, role } = parsed.data;
    const repo = new UserRepository(getServerClient());
    const user = await repo.createUser(userId, email, fullName ?? null, ctx.tenantId, role as import("@/lib/db/types").UserRole);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
