import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { SubstationRepository } from "@/lib/db/repositories/substation.repository";
import {
  SubstationCreateSchema,
  zodErrorToApiError,
  type ApiError,
} from "@/lib/validation/asset-schemas";
import type { SubstationPlan } from "@/lib/types";

export const dynamic = "force-dynamic";

type ManagedSubstation = SubstationPlan & { createdAt: string; updatedAt: string };

function dbRequired() {
  return NextResponse.json<ApiError>(
    { error: "Database not configured" },
    { status: 503 }
  );
}

export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) return dbRequired();
  try {
    const repo = new SubstationRepository(getServerClient());
    const substations = await repo.listManaged(ctx.tenantId);
    return NextResponse.json({ substations, count: substations.length });
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
    const parsed = SubstationCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorToApiError(parsed.error), { status: 422 });
    }
    const d = parsed.data;
    const ss: SubstationPlan = {
      id: d.id, name: d.name, region: d.region,
      voltageKV: d.voltageKV, nameplateMVA: d.nameplateMVA,
      peakLoadMW: d.peakLoadMW, n1CapacityMW: d.n1CapacityMW,
      annualGrowthPct: d.annualGrowthPct,
      latitude: d.latitude, longitude: d.longitude,
      transformers: [], feeders: [],
    };
    const repo = new SubstationRepository(getServerClient());
    await repo.upsert(ss);
    const created = await repo.findById(d.id);
    return NextResponse.json({ substation: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}
