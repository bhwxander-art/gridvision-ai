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

export async function GET(): Promise<NextResponse<SubstationServiceData>> {
  // ── 1. Database ────────────────────────────────────────────────────────────
  if (isDbConfigured()) {
    try {
      const ctx = await getCurrentTenant();
      if (!ctx) {
        throw new Error("Tenant context required");
      }
      const repo = new SubstationRepository(getServerClient());
      const portfolio = await repo.findAll(ctx.tenantId);

      const simple: Substation[] = portfolio.map((ss) => {
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
      const body: SubstationServiceData = {
        ...MOCK_BASE,
        portfolio,
        simple,
        _provenance: makeProvenance("Supabase", now, false),
      };

      return NextResponse.json(body, {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Data-Source": "db",
        },
      });
    } catch (dbErr) {
      console.error("[api/substations] DB error, falling back to mock:", dbErr);
    }
  }

  // ── 2. Mock fallback ────────────────────────────────────────────────────────
  return NextResponse.json(
    { ...MOCK_BASE, _provenance: mockProvenance() },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Data-Source": "mock",
      },
    }
  );
}
