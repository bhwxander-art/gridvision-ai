import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { CapitalProjectRepository } from "@/lib/db/repositories/capital-project.repository";
import {
  CapitalProjectPatchSchema,
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
  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = CapitalProjectPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorToApiError(parsed.error), { status: 422 });
    }
    const repo = new CapitalProjectRepository(getServerClient());
    const existing = await repo.findById(id);
    if (!existing) {
      return NextResponse.json<ApiError>({ error: "Capital project not found" }, { status: 404 });
    }
    const merged = { ...existing, ...parsed.data, id };
    await repo.upsert(merged, parsed.data.status ?? "planned");
    const updated = await repo.findById(id);
    return NextResponse.json({ project: updated });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isDbConfigured()) return dbRequired();
  const { id } = await params;
  try {
    const repo = new CapitalProjectRepository(getServerClient());
    const existing = await repo.findById(id);
    if (!existing) {
      return NextResponse.json<ApiError>({ error: "Capital project not found" }, { status: 404 });
    }
    await repo.delete(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}
