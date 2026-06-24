import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { TransformerRepository } from "@/lib/db/repositories/transformer.repository";
import {
  TransformerPatchSchema,
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
    const parsed = TransformerPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorToApiError(parsed.error), { status: 422 });
    }
    const repo = new TransformerRepository(getServerClient());
    const existing = await repo.findById(id);
    if (!existing) {
      return NextResponse.json<ApiError>({ error: "Transformer not found" }, { status: 404 });
    }
    await repo.upsert({ ...existing, ...parsed.data, id });
    const updated = await repo.findById(id);
    return NextResponse.json({ transformer: updated });
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
    const repo = new TransformerRepository(getServerClient());
    const existing = await repo.findById(id);
    if (!existing) {
      return NextResponse.json<ApiError>({ error: "Transformer not found" }, { status: 404 });
    }
    await repo.delete(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}
