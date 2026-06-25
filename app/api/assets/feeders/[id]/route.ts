import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { FeederRepository } from "@/lib/db/repositories/feeder.repository";
import {
  FeederPatchSchema,
  zodErrorToApiError,
  type ApiError,
} from "@/lib/validation/asset-schemas";

export const dynamic = "force-dynamic";

function dbRequired() {
  return NextResponse.json<ApiError>({ error: "Database not configured" }, { status: 503 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isDbConfigured()) return dbRequired();
  const ctx = await getCurrentTenant();
  if (!ctx) return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = FeederPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorToApiError(parsed.error), { status: 422 });
    }
    const repo = new FeederRepository(getServerClient());
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      return NextResponse.json<ApiError>({ error: "Feeder not found" }, { status: 404 });
    }
    await repo.upsert({ ...existing, ...parsed.data, id }, ctx.tenantId);
    const updated = await repo.findById(id, ctx.tenantId);
    return NextResponse.json({ feeder: updated });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isDbConfigured()) return dbRequired();
  const ctx = await getCurrentTenant();
  if (!ctx) return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const repo = new FeederRepository(getServerClient());
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      return NextResponse.json<ApiError>({ error: "Feeder not found" }, { status: 404 });
    }
    await repo.delete(id, ctx.tenantId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}
