import { NextResponse } from "next/server";
import type { SubstationServiceData } from "@/lib/services/substation.service";
import type { Substation } from "@/lib/types";
import {
  substationPortfolio,
  planningTerritory,
  loadGrowthAssumptions,
  transformerLoadingTrend,
} from "@/lib/enterprise-data";
import { substations } from "@/lib/sample-data";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { SubstationRepository } from "@/lib/db/repositories/substation.repository";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { makeProvenance, mockProvenance } from "@/lib/provenance";

const MOCK_BASE = {
  portfolio: substationPortfolio,
  trend: transformerLoadingTrend,
  simple: substations,
  config: { territory: planningTerritory, loadGrowthAssumptions },
};

function buildSimple(portfolio: SubstationServiceData["portfolio"]): Substation[] {
  return portfolio.map((ss) => {
    const util = ss.peakLoadMW / ss.nameplateMVA;
    const status: Substation["status"] =
      util >= 0.95 ? "capacity-risk" : util >= 0.8 ? "warning" : "normal";
    return {
      id: ss.id.replace("ss-", ""),
      name: ss.name.split(" ").slice(0, 2).join(" "),
      status,
      load: ss.peakLoadMW,
      capacity: ss.nameplateMVA,
      latitude: ss.latitude,
      longitude: ss.longitude,
      region: ss.region,
    };
  });
}

export async function GET(): Promise<NextResponse<SubstationServiceData>> {
  // DB not configured — return mock (dev / demo environments)
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ...MOCK_BASE, _provenance: mockProvenance() },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Data-Source": "mock",
          "X-Fallback-Reason": "db-not-configured",
        },
      }
    );
  }

  try {
    const ctx = await getCurrentTenant();

    if (!ctx) {
      // Return mock for unauthenticated access in dev
      return NextResponse.json(
        { ...MOCK_BASE, _provenance: mockProvenance() },
        {
          headers: {
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
            "X-Data-Source": "mock",
            "X-Fallback-Reason": "no-tenant-context",
          },
        }
      );
    }

    const repo = new SubstationRepository(getServerClient());
    const portfolio = await repo.getPortfolio(ctx.tenantId);

    if (portfolio.length === 0) {
      // No tenant data in DB
      const isDev = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_USE_MOCK_DATA === "true";

      if (isDev) {
        // Development: serve mock with explicit provenance
        return NextResponse.json(
          {
            ...MOCK_BASE,
            _provenance: mockProvenance("dev-seed"),
          },
          {
            headers: {
              "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
              "X-Data-Source": "mock-dev",
              "X-Fallback-Reason": "empty-portfolio-dev",
            },
          }
        );
      }

      // Production with no data: return empty portfolio
      return NextResponse.json(
        {
          portfolio: [],
          trend: transformerLoadingTrend,
          simple: [],
          config: { territory: planningTerritory, loadGrowthAssumptions },
          _provenance: mockProvenance("no-data"),
        },
        {
          headers: {
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
            "X-Data-Source": "empty",
            "X-Fallback-Reason": "empty-portfolio-production",
          },
        }
      );
    }

    // Live DB data
    const now = new Date().toISOString();
    const body: SubstationServiceData = {
      ...MOCK_BASE,
      portfolio,
      simple: buildSimple(portfolio),
      _provenance: makeProvenance("Supabase", now, false),
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Data-Source": "db",
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[api/substations] Error:", errMsg);

    return NextResponse.json(
      { ...MOCK_BASE, _provenance: mockProvenance() },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Data-Source": "mock",
          "X-Fallback-Reason": "exception",
        },
      }
    );
  }
}
