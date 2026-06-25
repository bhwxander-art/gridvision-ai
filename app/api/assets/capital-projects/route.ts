import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { CapitalProjectRepository } from "@/lib/db/repositories/capital-project.repository";
import {
  CapitalProjectCreateSchema,
  zodErrorToApiError,
  type ApiError,
} from "@/lib/validation/asset-schemas";
import type { UpgradeProject } from "@/lib/data/capital-projects";

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
    const repo = new CapitalProjectRepository(getServerClient());
    const projects = await repo.listManaged(ctx.tenantId);
    return NextResponse.json({ projects, count: projects.length });
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
    const parsed = CapitalProjectCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorToApiError(parsed.error), { status: 422 });
    }
    const d = parsed.data;
    const project: UpgradeProject = {
      id: d.id, substationId: d.substationId, projectName: d.projectName,
      upgradeType: d.upgradeType, estimatedCostUSD: d.estimatedCostUSD,
      addedCapacityMW: d.addedCapacityMW, implementationMonths: d.implementationMonths,
      riskReduction: d.riskReduction, priorityScore: d.priorityScore,
    };
    const repo = new CapitalProjectRepository(getServerClient());
    await repo.upsert(project, d.status);
    const created = await repo.findById(d.id);
    return NextResponse.json({ project: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json<ApiError>({ error: String(err) }, { status: 500 });
  }
}
