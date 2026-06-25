import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { TransformerRepository } from "@/lib/db/repositories/transformer.repository";
import {
  TransformerCreateSchema,
  zodErrorToApiError,
  type ApiError,
} from "@/lib/validation/asset-schemas";
import type { TransformerAsset } from "@/lib/planning-engine";

export const dynamic = "force-dynamic";

function dbRequired() {
  return NextResponse.json<ApiError>({ error: "Database not configured" }, { status: 503 });
}

export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) return dbRequired();
  try {
    const repo = new TransformerRepository(getServerClient());
    const transformers = await repo.listManaged();
    return NextResponse.json({ transformers, count: transformers.length });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) return dbRequired();
  try {
    const body = await req.json();
    const parsed = TransformerCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorToApiError(parsed.error), { status: 422 });
    }
    const d = parsed.data;
    const tx: TransformerAsset = {
      id: d.id, substationId: d.substationId, name: d.name,
      ratedMVA: d.ratedMVA, peakLoadMVA: d.peakLoadMVA,
      loadFactor: d.loadFactor, ageYears: d.ageYears, n1Compliant: d.n1Compliant,
    };
    const repo = new TransformerRepository(getServerClient());
    await repo.upsert(tx);
    const created = await repo.findById(d.id);
    return NextResponse.json({ transformer: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}
