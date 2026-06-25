import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { CapitalProjectRepository } from "@/lib/db/repositories/capital-project.repository";
import { getCurrentTenant } from "@/lib/auth/tenant";
import {
  capitalProjects as mockProjects,
  type UpgradeProject,
} from "@/lib/data/capital-projects";

export const dynamic = "force-dynamic";

export interface CapitalProjectsResponse {
  projects: UpgradeProject[];
  source: "db" | "mock";
  count: number;
}

export async function GET(): Promise<
  NextResponse<CapitalProjectsResponse | { error: string }>
> {
  // ── 1. Try database ────────────────────────────────────────────────────────
  if (isDbConfigured()) {
    try {
      const ctx = await getCurrentTenant();
      const repo = new CapitalProjectRepository(getServerClient());
      const projects = await repo.findAll(ctx?.tenantId);

      if (projects.length > 0) {
        return NextResponse.json(
          { projects, source: "db", count: projects.length },
          {
            headers: {
              "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
              "X-Data-Source": "db",
            },
          }
        );
      }
      // Table exists but is empty — fall through to seed check / mock
    } catch (err) {
      console.error("[api/capital-projects] DB error:", err);
      // Fall through to mock fallback
    }
  }

  // ── 2. Fallback to seeded mock data ────────────────────────────────────────
  return NextResponse.json(
    { projects: mockProjects, source: "mock", count: mockProjects.length },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        "X-Data-Source": "mock",
      },
    }
  );
}
