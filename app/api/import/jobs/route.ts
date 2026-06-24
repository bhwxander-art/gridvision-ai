import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { ImportJobRepository } from "@/lib/db/repositories/import-job.repository";
import type { ImportEntityType } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json({ jobs: [], count: 0, source: "no-db" });
  }

  const ctx = await getCurrentTenant();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entity_type") as ImportEntityType | null;
  const limit      = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

  try {
    const repo = new ImportJobRepository(getServerClient());
    const jobs = await repo.listJobs(ctx.tenantId, entityType ?? undefined, limit);
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
