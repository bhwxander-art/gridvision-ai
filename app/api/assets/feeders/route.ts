import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { FeederRepository } from "@/lib/db/repositories/feeder.repository";
import {
  FeederCreateSchema,
  zodErrorToApiError,
  type ApiError,
} from "@/lib/validation/asset-schemas";
import type { FeederCircuit } from "@/lib/types";

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
    const repo = new FeederRepository(getServerClient());
    const feeders = await repo.listManaged(ctx.tenantId);
    return NextResponse.json({ feeders, count: feeders.length });
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
    const parsed = FeederCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorToApiError(parsed.error), { status: 422 });
    }
    const d = parsed.data;
    const feeder: FeederCircuit = {
      id: d.id, substationId: d.substationId, name: d.name,
      hostingCapacityMW: d.hostingCapacityMW,
      committedLoadMW: d.committedLoadMW,
      queuedLoadMW: d.queuedLoadMW,
    };
    const repo = new FeederRepository(getServerClient());
    await repo.upsert(feeder, ctx.tenantId);
    const created = await repo.findById(d.id, ctx.tenantId);
    return NextResponse.json({ feeder: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}
