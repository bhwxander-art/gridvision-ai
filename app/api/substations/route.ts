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
import { SubstationRepository, lastFindAllDiag } from "@/lib/db/repositories/substation.repository";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { makeProvenance, mockProvenance } from "@/lib/provenance";

const MOCK_BASE = {
  portfolio: substationPortfolio,
  trend: transformerLoadingTrend,
  simple: substations,
  config: { territory: planningTerritory, loadGrowthAssumptions },
};

export async function GET(): Promise<NextResponse<SubstationServiceData>> {
  const diag: any = {};
  let exceptionCaught = "none";

  // Step 1: Check if DB configured
  const dbConfigured = isDbConfigured();
  diag.step1 = String(dbConfigured);

  if (!dbConfigured) {
    return NextResponse.json(
      { ...MOCK_BASE, _provenance: mockProvenance() },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Data-Source": "mock",
          "X-Step-1-DbConfigured": String(dbConfigured),
          "X-Step-2-TenantContext": "n/a",
          "X-Step-3-RepoReturnedCount": "n/a",
          "X-Step-4-ExceptionCaught": "n/a",
          "X-Step-5-EffectivePortfolioCount": "n/a",
          "X-Step-6-FallbackReason": "db-not-configured",
        },
      }
    );
  }

  try {
    // Step 2: Get tenant context
    const ctx = await getCurrentTenant();
    diag.step2 = ctx ? "ok" : "null";

    if (!ctx) {
      throw new Error("Tenant context required");
    }

    // Step 3: Call repository
    const repo = new SubstationRepository(getServerClient());
    const portfolio = await repo.findAll(ctx.tenantId);
    diag.step3 = portfolio.length;

    // Step 5: Determine effective portfolio
    const effectivePortfolio = portfolio.length > 0 ? portfolio : substationPortfolio;
    diag.step5 = effectivePortfolio.length;

    // Step 6: Fallback reason
    const fallbackReason = portfolio.length > 0 ? "none" : "empty-portfolio";
    diag.step6 = fallbackReason;

    const simple: Substation[] = effectivePortfolio.map((ss) => {
      const util = ss.peakLoadMW / ss.nameplateMVA;
      const status: Substation["status"] =
        util >= 0.95 ? "capacity-risk" : util >= 0.80 ? "warning" : "normal";
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

    const now = new Date().toISOString();
    const dataSource = portfolio.length > 0 ? "db" : "db-empty-fallback";
    const body: SubstationServiceData = {
      ...MOCK_BASE,
      portfolio: effectivePortfolio,
      simple,
      _provenance: makeProvenance("Supabase", now, portfolio.length === 0),
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Data-Source": dataSource,
        "X-Step-1-DbConfigured": String(dbConfigured),
        "X-Step-2-TenantContext": String(diag.step2),
        "X-Step-3-RepoReturnedCount": String(diag.step3),
        "X-Step-4-ExceptionCaught": exceptionCaught,
        "X-Step-5-EffectivePortfolioCount": String(diag.step5),
        "X-Step-6-FallbackReason": String(diag.step6),
      },
    });
  } catch (dbErr) {
    exceptionCaught = (dbErr as Error).message;

    return NextResponse.json(
      { ...MOCK_BASE, _provenance: mockProvenance() },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Data-Source": "mock",
          "X-Step-1-DbConfigured": String(dbConfigured),
          "X-Step-2-TenantContext": String(diag.step2 ?? "unknown"),
          "X-Step-3-RepoReturnedCount": String(diag.step3 ?? "unknown"),
          "X-Step-4-ExceptionCaught": exceptionCaught,
          "X-Step-5-EffectivePortfolioCount": String(diag.step5 ?? "unknown"),
          "X-Step-6-FallbackReason": "exception",
        },
      }
    );
  }
}
